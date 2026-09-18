/**
 * Receita por dia, cada barra partida em custo e lucro.
 *
 * FORMA: barra empilhada, não duas linhas nem eixo duplo. Custo e lucro são
 * PARTES da receita (custo + lucro = receita), e empilhar é o que mostra as
 * duas coisas que ela quer saber de uma olhada: o tamanho do dia (altura da
 * barra) e quanto daquilo sobrou pra ela (o pedaço escuro no topo). Duas
 * séries lado a lado mostrariam os mesmos números perdendo a relação entre
 * eles.
 *
 * Tudo em reais, um eixo só. Gráfico de dois eixos y é a pior armadilha de
 * dataviz -- dá pra fazer qualquer série parecer que acompanha qualquer outra
 * só escolhendo as escalas.
 *
 * DIA DE PREJUÍZO quebra o empilhamento: não existe "parte negativa" de uma
 * soma. Nesses dias a barra inteira vira o estado.
 *
 * Com a paleta em preto e branco, esse terceiro estado NÃO é um terceiro
 * cinza: é hachura diagonal, na mesma tinta do lucro, com contorno. Um cinza
 * intermediário entre custo e lucro é exatamente o que não se distingue numa
 * barra estreita vista de lado. Ver `Grafico` em `constants/theme`.
 */

import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, Line, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg';

import { Espaco, Raio } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import type { DiaResumo } from '@/lib/dados';
import { diaDaSemana, diaMes, dinheiro, dinheiroCurto } from '@/lib/formato';

import { Cartao, Linha, Txt } from './ui';

const ALTURA = 150;
const RAIO_PONTA = 4;
/** Fundo aparecendo entre custo e lucro, pra separar os dois sem depender da tinta. */
const FOLGA = 2;
/** Mais que isso e os rótulos de dia se atropelam num celular estreito. */
const MAX_ROTULOS = 7;
/** Lado do ladrilho da hachura. O traço ocupa ~44% dele: listra, não cinza. */
const LADRILHO = 8;
const TRACO = 2.5;
/** Lado do quadradinho da legenda, dos dois tipos, pra alinharem. */
const CHAVE = 12;

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

/** Retângulo com só as duas pontas de cima arredondadas — a ponta dos dados. */
function caminhoPonta(x: number, y: number, largura: number, altura: number) {
  const r = Math.min(RAIO_PONTA, largura / 2, altura);
  return [
    `M ${x} ${y + altura}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + largura - r} ${y}`,
    `Q ${x + largura} ${y} ${x + largura} ${y + r}`,
    `L ${x + largura} ${y + altura}`,
    'Z',
  ].join(' ');
}

export function GraficoDias({ dias }: { dias: DiaResumo[] }) {
  const { cores, grafico } = useTema();
  const [largura, setLargura] = useState(0);
  const [selecionado, setSelecionado] = useState<number | null>(null);

  if (dias.length === 0) return null;

  const temPrejuizo = dias.some((d) => d.lucro_vendas < 0);
  // A escala sai da receita, que é o topo de toda barra -- inclusive nos dias
  // de prejuízo, onde a barra também vai até a receita.
  const teto = Math.max(...dias.map((d) => d.receita), 0);
  // Teto 0 (semana sem venda nenhuma) dividiria por zero e sumiria com o
  // gráfico; 1 mantém a grade desenhada e todas as barras rentes à base.
  const escala = teto > 0 ? ALTURA / teto : ALTURA;

  const vaoTotal = largura;
  const passo = vaoTotal / dias.length;
  const larguraBarra = Math.max(6, passo * 0.62);
  const passoRotulo = Math.ceil(dias.length / MAX_ROTULOS);

  const foco = selecionado === null ? null : dias[selecionado];

  return (
    <Cartao>
      {/* Legenda sempre presente: com duas séries, a identidade nunca pode
          depender só da tinta. */}
      <Linha style={{ flexWrap: 'wrap', marginBottom: Espaco.md }}>
        <Chave cor={grafico.lucro} rotulo="Lucro" />
        <Chave cor={grafico.custo} rotulo="Custo" />
        {temPrejuizo ? <Chave cor={grafico.prejuizo} rotulo="Dia no prejuízo" textura /> : null}
      </Linha>

      {/* O painel do dia tocado, que no celular faz o papel do tooltip. Fica
          acima do gráfico, não flutuando sobre ele: sobreposição num celular
          cobre justamente a barra que ela acabou de tocar. */}
      <View style={{ minHeight: 54, justifyContent: 'center', marginBottom: Espaco.sm }}>
        {foco ? (
          <View style={{ gap: 2 }}>
            <Txt tipo="rotulo" tom="textoFraco">
              {diaDaSemana(foco.dia)}, {diaMes(foco.dia)}
            </Txt>
            <Linha style={{ flexWrap: 'wrap', columnGap: Espaco.md }}>
              <Txt tipo="corpo" negrito>
                {dinheiro(foco.receita)}
              </Txt>
              {/* "lucro" / "prejuízo" escrito: sem matiz, a palavra é o que diz
                  de que lado o número está. */}
              <Txt tipo="rotulo" tom={foco.lucro_vendas < 0 ? 'negativo' : 'positivo'}>
                {foco.lucro_vendas < 0 ? 'prejuízo' : 'lucro'} {dinheiro(foco.lucro_vendas)}
              </Txt>
              <Txt tipo="rotulo" tom="textoFraco">
                custo {dinheiro(foco.custo_vendido)}
              </Txt>
            </Linha>
          </View>
        ) : (
          <Txt tipo="rotulo" tom="textoFraco">
            Toque num dia para ver os valores. Maior dia: {dinheiroCurto(teto)}
          </Txt>
        )}
      </View>

      <View onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
        {largura > 0 ? (
          <>
            <Svg width={largura} height={ALTURA + 4}>
              <Defs>
                <Pattern
                  id="hachura"
                  width={LADRILHO}
                  height={LADRILHO}
                  patternUnits="userSpaceOnUse">
                  {/* O vão entre os traços é a superfície do cartão, não
                      transparência: por baixo da barra passa a linha da base. */}
                  <Rect width={LADRILHO} height={LADRILHO} fill={cores.superficie} />
                  <Path d={HACHURA} stroke={grafico.prejuizo} strokeWidth={TRACO} />
                </Pattern>
              </Defs>

              {/* Base recessiva: referência, não informação. */}
              <Line
                x1={0}
                y1={ALTURA + 0.5}
                x2={largura}
                y2={ALTURA + 0.5}
                stroke={cores.borda}
                strokeWidth={1}
              />
              {dias.map((dia, indice) => {
                const centro = passo * indice + passo / 2;
                const x = centro - larguraBarra / 2;
                const alturaTotal = dia.receita * escala;
                if (alturaTotal <= 0) return null;

                const estaSelecionado = selecionado === indice;
                const anel = estaSelecionado ? (
                  <Rect
                    key={`anel-${dia.dia}`}
                    x={x - 2}
                    y={ALTURA - alturaTotal - 2}
                    width={larguraBarra + 4}
                    height={alturaTotal + 4}
                    rx={RAIO_PONTA + 2}
                    fill="none"
                    stroke={cores.texto}
                    strokeWidth={1.5}
                  />
                ) : null;

                // Prejuízo: sem empilhamento possível, a barra toda é o estado.
                // Hachura MAIS contorno: a hachura sozinha deixa a silhueta da
                // barra indefinida contra a superfície do cartão.
                if (dia.lucro_vendas < 0) {
                  return (
                    <Fragment key={dia.dia}>
                      <Path
                        d={caminhoPonta(x, ALTURA - alturaTotal, larguraBarra, alturaTotal)}
                        fill="url(#hachura)"
                        stroke={grafico.prejuizo}
                        strokeWidth={1}
                      />
                      {anel}
                    </Fragment>
                  );
                }

                const alturaLucro = Math.max(0, dia.lucro_vendas * escala);
                const alturaCusto = Math.max(0, alturaTotal - alturaLucro - FOLGA);

                return (
                  <Fragment key={dia.dia}>
                    {/* Custo encostado na base, cantos retos: é a ponta presa,
                        não a ponta dos dados. */}
                    {alturaCusto > 0 ? (
                      <Rect
                        x={x}
                        y={ALTURA - alturaCusto}
                        width={larguraBarra}
                        height={alturaCusto}
                        fill={grafico.custo}
                      />
                    ) : null}
                    {/* Lucro no topo, com a ponta arredondada. */}
                    <Path
                      d={caminhoPonta(
                        x,
                        ALTURA - alturaTotal,
                        larguraBarra,
                        Math.max(alturaLucro, 1),
                      )}
                      fill={grafico.lucro}
                    />
                    {anel}
                  </Fragment>
                );
              })}
              {/* Rótulos afinados: no máximo sete, pra não se atropelarem. */}
              {dias.map((dia, indice) =>
                indice % passoRotulo === 0 || indice === dias.length - 1 ? (
                  <SvgText
                    key={`rotulo-${dia.dia}`}
                    x={passo * indice + passo / 2}
                    y={ALTURA + 16}
                    fill={cores.textoFraco}
                    fontSize={11}
                    textAnchor="middle">
                    {dias.length > 10 ? diaMes(dia.dia).slice(0, 2) : diaDaSemana(dia.dia)}
                  </SvgText>
                ) : null,
              )}
            </Svg>

            {/* Alvos de toque por cima do SVG: maiores que a barra, cobrindo a
                faixa inteira do dia. Mirar numa barra de 20 px com o dedo, no
                balcão, não acontece. */}
            <View style={estilos.faixaToques}>
              {dias.map((dia, indice) => (
                <Pressable
                  key={`toque-${dia.dia}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${diaDaSemana(dia.dia)} ${diaMes(dia.dia)}: receita ${dinheiro(
                    dia.receita,
                  )}, ${dia.lucro_vendas < 0 ? 'prejuízo' : 'lucro'} ${dinheiro(dia.lucro_vendas)}`}
                  onPress={() => setSelecionado(indice === selecionado ? null : indice)}
                  style={{ width: passo, height: ALTURA }}
                />
              ))}
            </View>
          </>
        ) : (
          <View style={{ height: ALTURA + 20 }} />
        )}
      </View>

      <View style={{ height: 22 }} />
    </Cartao>
  );
}

function Chave({ cor, rotulo, textura }: { cor: string; rotulo: string; textura?: boolean }) {
  const { cores } = useTema();
  return (
    <Linha style={{ gap: Espaco.xs }}>
      {textura ? (
        <Svg width={CHAVE} height={CHAVE}>
          <Defs>
            <Pattern
              id="hachura-chave"
              width={LADRILHO}
              height={LADRILHO}
              patternUnits="userSpaceOnUse">
              <Rect width={LADRILHO} height={LADRILHO} fill={cores.superficie} />
              <Path d={HACHURA} stroke={cor} strokeWidth={TRACO} />
            </Pattern>
          </Defs>
          <Rect
            width={CHAVE}
            height={CHAVE}
            rx={Raio.sm / 2}
            fill="url(#hachura-chave)"
            stroke={cor}
            strokeWidth={1}
          />
        </Svg>
      ) : (
        <View
          style={{ width: CHAVE, height: CHAVE, borderRadius: Raio.sm / 2, backgroundColor: cor }}
        />
      )}
      {/* O texto usa tom de tinta, nunca a tinta da série: o quadradinho ao lado
          já carrega a identidade. */}
      <Txt tipo="rotulo" tom="textoFraco">
        {rotulo}
      </Txt>
    </Linha>
  );
}

const estilos = StyleSheet.create({
  faixaToques: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
  },
});
