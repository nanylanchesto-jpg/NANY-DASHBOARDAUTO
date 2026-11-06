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

import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Produto = {
  id: string;
  nome: string;
  preco_venda: number;
  ordem: number;
  ativo: boolean;
  /**
   * Os quatro abaixo vêm de `produtos_com_custo` e são da época da receita por
   * ingrediente. A tela não usa mais: o lucro agora é vendas menos gastos
   * (ver `lucroDe`), sem custo por produto.
   */
  custo_unitario: number;
  lucro_unitario: number;
  tem_receita: boolean;
  custo_estimado: number;
};

/** Os valores do CHECK de `vendas.pagamento`. */
export type Pagamento = 'dinheiro' | 'pix' | 'cartao';

/** Os valores do CHECK de `metas.periodo`. */
export type Periodo = 'dia' | 'semana' | 'mes';

export type Fechamento = {
  dia: string;
  receita: number;
  custo_vendido: number;
  /** Receita menos o custo dos ingredientes das vendas do dia: a margem. Não desconta despesa. */
  lucro_vendas: number;
  compras: number;
  /** Gasto que não é ingrediente (gás, embalagem, transporte, taxa). */
  despesas: number;
  /** Entrou de venda menos compras e despesas do dia: dinheiro. */
  caixa: number;
  unidades: number;
  /** Pedidos, não linhas: 2 hot-dogs + 1 suco contam 1. */
  atendimentos: number;
  /**
   * Receita por forma. Venda de antes do pedido não tem forma e não entra em
   * nenhuma, então as três podem somar menos que `receita`.
   */
  em_dinheiro: number;
  em_pix: number;
  em_cartao: number;
};

export type DiaResumo = {
  dia: string;
  receita: number;
  custo_vendido: number;
  lucro_vendas: number;
  compras: number;
  despesas: number;
  unidades: number;
  atendimentos: number;
};

/**
 * O lucro que TODA tela mostra: o que entrou de venda menos tudo que saiu
 * (mercado e outros gastos) no mesmo período.
 *
 * Antes havia dois números, a margem dos ingredientes (`lucro_vendas`) e o
 * caixa. A margem só existia se ela montasse a receita de cada produto,
 * ingrediente por ingrediente -- e foi exatamente isso que ela achou difícil
 * demais. Sem receita, a margem sai igual ao preço cheio, que é um número
 * bonito e falso. Vendas menos gastos é o que ela já faz de cabeça, e não
 * depende de cadastro nenhum.
 *
 * `|| 0` cobre a série de antes da migration 20260921120000, sem `despesas`.
 */
export function lucroDe(d: { receita: number; compras: number; despesas: number }) {
  return (d.receita || 0) - (d.compras || 0) - (d.despesas || 0);
}

/** Tudo que saiu: mercado (lançado como gasto, ou compra antiga) mais o resto. */
export function gastosDe(d: { compras: number; despesas: number }) {
  return (d.compras || 0) + (d.despesas || 0);
}

export type ProdutoVendas = {
  produto_id: string;
  nome: string;
  unidades: number;
  receita: number;
  lucro: number;
};

export type CompraResumo = {
  id: string;
  fornecedor: string;
  comprada_em: string;
  origem: 'foto' | 'manual';
  total: number;
  itens: number;
};

/** Uma linha de `vendas_do_dia`. Um pedido de 2 produtos são 2 linhas com o mesmo `pedido`. */
export type VendaDoDia = {
  id: string;
  /** null = venda de antes do pedido: desfaz por `useCancelarVenda(id)`. */
  pedido: string | null;
  produto_id: string;
  /** Nome atual do produto (preço e lucro, esses sim, são da hora da venda). */
  nome: string;
  quantidade: number;
  preco_unitario: number;
  total: number;
  lucro: number;
  /** null = venda de antes do campo existir. Não é "dinheiro". */
  pagamento: Pagamento | null;
  vendida_em: string;
  /** Vem preenchido nas desfeitas: quem esconde é a tela. */
  cancelada_em: string | null;
};

/** Meta de VENDAS (receita) em R$, uma por período. */
export type Meta = { periodo: Periodo; valor: number };

export type Despesa = {
  id: string;
  descricao: string;
  valor: number;
  /** "YYYY-MM-DD": o dia do gasto, que pode ser anterior ao lançamento. */
  dia: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Chaves de cache
// ---------------------------------------------------------------------------

export const chaves = {
  fechamento: (dia?: string) => ['fechamento', dia ?? 'hoje'] as const,
  resumoDias: (dias: number) => ['resumo-dias', dias] as const,
  porProduto: (dias: number) => ['por-produto', dias] as const,
  produtos: ['produtos'] as const,
  compras: ['compras'] as const,
  vendasDoDia: (dia?: string) => ['vendas-do-dia', dia ?? 'hoje'] as const,
  metas: ['metas'] as const,
  despesas: ['despesas'] as const,
};

/**
 * Tudo que uma venda, uma compra ou uma despesa muda de uma vez.
 *
 * Existe como lista única porque o custo de esquecer um item é invisível: a
 * tela simplesmente mostra o número velho, sem erro nenhum, e ela conclui que
 * o registro não funcionou. Venda mexe em estoque (baixa da receita), que mexe
 * no custo do produto, que mexe no lucro -- praticamente tudo se toca. Despesa
 * mexe no caixa do fechamento e da série.
 */
function invalidarMovimento(qc: QueryClient) {
  const raizes = [
    'fechamento',
    'resumo-dias',
    'por-produto',
    'produtos',
    'compras',
    'vendas-do-dia',
    'despesas',
  ];
  return Promise.all(raizes.map((raiz) => qc.invalidateQueries({ queryKey: [raiz] })));
}

/**
 * Erro do Supabase em português. As mensagens que as funções do banco levantam
 * (`RAISE EXCEPTION`) já vêm prontas e passam direto; o que não vem é o erro de
 * rede ("Failed to fetch"), o de sessão vencida e o das restrições, que chegavam
 * à tela em inglês de banco ("duplicate key value violates unique constraint").
 */
function falhaDoBanco(error: { message: string; code?: string }): Error {
  if (/fetch|network/i.test(error.message)) {
    return new Error('Sem internet. Confira a conexão e tente de novo.');
  }
  if (/jwt/i.test(error.message) || error.code === 'PGRST301') {
    return new Error('Sessão expirada. Saia e entre de novo.');
  }
  if (error.code === '23505') return new Error('Já existe um cadastro com esse nome.');
  if (error.code === '23514') return new Error('Algum valor ficou inválido. Confira os campos.');
  return new Error(error.message);
}

/** Desempacota um RPC, transformando erro do PostgREST em Error com a mensagem do banco. */
async function rpc<T>(nome: string, argumentos?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nome, argumentos);
  if (error) throw falhaDoBanco(error);
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

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

export function useProdutos() {
  return useQuery({
    queryKey: chaves.produtos,
    queryFn: () => rpc<Produto[]>('produtos_com_custo'),
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
        if (error) throw falhaDoBanco(error);
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
      if (error) throw falhaDoBanco(error);
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
        throw falhaDoBanco(error);
      }
    },
    onSuccess: () => invalidarMovimento(qc),
  });
}

// ---------------------------------------------------------------------------
// Vendas
// ---------------------------------------------------------------------------

/**
 * As vendas de um dia civil, linha a linha, canceladas inclusive.
 *
 * Sem `dia`, é o hoje do SERVIDOR (`dia_local()`), não o do celular: a lista
 * tem que fechar no mesmo dia que `fechamento_do_dia` soma, senão a venda das
 * 21h30 de sábado aparece numa e falta na outra.
 */
export function useVendasDoDia(dia?: string) {
  return useQuery({
    queryKey: chaves.vendasDoDia(dia),
    queryFn: () => rpc<VendaDoDia[]>('vendas_do_dia', { _dia: dia ?? null }),
  });
}

/**
 * Um pedido inteiro (2 hot-dogs + 1 suco, no Pix) numa chamada só. Devolve o
 * uuid do pedido, que é o que `useCancelarPedido` desfaz.
 *
 * RPC e não um INSERT por produto: no 3G da rua, a conexão que cai no meio
 * deixaria meio pedido gravado, com o estoque da metade já baixado. O preço
 * não vai daqui -- o banco usa o de tabela e fotografa o custo (`fecha_venda`),
 * então um cache velho de produtos no celular não grava preço antigo.
 */
export function useRegistrarPedido() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itens,
      pagamento,
    }: {
      itens: { produto: Produto; quantidade: number }[];
      pagamento: Pagamento;
    }) =>
      rpc<string>('registrar_pedido', {
        _itens: itens.map(({ produto, quantidade }) => ({ produto_id: produto.id, quantidade })),
        _pagamento: pagamento,
      }),
    onSuccess: () => invalidarMovimento(qc),
  });
}

/** Desfaz o pedido inteiro. Devolve quantas linhas cancelou: 0 = já estava desfeito. */
export function useCancelarPedido() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pedido: string) => rpc<number>('cancelar_pedido', { _pedido: pedido }),
    onSuccess: () => invalidarMovimento(qc),
  });
}

/** Desfaz UMA linha. É o caminho das vendas de antes do pedido (`pedido` null). */
export function useCancelarVenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc<boolean>('cancelar_venda', { _venda_id: id }),
    onSuccess: () => invalidarMovimento(qc),
  });
}

// ---------------------------------------------------------------------------
// Metas
// ---------------------------------------------------------------------------

export function useMetas() {
  return useQuery({
    queryKey: chaves.metas,
    queryFn: async () => {
      const { data, error } = await supabase.from('metas').select('periodo, valor');
      if (error) throw falhaDoBanco(error);
      return (data ?? []) as Meta[];
    },
  });
}

/** Define ou troca a meta do período: é upsert, porque só existe uma por período. */
export function useSalvarMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ periodo, valor }: Meta) => {
      const { error } = await supabase
        .from('metas')
        // Sem `onConflict`, definir a meta do dia pela segunda vez daria erro
        // de chave duplicada em vez de trocar o valor.
        .upsert({ user_id: await donaAtual(), periodo, valor }, { onConflict: 'user_id,periodo' });
      if (error) {
        if (error.code === '23514') throw new Error('A meta precisa ser maior que zero.');
        throw falhaDoBanco(error);
      }
    },
    // Meta não entra em conta nenhuma do banco: só a lista dela muda.
    onSuccess: () => qc.invalidateQueries({ queryKey: chaves.metas }),
  });
}

export function useApagarMeta() {
  const qc = useQueryClient();
  return useMutation({
    // Só o período no filtro: a RLS já limita o DELETE às metas desta conta.
    mutationFn: async (periodo: Periodo) => {
      const { error } = await supabase.from('metas').delete().eq('periodo', periodo);
      if (error) throw falhaDoBanco(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chaves.metas }),
  });
}

// ---------------------------------------------------------------------------
// Gastos (tabela `despesas`): mercado, gás, embalagem, transporte...
// ---------------------------------------------------------------------------

export function useDespesas(limite = 60) {
  return useQuery({
    // O limite entra na chave pra duas telas com limites diferentes não
    // dividirem um cache de tamanho errado; a raiz continua `chaves.despesas`,
    // que é o que `invalidarMovimento` derruba.
    queryKey: [...chaves.despesas, limite],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('despesas')
        .select('id, descricao, valor, dia, created_at')
        .order('dia', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limite);
      if (error) throw falhaDoBanco(error);
      return (data ?? []) as Despesa[];
    },
  });
}

export function useSalvarDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      descricao,
      valor,
      dia,
    }: {
      descricao: string;
      valor: number;
      /** "YYYY-MM-DD". Ausente = hoje, decidido pelo banco. */
      dia?: string;
    }) => {
      const { data, error } = await supabase
        .from('despesas')
        .insert({
          user_id: await donaAtual(),
          descricao: descricao.trim(),
          valor,
          // Sem `dia` no corpo, vale o DEFAULT `dia_local()`: o relógio do
          // celular pode estar errado, o fuso do banco não.
          ...(dia ? { dia } : {}),
        })
        .select('id')
        .single();
      if (error) {
        // 23514 = check_violation: descrição vazia/longa ou valor <= 0.
        if (error.code === '23514') {
          throw new Error('Descreva o gasto (até 120 letras) e use um valor maior que zero.');
        }
        throw falhaDoBanco(error);
      }
      return (data as { id: string }).id;
    },
    onSuccess: () => invalidarMovimento(qc),
  });
}

export function useApagarDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('despesas').delete().eq('id', id);
      if (error) throw falhaDoBanco(error);
    },
    onSuccess: () => invalidarMovimento(qc),
  });
}

// ---------------------------------------------------------------------------
// Compras antigas
//
// Da época em que a nota entrava item por item. Não se lança mais compra (o
// mercado agora é um gasto com o total da nota), mas as antigas continuam
// somando no dia delas, e a tela de Gastos ainda lista e desfaz.
// ---------------------------------------------------------------------------

export function useHistoricoCompras(limite = 20) {
  return useQuery({
    queryKey: chaves.compras,
    queryFn: () => rpc<CompraResumo[]>('historico_compras', { _limite: limite }),
  });
}

export function useCancelarCompra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rpc<boolean>('cancelar_compra', { _compra_id: id }),
    onSuccess: () => invalidarMovimento(qc),
  });
}
