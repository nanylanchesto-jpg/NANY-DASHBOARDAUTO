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
