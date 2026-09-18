-- Produto de revenda e custo estimado.
--
-- O PROBLEMA: `custo_do_produto()` soma a receita. Produto sem receita custa 0,
-- e aí o "lucro" mostrado é o preço cheio. Isso pega dois casos reais:
--
--   1. REVENDA. Coca lata, água, salgadinho: ela compra pronto e vende pronto.
--      "Receita" não quer dizer nada aí, mas o custo existe e é o da nota.
--   2. PRODUTO NOVO. Ela quer ver a margem do hot-dog antes de ter comprado
--      qualquer coisa, pra decidir o preço.
--
-- São problemas DIFERENTES e aqui têm soluções diferentes, de propósito:
--
--   1 vira dado real. O produto de revenda continua sendo produto + ingrediente
--     + receita de 1 unidade, exatamente como o hot-dog -- só que criado de uma
--     vez, porque ninguém descobre sozinho que precisa cadastrar um
--     "ingrediente Coca" pra vender uma Coca. O custo continua saindo da média
--     ponderada das compras, o estoque continua baixando na venda, e o gasto
--     continua aparecendo no caixa do dia.
--
--   2 vira `produtos.custo_estimado`, que é PALPITE e a tela diz isso. Ele NÃO
--     entra em `vendas.custo_unitario` nem no fechamento. Fosse um "custo" de
--     verdade em coluna, seria a segunda verdade que o README rejeita: um
--     número que não acompanha alta de preço, não baixa estoque e não aparece
--     no caixa -- com cara de certo e errado por dentro. É a falha que o PI
--     existe pra corrigir, não pra reproduzir.

-- ---------------------------------------------------------------------------
-- 1. Custo estimado: palpite de planejamento, nunca apuração
-- ---------------------------------------------------------------------------
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS custo_estimado NUMERIC NOT NULL DEFAULT 0
    CHECK (custo_estimado >= 0);

COMMENT ON COLUMN public.produtos.custo_estimado IS
  'Palpite de custo para ver margem ANTES de existir compra lançada. Não entra '
  'em vendas.custo_unitario nem no fechamento: quem apura é custo_do_produto(), '
  'que soma a receita com o preço real das compras.';

-- ---------------------------------------------------------------------------
-- 2. A grade da tela passa a devolver o palpite junto
-- ---------------------------------------------------------------------------
-- DROP antes de CREATE porque `CREATE OR REPLACE` não muda o tipo de retorno de
-- uma função -- acrescentar coluna ao RETURNS TABLE falha com "cannot change
-- return type of existing function".
--
-- A tela decide o que mostrar, não o banco: devolvemos os fatos (custo real,
-- tem_receita, palpite) e quem escolhe entre "R$ 1,80" e "~R$ 1,80 estimado" é
-- `cadastro.tsx`. Resolver aqui obrigaria a inventar um campo "custo_efetivo"
-- que às vezes é real e às vezes é chute, e a primeira consulta que somasse
-- esse campo passaria a somar palpite sem ninguém perceber.
DROP FUNCTION IF EXISTS public.produtos_com_custo();

CREATE FUNCTION public.produtos_com_custo()
RETURNS TABLE (
  id UUID,
  nome TEXT,
  preco_venda NUMERIC,
  ordem SMALLINT,
  ativo BOOLEAN,
  custo_unitario NUMERIC,
  lucro_unitario NUMERIC,
  tem_receita BOOLEAN,
  custo_estimado NUMERIC
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
    EXISTS (SELECT 1 FROM public.receita_itens r WHERE r.produto_id = p.id) AS tem_receita,
    p.custo_estimado
  FROM public.produtos p
  WHERE p.user_id = auth.uid()
  ORDER BY p.ordem, p.nome;
$$;

-- O DROP levou junto os GRANTs da migration 20260917120000 e o REVOKE da
-- 20260917124000. Sem repetir os dois aqui, a função nasceria executável por
-- PUBLIC de novo (default do Postgres) e a leitura voltaria a ficar aberta pro
-- anônimo -- desfazendo calada a correção daquela migration.
REVOKE ALL ON FUNCTION public.produtos_com_custo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.produtos_com_custo() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Produto de revenda em uma chamada
-- ---------------------------------------------------------------------------
-- POR QUE RPC E NÃO TRÊS INSERTS DA TELA: são quatro escritas dependentes
-- (ingrediente, produto, item de receita e, opcionalmente, a compra). No 3G do
-- balcão, qualquer uma cai no meio e ela fica com um ingrediente "Coca" sem
-- produto nenhum, ou com o produto sem receita -- que é exatamente o estado
-- "lucro igual ao preço cheio" que esta migration existe pra acabar. Aqui é uma
-- transação: ou tudo entra, ou nada entra.
--
-- A compra vai por `registrar_compra()` em vez de INSERT direto, de propósito:
-- é ela que abre a linha em `compras` (pro caixa do dia enxergar), dispara o
-- gatilho da média ponderada e soma o estoque. Reescrever isso aqui daria dois
-- caminhos de compra pra manter em sincronia.
CREATE OR REPLACE FUNCTION public.criar_produto_de_revenda(
  _nome TEXT,
  _preco_venda NUMERIC,
  -- Primeira compra, opcional: quantidade 0 cria só o cadastro, e o custo fica
  -- pendente até a primeira nota -- do mesmo jeito que um hot-dog recém
  -- cadastrado.
  _quantidade NUMERIC DEFAULT 0,
  _preco_pago NUMERIC DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Prefixo v_ em tudo, pelo mesmo motivo de `registrar_compra`: `nome` sem
  -- prefixo colide com a coluna `nome` e o Postgres recusa a função inteira.
  v_dona UUID := auth.uid();
  v_nome TEXT;
  v_ingrediente UUID;
  v_unidade_atual TEXT;
  v_produto UUID;
BEGIN
  IF v_dona IS NULL THEN
    RAISE EXCEPTION 'Faça login para cadastrar.';
  END IF;

  v_nome := trim(COALESCE(_nome, ''));
  IF v_nome = '' THEN
    RAISE EXCEPTION 'O produto precisa de um nome.';
  END IF;
  IF COALESCE(_preco_venda, 0) < 0 THEN
    RAISE EXCEPTION 'O preço de venda não pode ser negativo.';
  END IF;

  -- Conferido ANTES de criar o ingrediente. Sem isto, o INSERT em `produtos`
  -- estoura no índice `produtos_nome_unico` lá embaixo e a tela mostra o
  -- "duplicate key value violates unique constraint" cru do Postgres -- e a
  -- transação já teria criado o ingrediente espelho, que some junto no
  -- rollback mas deixa o diagnóstico confuso pra quem for ler o log.
  IF EXISTS (
    SELECT 1 FROM public.produtos p
     WHERE p.user_id = v_dona
       AND public.nome_normalizado(p.nome) = public.nome_normalizado(v_nome)
  ) THEN
    RAISE EXCEPTION 'Você já tem um produto chamado %.', v_nome;
  END IF;

  -- Acha ou cria o ingrediente espelho, como `registrar_compra` faz. O
  -- ON CONFLICT aponta pro índice funcional, então cadastrar "Coca" duas vezes
  -- não cria dois ingredientes.
  --
  -- Sempre 'unidade': revenda é coisa contável (lata, garrafa, pacote). Pacote
  -- de 12 comprado e vendido avulso se resolve na COMPRA, lançando 12 unidades
  -- ao preço de uma -- que é o que a leitura da notinha já faz.
  INSERT INTO public.ingredientes (user_id, nome, unidade)
  VALUES (v_dona, v_nome, 'unidade')
  ON CONFLICT (user_id, public.nome_normalizado(nome)) DO NOTHING
  RETURNING id INTO v_ingrediente;

  IF v_ingrediente IS NULL THEN
    SELECT i.id, i.unidade INTO v_ingrediente, v_unidade_atual
      FROM public.ingredientes i
     WHERE i.user_id = v_dona
       AND public.nome_normalizado(i.nome) = public.nome_normalizado(v_nome);

    -- Mesmo nome já cadastrado por PESO ou VOLUME. A receita abaixo grava
    -- quantidade_base = 1, que nesse caso significaria 1 grama ou 1 ml de
    -- produto vendido -- e o custo sairia mil vezes menor, calado.
    IF public.unidade_base(v_unidade_atual) <> 'unidade' THEN
      RAISE EXCEPTION
        '% já está cadastrado como ingrediente em %. Revenda é item contável; '
        'use outro nome ou ajuste a unidade do ingrediente.',
        v_nome, v_unidade_atual;
    END IF;
  END IF;

  INSERT INTO public.produtos (user_id, nome, preco_venda)
  VALUES (v_dona, v_nome, COALESCE(_preco_venda, 0))
  RETURNING id INTO v_produto;

  -- 1 unidade vendida consome 1 unidade do estoque. É a receita inteira de um
  -- item de revenda.
  INSERT INTO public.receita_itens (user_id, produto_id, ingrediente_id, quantidade_base)
  VALUES (v_dona, v_produto, v_ingrediente, 1);

  IF COALESCE(_quantidade, 0) > 0 THEN
    PERFORM public.registrar_compra(
      '',
      -- Tipado: `NULL` pelado deixa a resolução de sobrecarga ambígua se um dia
      -- aparecer outra `registrar_compra`. Dentro dela o NULL vira o dia local.
      NULL::DATE,
      jsonb_build_array(jsonb_build_object(
        'nome', v_nome,
        'quantidade', _quantidade,
        'unidade', 'unidade',
        'preco_unitario', GREATEST(COALESCE(_preco_pago, 0), 0)
      )),
      'manual'
    );
  END IF;

  RETURN v_produto;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_produto_de_revenda(TEXT, NUMERIC, NUMERIC, NUMERIC)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_produto_de_revenda(TEXT, NUMERIC, NUMERIC, NUMERIC)
  TO authenticated;
