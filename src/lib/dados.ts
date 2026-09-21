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
  /** Apurado: soma da receita com o preço real das compras. 0 sem receita. */
  custo_unitario: number;
  lucro_unitario: number;
  tem_receita: boolean;
  /** Palpite dela, pra ver margem antes de existir compra. Nunca é apuração. */
  custo_estimado: number;
};

/**
 * Qual custo a tela mostra, e de que natureza ele é.
 *
 * Um lugar só porque a regra tem que ser a MESMA em Produtos, Hoje e Lucro: um
 * número com cara de apurado numa tela e de palpite na outra é pior que não ter
 * o palpite. E a ordem importa -- o apurado sempre ganha do estimado, senão o
 * palpite velho continuaria na tela depois da primeira nota lançada, que é
 * justamente quando ele deixa de valer.
 *
 * `custo_unitario > 0` além de `tem_receita` porque receita cadastrada com
 * ingrediente que nunca foi comprado ainda soma 0: tem receita e não tem custo.
 */
export type CustoDoProduto =
  | { tipo: 'apurado'; custo: number; lucro: number }
  | { tipo: 'estimado'; custo: number; lucro: number }
  | { tipo: 'ausente' };

export function custoDoProduto(produto: Produto): CustoDoProduto {
  if (produto.tem_receita && produto.custo_unitario > 0) {
    return { tipo: 'apurado', custo: produto.custo_unitario, lucro: produto.lucro_unitario };
  }
  if (produto.custo_estimado > 0) {
    return {
      tipo: 'estimado',
      custo: produto.custo_estimado,
      lucro: produto.preco_venda - produto.custo_estimado,
    };
  }
  return { tipo: 'ausente' };
}

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
    'para-comprar',
    'produtos',
    'ingredientes',
    'compras',
    'vendas-do-dia',
    'despesas',
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
      /** Palpite de custo. `undefined` não mexe no que já está gravado. */
      custo_estimado?: number;
    }) => {
      if (produto.id) {
        const { error } = await supabase
          .from('produtos')
          .update({
            nome: produto.nome.trim(),
            preco_venda: produto.preco_venda,
            ordem: produto.ordem ?? 0,
            ...(produto.ativo === undefined ? {} : { ativo: produto.ativo }),
            ...(produto.custo_estimado === undefined
              ? {}
              : { custo_estimado: produto.custo_estimado }),
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
          custo_estimado: produto.custo_estimado ?? 0,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    },
    onSuccess: () => invalidarMovimento(qc),
  });
}

/**
 * Produto de revenda (Coca, água, salgadinho): ela compra pronto e vende pronto.
 *
 * Uma chamada só porque são quatro escritas dependentes -- ingrediente, produto,
 * item de receita e, se ela informar, a primeira compra. Fazer em quatro idas e
 * voltas deixaria um ingrediente órfão ou um produto sem receita quando o 3G do
 * balcão cai no meio, e produto sem receita é exatamente o estado "lucro igual
 * ao preço cheio" que isto existe pra acabar.
 */
export function useCriarProdutoDeRevenda() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      nome,
      preco_venda,
      quantidade = 0,
      preco_pago = 0,
    }: {
      nome: string;
      preco_venda: number;
      /** 0 cria só o cadastro; o custo fica pendente até a primeira nota. */
      quantidade?: number;
      preco_pago?: number;
    }) =>
      rpc<string>('criar_produto_de_revenda', {
        _nome: nome.trim(),
        _preco_venda: preco_venda,
        _quantidade: quantidade,
        _preco_pago: preco_pago,
      }),
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
      if (error) throw new Error(error.message);
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
        throw new Error(error.message);
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
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chaves.metas }),
  });
}

// ---------------------------------------------------------------------------
// Despesas (gasto que não é ingrediente)
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
      if (error) throw new Error(error.message);
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
        throw new Error(error.message);
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
      if (error) throw new Error(error.message);
    },
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
