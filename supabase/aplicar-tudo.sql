-- ============================================================
-- Nany Lanches - as 4 migrations concatenadas, na ordem.
--
-- Para colar no SQL Editor do Supabase quando nao houver Docker
-- pra rodar `supabase db push`. Roda tudo numa transacao: se
-- qualquer linha falhar, NADA e aplicado e o banco nao fica meio
-- migrado -- que era o risco de aplicar SQL nao testado.
--
-- Este arquivo fica FORA de supabase/migrations/ de proposito:
-- dentro, o `db push` o trataria como uma quinta migration e
-- tentaria aplicar tudo duas vezes.
--
-- Gerado de:
--   20260917120000_base_ingredientes_produtos_receita.sql
--   20260917121000_compras_e_vendas.sql
--   20260917122000_fechamento_e_dashboard.sql
--   20260917123000_registrar_compra.sql
-- ============================================================

BEGIN;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 20260917120000_base_ingredientes_produtos_receita.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Base do controle da Nany Lanches: ingrediente cru, produto vendido e a
-- receita que liga os dois.
--
-- O diagnóstico do PI04 é que ela não sabe o custo de um hot-dog. Esse número
-- não existe em lugar nenhum a menos que o sistema saiba (a) quanto custou o
-- pão e a salsicha e (b) quanto de cada um entra num hot-dog. Daí as três
-- tabelas aqui: `ingredientes` guarda (a), `receita_itens` guarda (b), e
-- `produtos` é o que ela de fato vende no balcão.
--
-- Ingrediente e produto são tabelas separadas, não uma tabela com flag. No
-- Almoxá os dois moram em `products` com `is_ingredient`, e o preço acabou
-- tendo dois significados na mesma coluna (compra pro ingrediente, venda pro
-- produto final) -- toda consulta precisa lembrar de filtrar a flag ou o
-- número sai errado. Aqui pão nunca tem preço de venda e hot-dog nunca tem
-- saldo de estoque próprio, então o banco não deixa a confusão existir.

-- ---------------------------------------------------------------------------
-- 1. Unidades: saldo mora sempre na unidade-base
-- ---------------------------------------------------------------------------
-- A Nany compra molho em quilo e usa em grama. Se o saldo fosse guardado na
-- unidade digitada, cada conta de receita teria que converter antes de somar
-- -- e um único lugar esquecido faz o estoque de molho errar por mil.
-- Convenção: massa em g, volume em ml, contagem em unidade. A unidade
-- escolhida por ingrediente serve só pra exibir e digitar.

CREATE OR REPLACE FUNCTION public.unidade_base(_unidade TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _unidade
    WHEN 'kg' THEN 'g'
    WHEN 'g'  THEN 'g'
    WHEN 'l'  THEN 'ml'
    WHEN 'ml' THEN 'ml'
    ELSE 'unidade'
  END;
$$;

CREATE OR REPLACE FUNCTION public.fator_base(_unidade TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _unidade
    WHEN 'kg' THEN 1000
    WHEN 'l'  THEN 1000
    ELSE 1
  END;
$$;

-- ---------------------------------------------------------------------------
-- 1a. Dia civil de Porto Alegre, não de UTC
-- ---------------------------------------------------------------------------
-- O servidor do Supabase roda em UTC, então `CURRENT_DATE` às 21h30 de sábado
-- já devolve domingo aqui. Todo lugar que fecha o dia (venda, compra,
-- dashboard) passa por esta função, pra ninguém cair no fuso do servidor sem
-- perceber -- é o tipo de erro que a faria desconfiar do sistema inteiro
-- justamente no número que ela conhece de cabeça.
CREATE OR REPLACE FUNCTION public.dia_local(_em TIMESTAMPTZ DEFAULT now())
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (_em AT TIME ZONE 'America/Sao_Paulo')::date;
$$;

GRANT EXECUTE ON FUNCTION public.dia_local(TIMESTAMPTZ) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1b. Nome normalizado, pra casar o que a IA leu com o que já existe
-- ---------------------------------------------------------------------------
-- A leitura da nota devolve "PAO DE HOT DOG", "Pão", "pao  de hotdog" -- e sem
-- normalizar, cada foto criaria um ingrediente novo, com o estoque do pão
-- espalhado em quatro linhas e o custo do hot-dog errado em todas.
--
-- `translate` em vez da extensão `unaccent` de propósito: unaccent precisa de
-- CREATE EXTENSION (e não é IMMUTABLE sem wrapper, então não serve pra índice).
-- A tabela abaixo cobre o português, que é tudo que esta conta digita.
CREATE OR REPLACE FUNCTION public.nome_normalizado(_nome TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    translate(
      lower(trim(_nome)),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'
    ),
    '\s+', ' ', 'g'          -- "pao  de   hotdog" -> "pao de hotdog"
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Ingredientes (pão, salsicha, molho, polpa de suco)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingredientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  nome TEXT NOT NULL CHECK (length(trim(nome)) > 0 AND length(nome) <= 120),
  unidade TEXT NOT NULL DEFAULT 'unidade'
    CHECK (unidade IN ('unidade', 'g', 'kg', 'ml', 'l')),

  -- Saldo na unidade-base. Pode ficar negativo de propósito: ela registra
  -- venda no aperto da tarde e só lança a nota do mercado à noite. Barrar a
  -- venda por falta de saldo faria o sistema mentir menos e atrapalhar mais
  -- -- e o PI06 já assume que a adoção depende de não estorvar a rotina.
  -- Saldo negativo é lido como "falta registrar compra" no dashboard.
  estoque_base NUMERIC NOT NULL DEFAULT 0,

  -- Custo de UMA unidade-base (1 g, 1 ml, 1 unidade), por média ponderada
  -- móvel das compras. Média, não último preço: o pão que ela comprou a
  -- R$ 0,50 e depois a R$ 0,60 custa algo entre os dois enquanto os dois
  -- pacotes estiverem no estoque, e é esse meio que o lucro do dia precisa.
  custo_base NUMERIC NOT NULL DEFAULT 0 CHECK (custo_base >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unicidade pelo nome NORMALIZADO, não pelo texto cru: com UNIQUE(user_id,
-- nome), "Pão" e "PAO" conviveriam como dois ingredientes. O índice funcional
-- faz o banco recusar a duplicata, então nem um bug de tela nem um INSERT
-- manual conseguem partir o estoque do pão em dois.
CREATE UNIQUE INDEX IF NOT EXISTS ingredientes_nome_unico
  ON public.ingredientes (user_id, public.nome_normalizado(nome));

ALTER TABLE public.ingredientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dona gerencia os proprios ingredientes" ON public.ingredientes;
CREATE POLICY "Dona gerencia os proprios ingredientes" ON public.ingredientes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- estoque_base e custo_base são derivados das compras e vendas: quem escreve
-- neles é gatilho (SECURITY DEFINER), nunca a tela. Sem esse corte, um saldo
-- digitado à mão desmentiria silenciosamente o histórico que o dashboard soma.
--
-- O REVOKE é obrigatório e não decorativo: o Supabase roda
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO authenticated`, então
-- toda tabela nova JÁ nasce com INSERT/UPDATE liberados em todas as colunas.
-- GRANT por coluna só soma permissão -- sem revogar o privilégio de tabela
-- primeiro, o recorte abaixo não recorta nada.
REVOKE INSERT, UPDATE ON public.ingredientes FROM authenticated;
GRANT SELECT, DELETE ON public.ingredientes TO authenticated;
GRANT INSERT (user_id, nome, unidade) ON public.ingredientes TO authenticated;
GRANT UPDATE (nome, unidade) ON public.ingredientes TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Produtos (hot-dog R$ 10, suco R$ 5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  nome TEXT NOT NULL CHECK (length(trim(nome)) > 0 AND length(nome) <= 120),
  preco_venda NUMERIC NOT NULL DEFAULT 0 CHECK (preco_venda >= 0),
  -- Ordem dos botões na tela de venda rápida: o que mais sai fica primeiro,
  -- decidido por ela, não pelo alfabeto.
  ordem SMALLINT NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS produtos_nome_unico
  ON public.produtos (user_id, public.nome_normalizado(nome));

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dona gerencia os proprios produtos" ON public.produtos;
CREATE POLICY "Dona gerencia os proprios produtos" ON public.produtos
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produtos TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Receita: quanto de cada ingrediente entra em 1 unidade do produto
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receita_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos ON DELETE CASCADE,
  ingrediente_id UUID NOT NULL REFERENCES public.ingredientes ON DELETE CASCADE,
  -- Na unidade-base do ingrediente: 1 pão = 1, 20 g de molho = 20.
  quantidade_base NUMERIC NOT NULL CHECK (quantidade_base > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (produto_id, ingrediente_id)
);

ALTER TABLE public.receita_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dona gerencia a propria receita" ON public.receita_itens;
CREATE POLICY "Dona gerencia a propria receita" ON public.receita_itens
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receita_itens TO authenticated;

CREATE INDEX IF NOT EXISTS receita_itens_produto_idx
  ON public.receita_itens (produto_id);
CREATE INDEX IF NOT EXISTS receita_itens_ingrediente_idx
  ON public.receita_itens (ingrediente_id);

-- ---------------------------------------------------------------------------
-- 5. Custo de um produto agora, somando a receita
-- ---------------------------------------------------------------------------
-- É a resposta direta ao "não sei quanto cada hot-dog custa" do PI04.
-- Produto sem receita cadastrada custa 0 -- e a tela mostra isso como
-- pendência, em vez de fingir um lucro igual ao preço cheio.
CREATE OR REPLACE FUNCTION public.custo_do_produto(_produto_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(r.quantidade_base * i.custo_base), 0)
  FROM public.receita_itens r
  JOIN public.ingredientes i ON i.id = r.ingrediente_id
  WHERE r.produto_id = _produto_id;
$$;

-- NÃO exposta à tela, e isto é segurança, não arrumação.
--
-- A função é SECURITY DEFINER (precisa ser: o gatilho `fecha_venda` a chama
-- durante um INSERT e tem que atravessar a RLS pra somar a receita). Como ela
-- recebe um UUID e não confere dono nenhum, qualquer conta autenticada poderia
-- chamá-la com o id do produto de OUTRA conta e descobrir o custo do produto
-- alheio -- justamente o número que um concorrente iria querer.
--
-- Em Postgres, função nova já nasce executável por PUBLIC, então o REVOKE é
-- obrigatório: sem ele, não conceder a `authenticated` não impede nada.
-- Quem a tela usa é `produtos_com_custo()`, que filtra por auth.uid().
REVOKE ALL ON FUNCTION public.custo_do_produto(UUID) FROM PUBLIC, anon, authenticated;

-- Grade da tela de produtos: preço, custo calculado e a margem que sai dos
-- dois, já pronta pra não recalcular no celular.
CREATE OR REPLACE FUNCTION public.produtos_com_custo()
RETURNS TABLE (
  id UUID,
  nome TEXT,
  preco_venda NUMERIC,
  ordem SMALLINT,
  ativo BOOLEAN,
  custo_unitario NUMERIC,
  lucro_unitario NUMERIC,
  tem_receita BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.nome,
    p.preco_venda,
    p.ordem,
    p.ativo,
    public.custo_do_produto(p.id) AS custo_unitario,
    p.preco_venda - public.custo_do_produto(p.id) AS lucro_unitario,
    EXISTS (SELECT 1 FROM public.receita_itens r WHERE r.produto_id = p.id) AS tem_receita
  FROM public.produtos p
  WHERE p.user_id = auth.uid()
  ORDER BY p.ordem, p.nome;
$$;

GRANT EXECUTE ON FUNCTION public.produtos_com_custo() TO authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 20260917121000_compras_e_vendas.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Os dois lados do dinheiro: o que sai (compra de ingrediente, lida da
-- notinha) e o que entra (venda no balcão).
--
-- Toda a aritmética de estoque e de custo mora em gatilho, não na tela. A
-- leitura por foto e o lançamento manual desembocam no mesmo INSERT, então
-- escrever a conta uma vez no banco garante que as duas portas de entrada
-- chegam ao mesmo saldo -- e que um app desatualizado no celular dela não
-- consegue gravar um número inconsistente.

-- ---------------------------------------------------------------------------
-- 1. Compra = uma notinha
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  fornecedor TEXT NOT NULL DEFAULT '' CHECK (length(fornecedor) <= 160),
  -- Data da compra separada de created_at: ela fotografa a nota de ontem hoje,
  -- e o fechamento do dia tem que contar a despesa no dia em que ela aconteceu.
  --
  -- `dia_local()` e não `CURRENT_DATE`: o servidor do Supabase roda em UTC, e
  -- uma compra lançada às 22h já cairia no dia seguinte.
  comprada_em DATE NOT NULL DEFAULT public.dia_local(),
  origem TEXT NOT NULL DEFAULT 'foto' CHECK (origem IN ('foto', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.compras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dona gerencia as proprias compras" ON public.compras;
CREATE POLICY "Dona gerencia as proprias compras" ON public.compras
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE fica fora porque `compra_itens` cascateia: apagar a compra levaria os
-- itens embora sem passar por nenhum estorno, e o estoque ficaria com o que a
-- nota apagada trouxe. Quem desfaz é `cancelar_compra()`.
REVOKE DELETE ON public.compras FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.compras TO authenticated;

CREATE INDEX IF NOT EXISTS compras_data_idx ON public.compras (user_id, comprada_em DESC);

CREATE TABLE IF NOT EXISTS public.compra_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  compra_id UUID NOT NULL REFERENCES public.compras ON DELETE CASCADE,
  ingrediente_id UUID NOT NULL REFERENCES public.ingredientes ON DELETE CASCADE,

  -- Guarda o que ela conferiu na tela, na unidade que ela leu na nota
  -- ("2 kg de salsicha a R$ 18,00"). O valor em unidade-base é derivado, não
  -- digitado: se um dia o fator mudar, o histórico não vira ficção, e a linha
  -- continua conferível contra a nota de papel.
  quantidade NUMERIC NOT NULL CHECK (quantidade > 0),
  unidade TEXT NOT NULL DEFAULT 'unidade'
    CHECK (unidade IN ('unidade', 'g', 'kg', 'ml', 'l')),
  preco_unitario NUMERIC NOT NULL CHECK (preco_unitario >= 0),

  quantidade_base NUMERIC
    GENERATED ALWAYS AS (quantidade * public.fator_base(unidade)) STORED,
  custo_base NUMERIC
    GENERATED ALWAYS AS (preco_unitario / public.fator_base(unidade)) STORED,
  total NUMERIC
    GENERATED ALWAYS AS (quantidade * preco_unitario) STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.compra_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dona gerencia os proprios itens de compra" ON public.compra_itens;
CREATE POLICY "Dona gerencia os proprios itens de compra" ON public.compra_itens
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Nem UPDATE nem DELETE pra tela. `compra_itens_aplica` é AFTER INSERT: ele
-- soma o estoque quando o item entra e não sabe de mais nada depois disso.
-- Alterar a quantidade mudaria o total da nota sem mexer no saldo, e apagar o
-- item deixaria o ingrediente com estoque que nunca foi comprado -- as duas
-- coisas em silêncio, sem nada acusar.
-- Desfazer uma nota errada passa por `cancelar_compra()` (migration
-- 20260917123000), que estorna o saldo na mesma transação.
REVOKE UPDATE, DELETE ON public.compra_itens FROM authenticated;
GRANT SELECT, INSERT ON public.compra_itens TO authenticated;

CREATE INDEX IF NOT EXISTS compra_itens_compra_idx ON public.compra_itens (compra_id);

-- Entrada de ingrediente: soma saldo e recalcula o custo médio ponderado.
--
-- As duas colunas do SET leem o valor ANTIGO da linha, então custo_base usa o
-- estoque de antes da compra -- que é exatamente o peso certo da média. Sem
-- estoque anterior (primeira compra, ou saldo zerado/negativo por venda não
-- lançada), o custo passa a ser o da nota, sem média: não há nada do passado
-- pra ponderar, e insistir na média arrastaria um custo velho pra frente.
CREATE OR REPLACE FUNCTION public.aplica_compra()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ingredientes
     SET custo_base = CASE
           WHEN estoque_base > 0
             THEN (estoque_base * custo_base + NEW.quantidade_base * NEW.custo_base)
                  / (estoque_base + NEW.quantidade_base)
           ELSE NEW.custo_base
         END,
         estoque_base = estoque_base + NEW.quantidade_base
   WHERE id = NEW.ingrediente_id
     AND user_id = NEW.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingrediente não encontrado nesta conta.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.aplica_compra() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS compra_itens_aplica ON public.compra_itens;
CREATE TRIGGER compra_itens_aplica
  AFTER INSERT ON public.compra_itens
  FOR EACH ROW EXECUTE FUNCTION public.aplica_compra();

-- ---------------------------------------------------------------------------
-- 2. Venda
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos ON DELETE RESTRICT,
  quantidade NUMERIC NOT NULL CHECK (quantidade > 0),

  -- Preço e custo são FOTOGRAFIA do momento da venda, não referência viva ao
  -- produto. É o que sustenta o histórico: quando a salsicha subir de preço em
  -- novembro, o lucro que o dashboard mostra pra outubro não pode mudar junto.
  -- Referência viva faria o fechamento de um dia fechado se reescrever sozinho
  -- a cada compra nova -- e aí o histórico deixa de valer como registro.
  preco_unitario NUMERIC NOT NULL CHECK (preco_unitario >= 0),
  custo_unitario NUMERIC NOT NULL DEFAULT 0 CHECK (custo_unitario >= 0),

  total NUMERIC GENERATED ALWAYS AS (quantidade * preco_unitario) STORED,
  lucro NUMERIC
    GENERATED ALWAYS AS (quantidade * (preco_unitario - custo_unitario)) STORED,

  -- Toque errado no botão de venda rápida acontece. Cancelar mantém a linha e
  -- marca a data, em vez de apagar: o estoque volta e o dia continua auditável.
  cancelada_em TIMESTAMPTZ,
  vendida_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vendas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dona gerencia as proprias vendas" ON public.vendas;
CREATE POLICY "Dona gerencia as proprias vendas" ON public.vendas
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- custo_unitario é preenchido pelo gatilho a partir da receita; cancelamento
-- passa por cancelar_venda(), que devolve o estoque na mesma transação.
-- Liberar as duas colunas pra tela deixaria gravar lucro inventado -- e um
-- UPDATE livre em `cancelada_em` marcaria a venda como cancelada sem devolver
-- ingrediente nenhum ao estoque.
--
-- REVOKE antes do GRANT por coluna: ver a nota em `ingredientes` na migration
-- 20260917120000. Sem ele o recorte é inócuo.
REVOKE INSERT, UPDATE, DELETE ON public.vendas FROM authenticated;
GRANT SELECT ON public.vendas TO authenticated;
GRANT INSERT (user_id, produto_id, quantidade, preco_unitario, vendida_em)
  ON public.vendas TO authenticated;

CREATE INDEX IF NOT EXISTS vendas_data_idx ON public.vendas (user_id, vendida_em DESC);

-- Antes de gravar: fecha o preço (o da tabela, se a tela não mandou outro) e
-- congela o custo vindo da receita.
CREATE OR REPLACE FUNCTION public.fecha_venda()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tabela NUMERIC;
BEGIN
  SELECT preco_venda INTO tabela
    FROM public.produtos
   WHERE id = NEW.produto_id AND user_id = NEW.user_id;

  IF tabela IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado nesta conta.';
  END IF;

  IF NEW.preco_unitario IS NULL OR NEW.preco_unitario = 0 THEN
    NEW.preco_unitario := tabela;
  END IF;

  NEW.custo_unitario := public.custo_do_produto(NEW.produto_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fecha_venda() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vendas_fecha ON public.vendas;
CREATE TRIGGER vendas_fecha
  BEFORE INSERT ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.fecha_venda();

-- Depois de gravar: baixa do estoque o que a receita consumiu.
-- Saldo pode ficar negativo (ver comentário em ingredientes.estoque_base):
-- vender sem ter lançado a compra é rotina dela, não erro a ser bloqueado.
CREATE OR REPLACE FUNCTION public.baixa_receita()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ingredientes i
     SET estoque_base = i.estoque_base - (r.quantidade_base * NEW.quantidade)
    FROM public.receita_itens r
   WHERE r.ingrediente_id = i.id
     AND r.produto_id = NEW.produto_id
     AND i.user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.baixa_receita() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vendas_baixa_receita ON public.vendas;
CREATE TRIGGER vendas_baixa_receita
  AFTER INSERT ON public.vendas
  FOR EACH ROW EXECUTE FUNCTION public.baixa_receita();

-- Cancelar devolve o estoque e marca a linha, numa transação só. Idempotente:
-- dois toques no botão de desfazer não devolvem ingrediente em dobro.
CREATE OR REPLACE FUNCTION public.cancelar_venda(_venda_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  alvo public.vendas;
BEGIN
  SELECT * INTO alvo
    FROM public.vendas
   WHERE id = _venda_id AND user_id = auth.uid()
     FOR UPDATE;

  -- NOT FOUND, não `alvo IS NULL`: em registro, `IS NULL` só dá verdadeiro
  -- quando TODO campo é nulo. Funcionaria aqui por acidente (linha não achada
  -- vira registro todo nulo), mas deixaria de funcionar no dia em que a
  -- consulta ganhasse um COALESCE.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada nesta conta.';
  END IF;
  IF alvo.cancelada_em IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.ingredientes i
     SET estoque_base = i.estoque_base + (r.quantidade_base * alvo.quantidade)
    FROM public.receita_itens r
   WHERE r.ingrediente_id = i.id
     AND r.produto_id = alvo.produto_id
     AND i.user_id = alvo.user_id;

  UPDATE public.vendas SET cancelada_em = now() WHERE id = _venda_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_venda(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_venda(UUID) TO authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 20260917122000_fechamento_e_dashboard.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- O fechamento do dia e os números do dashboard.
--
-- As contas ficam no banco, não no celular: o app pede um resumo já somado em
-- vez de baixar venda por venda pra somar na tela. Num 3G de rua isso é a
-- diferença entre abrir e não abrir -- e o PI06 aponta o abandono do registro
-- diário como o risco mais alto do projeto.
--
-- DUAS LEITURAS DE "RESULTADO", de propósito. Confundir as duas é o erro fácil
-- aqui, porque só uma delas responde "o negócio dá lucro?":
--
--   lucro_vendas -- receita do dia menos o custo dos ingredientes que as
--     vendas do dia consumiram. É a margem real do que saiu do balcão. Mede o
--     negócio.
--
--   caixa -- o que entrou de venda menos o que ela pagou de compra naquele
--     dia. É dinheiro, não margem: num dia de feira o caixa afunda mesmo com
--     a lanchonete vendendo bem, porque a compra cobre a semana inteira. Mede
--     o bolso.
--
-- Mostrar só a segunda faria um dia normal de compras parecer prejuízo. Mostrar
-- só a primeira esconderia o aperto de caixa que ela sente de verdade.

-- `public.dia_local()` vem da migration base (20260917120000): é ela que
-- mantém venda, compra e dashboard fechando no mesmo dia civil.

-- ---------------------------------------------------------------------------
-- 1. Fechamento de um dia
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fechamento_do_dia(_dia DATE DEFAULT NULL)
RETURNS TABLE (
  dia DATE,
  receita NUMERIC,
  custo_vendido NUMERIC,
  lucro_vendas NUMERIC,
  compras NUMERIC,
  caixa NUMERIC,
  unidades NUMERIC,
  atendimentos BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH alvo AS (
    SELECT COALESCE(_dia, public.dia_local(now())) AS d
  ),
  v AS (
    SELECT
      COALESCE(SUM(total), 0)          AS receita,
      COALESCE(SUM(quantidade * custo_unitario), 0) AS custo,
      COALESCE(SUM(lucro), 0)          AS lucro,
      COALESCE(SUM(quantidade), 0)     AS unidades,
      COUNT(*)                         AS atendimentos
    FROM public.vendas, alvo
    WHERE user_id = auth.uid()
      AND cancelada_em IS NULL
      AND public.dia_local(vendida_em) = alvo.d
  ),
  c AS (
    SELECT COALESCE(SUM(ci.total), 0) AS gasto
    FROM public.compra_itens ci
    JOIN public.compras co ON co.id = ci.compra_id
    CROSS JOIN alvo
    WHERE co.user_id = auth.uid()
      AND co.comprada_em = alvo.d
  )
  SELECT
    alvo.d,
    v.receita,
    v.custo,
    v.lucro,
    c.gasto,
    v.receita - c.gasto,
    v.unidades,
    v.atendimentos
  FROM alvo, v, c;
$$;

GRANT EXECUTE ON FUNCTION public.fechamento_do_dia(DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Série por dia — alimenta o gráfico do dashboard
-- ---------------------------------------------------------------------------
-- generate_series garante linha pra todo dia do intervalo, inclusive os
-- fechados: um gráfico que simplesmente omite o domingo desenha a semana com
-- seis dias e engana a leitura da tendência.
CREATE OR REPLACE FUNCTION public.resumo_por_dia(_dias INTEGER DEFAULT 14)
RETURNS TABLE (
  dia DATE,
  receita NUMERIC,
  custo_vendido NUMERIC,
  lucro_vendas NUMERIC,
  compras NUMERIC,
  unidades NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH janela AS (
    SELECT generate_series(
      public.dia_local(now()) - (GREATEST(LEAST(_dias, 180), 1) - 1),
      public.dia_local(now()),
      INTERVAL '1 day'
    )::date AS d
  )
  SELECT
    j.d,
    COALESCE(v.receita, 0),
    COALESCE(v.custo, 0),
    COALESCE(v.lucro, 0),
    COALESCE(c.gasto, 0),
    COALESCE(v.unidades, 0)
  FROM janela j
  LEFT JOIN (
    SELECT
      public.dia_local(vendida_em) AS d,
      SUM(total) AS receita,
      SUM(quantidade * custo_unitario) AS custo,
      SUM(lucro) AS lucro,
      SUM(quantidade) AS unidades
    FROM public.vendas
    WHERE user_id = auth.uid() AND cancelada_em IS NULL
    GROUP BY 1
  ) v ON v.d = j.d
  LEFT JOIN (
    SELECT co.comprada_em AS d, SUM(ci.total) AS gasto
    FROM public.compra_itens ci
    JOIN public.compras co ON co.id = ci.compra_id
    WHERE co.user_id = auth.uid()
    GROUP BY 1
  ) c ON c.d = j.d
  ORDER BY j.d;
$$;

GRANT EXECUTE ON FUNCTION public.resumo_por_dia(INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Quanto cada produto rendeu na janela
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendas_por_produto(_dias INTEGER DEFAULT 30)
RETURNS TABLE (
  produto_id UUID,
  nome TEXT,
  unidades NUMERIC,
  receita NUMERIC,
  lucro NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.nome,
    COALESCE(SUM(v.quantidade), 0),
    COALESCE(SUM(v.total), 0),
    COALESCE(SUM(v.lucro), 0)
  FROM public.produtos p
  LEFT JOIN public.vendas v
    ON v.produto_id = p.id
   AND v.cancelada_em IS NULL
   AND public.dia_local(v.vendida_em)
       >= public.dia_local(now()) - (GREATEST(LEAST(_dias, 365), 1) - 1)
  WHERE p.user_id = auth.uid()
  GROUP BY p.id, p.nome
  ORDER BY 4 DESC, p.nome;
$$;

GRANT EXECUTE ON FUNCTION public.vendas_por_produto(INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. O que está acabando
-- ---------------------------------------------------------------------------
-- Responde ao "às vezes compro menos do que precisaria" do PI04. O ritmo sai
-- das vendas dos últimos 7 dias: com quantos dias de estoque ela ainda está.
--
-- A média divide pelos dias em que o ingrediente existe, não pelos 7 fixos --
-- ingrediente cadastrado ontem que já saiu bastante tem ritmo alto, não 1/7
-- dele. Mesmo cuidado que purchaseSuggestions() toma no Almoxá.
CREATE OR REPLACE FUNCTION public.ingredientes_para_comprar()
RETURNS TABLE (
  id UUID,
  nome TEXT,
  unidade TEXT,
  estoque_base NUMERIC,
  custo_base NUMERIC,
  consumo_dia NUMERIC,
  dias_restantes NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH consumo AS (
    SELECT
      r.ingrediente_id,
      SUM(r.quantidade_base * v.quantidade) AS gasto_base
    FROM public.vendas v
    JOIN public.receita_itens r ON r.produto_id = v.produto_id
    WHERE v.user_id = auth.uid()
      AND v.cancelada_em IS NULL
      AND public.dia_local(v.vendida_em) >= public.dia_local(now()) - 6
    GROUP BY 1
  )
  SELECT
    i.id,
    i.nome,
    i.unidade,
    i.estoque_base,
    i.custo_base,
    ritmo.por_dia,
    CASE
      WHEN ritmo.por_dia > 0 THEN i.estoque_base / ritmo.por_dia
      ELSE NULL          -- não gira: "dias restantes" não significa nada
    END
  FROM public.ingredientes i
  LEFT JOIN consumo c ON c.ingrediente_id = i.id
  CROSS JOIN LATERAL (
    SELECT COALESCE(c.gasto_base, 0) / GREATEST(
      LEAST(7, CEIL(EXTRACT(EPOCH FROM (now() - i.created_at)) / 86400)),
      1
    ) AS por_dia
  ) ritmo
  WHERE i.user_id = auth.uid()
  ORDER BY
    -- Primeiro o que já está negativo (compra não lançada), depois o que
    -- acaba mais cedo, e por último o que não gira.
    (i.estoque_base < 0) DESC,
    CASE WHEN ritmo.por_dia > 0 THEN i.estoque_base / ritmo.por_dia END
      ASC NULLS LAST,
    i.nome;
$$;

GRANT EXECUTE ON FUNCTION public.ingredientes_para_comprar() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cota de leitura por IA
-- ---------------------------------------------------------------------------
-- Mesmo freio do Almoxá: sem isso, uma conta comprometida martela a Edge
-- Function e cada chamada custa uma requisição de verdade ao Gemini.
CREATE TABLE IF NOT EXISTS public.cota_leitura (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  janela_iniciada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  usos INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.cota_leitura ENABLE ROW LEVEL SECURITY;
-- Ninguém lê nem escreve direto: só a função abaixo, que é SECURITY DEFINER.
REVOKE ALL ON public.cota_leitura FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.consome_cota_leitura()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  limite CONSTANT INTEGER := 30;      -- leituras por janela
  janela CONSTANT INTERVAL := '1 hour';
  atual public.cota_leitura;
BEGIN
  INSERT INTO public.cota_leitura (user_id) VALUES (auth.uid())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO atual FROM public.cota_leitura
   WHERE user_id = auth.uid() FOR UPDATE;

  IF now() - atual.janela_iniciada_em > janela THEN
    UPDATE public.cota_leitura
       SET janela_iniciada_em = now(), usos = 1
     WHERE user_id = auth.uid();
    RETURN true;
  END IF;

  IF atual.usos >= limite THEN
    RETURN false;
  END IF;

  UPDATE public.cota_leitura SET usos = usos + 1 WHERE user_id = auth.uid();
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consome_cota_leitura() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consome_cota_leitura() TO authenticated;

-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- 20260917123000_registrar_compra.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Salvar a notinha conferida em UMA chamada.
--
-- POR QUE RPC E NÃO VÁRIOS INSERTS DA TELA: registrar uma nota é achar-ou-criar
-- cada ingrediente, abrir a compra e lançar os itens -- de 8 a 20 idas e voltas
-- ao servidor pra uma nota de mercado. No 3G do balcão, qualquer uma delas cai,
-- e como o gatilho `compra_itens_aplica` já somou o estoque dos itens que
-- passaram, ela ficaria com metade da nota lançada e nenhum jeito de saber
-- qual metade. Aqui é uma transação: ou a nota inteira entra, ou nada entra.

CREATE OR REPLACE FUNCTION public.registrar_compra(
  _fornecedor TEXT,
  _comprada_em DATE,
  _itens JSONB,
  _origem TEXT DEFAULT 'foto'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Prefixo v_ em tudo: sem ele, uma variável chamada `nome` colide com a
  -- coluna `nome` de ingredientes e o Postgres recusa a função inteira com
  -- "column reference is ambiguous".
  v_dona UUID := auth.uid();
  v_compra UUID;
  v_item JSONB;
  v_nome TEXT;
  v_unidade TEXT;
  v_quantidade NUMERIC;
  v_preco NUMERIC;
  v_ingrediente UUID;
  v_unidade_atual TEXT;
  v_lancados INTEGER := 0;
BEGIN
  IF v_dona IS NULL THEN
    RAISE EXCEPTION 'Faça login para registrar a compra.';
  END IF;
  IF _itens IS NULL OR jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'Nenhum item para registrar.';
  END IF;
  IF jsonb_array_length(_itens) > 60 THEN
    RAISE EXCEPTION 'Essa nota tem itens demais. Divida em duas.';
  END IF;

  INSERT INTO public.compras (user_id, fornecedor, comprada_em, origem)
  VALUES (
    v_dona,
    COALESCE(NULLIF(trim(_fornecedor), ''), ''),
    COALESCE(_comprada_em, public.dia_local(now())),
    CASE WHEN _origem = 'manual' THEN 'manual' ELSE 'foto' END
  )
  RETURNING id INTO v_compra;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens)
  LOOP
    -- Zerado à mão a cada volta. O `RETURNING ... INTO` mais abaixo já anula
    -- quando o ON CONFLICT não devolve linha, mas aí o id do item ANTERIOR
    -- estaria a um descuido de distância de virar o ingrediente deste -- e o
    -- erro sairia como pão comprado no lugar de salsicha, sem nada falhar.
    v_ingrediente := NULL;

    v_nome := trim(COALESCE(v_item->>'nome', ''));
    CONTINUE WHEN v_nome = '';

    v_quantidade := COALESCE((v_item->>'quantidade')::NUMERIC, 0);
    CONTINUE WHEN v_quantidade <= 0;

    v_unidade := COALESCE(v_item->>'unidade', 'unidade');
    IF v_unidade NOT IN ('unidade', 'g', 'kg', 'ml', 'l') THEN
      v_unidade := 'unidade';
    END IF;

    v_preco := GREATEST(COALESCE((v_item->>'preco_unitario')::NUMERIC, 0), 0);

    -- Acha ou cria o ingrediente. O ON CONFLICT aponta pro índice funcional
    -- `ingredientes_nome_unico`, então duas fotos da mesma nota mandadas ao
    -- mesmo tempo não criam dois "Pão".
    INSERT INTO public.ingredientes (user_id, nome, unidade)
    VALUES (v_dona, v_nome, v_unidade)
    ON CONFLICT (user_id, public.nome_normalizado(nome)) DO NOTHING
    RETURNING id INTO v_ingrediente;

    IF v_ingrediente IS NULL THEN
      SELECT i.id, i.unidade INTO v_ingrediente, v_unidade_atual
        FROM public.ingredientes i
       WHERE i.user_id = v_dona
         AND public.nome_normalizado(i.nome) = public.nome_normalizado(v_nome);

      -- Ingrediente já existe em outra DIMENSÃO: cadastrado em kg e a nota
      -- veio em litros. Converter na força somaria mililitro em grama e
      -- estragaria o estoque calado. Ela conserta a unidade na tela de
      -- conferência, que é onde dá pra ver a nota junto.
      IF public.unidade_base(v_unidade) <> public.unidade_base(v_unidade_atual) THEN
        RAISE EXCEPTION
          '% está cadastrado em % e a nota veio em %. Ajuste a unidade antes de salvar.',
          v_nome, v_unidade_atual, v_unidade;
      END IF;
    END IF;

    INSERT INTO public.compra_itens (
      user_id, compra_id, ingrediente_id, quantidade, unidade, preco_unitario
    )
    VALUES (v_dona, v_compra, v_ingrediente, v_quantidade, v_unidade, v_preco);

    v_lancados := v_lancados + 1;
  END LOOP;

  -- Nota em que todo item caiu no filtro (nome vazio, quantidade zero) não
  -- vira compra fantasma: sem o rollback, ficaria uma linha em `compras` com
  -- zero itens aparecendo no histórico dela como uma ida ao mercado.
  IF v_lancados = 0 THEN
    RAISE EXCEPTION 'Nenhum item válido na nota.';
  END IF;

  RETURN v_compra;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_compra(TEXT, DATE, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_compra(TEXT, DATE, JSONB, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Desfazer uma nota lançada errado
-- ---------------------------------------------------------------------------
-- A tela não tem DELETE em `compras` nem em `compra_itens` (ver os REVOKE na
-- migration 20260917121000), justamente pra não existir jeito de apagar a nota
-- sem devolver o estoque. Este é o único caminho.
--
-- LIMITE CONHECIDO: devolve a QUANTIDADE, mas não desfaz a média do custo.
-- Média ponderada não tem volta exata -- depois de misturar o pão de R$ 0,50
-- com o de R$ 0,60, o R$ 0,55 não se separa mais, porque o peso de cada compra
-- se perdeu nas vendas que aconteceram no meio. O custo fica levemente
-- contaminado até a próxima compra do ingrediente, que o traz de volta pro
-- preço real. Preferi isso a inventar uma reversão que pareceria exata e não
-- seria; o alternativa honesta (guardar o saldo/custo antes de cada compra pra
-- poder rebobinar) é trabalho pra uma v2 com histórico de custo próprio.
CREATE OR REPLACE FUNCTION public.cancelar_compra(_compra_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dona UUID := auth.uid();
  v_achada UUID;
BEGIN
  -- SELECT ... INTO em vez de NOT EXISTS: o Postgres não aceita FOR UPDATE
  -- dentro de subconsulta, e o travamento é o que impede dois toques no botão
  -- de desfazer de estornarem o mesmo estoque duas vezes.
  SELECT id INTO v_achada
    FROM public.compras
   WHERE id = _compra_id AND user_id = v_dona
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra não encontrada nesta conta.';
  END IF;

  UPDATE public.ingredientes i
     SET estoque_base = i.estoque_base - ci.quantidade_base
    FROM public.compra_itens ci
   WHERE ci.ingrediente_id = i.id
     AND ci.compra_id = _compra_id
     AND i.user_id = v_dona;

  -- Apaga de verdade em vez de marcar cancelada: `historico_compras` e o
  -- fechamento do dia somam `compra_itens` direto, e uma nota "cancelada"
  -- exigiria lembrar de filtrar nos dois -- é a mesma armadilha que o
  -- `reversed_at` do Almoxá cria em toda consulta de venda. O rastro do que
  -- ela desfez não vale o risco de um dia a despesa apagada voltar a contar.
  DELETE FROM public.compras WHERE id = _compra_id AND user_id = v_dona;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_compra(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_compra(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Histórico de compras pra tela, já com o total somado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.historico_compras(_limite INTEGER DEFAULT 20)
RETURNS TABLE (
  id UUID,
  fornecedor TEXT,
  comprada_em DATE,
  origem TEXT,
  total NUMERIC,
  itens BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.fornecedor,
    c.comprada_em,
    c.origem,
    COALESCE(SUM(ci.total), 0),
    COUNT(ci.id)
  FROM public.compras c
  LEFT JOIN public.compra_itens ci ON ci.compra_id = c.id
  WHERE c.user_id = auth.uid()
  GROUP BY c.id, c.fornecedor, c.comprada_em, c.origem
  ORDER BY c.comprada_em DESC, c.created_at DESC
  LIMIT GREATEST(LEAST(_limite, 100), 1);
$$;

GRANT EXECUTE ON FUNCTION public.historico_compras(INTEGER) TO authenticated;

COMMIT;
