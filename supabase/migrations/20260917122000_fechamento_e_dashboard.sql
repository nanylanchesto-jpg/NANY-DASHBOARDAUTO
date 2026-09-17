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
