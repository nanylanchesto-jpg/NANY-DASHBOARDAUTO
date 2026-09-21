/**
 * Contas de calendário do Planejar: semana, mês, meta e compra da semana.
 *
 * Funções puras sobre o que o banco já somou. Aritmética de estoque NÃO mora
 * aqui (é dos gatilhos no Postgres): isto só recorta a série de
 * `resumo_por_dia` no período e projeta a compra a partir do ritmo que
 * `ingredientes_para_comprar` já calculou.
 *
 * DATAS: entra e sai "YYYY-MM-DD", o `DATE` do Postgres, sem fuso. A conta é
 * feita em UTC puro (`Date.UTC`/`getUTC*`), que não tem horário de verão nem
 * depende do fuso do celular -- o mesmo problema que `dataLocal()` resolve em
 * formato.ts, só que aqui a data nunca vira objeto pra quem chama. E "hoje"
 * vem do banco (`hojeDaSerie`), nunca de `new Date()`: com o relógio do
 * celular adiantado ou em outro fuso, a semana dela viraria num dia diferente
 * do que o fechamento soma.
 */

import type { DiaResumo, Meta, ParaComprar, Periodo } from './dados';
import type { Unidade } from './unidades';

const DIA_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}/;

/** Meia-noite UTC do dia, em ms. NaN se não for data. */
function emUTC(iso: string): number {
  if (!ISO.test(iso)) return NaN;
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

/**
 * Volta pra "YYYY-MM-DD". '' em vez de exceção quando a entrada não era data:
 * `toISOString()` de data inválida lança RangeError, e isso derrubaria a tela
 * inteira enquanto a série ainda está carregando.
 */
function deUTC(ms: number): string {
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
}

/** Dias corridos desde a segunda-feira (segunda = 0, domingo = 6). */
function desdeSegunda(ms: number): number {
  // getUTCDay() começa no domingo (0); o +6 mod 7 desloca o zero pra segunda.
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/** Soma (ou subtrai) dias corridos. */
export function somarDias(iso: string, dias: number): string {
  return deUTC(emUTC(iso) + dias * DIA_MS);
}

/**
 * Segunda-feira da semana que contém `iso`.
 *
 * Segunda, e não o domingo do `getUTCDay()`: assim sábado e domingo caem na
 * MESMA semana. Começando no domingo, o fim de semana -- quando rua e feira
 * mais vendem -- ficaria partido entre duas semanas.
 */
export function inicioDaSemana(iso: string): string {
  const ms = emUTC(iso);
  return deUTC(ms - desdeSegunda(ms) * DIA_MS);
}

/** Os 7 dias (segunda a domingo) da semana que contém `hoje`, pro gráfico da semana. */
export function diasDaSemana(hoje: string): string[] {
  const inicio = inicioDaSemana(hoje);
  if (!inicio) return [];
  return Array.from({ length: 7 }, (_, i) => somarDias(inicio, i));
}

/** Primeiro dia do período que contém `hoje`. */
export function inicioDoPeriodo(periodo: Periodo, hoje: string): string {
  if (!ISO.test(hoje)) return '';
  if (periodo === 'dia') return hoje.slice(0, 10);
  if (periodo === 'semana') return inicioDaSemana(hoje);
  return `${hoje.slice(0, 7)}-01`;
}

/** Último dia do período que contém `hoje` (pode estar no futuro). */
export function fimDoPeriodo(periodo: Periodo, hoje: string): string {
  if (!ISO.test(hoje)) return '';
  if (periodo === 'dia') return hoje.slice(0, 10);
  if (periodo === 'semana') return somarDias(inicioDaSemana(hoje), 6);
  const [ano, mes] = hoje.slice(0, 7).split('-').map(Number);
  // Dia 0 do mês seguinte é o último dia deste: cobre 28, 29, 30 e 31.
  return deUTC(Date.UTC(ano, mes, 0));
}

/** Se `dia` cai no período que contém `hoje`. Comparação de string: ISO ordena igual à data. */
export function noPeriodo(dia: string, periodo: Periodo, hoje: string): boolean {
  const inicio = inicioDoPeriodo(periodo, hoje);
  if (!inicio) return false;
  const d = dia.slice(0, 10);
  return d >= inicio && d <= fimDoPeriodo(periodo, hoje);
}

/**
 * Dias que ainda restam no período, CONTANDO hoje -- o divisor do "R$ Y por
 * dia" da meta. Conta hoje porque às 9h de segunda a semana inteira ainda está
 * pela frente. Nunca menos que 1, então dá pra dividir sem guarda.
 */
export function diasRestantes(periodo: Periodo, hoje: string): number {
  const fim = fimDoPeriodo(periodo, hoje);
  if (!fim) return 1;
  return Math.max(1, Math.round((emUTC(fim) - emUTC(hoje)) / DIA_MS) + 1);
}

export type SomaPeriodo = {
  receita: number;
  /** Soma de `lucro_vendas`: margem, não desconta despesa. */
  lucro: number;
  compras: number;
  despesas: number;
  /** receita − compras − despesas, a mesma conta do `caixa` de `fechamento_do_dia`. */
  caixa: number;
  atendimentos: number;
};

/**
 * Soma as linhas de `resumo_por_dia` que caem no período que contém `hoje`.
 *
 * A série tem que COBRIR o período: 7 dias bastam pra semana (que nunca começou
 * há mais de 6 dias), o mês pede 31. Com série curta a soma sai menor calada --
 * a função não tem como saber dos dias que não recebeu.
 *
 * Aceita 'dia' também, pro progresso da meta diária sair da mesma conta que o
 * da semana e o do mês.
 */
export function somaPeriodo(dias: DiaResumo[], periodo: Periodo, hoje: string): SomaPeriodo {
  const soma: SomaPeriodo = {
    receita: 0,
    lucro: 0,
    compras: 0,
    despesas: 0,
    caixa: 0,
    atendimentos: 0,
  };
  for (const d of dias) {
    if (!noPeriodo(d.dia, periodo, hoje)) continue;
    // `|| 0` pelo mesmo motivo de `dinheiro()` -- e cobre o app publicado antes
    // da migration 20260921120000, quando a série ainda não trazia despesas
    // nem atendimentos: sem ele, o total inteiro viraria NaN.
    soma.receita += d.receita || 0;
    soma.lucro += d.lucro_vendas || 0;
    soma.compras += d.compras || 0;
    soma.despesas += d.despesas || 0;
    soma.atendimentos += d.atendimentos || 0;
  }
  soma.caixa = soma.receita - soma.compras - soma.despesas;
  return soma;
}

/**
 * O "hoje" do servidor: o último dia da série de `resumo_por_dia`, que termina
 * em `dia_local()`. '' com a série vazia (ainda carregando); as funções daqui
 * tratam '' como "sem dado" em vez de lançar.
 */
export function hojeDaSerie(dias: DiaResumo[]): string {
  let hoje = '';
  // Maior dia, e não `dias.at(-1)`: não depende da ordem em que a série veio.
  for (const d of dias) if (d.dia > hoje) hoje = d.dia;
  return hoje.slice(0, 10);
}

const PRIORIDADE: Periodo[] = ['dia', 'semana', 'mes'];

/**
 * A meta mais imediata: a do dia ganha da semana, que ganha do mês. A tela
 * Hoje mostra UMA barra, e "preciso vender agora?" é pergunta de prazo curto.
 * Aceita `undefined` pra receber direto o `data` de `useMetas()` carregando.
 */
export function metaAtiva(metas: Meta[] | null | undefined): Meta | null {
  for (const periodo of PRIORIDADE) {
    const meta = metas?.find((m) => m.periodo === periodo && m.valor > 0);
    if (meta) return meta;
  }
  return null;
}

export type ItemDoPlano = {
  id: string;
  nome: string;
  unidade: Unidade;
  /** Quanto comprar, em unidade-base (g, ml ou unidade): exibir com `saldo()`. */
  necessidade: number;
  /** `necessidade` × custo médio atual. 0 se o ingrediente nunca foi comprado. */
  custo: number;
};

/**
 * O que comprar pra `dias` dias no ritmo da última semana, do mais caro pro
 * mais barato.
 *
 * Saldo negativo conta como zero, e não como dívida a somar: o negativo é
 * venda feita com compra ainda não LANÇADA (ver `ingredientes.estoque_base`),
 * não pão faltando na prateleira. A compra que cobriu aquele buraco já
 * aconteceu; somá-la de novo faria comprar duas vezes.
 *
 * Arredonda pra cima na unidade-base: não existe comprar 9,4 pães, e 1 g a
 * mais de molho não muda o custo.
 *
 * Fica fora o que não gira (sem ritmo não há o que projetar) e o que já tem
 * estoque pro período: a lista é do que COMPRAR, e vazia quer dizer "nada".
 */
export function planoDeCompras(itens: ParaComprar[], dias = 7): ItemDoPlano[] {
  const plano: ItemDoPlano[] = [];
  for (const item of itens) {
    if (!(item.consumo_dia > 0)) continue;
    const falta = item.consumo_dia * dias - Math.max(item.estoque_base, 0);
    // O épsilon segura o 10,000000001 que sai de 1,4285714… × 7 e que o ceil
    // levaria a 11.
    const necessidade = Math.max(0, Math.ceil(falta - 1e-9));
    if (necessidade === 0) continue;
    plano.push({
      id: item.id,
      nome: item.nome,
      unidade: item.unidade,
      necessidade,
      custo: necessidade * (item.custo_base || 0),
    });
  }
  return plano.sort((a, b) => b.custo - a.custo || a.nome.localeCompare(b.nome, 'pt-BR'));
}
