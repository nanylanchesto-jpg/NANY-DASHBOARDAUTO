-- Fecha duas portas que a RLS sozinha deixava abertas.
--
-- 1. REFERÊNCIA CRUZADA ENTRE CONTAS. As políticas de `receita_itens` e
--    `compra_itens` só conferiam `user_id = auth.uid()` na linha nova. A chave
--    estrangeira é conferida pelo dono da tabela, por cima da RLS, então a
--    conta A conseguia gravar um item de receita apontando pro PRODUTO da conta
--    B (e `custo_do_produto`, que não filtra por dona, passava a somar o
--    ingrediente de A no custo do hot-dog de B), ou apontando pro INGREDIENTE de
--    B (e ler o custo dele pelo próprio produto). Em `compra_itens`, o mesmo com
--    a `compra_id` de outra conta: o total da nota de B mudava. Exige saber o
--    uuid alheio, que nenhuma tela expõe -- é defesa em profundidade, no mesmo
--    espírito da seção 9 de 20260921120000.
--
-- 2. INSERT DIRETO EM `vendas`. Ficou liberado nas colunas antigas "pro app
--    antigo aberto no celular dela" (20260921120000, seção 1). Esse app já
--    recarregou há semanas, e o INSERT direto aceita `preco_unitario` e
--    `vendida_em` digitados: venda com preço inventado ou lançada num dia já
--    fechado, fora de pedido e sem forma de pagamento. A venda agora entra só
--    por `registrar_pedido()`, que é SECURITY DEFINER e não precisa do GRANT.

-- ---------------------------------------------------------------------------
-- 1a. Receita: produto e ingrediente têm de ser desta conta
-- ---------------------------------------------------------------------------
-- As subconsultas rodam com a RLS de quem chama, então "EXISTS" só enxerga o
-- que é dela -- produto alheio simplesmente não existe aqui.
DROP POLICY IF EXISTS "Dona gerencia a propria receita" ON public.receita_itens;
CREATE POLICY "Dona gerencia a propria receita" ON public.receita_itens
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.produtos p WHERE p.id = produto_id AND p.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.ingredientes i WHERE i.id = ingrediente_id AND i.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 1b. Item de compra: a nota e o ingrediente têm de ser desta conta
-- ---------------------------------------------------------------------------
-- `registrar_compra()` é SECURITY DEFINER e não passa por aqui; isto vale pro
-- INSERT direto, que continua com GRANT.
DROP POLICY IF EXISTS "Dona gerencia os proprios itens de compra" ON public.compra_itens;
CREATE POLICY "Dona gerencia os proprios itens de compra" ON public.compra_itens
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.compras c WHERE c.id = compra_id AND c.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.ingredientes i WHERE i.id = ingrediente_id AND i.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 1c. Custo do produto só soma ingrediente da mesma dona
-- ---------------------------------------------------------------------------
-- Mesmo corpo de 20260917120000, mais o filtro. Se uma linha cruzada já tiver
-- entrado antes desta migration, ela deixa de contaminar o custo.
CREATE OR REPLACE FUNCTION public.custo_do_produto(_produto_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(r.quantidade_base * i.custo_base), 0)
  FROM public.receita_itens r
  JOIN public.ingredientes i ON i.id = r.ingrediente_id AND i.user_id = r.user_id
  WHERE r.produto_id = _produto_id;
$$;

REVOKE ALL ON FUNCTION public.custo_do_produto(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Venda só por `registrar_pedido()`
-- ---------------------------------------------------------------------------
-- REVOKE no nível da tabela leva junto os GRANT por coluna.
REVOKE INSERT ON public.vendas FROM authenticated, anon;
