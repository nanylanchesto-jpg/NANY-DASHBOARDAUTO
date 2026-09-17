-- Fecha as funções de leitura para o visitante anônimo.
--
-- ACHADO NUM TESTE CONTRA O BANCO REAL: chamando as RPCs só com a chave
-- publicável, sem login nenhum, todas as seis responderam. Não vazou dado --
-- cada uma filtra por `auth.uid()`, que é NULL pro anônimo, então o resultado
-- volta vazio. Mas elas RODAM.
--
-- A causa é a mesma que já corrigi em `custo_do_produto` e nas funções de
-- escrita, e que eu deixei passar aqui: em Postgres, função nova nasce com
-- EXECUTE concedido a PUBLIC. Escrever `GRANT EXECUTE ... TO authenticated`
-- soa como "só autenticado pode", mas só soma uma permissão que PUBLIC já
-- tinha -- exatamente o mesmo engano do `GRANT` por coluna sem `REVOKE` antes.
--
-- Por que consertar se nada vaza hoje: a chave publicável é pública por
-- construção, e o que segura os dados é o `WHERE user_id = auth.uid()` DENTRO
-- de cada função, que é SECURITY DEFINER e portanto atravessa a RLS. O dia em
-- que alguém editar uma dessas funções e esquecer o filtro -- ou adicionar uma
-- sétima função no mesmo molde -- o banco inteiro fica legível por qualquer um
-- que leia a chave no DevTools, sem nenhum aviso. Revogar de PUBLIC tira a
-- RLS da posição de última linha de defesa.

REVOKE ALL ON FUNCTION public.fechamento_do_dia(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resumo_por_dia(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vendas_por_produto(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ingredientes_para_comprar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.produtos_com_custo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.historico_compras(INTEGER) FROM PUBLIC, anon;

-- O REVOKE acima tira de PUBLIC, e `authenticated` herda de PUBLIC -- então
-- sem reconceder explicitamente, o app logado também perderia acesso.
GRANT EXECUTE ON FUNCTION public.fechamento_do_dia(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resumo_por_dia(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendas_por_produto(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingredientes_para_comprar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.produtos_com_custo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.historico_compras(INTEGER) TO authenticated;

-- `unidade_base`, `fator_base`, `nome_normalizado` e `dia_local` ficam como
-- estão: são funções puras de conversão, sem acesso a tabela nenhuma, e
-- `nome_normalizado` precisa continuar executável porque sustenta os índices
-- únicos de `ingredientes` e `produtos`.
