/**
 * Primitivas de tela. Uma só implementação pra web e nativo -- nada de
 * `.web.tsx` aqui, porque cada par de arquivos é um lugar onde o app da Nany e
 * o app do celular podem divergir sem ninguém notar.
 *
 * Estado de acessibilidade vai pelas props `aria-*` (`aria-checked`,
 * `aria-busy`, `aria-value*`) e por `disabled`, não por `accessibilityState` /
 * `accessibilityValue`. O motivo é o web, que é como ela instala no iPhone: o
 * react-native-web 0.21 descarta esses dois objetos sem avisar (não estão na
 * lista `forwardedProps`), e o leitor de tela do Safari nunca sabia qual forma
 * de pagamento estava marcada. As `aria-*` o RN 0.86 também entende e converte
 * pro formato nativo (`View.js`), então uma prop serve às três plataformas.
 */

import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
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

import { Espaco, Fonte, LarguraMax, Peso, Raio, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';

import { Icone, type NomeIcone } from './icone';

type Paleta = ReturnType<typeof useTema>['cores'];

/** Altura do trilho da barra de meta. */
const ALTURA_PROGRESSO = 12;

// ---------------------------------------------------------------------------
// Sombra
// ---------------------------------------------------------------------------

/**
 * Sombra de cartão a partir do token `cores.sombra` (string de CSS).
 *
 * `boxShadow` em string funciona nas três pontas, conferido no node_modules:
 * - RN 0.86 (arquitetura nova, a única que existe nele) interpreta a string em
 *   `processBoxShadow` e desenha no iOS e no Android;
 * - react-native-web 0.21 repassa a string direto pro `box-shadow` do CSS.
 *
 * A exceção é Android antigo: o desenho da sombra externa exige API 28
 * (`MIN_OUTSET_BOX_SHADOW_SDK_VERSION` em `OutsetBoxShadowDrawable.kt`) e o
 * RN aceita a partir da 24. No Android 7 e 8 a sombra simplesmente sumiria, e
 * cartão branco sobre creme sem sombra quase não tem borda visível -- por isso
 * cai pra `elevation`, que ignora a cor mas separa o cartão do fundo.
 *
 * Exportada porque o bloco de produto do Vender usa a mesma sombra sem ser um
 * `Cartao`.
 */
export function estiloSombra(sombra: string): ViewStyle {
  if (Platform.OS === 'android' && Platform.Version < 28) return { elevation: 2 };
  return { boxShadow: sombra };
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

export type TipoTexto = 'rotulo' | 'corpo' | 'secao' | 'titulo' | 'numero' | 'destaque';
export type TomTexto =
  | 'texto'
  | 'textoFraco'
  | 'positivo'
  | 'negativo'
  | 'atencao'
  /** Tinta pra usar SOBRE o fundo `acao` (mostarda) -- não sobre o creme. */
  | 'acaoTexto'
  /** Tinta pra usar SOBRE o fundo `inverso`. */
  | 'inversoTexto';

/**
 * Hierarquia vem de tamanho E peso. O rótulo pequeno é 600, não 400: é o que
 * diz o que o número grande é, e 14 px fino some na tela de celular barato sob
 * o sol do balcão.
 */
const PESO: Record<TipoTexto, TextStyle['fontWeight']> = {
  rotulo: Peso.medio,
  corpo: Peso.normal,
  secao: Peso.forte,
  titulo: Peso.pesado,
  numero: Peso.pesado,
  destaque: Peso.pesado,
};

/** Número grande em peso 800 fica frouxo no espaçamento padrão; aperta um pouco. */
const ESPACAMENTO: Partial<Record<TipoTexto, number>> = {
  titulo: -0.3,
  numero: -0.5,
  destaque: -1,
};

function estiloDeTexto(
  cores: Paleta,
  tipo: TipoTexto,
  tom: TomTexto,
  negrito?: boolean,
  centro?: boolean,
): TextStyle {
  const numerico = tipo === 'numero' || tipo === 'destaque';
  const peso = PESO[tipo];
  return {
    fontSize: Fonte[tipo],
    color: cores[tom],
    // `negrito` nunca AFINA: num `titulo` (800) ele não pode virar 700.
    fontWeight: negrito && Number(peso) < 700 ? Peso.forte : peso,
    textAlign: centro ? 'center' : 'left',
    letterSpacing: ESPACAMENTO[tipo],
    // `fontVariant` alinha os dígitos em coluna, pra lista de valores não
    // dançar conforme o número tem 1 ou 4 algarismos.
    ...(numerico ? { fontVariant: ['tabular-nums' as const] } : {}),
    // Sem `lineHeight` fixo: o React Native escala `fontSize` com a fonte do
    // sistema mas NÃO escala `lineHeight`, então um valor cravado corta o
    // glifo assim que alguém aumenta a fonte do aparelho -- e quem trabalha em
    // balcão é justamente quem costuma aumentar.
  };
}

export function Txt({
  children,
  tipo = 'corpo',
  tom = 'texto',
  negrito,
  centro,
  style,
  numberOfLines,
  rotuloAcessivel,
  cabecalho,
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
  rotuloAcessivel?: string;
  /** Marca como título de seção pro leitor de tela (navegação por títulos). */
  cabecalho?: boolean;
}) {
  const { cores } = useTema();
  return (
    <Text
      numberOfLines={numberOfLines}
      accessibilityLabel={rotuloAcessivel}
      accessibilityRole={cabecalho ? 'header' : undefined}
      style={[estiloDeTexto(cores, tipo, tom, negrito, centro), style]}>
      {children}
    </Text>
  );
}

/**
 * Valor que encolhe pra caber na largura, sem quebrar nem cortar.
 *
 * "R$ 1.234,56" em 30 px tem uns 175 px, e dois indicadores lado a lado num
 * celular de 360 px têm uns 140 cada. Quebrar a linha parte o número;
 * reticências escondem justamente os centavos. `adjustsFontSizeToFit` resolve
 * no nativo, mas o react-native-web ignora -- e o web é o app dela no iPhone.
 *
 * Então mede: um clone invisível do texto, no tamanho cheio, dentro de uma
 * faixa larga, dá a largura natural; a <View> de fora dá a largura
 * disponível. Se não cabe, a fonte encolhe na proporção.
 *
 * A comparação é sempre contra o clone em tamanho CHEIO, nunca contra o
 * texto visível. Se fosse contra o visível, o texto encolhido encolheria a
 * caixa, que encolheria o texto, até sumir. Assim: quando o pai limita a
 * largura (coluna, ou `flex: 1` numa linha), a caixa não depende do texto e a
 * conta fecha de primeira; quando ninguém limita, a caixa tem o tamanho do
 * próprio texto cheio, `natural` cabe, e nada encolhe.
 *
 * O medidor fica numa caixa 0×0 com `overflow: hidden` e posição absoluta:
 * não empurra o layout e não cria rolagem horizontal no navegador.
 */
function ValorQueCabe({ valor, tipo, tom }: { valor: string; tipo: TipoTexto; tom: TomTexto }) {
  const { cores } = useTema();
  const [disponivel, setDisponivel] = useState(0);
  const [natural, setNatural] = useState(0);

  const cheio = Fonte[tipo];
  // 1 px de tolerância: arredondamento de layout não pode disparar
  // encolhimento; e 2 px de margem no encolhido, pra não cair nas reticências
  // do `numberOfLines` por fração de pixel.
  const cabe = disponivel === 0 || natural === 0 || natural <= disponivel + 1;
  // Metade é o piso: menor que isso o valor deixa de ser lido de relance, e
  // aí é melhor que a tela dê mais espaço a ele.
  const tamanho = cabe ? cheio : Math.max(cheio / 2, (cheio * (disponivel - 2)) / natural);

  const estilo = estiloDeTexto(cores, tipo, tom);

  return (
    <View onLayout={(e) => setDisponivel(e.nativeEvent.layout.width)}>
      <Text numberOfLines={1} style={[estilo, { fontSize: tamanho }]}>
        {valor}
      </Text>
      <View
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={estilos.medidorCaixa}>
        <View style={estilos.medidorFaixa}>
          <Text style={estilo} onLayout={(e) => setNatural(e.nativeEvent.layout.width)}>
            {valor}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estrutura
// ---------------------------------------------------------------------------

/** Coluna central com a trava de largura e o gutter lateral. */
function Coluna({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={estilos.centralizador}>
      <View style={[estilos.coluna, style]}>{children}</View>
    </View>
  );
}

/**
 * Container de tela: fundo, respiro do notch, cabeçalho e trava de largura.
 *
 * `LarguraMax` existe porque o mesmo bundle abre no desktop do professor na
 * apresentação -- sem a trava, os botões de venda esticariam 1400 px e o app
 * pareceria uma planilha.
 *
 * O cabeçalho fica FORA da rolagem: o "voltar" tem que estar ao alcance do
 * polegar no fim de uma lista longa também, não só no topo.
 */
export function Tela({
  children,
  titulo,
  voltar,
  acao,
  rodape,
  scroll = true,
  atualizando,
}: {
  children: ReactNode;
  titulo?: string;
  /**
   * `true`: volta na pilha e, se não houver pilha (a página foi aberta direto
   * pela URL no navegador), cai no hub do Planejar em vez de não fazer nada.
   * Uma função substitui esse comportamento.
   */
  voltar?: boolean | (() => void);
  /** Elemento pequeno à direita do título (um botão de ícone, uma ficha). */
  acao?: ReactNode;
  /**
   * Fica FORA da rolagem, grudado embaixo, acima da barra de abas: é onde
   * mora o "Finalizar" do Vender e o "Salvar" da nota, que não podem sumir
   * quando a lista rola.
   */
  rodape?: ReactNode;
  scroll?: boolean;
  atualizando?: boolean;
}) {
  const { cores } = useTema();
  const inset = useSafeAreaInsets();

  function aoVoltar() {
    if (typeof voltar === 'function') return voltar();
    if (router.canGoBack()) router.back();
    else router.replace('/planejar');
  }

  const temCabecalho = Boolean(titulo || voltar || acao);

  const indicador = atualizando ? (
    <ActivityIndicator
      size="small"
      color={cores.textoFraco}
      accessibilityLabel="Atualizando"
    />
  ) : null;

  const cabecalho = temCabecalho ? (
    <Coluna style={estilos.cabecalho}>
      {voltar ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          onPress={aoVoltar}
          hitSlop={Espaco.xs}
          style={({ pressed }) => [
            estilos.botaoVoltar,
            { backgroundColor: pressed ? cores.superficieAlt : 'transparent' },
          ]}>
          <Icone nome="voltar" tamanho={26} cor={cores.texto} espessura={2.25} />
        </Pressable>
      ) : null}
      <View style={estilos.tituloCabecalho}>
        {titulo ? (
          <Txt tipo="titulo" numberOfLines={1} cabecalho style={{ flexShrink: 1 }}>
            {titulo}
          </Txt>
        ) : null}
        {indicador}
      </View>
      {acao}
    </Coluna>
  ) : null;

  // Sem rodapé, o fim da rolagem ganha o respiro do indicador de início do
  // iPhone; com rodapé, quem fica colado nesse canto é o rodapé.
  const respiroFinal = rodape ? Espaco.xl : inset.bottom + Espaco.xxl;

  const conteudo = (
    <View
      style={[
        estilos.centralizador,
        { flexGrow: 1, paddingTop: temCabecalho ? 0 : Espaco.sm, paddingBottom: respiroFinal },
      ]}>
      <View style={estilos.colunaMax}>{children}</View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: cores.fundo, paddingTop: inset.top }}>
      {cabecalho}
      {/* Sem título, o indicador flutua no alto da tela sem empurrar nada. */}
      {atualizando && !temCabecalho ? (
        <View style={[estilos.indicadorSolto, { top: inset.top + Espaco.xs }]}>
          {indicador}
        </View>
      ) : null}
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          // Sem isto, no iOS o teclado sobe POR CIMA do campo que ela acabou de
          // tocar -- e no login é o botão Entrar que fica escondido. O
          // `keyboardShouldPersistTaps` acima resolve outra coisa (o primeiro
          // toque fora do campo valer como toque, e não só como fechar o
          // teclado); ele não desloca nada.
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}>
          {conteudo}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{conteudo}</View>
      )}
      {rodape ? (
        <View
          style={[
            estilos.rodape,
            { backgroundColor: cores.fundo, borderTopColor: cores.divisor },
          ]}>
          <Coluna style={{ gap: Espaco.md }}>{rodape}</Coluna>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Cartão sem contorno, separado do creme pela sombra. Contorno em volta de
 * cada bloco era o que deixava a tela com cara de formulário.
 */
export function Cartao({
  children,
  style,
  tom = 'superficie',
  plano,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tom?: 'superficie' | 'superficieAlt';
  /** Sem sombra: cartão dentro de cartão, ou bloco recuado. */
  plano?: boolean;
}) {
  const { cores } = useTema();
  return (
    <View
      style={[
        estilos.cartao,
        { backgroundColor: cores[tom] },
        plano ? null : estiloSombra(cores.sombra),
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

/** Bloco com título no meio da tela. O respiro de cima é o que separa blocos. */
export function Secao({
  titulo,
  acao,
  children,
}: {
  titulo: string;
  /** Ação curta à direita do título ("Ver tudo", um botão de ícone). */
  acao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={{ marginTop: Espaco.xl, gap: Espaco.md }}>
      <Linha entre style={{ minHeight: Touch.alvoSecundario }}>
        <Txt tipo="secao" cabecalho style={{ flexShrink: 1 }}>
          {titulo}
        </Txt>
        {acao}
      </Linha>
      {children}
    </View>
  );
}

export function Divisor() {
  const { cores } = useTema();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: cores.divisor }} />;
}

// ---------------------------------------------------------------------------
// Botões
// ---------------------------------------------------------------------------

export function Botao({
  children,
  onPress,
  variante = 'primaria',
  grande,
  icone,
  ocupado,
  desabilitado,
  style,
  rotuloAcessivel,
}: {
  children: ReactNode;
  onPress: () => void;
  /**
   * `primaria` é UMA por tela: a mostarda é a resposta pra "o que eu faço
   * aqui?", e duas mostardas não respondem nada.
   */
  variante?: 'primaria' | 'secundaria' | 'fantasma' | 'perigo';
  /** Altura de ação principal (VENDER, Finalizar). */
  grande?: boolean;
  icone?: NomeIcone;
  ocupado?: boolean;
  desabilitado?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * Nome pra leitor de tela quando o conteúdo visível não serve de nome.
   *
   * Existe por causa do botão de apagar item de receita, que é só um `✕`: sem
   * isto o leitor anuncia "✕" e a pessoa não faz ideia do que o botão apaga.
   * Não havia como corrigir no ponto de uso, porque este componente não
   * repassava `accessibilityLabel` nenhum.
   */
  rotuloAcessivel?: string;
}) {
  const { cores } = useTema();
  const travado = Boolean(ocupado || desabilitado);

  const visual = {
    primaria: {
      fundo: cores.acao,
      borda: cores.acaoBorda,
      texto: cores.acaoTexto,
      peso: Peso.pesado,
    },
    secundaria: {
      fundo: cores.superficie,
      borda: cores.borda,
      texto: cores.texto,
      peso: Peso.forte,
    },
    fantasma: { fundo: 'transparent', borda: 'transparent', texto: cores.texto, peso: Peso.forte },
    perigo: {
      fundo: cores.negativoFraco,
      borda: 'transparent',
      texto: cores.negativo,
      peso: Peso.forte,
    },
  }[variante];

  // Com o spinner no lugar do texto, o nome visível some; o leitor de tela
  // continua sabendo que botão é esse.
  const nome = rotuloAcessivel ?? (typeof children === 'string' ? children : undefined);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={nome}
      aria-busy={Boolean(ocupado)}
      // `disabled` e não só `onPress={undefined}`: é ele que o RN traduz pra
      // estado "indisponível" no leitor de tela e `aria-disabled` no web.
      disabled={travado}
      onPress={onPress}
      style={({ pressed }) => [
        estilos.botao,
        grande ? estilos.botaoGrande : null,
        {
          backgroundColor: visual.fundo,
          borderColor: visual.borda,
          // A borda de baixo mais grossa na mostarda é a "base" do botão: dá
          // silhueta a um fundo que tem pouca diferença de luminosidade contra
          // o creme (ver `acaoBorda` no tema).
          borderBottomWidth: variante === 'primaria' ? 3 : 1.5,
          opacity: travado ? 0.45 : pressed ? 0.9 : 1,
          transform: [{ scale: pressed && !travado ? 0.98 : 1 }],
        },
        style,
      ]}>
      {ocupado ? (
        <ActivityIndicator size="small" color={visual.texto} />
      ) : (
        <>
          {icone ? (
            <Icone
              nome={icone}
              tamanho={grande ? 28 : 22}
              cor={visual.texto}
              espessura={grande ? 2.25 : 2}
            />
          ) : null}
          <Text
            numberOfLines={2}
            style={{
              color: visual.texto,
              fontSize: grande ? 20 : Fonte.corpo,
              fontWeight: visual.peso,
              textAlign: 'center',
              flexShrink: 1,
            }}>
            {children}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * Pílula de escolha rápida ("Gás", "Embalagem", "Eu faço"). Menor que um
 * botão (`alvoSecundario`) porque aparece em grupo, e um grupo de pílulas de
 * 56 px ocuparia a tela.
 *
 * `radio` e `aria-checked`: é uma escolha entre irmãs, e é o par de papel e
 * estado que o web e o nativo leem igual ("marcado").
 */
export function Ficha({
  rotulo,
  ativo,
  onPress,
}: {
  rotulo: string;
  ativo: boolean;
  onPress: () => void;
}) {
  const { cores } = useTema();
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={ativo}
      onPress={onPress}
      style={({ pressed }) => [
        estilos.ficha,
        {
          borderColor: ativo ? cores.inverso : cores.borda,
          backgroundColor: ativo ? cores.inverso : pressed ? cores.superficieAlt : cores.superficie,
        },
      ]}>
      <Txt tipo="rotulo" negrito tom={ativo ? 'inversoTexto' : 'texto'}>
        {rotulo}
      </Txt>
    </Pressable>
  );
}

/**
 * Controle segmentado: 2 a 4 opções exclusivas (período, forma de pagamento).
 *
 * A opção marcada é `inverso` (marrom cheio), não mostarda: mostarda é a AÇÃO
 * da tela, e no Vender o "Finalizar" logo abaixo precisa ser a única coisa
 * amarela.
 */
export function Segmentos<T extends string>({
  opcoes,
  valor,
  onMudar,
  rotuloAcessivel,
}: {
  opcoes: { valor: T; rotulo: string; icone?: NomeIcone }[];
  /** `null` = nada escolhido ainda (primeira venda, forma de pagamento). */
  valor: T | null;
  onMudar: (valor: T) => void;
  /** Nome do grupo pro leitor de tela: "Forma de pagamento". */
  rotuloAcessivel: string;
}) {
  const { cores } = useTema();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={rotuloAcessivel}
      style={[estilos.trilho, { backgroundColor: cores.superficieAlt }]}>
      {opcoes.map((opcao) => {
        const ativo = opcao.valor === valor;
        const tinta = ativo ? cores.inversoTexto : cores.texto;
        return (
          <Pressable
            key={opcao.valor}
            accessibilityRole="radio"
            aria-checked={ativo}
            accessibilityLabel={opcao.rotulo}
            onPress={() => onMudar(opcao.valor)}
            // A opção desenhada tem 48 px (o trilho tem 56 com o respiro); o
            // `hitSlop` devolve o respiro ao toque, pra valer o alvo cheio.
            hitSlop={{ top: Espaco.xs, bottom: Espaco.xs }}
            style={({ pressed }) => [
              estilos.segmento,
              {
                backgroundColor: ativo
                  ? cores.inverso
                  : pressed
                    ? cores.superficie
                    : 'transparent',
              },
            ]}>
            {opcao.icone ? <Icone nome={opcao.icone} tamanho={20} cor={tinta} /> : null}
            <Text
              numberOfLines={1}
              style={{ color: tinta, fontSize: Fonte.corpo, fontWeight: Peso.forte, flexShrink: 1 }}>
              {opcao.rotulo}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export function Campo({
  rotulo,
  prefixo,
  style,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & {
  rotulo?: string;
  /** Unidade antes do valor, em tinta fraca: "R$". */
  prefixo?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { cores } = useTema();
  const [focado, setFocado] = useState(false);
  const entrada = useRef<TextInput>(null);

  return (
    <View style={[{ gap: Espaco.xs }, style]}>
      {rotulo ? (
        <Txt tipo="rotulo" tom="textoFraco">
          {rotulo}
        </Txt>
      ) : null}
      <Pressable
        // A caixa inteira é o campo: tocar no "R$" também abre o teclado. Não
        // é um elemento próprio pro leitor de tela -- o nome está no input.
        //
        // `tabIndex={-1}` e não `focusable={false}`: o Pressable do
        // react-native-web ignora `focusable` e põe `tabindex="0"` sozinho, e
        // o Tab do teclado parava numa caixa vazia antes de chegar no input.
        onPress={() => entrada.current?.focus()}
        accessible={false}
        tabIndex={-1}
        style={[
          estilos.campo,
          {
            backgroundColor: cores.superficie,
            borderColor: focado ? cores.texto : cores.borda,
            // Foco visível sem mexer no layout: o contorno não ocupa espaço,
            // a borda mais grossa empurraria o texto 1 px a cada toque.
            outlineWidth: focado ? 2 : 0,
            outlineColor: cores.texto,
            outlineStyle: 'solid',
          },
        ]}>
        {prefixo ? (
          <Text
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ fontSize: Fonte.secao, color: cores.textoFraco, fontWeight: Peso.medio }}>
            {prefixo}
          </Text>
        ) : null}
        <TextInput
          ref={entrada}
          // `placeholder` e não `textoFraco`: com a tinta do texto digitado,
          // o exemplo dentro do campo parecia valor já preenchido. Ver o token
          // no theme.ts -- é a única tinta de texto abaixo de 7:1, e o
          // checa-paleta cobra os 4,5:1 dela.
          placeholderTextColor={cores.placeholder}
          // O `rotulo` acima é um <Text> IRMÃO do input: pro olho ele nomeia o
          // campo, mas pra quem usa leitor de tela os dois não têm relação
          // nenhuma -- o input é anunciado sem nome. Era o caso dos dois campos
          // do login. `accessibilityLabel` faz a ligação (vira `aria-label` na
          // web, o equivalente ao `<label for>` que aqui não existe).
          //
          // Antes do spread de propósito: quem precisar de um nome diferente do
          // rótulo visível passa `accessibilityLabel` e ganha precedência.
          accessibilityLabel={rotulo}
          {...props}
          onFocus={(e) => {
            setFocado(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocado(false);
            onBlur?.(e);
          }}
          style={[
            estilos.entrada,
            // O anel de foco é o da caixa; o do navegador, dentro dela, seria
            // um segundo retângulo desalinhado. `solid` junto com a largura 0
            // porque o padrão do Chrome é `outline-style: auto`, que ignora a
            // largura e desenha o anel mesmo assim.
            { color: cores.texto, outlineWidth: 0, outlineStyle: 'solid' },
          ]}
        />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avisos e estados
// ---------------------------------------------------------------------------

/** Junta o texto puro de `children` ("Venda de ", valor, " registrada"). */
function textoPuro(children: ReactNode): string | null {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children) && children.every((c) => typeof c === 'string' || typeof c === 'number')) {
    return children.join('');
  }
  return null;
}

/**
 * Faixa de recado. Nunca só cor: cada tom vem com um símbolo (✓, ✕, !),
 * porque tomate e verde são o par que some pra quem tem daltonismo.
 *
 * E nunca só visual: a faixa é uma REGIÃO VIVA. Ela aparece por renderização
 * condicional (`{erro ? <Aviso/> : null}`), então quem não vê a tela não
 * recebia nada -- digitava a senha errada no login e, do ponto de vista do
 * leitor de tela, não acontecia absolutamente nada.
 *
 * `assertive` só no erro: interrompe o que estiver sendo lido, que é o certo
 * pra "senha incorreta" e exagerado pra "conta criada".
 */
export function Aviso({
  children,
  tom = 'atencao',
  acao,
}: {
  children: ReactNode;
  tom?: 'positivo' | 'negativo' | 'atencao';
  /** Botão de texto à direita: "Desfazer", "Cadastrar". */
  acao?: { rotulo: string; onPress: () => void };
}) {
  const { cores } = useTema();
  const fundo = { positivo: cores.positivoFraco, negativo: cores.negativoFraco, atencao: cores.atencaoFraco }[tom];
  const simbolo = ({ positivo: 'ok', negativo: 'fechar', atencao: 'alerta' } as const)[tom];

  // O iOS não implementa `accessibilityLiveRegion` (é Android + web). Lá o
  // anúncio é imperativo, e só dá pra fazer quando o recado é texto puro --
  // que é o caso de todas as chamadas hoje.
  const texto = textoPuro(children);
  useEffect(() => {
    if (texto && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(texto);
  }, [texto]);

  return (
    <View
      // `alert` só no negativo: é o papel que carrega urgência. Nos outros a
      // região viva educada já basta e não atropela a navegação dela.
      accessibilityRole={tom === 'negativo' ? 'alert' : undefined}
      accessibilityLiveRegion={tom === 'negativo' ? 'assertive' : 'polite'}
      style={[estilos.aviso, { backgroundColor: fundo, paddingRight: acao ? Espaco.xs : Espaco.md }]}>
      {/* O símbolo é decoração: quem enxerga usa ele pra distinguir as faixas
          sem depender de cor, mas lido em voz alta ele vira "imagem" ou
          "letra xis" antes da mensagem, que só atrapalha. O `Icone` já sai
          escondido do leitor de tela nas três plataformas (ver as três props
          lá). */}
      <Icone nome={simbolo} tamanho={22} cor={cores[tom]} espessura={2.5} />
      <View style={{ flex: 1 }}>
        <Txt tipo="corpo" tom={tom} negrito>
          {children}
        </Txt>
      </View>
      {acao ? (
        <Pressable
          accessibilityRole="button"
          onPress={acao.onPress}
          style={({ pressed }) => [estilos.acaoAviso, { opacity: pressed ? 0.6 : 1 }]}>
          <Text
            style={{
              color: cores[tom],
              fontSize: Fonte.corpo,
              fontWeight: Peso.pesado,
              textDecorationLine: 'underline',
            }}>
            {acao.rotulo}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Estado vazio: diz o que fazer, não só que está vazio. */
export function Vazio({
  titulo,
  dica,
  acao,
}: {
  titulo: string;
  dica?: string;
  acao?: { rotulo: string; onPress: () => void };
}) {
  return (
    <View style={estilos.vazio}>
      <Txt tipo="secao" centro>
        {titulo}
      </Txt>
      {dica ? (
        <Txt tipo="rotulo" tom="textoFraco" centro>
          {dica}
        </Txt>
      ) : null}
      {acao ? (
        <Botao variante="secundaria" onPress={acao.onPress} style={{ marginTop: Espaco.sm }}>
          {acao.rotulo}
        </Botao>
      ) : null}
    </View>
  );
}

export function Carregando() {
  const { cores } = useTema();
  return (
    <View style={{ paddingVertical: Espaco.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={cores.marca} accessibilityLabel="Carregando" />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

/**
 * Rótulo curto em cima, número embaixo. O número é o que ela procura; o
 * rótulo só diz qual é.
 */
export function Indicador({
  rotulo,
  valor,
  tom = 'texto',
  legenda,
  grande,
  style,
}: {
  rotulo: string;
  /** Já formatado ("R$ 347,50"): quem chama decide centavos e sinal. */
  valor: string;
  tom?: TomTexto;
  legenda?: string;
  /** Número-herói da tela (`destaque`). Um por tela. */
  grande?: boolean;
  /** Pra dividir uma linha: `{ flex: 1 }` em cada indicador lado a lado. */
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap: Espaco.xs }, style]}>
      <Txt tipo="rotulo" tom="textoFraco">
        {rotulo}
      </Txt>
      <ValorQueCabe valor={valor} tipo={grande ? 'destaque' : 'numero'} tom={tom} />
      {legenda ? (
        <Txt tipo="rotulo" tom="textoFraco">
          {legenda}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * Progresso da meta. Passou de 100%, a barra fica cheia e muda pra tinta de
 * lucro -- mas quem diz "batida" é o texto ao lado (✓ batida), não a cor.
 */
export function BarraProgresso({
  atual,
  alvo,
  rotuloAcessivel,
}: {
  atual: number;
  alvo: number;
  rotuloAcessivel: string;
}) {
  const { cores, grafico } = useTema();
  const fracao = alvo > 0 ? Math.max(0, atual / alvo) : 0;
  const cheia = Math.min(fracao, 1);
  const porcento = Math.round(fracao * 100);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={rotuloAcessivel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(porcento, 100)}
      aria-valuetext={`${porcento}%`}
      style={[estilos.trilhoProgresso, { backgroundColor: cores.superficieAlt }]}>
      <View
        style={{
          width: `${cheia * 100}%`,
          // Um começo de meta (2%) ainda aparece como um ponto, não some.
          minWidth: cheia > 0 ? ALTURA_PROGRESSO : 0,
          height: '100%',
          borderRadius: Raio.pill,
          backgroundColor: fracao >= 1 ? grafico.lucro : cores.marca,
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Listas
// ---------------------------------------------------------------------------

/**
 * Linha de navegação do Planejar: ícone, assunto, valor curto, seta.
 *
 * Vários ficam dentro de UM `Cartao`, separados por `Divisor` -- uma lista,
 * não uma pilha de cartões.
 */
export function ItemLista({
  icone,
  titulo,
  valor,
  tomValor,
  alerta,
  onPress,
  rotuloAcessivel,
}: {
  icone?: NomeIcone;
  titulo: string;
  valor?: string;
  tomValor?: TomTexto;
  /** Precisa de atenção: troca o ícone pelo triângulo, em pastilha amarela. */
  alerta?: boolean;
  onPress?: () => void;
  rotuloAcessivel?: string;
}) {
  const { cores } = useTema();
  const iconeFinal: NomeIcone | undefined = alerta ? 'alerta' : icone;
  const nome =
    rotuloAcessivel ?? [titulo, valor, alerta ? 'precisa de atenção' : null].filter(Boolean).join(', ');

  const miolo = (
    <>
      {iconeFinal ? (
        <View
          style={[
            estilos.pastilha,
            { backgroundColor: alerta ? cores.atencaoFraco : cores.superficieAlt },
          ]}>
          <Icone nome={iconeFinal} tamanho={22} cor={alerta ? cores.atencao : cores.texto} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Txt tipo="corpo" negrito numberOfLines={2}>
          {titulo}
        </Txt>
      </View>
      {valor ? (
        <Txt
          tipo="corpo"
          tom={tomValor ?? (alerta ? 'atencao' : 'textoFraco')}
          negrito={alerta}
          numberOfLines={1}
          style={{ flexShrink: 1, maxWidth: '50%', textAlign: 'right' }}>
          {valor}
        </Txt>
      ) : null}
      {onPress ? <Icone nome="seguir" tamanho={20} cor={cores.textoFraco} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={nome} style={estilos.itemLista}>
        {miolo}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={nome}
      onPress={onPress}
      style={({ pressed }) => [estilos.itemLista, { opacity: pressed ? 0.6 : 1 }]}>
      {miolo}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

const estilos = StyleSheet.create({
  centralizador: {
    alignItems: 'center',
    paddingHorizontal: Espaco.lg,
  },
  coluna: {
    width: '100%',
    maxWidth: LarguraMax,
  },
  colunaMax: {
    width: '100%',
    maxWidth: LarguraMax,
    // `flexGrow` e não `flex: 1`: sem isto a coluna encolhe pra altura do
    // conteúdo e todo `justifyContent: 'center'` de quem está dentro não tem o
    // que preencher -- era por isso que o login ficava grudado no topo. `flex:
    // 1` traria `flexBasis: 0` junto e espremeria as telas que passam da
    // altura do aparelho.
    flexGrow: 1,
  },
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Espaco.xs,
    minHeight: Touch.alvo,
    paddingTop: Espaco.xs,
    paddingBottom: Espaco.sm,
  },
  botaoVoltar: {
    width: Touch.alvoSecundario,
    height: Touch.alvoSecundario,
    borderRadius: Raio.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // Puxa o chevron pro alinhamento do texto da tela: o desenho tem folga
    // dentro do alvo de 44 px, e sem isto a seta parece recuada.
    marginLeft: -Espaco.sm,
  },
  tituloCabecalho: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Espaco.sm,
  },
  indicadorSolto: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 1,
    pointerEvents: 'none',
  },
  rodape: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Espaco.md,
    paddingBottom: Espaco.md,
  },
  cartao: {
    borderRadius: Raio.lg,
    padding: Espaco.lg,
  },
  botao: {
    minHeight: Touch.alvo,
    borderRadius: Raio.md,
    borderWidth: 1.5,
    paddingHorizontal: Espaco.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Espaco.sm,
  },
  botaoGrande: {
    minHeight: Touch.alvoPrincipal,
    borderRadius: Raio.lg,
    paddingHorizontal: Espaco.xl,
    gap: Espaco.md,
  },
  ficha: {
    minHeight: Touch.alvoSecundario,
    paddingHorizontal: Espaco.lg,
    justifyContent: 'center',
    borderRadius: Raio.pill,
    borderWidth: 1.5,
  },
  trilho: {
    flexDirection: 'row',
    minHeight: Touch.alvo,
    padding: Espaco.xs,
    gap: Espaco.xs,
    borderRadius: Raio.md,
  },
  segmento: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Respiro mínimo de propósito: três opções num celular de 360 px dão
    // ~100 px cada, e "Dinheiro" com o ícone ocupa ~90.
    gap: Espaco.xs,
    paddingHorizontal: Espaco.xs,
    // Raio de dentro = raio de fora menos o respiro: as curvas ficam paralelas.
    borderRadius: Raio.md - Espaco.xs,
  },
  campo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Espaco.sm,
    minHeight: Touch.alvo,
    borderRadius: Raio.md,
    borderWidth: 1.5,
    paddingHorizontal: Espaco.md,
  },
  entrada: {
    flex: 1,
    alignSelf: 'stretch',
    fontSize: Fonte.secao,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  aviso: {
    flexDirection: 'row',
    gap: Espaco.md,
    alignItems: 'center',
    borderRadius: Raio.md,
    paddingVertical: Espaco.md,
    paddingLeft: Espaco.md,
    minHeight: Touch.alvo,
  },
  acaoAviso: {
    minHeight: Touch.alvoSecundario,
    paddingHorizontal: Espaco.md,
    justifyContent: 'center',
  },
  vazio: {
    alignItems: 'center',
    gap: Espaco.xs,
    paddingVertical: Espaco.xl,
    paddingHorizontal: Espaco.lg,
  },
  trilhoProgresso: {
    height: ALTURA_PROGRESSO,
    borderRadius: Raio.pill,
    overflow: 'hidden',
  },
  itemLista: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Espaco.md,
    minHeight: Touch.alvo,
    paddingVertical: Espaco.md,
  },
  pastilha: {
    width: 40,
    height: 40,
    borderRadius: Raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medidorCaixa: {
    position: 'absolute',
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
  medidorFaixa: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: 4000,
  },
});
