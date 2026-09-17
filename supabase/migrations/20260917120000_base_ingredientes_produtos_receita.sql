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
