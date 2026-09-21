/**
 * Ícones do app, desenhados aqui mesmo em SVG.
 *
 * Por que não uma fonte de ícones (`@expo/vector-icons`) nem `expo-symbols`:
 * fonte de ícone é mais um arquivo pra carregar antes da primeira tela no
 * export web, e SF Symbols só existe no iOS -- o mesmo botão teria um desenho
 * no iPhone da Nany e outro no Chrome. Uns vinte traços num viewBox 24 cobrem
 * o app inteiro e são iguais nas três plataformas.
 *
 * Estilo único: traço de 2 (na escala do viewBox), pontas e junções
 * arredondadas, sem preenchimento. Cantos redondos são a mesma linguagem dos
 * cartões e botões; e um conjunto só de traço não briga com o número, que é o
 * que ela procura na tela.
 *
 * Ponto (o "pingo" do `!`, o centro do alvo) é um traço de comprimento quase
 * zero com ponta redonda: vira um círculo cheio do diâmetro da espessura, sem
 * precisar de um segundo tipo de elemento com `fill`.
 */

import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTema } from '@/hooks/use-tema';

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

/** Círculo como caminho: dois arcos de meia volta. */
const circulo = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/** Retângulo de cantos redondos como caminho, no sentido horário. */
const retangulo = (x: number, y: number, l: number, a: number, r: number) =>
  [
    `M${x + r} ${y}`,
    `h${l - 2 * r}`,
    `a${r} ${r} 0 0 1 ${r} ${r}`,
    `v${a - 2 * r}`,
    `a${r} ${r} 0 0 1 ${-r} ${r}`,
    `h${-(l - 2 * r)}`,
    `a${r} ${r} 0 0 1 ${-r} ${-r}`,
    `v${-(a - 2 * r)}`,
    `a${r} ${r} 0 0 1 ${r} ${-r}`,
    'Z',
  ].join('');

/** Pingo redondo (ver o cabeçalho). */
const ponto = (x: number, y: number) => `M${x} ${y}h.01`;

/**
 * Cada ícone é UM caminho, com os traços separados por `M`. Um `<Path>` por
 * ícone em vez de vários elementos: a lista de venda desenha dezenas deles, e
 * cada elemento SVG a menos é uma view nativa a menos.
 */
const DESENHOS = {
  // Abas -------------------------------------------------------------------
  /** Casa: "Hoje" é a tela de início. */
  hoje: [
    'M3 11 12 3.5 21 11',
    'M5.5 9.5V19a1 1 0 0 0 1 1H10v-5h4v5h3.5a1 1 0 0 0 1-1V9.5',
  ],
  /** Sacola. */
  vender: [
    'M5.2 8h13.6l-.9 11.1a2 2 0 0 1-2 1.9H8.1a2 2 0 0 1-2-1.9L5.2 8Z',
    'M9 8V6.5a3 3 0 0 1 6 0V8',
  ],
  /** Prancheta com anotações. */
  planejar: [
    'M8 4H6.5A1.5 1.5 0 0 0 5 5.5v14A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-14A1.5 1.5 0 0 0 17.5 4H16',
    retangulo(8.5, 2.5, 7, 3.5, 1),
    'M9 11h6',
    'M9 15h4',
  ],

  // Navegação e ação ---------------------------------------------------------
  voltar: ['M15 5l-7 7 7 7'],
  seguir: ['M9 5l7 7-7 7'],
  mais: ['M12 5v14', 'M5 12h14'],
  menos: ['M5 12h14'],
  fechar: ['M6 6l12 12', 'M18 6 6 18'],
  ok: ['M4.5 12.5l5 5L19.5 7'],
  /** Triângulo com "!": o símbolo de atenção que não depende da cor. */
  alerta: ['M12 4 3 19.5h18L12 4Z', 'M12 10v4', ponto(12, 16.8)],

  // Assuntos do Planejar -----------------------------------------------------
  /** Alvo. */
  meta: [circulo(12, 12, 9), circulo(12, 12, 5), circulo(12, 12, 1)],
  /** Calendário. */
  semana: [
    retangulo(3, 5, 18, 16, 2.5),
    'M3 10h18',
    'M8 3v4',
    'M16 3v4',
    ponto(8, 14),
    ponto(12, 14),
    ponto(16, 14),
    ponto(8, 17.5),
    ponto(12, 17.5),
  ],
  /** Seta subindo em degraus. */
  lucro: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  /** Nota de mercado, com o picote embaixo. */
  compras: [
    'M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21Z',
    'M9 8h6',
    'M9 12h6',
    'M9 16h3',
  ],
  /** Carteira. */
  gastos: [
    retangulo(3, 6.5, 18, 13, 2.5),
    'M6 6.5 15.2 3.6a1 1 0 0 1 1.3 1V6.5',
    'M21 11h-4a2 2 0 0 0 0 4h4',
    ponto(17, 13),
  ],
  /** Caixa de papelão em perspectiva. */
  estoque: ['M12 3 20.5 7.5v9L12 21l-8.5-4.5v-9L12 3Z', 'M3.5 7.5 12 12l8.5-4.5', 'M12 12v9'],
  /** Etiqueta de preço. */
  produtos: [
    'M3 4v7.2c0 .5.2 1 .6 1.4l8 8a2 2 0 0 0 2.8 0l6.2-6.2a2 2 0 0 0 0-2.8l-8-8A2 2 0 0 0 11.2 3H4a1 1 0 0 0-1 1Z',
    circulo(7.5, 7.5, 1.5),
  ],
  /** Relógio. */
  historico: [circulo(12, 12, 9), 'M12 7v5l3.5 2'],

  // Foto da nota -------------------------------------------------------------
  camera: [
    'M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z',
    circulo(12, 13.5, 3.5),
  ],
  galeria: [retangulo(3, 4, 18, 16, 2.5), circulo(8.5, 9.5, 1.5), 'M3 17.5l5-5 4 4 3-3 5.5 5.5'],

  // Formas de pagamento ------------------------------------------------------
  /** Cédula. */
  dinheiro: [retangulo(2.5, 6, 19, 12, 2), circulo(12, 12, 2.5), ponto(6, 12), ponto(18, 12)],
  /**
   * Celular com um raio: "pagamento instantâneo pelo celular". NÃO é o
   * losango do Pix -- aquele desenho é marca registrada do Banco Central, e o
   * rótulo "Pix" escrito ao lado já diz qual é a forma.
   */
  pix: [retangulo(6, 2, 12, 20, 2.5), 'M13 6.5l-3 5h4l-3 5'],
  cartao: [retangulo(2.5, 5, 19, 14, 2), 'M2.5 10h19', 'M6.5 15h3'],

  // Conta e remoção ----------------------------------------------------------
  sair: [
    'M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9',
    'M16 16.5l4.5-4.5L16 7.5',
    'M20.5 12H9',
  ],
  lixo: [
    'M4 6.5h16',
    'M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2',
    'M6 6.5l1 13a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5l1-13',
    'M10 11v5.5',
    'M14 11v5.5',
  ],
} satisfies Record<string, string[]>;

export type NomeIcone = keyof typeof DESENHOS;

/** Um `d` por ícone, montado uma vez no carregamento do módulo. */
const CAMINHOS = Object.fromEntries(
  Object.entries(DESENHOS).map(([nome, tracos]) => [nome, tracos.join(' ')]),
) as Record<NomeIcone, string>;

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function Icone({
  nome,
  tamanho = 24,
  cor,
  espessura = 2,
}: {
  nome: NomeIcone;
  tamanho?: number;
  /** Sem cor, usa a tinta de texto do tema. */
  cor?: string;
  /** Na escala do viewBox 24: num ícone de 48 px, `2` vira um traço de 4 px. */
  espessura?: number;
}) {
  const { cores } = useTema();

  return (
    <View
      // O ícone é sempre decoração: quem nomeia o botão é o rótulo escrito do
      // lado (ou o `rotuloAcessivel`, quando o botão é só o desenho). Lido em
      // voz alta, um SVG vira "imagem" antes do nome e só atrapalha.
      //
      // As três props porque cada plataforma entende a sua, e conferi no DOM:
      // `accessibilityElementsHidden` sozinho (iOS) NÃO vira `aria-hidden` no
      // react-native-web -- o símbolo continuava sendo lido.
      //
      // E numa <View> em volta, não no <Svg>: no web o `Svg` é criado direto
      // com `createElement('svg')`, que repassa pro DOM tudo o que não
      // reconhece -- `accessibilityElementsHidden` viraria atributo HTML
      // inválido, com aviso do React no console. A <View> filtra as props.
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: tamanho, height: tamanho }}>
      <Svg width={tamanho} height={tamanho} viewBox="0 0 24 24">
        <Path
          d={CAMINHOS[nome]}
          fill="none"
          stroke={cor ?? cores.texto}
          strokeWidth={espessura}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}
