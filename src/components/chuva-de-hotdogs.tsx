/**
 * Chuva de hot-dogs: a espera e a troca de tela viram um instante de marca.
 *
 * TRÊS REGRAS, e nenhuma é enfeite:
 *
 * 1. NÃO BLOQUEIA TOQUE. A camada é `pointerEvents: 'none'` em todos os usos.
 *    Se a animação atrasar um toque no balcão, ela custa registro -- e registro
 *    perdido é o risco nº 1 do projeto (PI06). O hot-dog cai POR CIMA de uma
 *    tela que já está inteira e funcionando.
 * 2. SOME PRA QUEM PEDIU MENOS MOVIMENTO. Quem liga "reduzir movimento" no
 *    sistema (enjoo, vertigem, epilepsia fotossensível) não vê nada cair: o
 *    `Carregando` volta ao indicador de sempre e as transições não acontecem.
 * 3. É DECORAÇÃO PRO LEITOR DE TELA. Quem não enxerga ouve "Carregando", não
 *    "imagem de cachorro-quente" sete vezes.
 *
 * Só transform (translate/rotate) e opacidade: são as duas propriedades que
 * animam sem refazer layout, e o aparelho dela é de entrada.
 */

import { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useAnimacaoReduzida } from '@/hooks/use-animacao-reduzida';

import { Hotdog } from './hotdog';

export type ModoDaChuva = 'continuo' | 'uma-vez';

type Semente = {
  chave: string;
  /** Em porcentagem da largura: o tipo literal é o que o estilo aceita. */
  esquerda: `${number}%`;
  tamanho: number;
  atraso: number;
  duracao: number;
  giro: number;
};

/**
 * Posições sorteadas UMA vez por montagem (`useMemo`), não a cada render: com
 * `Math.random()` solto no corpo, todo render remontaria a chuva do zero e ela
 * piscaria. A semente entra por índice pra duas chuvas na mesma tela não
 * caírem idênticas.
 */
function semear(quantidade: number, rapido: boolean): Semente[] {
  const passo = 100 / (quantidade + 1);
  return Array.from({ length: quantidade }, (_, i) => {
    const desvio = (Math.random() - 0.5) * passo * 0.8;
    return {
      chave: `hotdog-${i}`,
      esquerda: `${Math.min(88, Math.max(2, passo * (i + 1) + desvio))}%` as const,
      tamanho: 40 + Math.round(Math.random() * 26),
      atraso: rapido ? i * 70 : i * 220 + Math.round(Math.random() * 180),
      duracao: rapido ? 620 + Math.round(Math.random() * 220) : 1500 + Math.round(Math.random() * 900),
      giro: (Math.random() < 0.5 ? -1 : 1) * (120 + Math.round(Math.random() * 240)),
    };
  });
}

function HotdogQueCai({
  semente,
  percurso,
  modo,
  aoTerminar,
}: {
  semente: Semente;
  percurso: number;
  modo: ModoDaChuva;
  aoTerminar?: () => void;
}) {
  const avanco = useSharedValue(0);

  useEffect(() => {
    const queda = withTiming(
      1,
      { duration: semente.duracao, easing: Easing.in(Easing.quad) },
      aoTerminar
        ? (concluiu) => {
            if (concluiu) runOnJS(aoTerminar)();
          }
        : undefined,
    );
    avanco.value = withDelay(semente.atraso, modo === 'continuo' ? withRepeat(queda, -1) : queda);
    return () => cancelAnimation(avanco);
  }, [avanco, modo, semente.atraso, semente.duracao, aoTerminar]);

  const estilo = useAnimatedStyle(() => ({
    transform: [
      { translateY: -120 + avanco.value * percurso },
      { rotate: `${avanco.value * semente.giro}deg` },
    ],
    // Aparece e some nas pontas: o hot-dog não "nasce" nem "morre" no meio da
    // tela, ele entra por cima e sai por baixo.
    opacity: avanco.value < 0.08 ? avanco.value / 0.08 : avanco.value > 0.9 ? (1 - avanco.value) / 0.1 : 1,
  }));

  return (
    <Animated.View style={[styles.gota, { left: semente.esquerda }, estilo]}>
      <Hotdog tamanho={semente.tamanho} />
    </Animated.View>
  );
}

/**
 * A chuva.
 *
 * `continuo` é a espera (a leitura da nota leva segundos); `uma-vez` é a
 * transição, e aí o último hot-dog a cair avisa por `aoTerminar` pra camada
 * sair da tela em vez de ficar montada à toa.
 */
export function ChuvaDeHotdogs({
  modo = 'continuo',
  quantidade = 6,
  altura,
  style,
  aoTerminar,
}: {
  modo?: ModoDaChuva;
  quantidade?: number;
  /** Distância da queda. Sem valor, a altura da janela. */
  altura?: number;
  style?: StyleProp<ViewStyle>;
  aoTerminar?: () => void;
}) {
  const janela = useWindowDimensions();
  const reduzida = useAnimacaoReduzida();
  const rapido = modo === 'uma-vez';
  const sementes = useMemo(() => semear(quantidade, rapido), [quantidade, rapido]);

  // Sem movimento pra quem pediu menos movimento -- e a transição avisa que
  // terminou na hora, senão a camada ficaria pendurada pra sempre.
  useEffect(() => {
    if (reduzida && aoTerminar) aoTerminar();
  }, [reduzida, aoTerminar]);

  if (reduzida) return null;

  const percurso = (altura ?? janela.height) + 240;
  // Só o ÚLTIMO a cair avisa: com todos avisando, a camada sairia no primeiro.
  const ultimo = sementes.reduce((a, b) => (a.atraso + a.duracao >= b.atraso + b.duracao ? a : b));

  return (
    <View
      // Decorativo: quem lê a tela ouve o rótulo de quem usa a chuva
      // ("Carregando"), não uma lista de figuras.
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.camada, style]}>
      {sementes.map((semente) => (
        <HotdogQueCai
          key={semente.chave}
          semente={semente}
          percurso={percurso}
          modo={modo}
          aoTerminar={aoTerminar && semente.chave === ultimo.chave ? aoTerminar : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  camada: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  gota: {
    position: 'absolute',
    top: 0,
  },
});
