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
