-- ============================================================
-- Nany Lanches - pedido, forma de pagamento, metas e despesas.
--
-- Para colar no SQL Editor do Supabase quando nao houver Docker
-- pra rodar `supabase db push`. Roda tudo numa transacao: se
-- qualquer linha falhar, NADA e aplicado.
--
-- So esta migration, nao o banco inteiro: as anteriores ja estao
-- aplicadas no projeto. Para um banco novo, na ordem:
-- aplicar-tudo.sql, migrations/20260917124000_fecha_leitura_para_anonimo.sql,
-- aplicar-revenda.sql e so entao este arquivo.
--
-- Aplique ANTES de publicar o app novo: ele chama registrar_pedido,
-- vendas_do_dia, metas e despesas, que so existem depois daqui. O
-- app antigo continua funcionando com o banco ja migrado.
--
-- Gerado de:
--   20260921120000_pedido_pagamento_metas_despesas.sql
-- ============================================================

BEGIN;
-- Venda com várias linhas, forma de pagamento, metas e gastos que não são
-- ingrediente.
--
-- O redesenho troca o "cada toque é uma venda" por um pedido: ela junta 2
-- hot-dogs e 1 suco, escolhe Pix e finaliza. Isso pede ao banco o que ele
-- ainda não tinha:
--
--   1. AGRUPAR as linhas. O pedido acima vira duas linhas em `vendas` (uma por
--      produto, porque preço e custo são fotografados por produto), mas é UM
--      atendimento. Sem o `pedido`, o "N vendas" do dia contaria linhas e
--      passaria do número que ela confere de cabeça.
--   2. FORMA DE PAGAMENTO, pra fechar a gaveta: quanto tem que ter em cédula e
--      quanto caiu no Pix e na maquininha.
--   3. GASTO QUE NÃO É INGREDIENTE (gás, embalagem, transporte, taxa) e META de
--      vendas.
--
-- A aritmética de estoque continua TODA onde já estava: `fecha_venda`,
-- `baixa_receita` e `cancelar_venda()`. As funções novas só passam por esses
-- caminhos, nunca refazem a conta -- dois estornos escritos em dois lugares
-- são duas verdades pro saldo, e a primeira divergência não acusa nada.

-- ---------------------------------------------------------------------------
-- 1. Pedido e forma de pagamento em `vendas`
-- ---------------------------------------------------------------------------
-- As duas colunas ficam NULL nas vendas antigas, e é de propósito. Preencher
-- `pagamento = 'dinheiro'` "pra não ficar vazio" poria na gaveta de dias já
-- fechados uma cédula que ninguém sabe se existiu. NULL diz a verdade: a forma
-- não foi registrada. O fechamento (seção 6) conta a venda sem pedido como um
-- atendimento sozinho, que é o que ela foi, e não a soma em forma nenhuma.
ALTER TABLE public.vendas
  ADD COLUMN IF NOT EXISTS pedido UUID,
  ADD COLUMN IF NOT EXISTS pagamento TEXT
    CHECK (pagamento IN ('dinheiro', 'pix', 'cartao'));

-- Nenhum GRANT novo, e a ausência é o recorte. A migration 20260917121000
-- revogou o INSERT de TABELA em `vendas` e devolveu só o de algumas colunas,
-- então as duas colunas novas nascem sem privilégio de escrita pra
-- `authenticated` (o SELECT, que é de tabela, já as cobre). Quem grava as duas
-- é `registrar_pedido()`, SECURITY DEFINER. Com INSERT livre em `pagamento`, a
-- tela gravaria forma sem pedido, ou o pedido de outra venda, e o "N vendas" e
-- a gaveta do dia deixariam de bater sem erro nenhum.
--
-- O INSERT direto nas colunas antigas continua liberado: é o caminho do app
-- antigo, que segue aberto no celular dela até recarregar. Venda gravada por
-- ele entra com pedido e forma NULL -- conta como um atendimento e fica fora da
-- gaveta, exatamente como as vendas de antes desta migration.

-- Desfazer um pedido acha as linhas por aqui.
CREATE INDEX IF NOT EXISTS vendas_pedido_idx ON public.vendas (user_id, pedido);

-- ---------------------------------------------------------------------------
-- 2. Registrar o pedido inteiro em UMA chamada
-- ---------------------------------------------------------------------------
-- Mesmo motivo de `registrar_compra()`: um INSERT por produto a partir da tela,
-- no 3G da rua, deixaria meio pedido gravado quando a conexão cai no meio -- e
-- `baixa_receita` já teria baixado o estoque da metade que passou. Aqui é uma
-- transação: ou o pedido inteiro entra, ou nada entra.
--
-- Diferente de `registrar_compra()`, item inválido DERRUBA o pedido em vez de
-- ser pulado. Lá o pulo existe porque a leitura por foto traz linha lixo
-- ("SUBTOTAL", quantidade 0). Aqui cada item veio de um toque dela, e gravar o
-- pedido sem um deles registraria um total diferente do que ela acabou de
-- cobrar do cliente.
CREATE OR REPLACE FUNCTION public.registrar_pedido(_itens JSONB, _pagamento TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Prefixo v_ pelo mesmo motivo de `registrar_compra`: variável com nome de
  -- coluna deixa a referência ambígua e o Postgres recusa a função.
  v_dona UUID := auth.uid();
  v_pedido UUID := gen_random_uuid();
  v_item JSONB;
  v_produto UUID;
  v_quantidade NUMERIC;
BEGIN
  IF v_dona IS NULL THEN
    RAISE EXCEPTION 'Faça login para registrar a venda.';
  END IF;

  -- `IS NULL OR`: com NULL, o `NOT IN` sozinho dá NULL, o IF não entra e a
  -- venda sairia sem forma -- o estado que só venda antiga pode ter.
  IF _pagamento IS NULL OR _pagamento NOT IN ('dinheiro', 'pix', 'cartao') THEN
    RAISE EXCEPTION 'Escolha a forma de pagamento.';
  END IF;

  IF _itens IS NULL OR jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'O pedido está vazio.';
  END IF;
  -- Teto de sanidade, não regra de negócio: pedido de balcão não tem 30
  -- produtos diferentes, e sem teto um app com defeito mandaria milhares de
  -- linhas numa transação só.
  IF jsonb_array_length(_itens) > 30 THEN
    RAISE EXCEPTION 'Pedido com itens demais. Divida em dois.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens)
  LOOP
    v_produto := (v_item->>'produto_id')::UUID;
    v_quantidade := (v_item->>'quantidade')::NUMERIC;

    IF v_produto IS NULL THEN
      RAISE EXCEPTION 'Item do pedido sem produto.';
    END IF;
    IF v_quantidade IS NULL OR v_quantidade <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida no pedido.';
    END IF;

    -- `preco_unitario` 0 de propósito: `fecha_venda` troca pelo preço de tabela
    -- e congela o custo da receita. O preço sai do banco, não do cache do
    -- celular, então preço mudado em outro aparelho já vale nesta venda. E é
    -- `fecha_venda` quem confere que o produto é desta conta: produto_id alheio
    -- estoura lá com 'Produto não encontrado nesta conta.' e derruba o pedido.
    --
    -- `vendida_em` fica no default `now()`, que é o início da transação: todas
    -- as linhas do pedido saem com o MESMO instante e aparecem juntas no
    -- histórico.
    INSERT INTO public.vendas (
      user_id, produto_id, quantidade, preco_unitario, pedido, pagamento
    )
    VALUES (v_dona, v_produto, v_quantidade, 0, v_pedido, _pagamento);
  END LOOP;

  RETURN v_pedido;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_pedido(JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pedido(JSONB, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Desfazer o pedido inteiro
-- ---------------------------------------------------------------------------
-- Chama `cancelar_venda()` linha a linha em vez de estornar aqui: é UM caminho
-- de estorno só. Copiar o UPDATE de ingredientes pra cá daria duas contas pra
-- manter iguais, e a primeira que divergisse devolveria estoque errado calada.
CREATE OR REPLACE FUNCTION public.cancelar_pedido(_pedido UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dona UUID := auth.uid();
  v_venda UUID;
  v_achadas INTEGER := 0;
  v_canceladas INTEGER := 0;
BEGIN
  -- Trava TODAS as linhas antes de estornar qualquer uma: dois toques no
  -- "Desfazer" (ou Vender e Histórico ao mesmo tempo) fazem fila aqui, e o
  -- segundo encontra tudo cancelado e devolve 0. `ORDER BY id` trava sempre na
  -- mesma ordem; sem ele, duas chamadas concorrentes podem se travar em cruz.
  PERFORM 1
     FROM public.vendas
    WHERE pedido = _pedido AND user_id = v_dona
    ORDER BY id
      FOR UPDATE;

  GET DIAGNOSTICS v_achadas = ROW_COUNT;

  -- O filtro por user_id faz o pedido de outra conta cair aqui também: pra
  -- quem chama, "não existe" e "não é seu" precisam ser a mesma resposta.
  IF v_achadas = 0 THEN
    RAISE EXCEPTION 'Venda não encontrada nesta conta.';
  END IF;

  FOR v_venda IN
    SELECT id
      FROM public.vendas
     WHERE pedido = _pedido AND user_id = v_dona AND cancelada_em IS NULL
     ORDER BY id
  LOOP
    -- Conta pelo retorno, não pelo filtro: quem decide se estornou é
    -- `cancelar_venda` (false = já estava cancelada).
    IF public.cancelar_venda(v_venda) THEN
      v_canceladas := v_canceladas + 1;
    END IF;
  END LOOP;

  RETURN v_canceladas;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelar_pedido(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Despesas: dinheiro que sai e não vira estoque
-- ---------------------------------------------------------------------------
-- Gás, embalagem, transporte, taxa. Tabela própria, e não uma "compra" sem
-- ingrediente: tudo em `compras` passa por `compra_itens`, que soma estoque e
-- mexe no custo médio. Lançar o botijão como compra criaria um ingrediente
-- "Gás" com saldo que receita nenhuma consome -- parado pra sempre na tela de
-- estoque, sem mudar em nada o custo do hot-dog.
--
-- Despesa entra no CAIXA (é dinheiro que saiu do bolso) e NÃO entra em
-- `lucro_vendas`, que continua sendo a margem dos ingredientes do que foi
-- vendido -- as duas leituras de resultado da migration 20260917122000.
CREATE TABLE IF NOT EXISTS public.despesas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  descricao TEXT NOT NULL
    CHECK (length(trim(descricao)) > 0 AND length(descricao) <= 120),
  valor NUMERIC NOT NULL CHECK (valor > 0),
  -- Dia do gasto separado de created_at, pelo mesmo motivo de
  -- `compras.comprada_em`: ela lança hoje o gás que pagou ontem. E
  -- `dia_local()`, nunca `CURRENT_DATE`: em UTC, o gasto das 22h já é amanhã.
  dia DATE NOT NULL DEFAULT public.dia_local(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.despesas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dona gerencia as proprias despesas" ON public.despesas;
CREATE POLICY "Dona gerencia as proprias despesas" ON public.despesas
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- REVOKE ALL primeiro: tabela nova nasce com ALL pra `authenticated` e `anon`
-- (default privileges do Supabase), e GRANT por coluna só soma -- ver a nota em
-- `ingredientes` na migration 20260917120000.
--
-- DELETE liberado, ao contrário de `compras`: despesa não mexe em estoque,
-- então apagar não deixa nada sem estorno. Sem UPDATE: a tela não edita
-- despesa (errou, apaga e lança de novo), e privilégio que tela nenhuma usa é
-- só superfície. INSERT por coluna deixa `id` e `created_at` com o banco:
-- `created_at` é o rastro de QUANDO ela lançou, e só vale como rastro se não
-- puder ser digitado.
REVOKE ALL ON public.despesas FROM authenticated, anon;
GRANT SELECT, DELETE ON public.despesas TO authenticated;
GRANT INSERT (user_id, descricao, valor, dia) ON public.despesas TO authenticated;

CREATE INDEX IF NOT EXISTS despesas_dia_idx ON public.despesas (user_id, dia DESC);

-- ---------------------------------------------------------------------------
-- 5. Metas de venda
-- ---------------------------------------------------------------------------
-- Meta é de RECEITA (quanto vendeu, em R$), não de lucro: é o número que ela
-- acompanha no balcão, e não depende de custo cadastrado. Meta de lucro ficaria
-- refém do produto sem custo -- com um hot-dog a custo 0, ela "bateria" antes
-- da hora.
--
-- Uma linha por período, com a chave (user_id, periodo): definir de novo é
-- upsert, e não existe "duas metas do dia" pra tela ter que escolher.
CREATE TABLE IF NOT EXISTS public.metas (
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  periodo TEXT NOT NULL CHECK (periodo IN ('dia', 'semana', 'mes')),
  valor NUMERIC NOT NULL CHECK (valor > 0),
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, periodo)
);

ALTER TABLE public.metas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dona gerencia as proprias metas" ON public.metas;
CREATE POLICY "Dona gerencia as proprias metas" ON public.metas
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Aqui a tela escreve direto (o upsert do PostgREST precisa de INSERT e
-- UPDATE): meta não alimenta conta nenhuma no banco, então não há saldo pra
-- proteger. O REVOKE vale pros dois papéis porque o ALL do default privileges
-- traz também TRUNCATE, que atravessa a RLS; os quatro de volta são os únicos
-- que alguma tela usa.
REVOKE ALL ON public.metas FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metas TO authenticated;

-- `atualizada_em` carimbada pelo banco. O upsert do PostgREST só escreve as
-- colunas que vieram no corpo, então o DEFAULT sozinho congelaria a data da
-- PRIMEIRA meta e mentiria a partir da primeira edição. Carimbar no celular não
-- serve: o relógio dele é o que ela ajustou, não o do servidor.
--
-- Sem SECURITY DEFINER: a função só mexe em NEW, não atravessa RLS nenhuma.
CREATE OR REPLACE FUNCTION public.carimba_meta()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.atualizada_em := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.carimba_meta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS metas_carimba ON public.metas;
CREATE TRIGGER metas_carimba
  BEFORE INSERT OR UPDATE ON public.metas
  FOR EACH ROW EXECUTE FUNCTION public.carimba_meta();

-- ---------------------------------------------------------------------------
-- 6. Fechamento do dia: despesas, gaveta por forma e atendimento por pedido
-- ---------------------------------------------------------------------------
-- DROP + CREATE porque acrescentar coluna ao RETURNS TABLE não passa em
-- `CREATE OR REPLACE` ("cannot change return type of existing function"). O
-- DROP leva junto o REVOKE da migration 20260917124000, e por isso ele é
-- repetido logo abaixo.
--
-- `atendimentos` passa a contar PEDIDOS: 2 hot-dogs e 1 suco são uma venda.
-- O `COALESCE(pedido, id)` é o que mantém as vendas antigas na conta -- o
-- `COUNT(DISTINCT)` ignora NULL, e sem ele toda venda anterior a esta
-- migration sumiria da contagem.
--
-- `caixa` agora desconta as despesas: o gás pago saiu do bolso tanto quanto a
-- nota do mercado. `lucro_vendas` não desconta (ver a seção 4).
--
-- `em_dinheiro`, `em_pix` e `em_cartao` são RECEITA por forma, pra ela conferir
-- a gaveta e o extrato. Venda sem forma (anterior a esta migration) não entra
-- em nenhuma, então num dia de transição as três somam menos que `receita` --
-- e têm que somar: jogar a diferença em "dinheiro" inventaria cédula na gaveta.
DROP FUNCTION IF EXISTS public.fechamento_do_dia(DATE);

CREATE FUNCTION public.fechamento_do_dia(_dia DATE DEFAULT NULL)
RETURNS TABLE (
  dia DATE,
  receita NUMERIC,
  custo_vendido NUMERIC,
  lucro_vendas NUMERIC,
  compras NUMERIC,
  despesas NUMERIC,
  caixa NUMERIC,
  unidades NUMERIC,
  atendimentos BIGINT,
  em_dinheiro NUMERIC,
  em_pix NUMERIC,
  em_cartao NUMERIC
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
      COALESCE(SUM(total), 0)                                       AS receita,
      COALESCE(SUM(quantidade * custo_unitario), 0)                 AS custo,
      COALESCE(SUM(lucro), 0)                                       AS lucro,
      COALESCE(SUM(quantidade), 0)                                  AS unidades,
      COUNT(DISTINCT COALESCE(pedido, id))                          AS atendimentos,
      COALESCE(SUM(total) FILTER (WHERE pagamento = 'dinheiro'), 0) AS em_dinheiro,
      COALESCE(SUM(total) FILTER (WHERE pagamento = 'pix'), 0)      AS em_pix,
      COALESCE(SUM(total) FILTER (WHERE pagamento = 'cartao'), 0)   AS em_cartao
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
  ),
  g AS (
    SELECT COALESCE(SUM(de.valor), 0) AS gasto
    FROM public.despesas de
    CROSS JOIN alvo
    WHERE de.user_id = auth.uid()
      AND de.dia = alvo.d
  )
  SELECT
    alvo.d,
    v.receita,
    v.custo,
    v.lucro,
    c.gasto,
    g.gasto,
    v.receita - c.gasto - g.gasto,
    v.unidades,
    v.atendimentos,
    v.em_dinheiro,
    v.em_pix,
    v.em_cartao
  FROM alvo, v, c, g;
$$;

REVOKE ALL ON FUNCTION public.fechamento_do_dia(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fechamento_do_dia(DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Série por dia, agora com despesas e atendimentos
-- ---------------------------------------------------------------------------
-- DROP + CREATE pelo mesmo motivo do fechamento. Mesma contagem de
-- atendimentos, e o `generate_series` fica: dia sem venda aparece com zero,
-- senão o gráfico desenha a semana com seis dias e engana a tendência.
--
-- O recorte pela janela nos três subselects é só desempenho: antes cada
-- abertura da tela somava o histórico inteiro pra o JOIN descartar tudo que
-- ficava fora da janela. O dia continua saindo de `dia_local()`.
DROP FUNCTION IF EXISTS public.resumo_por_dia(INTEGER);

CREATE FUNCTION public.resumo_por_dia(_dias INTEGER DEFAULT 14)
RETURNS TABLE (
  dia DATE,
  receita NUMERIC,
  custo_vendido NUMERIC,
  lucro_vendas NUMERIC,
  compras NUMERIC,
  despesas NUMERIC,
  unidades NUMERIC,
  atendimentos BIGINT
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
  ),
  inicio AS (
    SELECT MIN(d) AS d FROM janela
  )
  SELECT
    j.d,
    COALESCE(v.receita, 0),
    COALESCE(v.custo, 0),
    COALESCE(v.lucro, 0),
    COALESCE(c.gasto, 0),
    COALESCE(g.gasto, 0),
    COALESCE(v.unidades, 0),
    COALESCE(v.atendimentos, 0)
  FROM janela j
  LEFT JOIN (
    SELECT
      public.dia_local(vendida_em) AS d,
      SUM(total) AS receita,
      SUM(quantidade * custo_unitario) AS custo,
      SUM(lucro) AS lucro,
      SUM(quantidade) AS unidades,
      COUNT(DISTINCT COALESCE(pedido, id)) AS atendimentos
    FROM public.vendas, inicio
    WHERE user_id = auth.uid()
      AND cancelada_em IS NULL
      AND public.dia_local(vendida_em) >= inicio.d
    GROUP BY 1
  ) v ON v.d = j.d
  LEFT JOIN (
    SELECT co.comprada_em AS d, SUM(ci.total) AS gasto
    FROM public.compra_itens ci
    JOIN public.compras co ON co.id = ci.compra_id
    CROSS JOIN inicio
    WHERE co.user_id = auth.uid()
      AND co.comprada_em >= inicio.d
    GROUP BY 1
  ) c ON c.d = j.d
  LEFT JOIN (
    SELECT de.dia AS d, SUM(de.valor) AS gasto
    FROM public.despesas de
    CROSS JOIN inicio
    WHERE de.user_id = auth.uid()
      AND de.dia >= inicio.d
    GROUP BY 1
  ) g ON g.d = j.d
  ORDER BY j.d;
$$;

REVOKE ALL ON FUNCTION public.resumo_por_dia(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumo_por_dia(INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. As vendas de um dia civil, linha a linha
-- ---------------------------------------------------------------------------
-- Substitui o recorte de "últimas 24 h" que a tela fazia direto em `vendas`. O
-- Histórico abre um dia qualquer, e "dia" tem que ser o civil daqui, o mesmo
-- que o fechamento soma -- senão a venda das 21h30 de sábado apareceria na
-- lista de domingo e não bateria com o total ao lado.
--
-- Devolve as canceladas também, com `cancelada_em`: quem esconde é a tela, e o
-- banco não perde o rastro do que ela desfez.
--
-- `nome` é o nome ATUAL do produto: renomear "Hot dog" pra "Hot-dog" não muda
-- quanto ela vendeu, então aqui não há fotografia a proteger. Preço, total e
-- lucro vêm da própria linha da venda, que é onde a fotografia mora.
CREATE OR REPLACE FUNCTION public.vendas_do_dia(_dia DATE DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  pedido UUID,
  produto_id UUID,
  nome TEXT,
  quantidade NUMERIC,
  preco_unitario NUMERIC,
  total NUMERIC,
  lucro NUMERIC,
  pagamento TEXT,
  vendida_em TIMESTAMPTZ,
  cancelada_em TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id,
    v.pedido,
    v.produto_id,
    p.nome,
    v.quantidade,
    v.preco_unitario,
    v.total,
    v.lucro,
    v.pagamento,
    v.vendida_em,
    v.cancelada_em
  FROM public.vendas v
  JOIN public.produtos p ON p.id = v.produto_id
  WHERE v.user_id = auth.uid()
    AND public.dia_local(v.vendida_em) = COALESCE(_dia, public.dia_local(now()))
  -- As linhas de um pedido têm o mesmo `vendida_em` (seção 2), então saem
  -- juntas; `pedido` e `id` só desempatam, pra a ordem não mudar entre duas
  -- leituras e a lista não pular na mão dela.
  ORDER BY v.vendida_em DESC, v.pedido, v.id;
$$;

REVOKE ALL ON FUNCTION public.vendas_do_dia(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendas_do_dia(DATE) TO authenticated;

COMMIT;
