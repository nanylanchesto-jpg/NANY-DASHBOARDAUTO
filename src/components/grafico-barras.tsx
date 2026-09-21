/**
 * Uma barra por dia, em reais, e a leitura do dia tocado logo acima.
 *
 * Dois modos, uma série só em cada -- por isso não tem legenda. Legenda é pra
 * separar séries; com uma só, ela é um bloco de texto que ninguém lê.
 *
 * - `vendas`: quanto entrou em cada dia. Hoje vai em tomate (`destaque`), os
 *   outros dias em marrom apagado. Hoje também tem o rótulo "hoje" em negrito
 *   embaixo: a cor sozinha não pode ser o que marca o dia.
 * - `lucro`: quanto sobrou. Dia bom sobe da linha de base; dia de prejuízo
 *   DESCE dela, com hachura. Descer é a leitura de "negativo" que não depende
 *   de enxergar cor nenhuma.
 *
 * Tudo em reais, um eixo só. Gráfico de dois eixos y é a pior armadilha de
 * dataviz -- dá pra fazer qualquer série parecer que acompanha qualquer outra
 * só escolhendo as escalas.
 *
 * O componente não tem cartão próprio: quem usa decide se ele vai dentro de
 * um `Cartao` ou solto na tela.
 */

import { Fragment, useId, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, Line, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg';

import { Espaco } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import { diaDaSemana, diaMes, dinheiro } from '@/lib/formato';

import { Linha, Txt } from './ui';

export type PontoGrafico = { dia: string; valor: number };

/** Raio da ponta da barra (a ponta dos dados; a ponta presa na base é reta). */
const RAIO_PONTA = 6;
/** Com poucos dias a barra não vira bloco: acima disso, sobra ar entre elas. */
const LARGURA_MAX_BARRA = 28;
/** Mais que isso e os rótulos de dia se atropelam num celular estreito. */
const MAX_ROTULOS = 7;
/** Faixa embaixo do gráfico onde moram os rótulos de dia. */
const FAIXA_ROTULOS = 22;
/** Espaço à direita reservado pro rótulo "meta", fora das barras. */
const MARGEM_META = 36;
/** Folga do anel de seleção em volta da barra. */
const FOLGA_ANEL = 3;
/** Lado do ladrilho da hachura. O traço ocupa ~44% dele: listra, não cinza. */
const LADRILHO = 8;
const TRACO = 2.5;

/**
 * Hachura a 45° que ladrilha sem emenda: a diagonal principal mais os dois
 * pedaços de canto. Desenhada assim, e não com `patternTransform="rotate(45)"`,
 * porque a rotação de padrão não se comporta igual nas três plataformas.
 */
const HACHURA = [
  'M -2 2 L 2 -2',
  `M 0 ${LADRILHO} L ${LADRILHO} 0`,
  `M ${LADRILHO - 2} ${LADRILHO + 2} L ${LADRILHO + 2} ${LADRILHO - 2}`,
].join(' ');

/**
 * Fonte dos rótulos dentro do SVG. No celular o `<Text>` do SVG já usa a do
 * sistema; no navegador ele herdaria a serifada padrão do `<svg>`, destoando
 * de todo o resto da tela.
 */
const FONTE_SVG = Platform.select({
  web: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  default: undefined,
});

/**
 * Retângulo com só as duas pontas de DADOS arredondadas: as de cima numa
 * barra que sobe, as de baixo numa que desce. O lado preso à base fica reto.
 */
function caminhoBarra(x: number, y: number, largura: number, altura: number, sobe: boolean) {
  const r = Math.min(RAIO_PONTA, largura / 2, altura);
  const fundo = y + altura;
  const direita = x + largura;
  if (sobe) {
    return [
      `M ${x} ${fundo}`,
      `L ${x} ${y + r}`,
      `Q ${x} ${y} ${x + r} ${y}`,
      `L ${direita - r} ${y}`,
      `Q ${direita} ${y} ${direita} ${y + r}`,
      `L ${direita} ${fundo}`,
      'Z',
    ].join(' ');
  }
  return [
    `M ${x} ${y}`,
    `L ${x} ${fundo - r}`,
    `Q ${x} ${fundo} ${x + r} ${fundo}`,
    `L ${direita - r} ${fundo}`,
    `Q ${direita} ${fundo} ${direita} ${fundo - r}`,
    `L ${direita} ${y}`,
    'Z',
  ].join(' ');
}

export function GraficoBarras({
  pontos,
  modo,
  meta,
  altura = 120,
  hoje,
}: {
  pontos: PontoGrafico[];
  modo: 'vendas' | 'lucro';
  /** Linha tracejada de referência (meta diária de vendas, em R$). */
  meta?: number;
  /** Altura da área das barras, sem a faixa dos rótulos de dia. */
  altura?: number;
  /**
   * Qual `dia` é hoje. Sem ele, hoje é o último ponto -- o caso de "últimos 7
   * dias". Existe pra semana corrente (seg a dom), onde o último ponto pode
   * ser um domingo que ainda não chegou: os dias depois de hoje ficam sem
   * barra e sem toque, em vez de parecerem dias de venda zero.
   */
  hoje?: string;
}) {
  const { cores, grafico } = useTema();
  const [largura, setLargura] = useState(0);
  // Guardado pelo DIA, não pelo índice: trocar de 30 pra 7 dias com um dia
  // escolhido faria o índice apontar pra fora da série.
  const [diaEscolhido, setDiaEscolhido] = useState<string | null>(null);
  // Um id por gráfico: no web o `url(#...)` resolve pro PRIMEIRO elemento com
  // aquele id no documento, que pode estar numa tela escondida da pilha -- e
  // padrão dentro de `display: none` não pinta. O `useId` traz caracteres que
  // não valem em `url(#)`; ficam só letras, números, `_` e `-`.
  const idHachura = `hachura${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const n = pontos.length;
  if (n === 0) return null;

  const indiceHoje = hoje ? pontos.findIndex((p) => p.dia === hoje) : n - 1;
  const futuro = (i: number) => indiceHoje >= 0 && i > indiceHoje;
  // Receita não é negativa; no modo vendas um valor abaixo de zero só pode
  // ser ruído de arredondamento, e desenhá-lo pra baixo mentiria.
  const valorDe = (v: number) => (modo === 'vendas' ? Math.max(0, v) : v);

  const temMeta = meta != null && meta > 0;
  const larguraPlot = Math.max(0, largura - (temMeta ? MARGEM_META : 0));
  const passo = larguraPlot / n;
  const larguraBarra = Math.min(LARGURA_MAX_BARRA, Math.max(4, passo * 0.58));

  // Escala: o topo é o maior valor (ou a meta, se ela estiver acima -- a
  // linha tem que caber); o fundo só existe se houver prejuízo. A base (o
  // zero) fica onde as duas partes se encontram.
  const topo = Math.max(0, ...pontos.map((p) => valorDe(p.valor)), temMeta ? meta : 0);
  const fundo = Math.max(0, ...pontos.map((p) => -valorDe(p.valor)));
  const escala = topo + fundo > 0 ? altura / (topo + fundo) : 0;
  // Tudo zero: base no chão do gráfico, não no teto.
  const base = topo + fundo > 0 ? topo * escala : altura;
  const alturaDe = (v: number) => (v === 0 ? 0 : Math.max(2, Math.abs(v) * escala));

  const escolhido = diaEscolhido ? pontos.findIndex((p) => p.dia === diaEscolhido) : -1;
  const foco = escolhido >= 0 ? escolhido : indiceHoje >= 0 ? indiceHoje : n - 1;
  const pontoFoco = pontos[foco]!;
  const valorFoco = valorDe(pontoFoco.valor);

  const passoRotulo = Math.ceil(n / MAX_ROTULOS);
  const nomeDoDia = (dia: string, i: number) =>
    i === indiceHoje ? 'hoje' : n > 10 ? diaMes(dia).slice(0, 2) : diaDaSemana(dia);

  const palavra = (v: number) => (modo === 'vendas' ? 'vendas' : v < 0 ? 'prejuízo' : 'lucro');

  return (
    <View>
      {/* A leitura do dia, que no celular faz o papel do tooltip. Fica acima
          do gráfico, não flutuando sobre ele: sobreposição num celular cobre
          justamente a barra que ela acabou de tocar. Sem toque, mostra hoje. */}
      <Linha style={estilos.leitura}>
        <Txt tipo="rotulo" tom="textoFraco">
          {foco === indiceHoje ? 'hoje' : diaDaSemana(pontoFoco.dia)}, {diaMes(pontoFoco.dia)}
        </Txt>
        <Txt tipo="secao" style={{ fontVariant: ['tabular-nums'] }}>
          {dinheiro(valorFoco)}
        </Txt>
        {/* "lucro" / "prejuízo" escrito: o sinal de menos é fácil de não ver,
            e a cor não chega pra quem não distingue vermelho de verde. */}
        {modo === 'lucro' && valorFoco !== 0 ? (
          <Txt tipo="rotulo" negrito tom={valorFoco < 0 ? 'negativo' : 'positivo'}>
            {palavra(valorFoco)}
          </Txt>
        ) : null}
      </Linha>

      <View onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
        {largura > 0 ? (
          <>
            {/* O desenho é só pro olho: quem lê a tela ouve os alvos de toque
                logo abaixo, que dizem dia e valor por extenso. */}
            <View
              aria-hidden
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              <Svg width={largura} height={altura + FAIXA_ROTULOS}>
                <Defs>
                  <Pattern
                    id={idHachura}
                    width={LADRILHO}
                    height={LADRILHO}
                    patternUnits="userSpaceOnUse">
                    {/* Vão transparente: o gráfico pode estar num cartão ou
                        solto no creme, e um vão pintado de branco viraria
                        listra branca no creme. A base não passa por baixo da
                        barra de prejuízo (ela começa na base e desce), então
                        não há linha pra vazar pelo vão. */}
                    <Path d={HACHURA} stroke={grafico.prejuizo} strokeWidth={TRACO} />
                  </Pattern>
                </Defs>

                {/* Base recessiva: referência, não informação. */}
                <Line
                  x1={0}
                  y1={base + 0.5}
                  x2={larguraPlot}
                  y2={base + 0.5}
                  stroke={cores.borda}
                  strokeWidth={1}
                />

                {pontos.map((ponto, i) => {
                  if (futuro(i)) return null;
                  const v = valorDe(ponto.valor);
                  const h = alturaDe(v);
                  const x = passo * i + passo / 2 - larguraBarra / 2;

                  // Anel no dia tocado: a leitura acima mudou, e o anel diz
                  // de QUAL barra ela fala. Dia zerado ganha um anel baixinho
                  // em cima da base, pra o toque não parecer que falhou.
                  const anel =
                    i === escolhido ? (
                      <Rect
                        x={x - FOLGA_ANEL}
                        y={v > 0 ? base - h - FOLGA_ANEL : v < 0 ? base - FOLGA_ANEL : base - 5}
                        width={larguraBarra + 2 * FOLGA_ANEL}
                        height={v === 0 ? 10 : h + 2 * FOLGA_ANEL}
                        rx={RAIO_PONTA + FOLGA_ANEL}
                        fill="none"
                        stroke={cores.texto}
                        strokeWidth={1.5}
                      />
                    ) : null;

                  if (v === 0) return <Fragment key={ponto.dia}>{anel}</Fragment>;

                  // Prejuízo: hachura MAIS contorno. A hachura sozinha deixa a
                  // silhueta da barra indefinida contra o fundo.
                  //
                  // Com tomate e verde, este estado parece resolvido pela cor
                  // -- não está: é exatamente o par que protan e deutan
                  // confundem. O que separa prejuízo de lucro é a hachura e o
                  // lado da base (ver `Grafico` no tema). Tirar a hachura
                  // "porque agora tem cor" apaga a única distinção que sobra
                  // pra quem não enxerga a diferença.
                  if (v < 0) {
                    return (
                      <Fragment key={ponto.dia}>
                        <Path
                          d={caminhoBarra(x, base, larguraBarra, h, false)}
                          fill={`url(#${idHachura})`}
                          stroke={grafico.prejuizo}
                          strokeWidth={1}
                        />
                        {anel}
                      </Fragment>
                    );
                  }

                  const tinta =
                    modo === 'lucro'
                      ? grafico.lucro
                      : i === indiceHoje
                        ? grafico.destaque
                        : grafico.barra;
                  return (
                    <Fragment key={ponto.dia}>
                      <Path d={caminhoBarra(x, base - h, larguraBarra, h, true)} fill={tinta} />
                      {anel}
                    </Fragment>
                  );
                })}

                {/* Meta por cima das barras, pra não sumir atrás delas. O
                    rótulo mora na margem da direita, fora da área das barras:
                    dentro, cobriria justamente a barra de hoje. */}
                {temMeta ? (
                  <>
                    <Line
                      x1={0}
                      y1={base - meta * escala}
                      x2={larguraPlot + Espaco.xs}
                      y2={base - meta * escala}
                      stroke={cores.texto}
                      strokeWidth={1.5}
                      strokeDasharray={[5, 4]}
                    />
                    <SvgText
                      x={largura}
                      y={base - meta * escala + 4}
                      textAnchor="end"
                      fontSize={12}
                      fontWeight="700"
                      fontFamily={FONTE_SVG}
                      fill={cores.texto}>
                      meta
                    </SvgText>
                  </>
                ) : null}

                {/* Rótulos afinados: no máximo sete, pra não se atropelarem;
                    hoje sempre aparece. */}
                {pontos.map((ponto, i) =>
                  i % passoRotulo === 0 || i === indiceHoje ? (
                    <SvgText
                      key={`rotulo-${ponto.dia}`}
                      x={passo * i + passo / 2}
                      y={altura + 16}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={i === indiceHoje || i === escolhido ? '700' : '400'}
                      fontFamily={FONTE_SVG}
                      fill={i === indiceHoje || i === escolhido ? cores.texto : cores.textoFraco}>
                      {nomeDoDia(ponto.dia, i)}
                    </SvgText>
                  ) : null,
                )}
              </Svg>
            </View>

            {/* Alvos de toque por cima do SVG: a faixa inteira do dia, da
                barra ao rótulo. Mirar numa barra de 20 px com o dedo, no
                balcão, não acontece. */}
            <View style={[estilos.faixaToques, { width: larguraPlot }]}>
              {pontos.map((ponto, i) => {
                const v = valorDe(ponto.valor);
                const estilo = { width: passo, height: altura + FAIXA_ROTULOS };
                if (futuro(i)) return <View key={`toque-${ponto.dia}`} style={estilo} />;
                return (
                  <Pressable
                    key={`toque-${ponto.dia}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${i === indiceHoje ? 'hoje, ' : ''}${diaDaSemana(
                      ponto.dia,
                    )} ${diaMes(ponto.dia)}: ${palavra(v)} ${dinheiro(v)}`}
                    onPress={() => setDiaEscolhido(i === escolhido ? null : ponto.dia)}
                    style={estilo}
                  />
                );
              })}
            </View>
          </>
        ) : (
          <View style={{ height: altura + FAIXA_ROTULOS }} />
        )}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  leitura: {
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: Espaco.sm,
    rowGap: 0,
    minHeight: 28,
    marginBottom: Espaco.md,
  },
  faixaToques: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
  },
});
