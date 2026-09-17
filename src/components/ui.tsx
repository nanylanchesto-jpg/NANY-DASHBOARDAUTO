/**
 * Primitivas de tela. Uma só implementação pra web e nativo -- nada de
 * `.web.tsx` aqui, porque cada par de arquivos é um lugar onde o app da Nany e
 * o app do celular podem divergir sem ninguém notar.
 */

import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Espaco, Fonte, LarguraMax, Raio, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

type TipoTexto = 'rotulo' | 'corpo' | 'titulo' | 'numero' | 'numeroGrande';
type TomTexto =
  | 'texto'
  | 'textoFraco'
  | 'positivo'
  | 'negativo'
  | 'atencao'
  | 'primaria'
  /** Tinta para usar SOBRE o fundo `primaria` — não confundir com `primaria`. */
  | 'primariaTexto';

export function Txt({
  children,
  tipo = 'corpo',
  tom = 'texto',
  negrito,
  centro,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  tipo?: TipoTexto;
  tom?: TomTexto;
  negrito?: boolean;
  centro?: boolean;
  /** TextStyle, não ViewStyle: isto estiliza um <Text>. Tipar como ViewStyle
   *  obrigava um `as never` em cada `flex: 1` nos pontos de uso. */
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const { cores } = useTema();
  const grande = tipo === 'numero' || tipo === 'numeroGrande';
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontSize: Fonte[tipo],
          color: cores[tom],
          // Número de dinheiro é sempre seminegrito: é o que ela procura na
          // tela, e peso separa melhor que tamanho quando a tela é estreita.
          fontWeight: negrito || grande ? '700' : '400',
          textAlign: centro ? 'center' : 'left',
          // `fontVariant` alinha os dígitos em coluna, pra lista de valores não
          // dançar conforme o número tem 1 ou 4 algarismos.
          ...(grande ? { fontVariant: ['tabular-nums' as const] } : {}),
        },
        style,
      ]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Estrutura
// ---------------------------------------------------------------------------

/**
 * Container de tela: fundo, respiro do notch e trava de largura.
 *
 * `LarguraMax` existe porque o mesmo bundle abre no desktop do professor na
 * apresentação -- sem a trava, os botões de venda esticariam 1400 px e o app
 * pareceria uma planilha.
 */
export function Tela({
  children,
  scroll = true,
  atualizando,
}: {
  children: ReactNode;
  scroll?: boolean;
  atualizando?: boolean;
}) {
  const { cores } = useTema();
  const inset = useSafeAreaInsets();

  const conteudo = (
    <View style={[estilos.centralizador, { paddingBottom: inset.bottom + Espaco.xxl }]}>
      <View style={estilos.colunaMax}>{children}</View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: cores.fundo, paddingTop: inset.top }}>
      {atualizando ? (
        <View style={estilos.faixaCarregando}>
          <ActivityIndicator size="small" color={cores.primaria} />
        </View>
      ) : null}
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {conteudo}
        </ScrollView>
      ) : (
        conteudo
      )}
    </View>
  );
}

export function Cartao({
  children,
  style,
  tom = 'superficie',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tom?: 'superficie' | 'superficieAlt';
}) {
  const { cores } = useTema();
  return (
    <View
      style={[
        estilos.cartao,
        { backgroundColor: cores[tom], borderColor: cores.borda },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Linha({
  children,
  style,
  entre,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Empurra os filhos pras pontas — rótulo de um lado, valor do outro. */
  entre?: boolean;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Espaco.sm,
          ...(entre ? { justifyContent: 'space-between' } : {}),
        },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Titulo({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <Linha entre style={{ marginBottom: Espaco.md, marginTop: Espaco.lg }}>
      <Txt tipo="titulo" negrito>
        {children}
      </Txt>
      {acao}
    </Linha>
  );
}

// ---------------------------------------------------------------------------
// Botões
// ---------------------------------------------------------------------------

export function Botao({
  children,
  onPress,
  variante = 'primaria',
  ocupado,
  desabilitado,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  variante?: 'primaria' | 'secundaria' | 'fantasma' | 'perigo';
  ocupado?: boolean;
  desabilitado?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { cores } = useTema();
  const travado = Boolean(ocupado || desabilitado);

  const fundo =
    variante === 'primaria'
      ? cores.primaria
      : variante === 'secundaria'
        ? cores.superficieAlt
        : variante === 'perigo'
          ? cores.negativoFraco
          : 'transparent';

  const corTexto =
    variante === 'primaria'
      ? cores.primariaTexto
      : variante === 'perigo'
        ? cores.negativo
        : cores.texto;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: travado, busy: Boolean(ocupado) }}
      onPress={travado ? undefined : onPress}
      style={({ pressed }) => [
        estilos.botao,
        {
          backgroundColor: fundo,
          borderColor: variante === 'fantasma' ? 'transparent' : cores.borda,
          opacity: travado ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      {ocupado ? (
        <ActivityIndicator size="small" color={corTexto} />
      ) : (
        <Text style={{ color: corTexto, fontSize: Fonte.corpo, fontWeight: '700' }}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export function Campo({
  rotulo,
  style,
  ...props
}: TextInputProps & { rotulo?: string; style?: StyleProp<ViewStyle> }) {
  const { cores } = useTema();
  return (
    <View style={[{ gap: Espaco.xs }, style]}>
      {rotulo ? (
        <Txt tipo="rotulo" tom="textoFraco">
          {rotulo}
        </Txt>
      ) : null}
      <TextInput
        placeholderTextColor={cores.textoFraco}
        {...props}
        style={[
          estilos.campo,
          {
            backgroundColor: cores.superficie,
            borderColor: cores.borda,
            color: cores.texto,
          },
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

/**
 * Faixa de recado. Nunca só cor: cada tom vem com um símbolo, porque a faixa
 * verde e a vermelha são a mesma faixa cinza pra quem não distingue as duas.
 */
export function Aviso({
  children,
  tom = 'atencao',
}: {
  children: ReactNode;
  tom?: 'positivo' | 'negativo' | 'atencao';
}) {
  const { cores } = useTema();
  const fundo = { positivo: cores.positivoFraco, negativo: cores.negativoFraco, atencao: cores.atencaoFraco }[tom];
  const simbolo = { positivo: '✓', negativo: '✕', atencao: '!' }[tom];

  return (
    <View style={[estilos.aviso, { backgroundColor: fundo, borderColor: cores[tom] }]}>
      <Text style={{ color: cores[tom], fontSize: Fonte.corpo, fontWeight: '700' }}>
        {simbolo}
      </Text>
      <View style={{ flex: 1 }}>
        <Txt tipo="corpo" tom={tom}>
          {children}
        </Txt>
      </View>
    </View>
  );
}

/** Estado vazio: diz o que fazer, não só que está vazio. */
export function Vazio({ titulo, dica }: { titulo: string; dica?: string }) {
  return (
    <Cartao tom="superficieAlt" style={{ alignItems: 'center', gap: Espaco.xs }}>
      <Txt tipo="corpo" negrito centro>
        {titulo}
      </Txt>
      {dica ? (
        <Txt tipo="rotulo" tom="textoFraco" centro>
          {dica}
        </Txt>
      ) : null}
    </Cartao>
  );
}

export function Carregando() {
  const { cores } = useTema();
  return (
    <View style={{ paddingVertical: Espaco.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={cores.primaria} />
    </View>
  );
}

const estilos = StyleSheet.create({
  centralizador: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: Espaco.lg,
  },
  colunaMax: {
    width: '100%',
    maxWidth: LarguraMax,
  },
  faixaCarregando: {
    height: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartao: {
    borderRadius: Raio.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Espaco.lg,
  },
  botao: {
    minHeight: Touch.alvo,
    borderRadius: Raio.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Espaco.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  campo: {
    minHeight: Touch.alvo,
    borderRadius: Raio.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Espaco.md,
    fontSize: Fonte.corpo,
  },
  aviso: {
    flexDirection: 'row',
    gap: Espaco.sm,
    alignItems: 'flex-start',
    borderRadius: Raio.md,
    borderLeftWidth: 3,
    padding: Espaco.md,
  },
});
