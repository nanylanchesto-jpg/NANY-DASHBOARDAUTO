/**
 * Camada de dados: tipos do banco e hooks de consulta/gravação.
 *
 * Quase tudo passa por RPC em vez de montar a consulta na tela. Não é gosto
 * por procedure: as somas do dashboard sobre venda, compra e receita viram
 * três ou quatro consultas e um monte de aritmética no celular, e esse é
 * justamente o aparelho mais fraco e a conexão mais ruim da cadeia. Somado no
 * Postgres, o dashboard é uma resposta de poucos bytes.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { ItemLido } from './notinha';
import { supabase } from './supabase';
import type { Unidade } from './unidades';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Ingrediente = {
  id: string;
  nome: string;
  unidade: Unidade;
  estoque_base: number;
  custo_base: number;
  created_at: string;
};

export type Produto = {
  id: string;
  nome: string;
  preco_venda: number;
  ordem: number;
  ativo: boolean;
  custo_unitario: number;
  lucro_unitario: number;
  tem_receita: boolean;
};

export type Fechamento = {
  dia: string;
  receita: number;
  custo_vendido: number;
  /** Receita menos o custo dos ingredientes das vendas do dia: a margem. */
  lucro_vendas: number;
  compras: number;
  /** Entrou de venda menos o que ela pagou de compra no dia: dinheiro. */
  caixa: number;
  unidades: number;
  atendimentos: number;
};

export type DiaResumo = {
  dia: string;
  receita: number;
  custo_vendido: number;
  lucro_vendas: number;
  compras: number;
  unidades: number;
};

export type ProdutoVendas = {
  produto_id: string;
  nome: string;
  unidades: number;
  receita: number;
  lucro: number;
};

export type ParaComprar = {
  id: string;
  nome: string;
  unidade: Unidade;
  estoque_base: number;
  custo_base: number;
  consumo_dia: number;
  /** null quando o ingrediente não girou na semana: "dias" não significaria nada. */
  dias_restantes: number | null;
};

export type CompraResumo = {
  id: string;
  fornecedor: string;
  comprada_em: string;
  origem: 'foto' | 'manual';
  total: number;
  itens: number;
};

export type VendaLinha = {
  id: string;
  produto_id: string;
  quantidade: number;
  preco_unitario: number;
  custo_unitario: number;
  total: number;
  lucro: number;
  vendida_em: string;
  cancelada_em: string | null;
  produtos: { nome: string } | null;
};

export type ItemReceita = {
  id: string;
  ingrediente_id: string;
  quantidade_base: number;
  ingredientes: { nome: string; unidade: Unidade; custo_base: number } | null;
};

// ---------------------------------------------------------------------------
// Chaves de cache
// ---------------------------------------------------------------------------

export const chaves = {
  fechamento: (dia?: string) => ['fechamento', dia ?? 'hoje'] as const,
  resumoDias: (dias: number) => ['resumo-dias', dias] as const,
  porProduto: (dias: number) => ['por-produto', dias] as const,
  paraComprar: ['para-comprar'] as const,
  produtos: ['produtos'] as const,
  ingredientes: ['ingredientes'] as const,
  receita: (produtoId: string) => ['receita', produtoId] as const,
  compras: ['compras'] as const,
  vendasDoDia: ['vendas-do-dia'] as const,
};

/**
 * Tudo que uma venda ou uma compra muda de uma vez.
 *
 * Existe como lista única porque o custo de esquecer um item é invisível: a
 * tela simplesmente mostra o número velho, sem erro nenhum, e ela conclui que
 * o registro não funcionou. Venda mexe em estoque (baixa da receita), que mexe
 * no custo do produto, que mexe no lucro -- praticamente tudo se toca.
 */
function invalidarMovimento(qc: QueryClient) {
  const raizes = [
    'fechamento',
    'resumo-dias',
    'por-produto',
    'para-comprar',
    'produtos',
    'ingredientes',
    'compras',
    'vendas-do-dia',
  ];
  return Promise.all(raizes.map((raiz) => qc.invalidateQueries({ queryKey: [raiz] })));
}

/** Desempacota um RPC, transformando erro do PostgREST em Error com a mensagem do banco. */
async function rpc<T>(nome: string, argumentos?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nome, argumentos);
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** `fechamento_do_dia` devolve uma linha só; o PostgREST embala em array. */
export function useFechamento(dia?: string) {
  return useQuery({
    queryKey: chaves.fechamento(dia),
    queryFn: async () => {
      const linhas = await rpc<Fechamento[]>('fechamento_do_dia', { _dia: dia ?? null });
      return linhas?.[0] ?? null;
    },
  });
}

export function useResumoPorDia(dias = 14) {
  return useQuery({
    queryKey: chaves.resumoDias(dias),
    queryFn: () => rpc<DiaResumo[]>('resumo_por_dia', { _dias: dias }),
  });
}

export function useVendasPorProduto(dias = 30) {
  return useQuery({
    queryKey: chaves.porProduto(dias),
    queryFn: () => rpc<ProdutoVendas[]>('vendas_por_produto', { _dias: dias }),
  });
}

export function useParaComprar() {
  return useQuery({
    queryKey: chaves.paraComprar,
    queryFn: () => rpc<ParaComprar[]>('ingredientes_para_comprar'),
  });
}

// ---------------------------------------------------------------------------
// Produtos, ingredientes e receita
// ---------------------------------------------------------------------------

export function useProdutos() {
  return useQuery({
    queryKey: chaves.produtos,
    queryFn: () => rpc<Produto[]>('produtos_com_custo'),
  });
}

export function useIngredientes() {
  return useQuery({
    queryKey: chaves.ingredientes,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ingredientes')
        .select('id, nome, unidade, estoque_base, custo_base, created_at')
        .order('nome');
      if (error) throw new Error(error.message);
      return (data ?? []) as Ingrediente[];
    },
  });
}

export function useReceita(produtoId: string | null) {
  return useQuery({
    queryKey: chaves.receita(produtoId ?? ''),
    enabled: Boolean(produtoId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('receita_itens')
        .select('id, ingrediente_id, quantidade_base, ingredientes(nome, unidade, custo_base)')
        .eq('produto_id', produtoId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ItemReceita[];
    },
  });
}

/** O user_id vai explícito porque a política de RLS exige `user_id = auth.uid()` no WITH CHECK. */
async function donaAtual(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data?.user?.id;
  if (!id) throw new Error('Sessão expirada. Entre de novo.');
  return id;
}

export function useSalvarProduto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (produto: {
      id?: string;
      nome: string;
      preco_venda: number;
      ordem?: number;
      /** Produto com venda registrada não pode ser apagado (FK restrita): desativar é a saída. */
      ativo?: boolean;
    }) => {
      if (produto.id) {
        const { error } = await supabase
          .from('produtos')
          .update({
            nome: produto.nome.trim(),
            preco_venda: produto.preco_venda,
            ordem: produto.ordem ?? 0,
            ...(produto.ativo === undefined ? {} : { ativo: produto.ativo }),
          })
          .eq('id', produto.id);
        if (error) throw new Error(error.message);
        return produto.id;
      }
      const { data, error } = await supabase
        .from('produtos')
        .insert({
          user_id: await donaAtual(),
          nome: produto.nome.trim(),
          preco_venda: produto.preco_venda,
          ordem: produto.ordem ?? 0,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    },
    onSuccess: () => invalidarMovimento(qc),
  });
}

export function useApagarProduto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('produtos').delete().eq('id', id);
      if (error) {
        // `vendas.produto_id` é ON DELETE RESTRICT: apagar um produto vendido
        // levaria o histórico junto e o fechamento daquele dia mudaria sozinho.
        if (error.code === '23503') {
          throw new Error('Esse produto já tem venda registrada. Desative em vez de apagar.');
        }
        throw new Error(error.message);
      }
    },
    onSuccess: () => invalidarMovimento(qc),
  });
}

export function useSalvarIngrediente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ingrediente: { id?: string; nome: string; unidade: Unidade }) => {
      if (ingrediente.id) {
        const { error } = await supabase
          .from('ingredientes')
          .update({ nome: ingrediente.nome.trim(), unidade: ingrediente.unidade })
          .eq('id', ingrediente.id);
        if (error) throw new Error(error.message);
        return ingrediente.id;
      }
      const { data, error } = await supabase
        .from('ingredientes')
        .insert({
          user_id: await donaAtual(),
          nome: ingrediente.nome.trim(),
          unidade: ingrediente.unidade,
        })
        .select('id')
        .single();
      if (error) {
        // 23505 = unique_violation: bateu no índice `ingredientes_nome_unico`,
        // que compara o nome NORMALIZADO -- então "Pão" e "PAO" caem aqui.
        if (error.code === '23505') {
          throw new Error('Já existe um ingrediente com esse nome.');
        }
        // 23514 = check_violation: nome vazio ou acima de 120 caracteres. Não é
        // duplicata, e dizer que é mandaria ela procurar um ingrediente que não
        // existe.
        if (error.code === '23514') {
          throw new Error('Nome inválido: use de 1 a 120 caracteres.');
        }
        throw new Error(error.message);
      }
      return (data as { id: string }).id;
    },
    onSuccess: () => invalidarMovimento(qc),
  });
}

export function useSalvarItemReceita() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: {
      produto_id: string;
      ingrediente_id: string;
      quantidade_base: number;
    }) => {
      const { error } = await supabase.from('receita_itens').upsert(
        { user_id: await donaAtual(), ...item },
        // Sem `onConflict`, mudar "1 pão" pra "2 pães" daria erro de duplicata
        // em vez de atualizar a linha que já existe.
        { onConflict: 'produto_id,ingrediente_id' },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: (_dados, item) => {
      qc.invalidateQueries({ queryKey: chaves.receita(item.produto_id) });
      return invalidarMovimento(qc);
    },
  });
}

export function useApagarItemReceita() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; produto_id: string }) => {
      const { error } = await supabase.from('receita_itens').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_dados, item) => {
      qc.invalidateQueries({ queryKey: chaves.receita(item.produto_id) });
      return invalidarMovimento(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// Vendas
// ---------------------------------------------------------------------------

export function useVendasDoDia() {
  return useQuery({
    queryKey: chaves.vendasDoDia,
    queryFn: async () => {
      // Recorte de 24h em vez do dia civil: o filtro por dia local precisaria
      // de RPC própria, e pra lista de "desfazer a última" o que importa é o
      // que acabou de acontecer. O número do dia vem de `fechamento_do_dia`,
      // que fecha no fuso certo.
      const desde = new Date(Date.now() - 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('vendas')
        .select(
          'id, produto_id, quantidade, preco_unitario, custo_unitario, total, lucro, vendida_em, cancelada_em, produtos(nome)',
        )
        .gte('vendida_em', desde)
        .order('vendida_em', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as VendaLinha[];
    },
  });
}

export function useRegistrarVenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ produto, quantidade = 1 }: { produto: Produto; quantidade?: number }) => {
      const { data, error } = await supabase
        .from('vendas')
        .insert({
          user_id: await donaAtual(),
          produto_id: produto.id,
          quantidade,
          // O gatilho `fecha_venda` troca 0 pelo preço de tabela. Mandar o
          // preço daqui permitiria, depois, uma tela de "vendi mais barato"
          // sem mexer no banco.
          preco_unitario: produto.preco_venda,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    },
    onSuccess: () => invalidarMovimento(qc),
  });
}

export function useCancelarVenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc<boolean>('cancelar_venda', { _venda_id: id }),
    onSuccess: () => invalidarMovimento(qc),
  });
}

// ---------------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------------

export function useHistoricoCompras(limite = 20) {
  return useQuery({
    queryKey: chaves.compras,
    queryFn: () => rpc<CompraResumo[]>('historico_compras', { _limite: limite }),
  });
}

export function useSalvarCompra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      fornecedor,
      data,
      itens,
      origem = 'foto',
    }: {
      fornecedor: string;
      /** "" quando a nota não tinha data: o banco assume o dia de hoje. */
      data: string;
      itens: ItemLido[];
      origem?: 'foto' | 'manual';
    }) =>
      rpc<string>('registrar_compra', {
        _fornecedor: fornecedor,
        _comprada_em: data || null,
        _itens: itens,
        _origem: origem,
      }),
    onSuccess: () => invalidarMovimento(qc),
  });
}

export function useCancelarCompra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc<boolean>('cancelar_compra', { _compra_id: id }),
    onSuccess: () => invalidarMovimento(qc),
  });
}
