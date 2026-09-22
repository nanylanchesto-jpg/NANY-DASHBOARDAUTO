/**
 * Formatação pt-BR de dinheiro, quantidade e data.
 *
 * `Intl` vem do Hermes (RN 0.86) no celular e do próprio navegador no web, sem
 * polyfill -- mas os formatadores são criados UMA vez no módulo, não a cada
 * chamada: construir `Intl.NumberFormat` é caro, e uma lista de vendas
 * reformata centenas de valores por render.
 */

import { daBase, ROTULO_UNIDADE, unidadeDeExibicao, type Unidade } from './unidades';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const NUMERO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const INTEIRO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** `|| 0` cobre NaN e null vindos de uma soma vazia do banco. */
export const dinheiro = (valor: number | null | undefined) => MOEDA.format(valor || 0);

/**
 * Dinheiro sem o sinal, pra onde a PALAVRA já diz de que lado o número está
 * ("Prejuízo R$ 24,30", "prejuízo R$ 3,80").
 *
 * A regra do app é essa, e vale nas duas pontas: onde aparece "prejuízo" ou
 * "Prejuízo", o valor vem em módulo; onde não aparece (Caixa, por exemplo), o
 * menos é que carrega o estado e fica. As duas coisas juntas ("Prejuízo
 * −R$ 24,30") é negação dupla, e era o que acontecia no hub, no Lucro, no
 * Histórico e na leitura do gráfico enquanto a Hoje e os Produtos já faziam
 * sem sinal -- o mesmo dia aparecia de dois jeitos em duas telas.
 */
export const dinheiroSemSinal = (valor: number | null | undefined) =>
  MOEDA.format(Math.abs(valor || 0));

export const quantidade = (valor: number | null | undefined) => NUMERO.format(valor || 0);

export const inteiro = (valor: number | null | undefined) => INTEIRO.format(valor || 0);

/**
 * Dinheiro sem os centavos, pro número grande do dashboard.
 *
 * "R$ 347" cabe na tela do celular e se lê de relance; "R$ 347,50" quebra a
 * linha em telas estreitas. Os centavos continuam aparecendo nos valores
 * unitários, onde a diferença de R$ 0,50 num hot-dog importa de verdade.
 */
export const dinheiroCurto = (valor: number | null | undefined) =>
  `R$ ${INTEIRO.format(Math.round(valor || 0))}`;

/** Saldo na unidade que faz sentido pro tamanho do número: "300 g", "2,4 kg". */
export const saldo = (base: number, unidade: Unidade) => {
  const mostrar = unidadeDeExibicao(base, unidade);
  return `${NUMERO.format(daBase(base, mostrar))} ${ROTULO_UNIDADE[mostrar]}`;
};

const DIA_MES = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const DIA_SEMANA = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * `DATE` do Postgres chega como "2026-09-17" -- string pura, sem fuso.
 * `new Date("2026-09-17")` interpreta como meia-noite UTC e, em Porto Alegre
 * (UTC−3), volta 21h do dia 16: todo rótulo do gráfico apareceria um dia
 * atrasado. Partir a string e montar a data em horário local evita o desvio.
 */
export const dataLocal = (iso: string) => {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return new Date(ano ?? 1970, (mes ?? 1) - 1, dia ?? 1);
};

export const diaMes = (iso: string) => DIA_MES.format(dataLocal(iso));

const MES_CURTO = new Intl.DateTimeFormat('pt-BR', { month: 'short' });

/**
 * "21 – 27 set", ou "29 set – 5 out" quando o intervalo vira o mês.
 *
 * Mês por extenso curto e não "21/09 – 27/09": é como ela fala da semana. Mora
 * aqui, e não na tela da Semana, porque a mesma semana aparece também em
 * Gastos -- e ali estava saindo em dd/mm, dois formatos pro mesmo intervalo.
 */
export const intervaloCurto = (inicio: string, fim: string) => {
  if (!inicio || !fim) return '';
  const mes = (iso: string) => MES_CURTO.format(dataLocal(iso)).replace('.', '');
  const dia = (iso: string) => Number(iso.slice(8, 10));
  return mes(inicio) === mes(fim)
    ? `${dia(inicio)} – ${dia(fim)} ${mes(fim)}`
    : `${dia(inicio)} ${mes(inicio)} – ${dia(fim)} ${mes(fim)}`;
};

export const diaDaSemana = (iso: string) =>
  DIA_SEMANA.format(dataLocal(iso)).replace('.', '').slice(0, 3);

/** Hora de um TIMESTAMPTZ, que aí sim tem fuso e pode ir direto pro Date. */
export const hora = (timestamptz: string) => HORA.format(new Date(timestamptz));

/**
 * Número a partir do que ela digitou, aceitando vírgula.
 *
 * `Number("12,50")` é NaN, e um campo de preço que zera calado quando a pessoa
 * digita do jeito brasileiro é pior que um que recusa. Também tolera o ponto de
 * milhar ("1.250,00") porque é assim que o valor aparece impresso na nota.
 */
export const numeroDeTexto = (texto: string): number => {
  const limpo = texto
    .trim()
    .replace(/\s/g, '')
    .replace(/R\$/gi, '')
    // Ponto só é separador de milhar quando há vírgula depois dele; sem
    // vírgula, "12.5" é decimal digitado em teclado numérico e tem que ficar.
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const valor = Number(limpo);
  return Number.isFinite(valor) ? valor : 0;
};

/** "2026-09-17" do dia de hoje no fuso do celular, pra casar com `dia_local()`. */
export const hojeISO = () => {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
};
