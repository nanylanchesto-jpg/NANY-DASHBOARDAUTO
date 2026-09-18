/**
 * Tokens visuais do app da Nany Lanches.
 *
 * Três restrições vindas do uso real, não de gosto:
 *
 * 1. Ela registra venda no pico da tarde, com uma mão. Alvo de toque mínimo de
 *    56 px (`Touch.alvo`), bem acima dos 44 px de praxe -- o botão de +1
 *    hot-dog precisa acertar de primeira, de lado, sem olhar.
 * 2. O celular fica no balcão, sob luz de rua. Contraste de texto sobre fundo
 *    acima de 7:1 (AAA) em vez dos 4,5:1 mínimos, porque tela de celular
 *    barato no sol perde muito mais que a conta teórica.
 * 3. Dinheiro se lê de longe: `Fonte.numero` existe pra valor monetário e é
 *    grande de propósito.
 *
 * PALETA PRETO E BRANCO, a pedido da dona do app. Antes era de lanchonete
 * (tomate, mostarda, brasa), escolhida porque o PI06 registra "abandono do
 * registro diário" como o risco mais alto e uma tela que ela reconhece como
 * sua é parte de não ser abandonada. Isso foi trocado conscientemente por
 * monocromático -- quem for reverter, reverta sabendo o que estava em jogo.
 *
 * O que o preto e branco custou, e como cada perda foi coberta:
 *
 * - Estado deixou de ter matiz. `positivo`/`negativo`/`atencao` agora são
 *   níveis de cinza, então TODO lugar que sinaliza estado carrega também um
 *   símbolo ou palavra escrita. O `Aviso` em `components/ui` já fazia isso
 *   (✓ / ✕ / !); a regra agora é obrigatória, não um extra.
 * - Erro é o mais escuro e a faixa de erro é o fundo mais denso dos três, nos
 *   dois temas. Peso ótico virou o que a cor fazia.
 * - O gráfico perdeu a terceira série por cor. Ver `Grafico` embaixo.
 *
 * A vantagem que veio junto: cinza é imune a daltonismo. A validação de ΔE com
 * simulação de protan/deutan, que governava a paleta antiga, deixa de ser o
 * gargalo -- o que resta é separação de LUMINOSIDADE, medida abaixo.
 */

export type Esquema = 'light' | 'dark';

type Paleta = {
  fundo: string;
  superficie: string;
  superficieAlt: string;
  borda: string;
  texto: string;
  textoFraco: string;
  primaria: string;
  primariaTexto: string;
  positivo: string;
  negativo: string;
  atencao: string;
  /** Fundo tênue das faixas de aviso. Sem matiz: o que separa é a densidade. */
  positivoFraco: string;
  negativoFraco: string;
  atencaoFraco: string;
};

/**
 * Medido (AAA pede 7:1 pra texto, WCAG 1.4.11 pede 3:1 pra contorno de campo).
 * Cada tom de texto foi conferido contra as TRÊS superfícies em que ele pode
 * cair (`fundo`, `superficie`, `superficieAlt`), e o número abaixo é o pior
 * caso -- não o mais bonito:
 *
 *   claro   texto 19,3:1 · textoFraco 7,2:1 · borda 4,2:1
 *   escuro  texto 17,0:1 · textoFraco 7,4:1 · borda 3,2:1
 *
 * `scripts/checa-contraste.mjs` roda essa conferência. Mexeu aqui, roda ele.
 */
export const Cores: Record<Esquema, Paleta> = {
  light: {
    fundo: '#FFFFFF',
    // Igual ao fundo de propósito: cartão em preto e branco se define pelo
    // contorno, não por um cinza de fundo que vira sujeira sob luz de rua.
    superficie: '#FFFFFF',
    superficieAlt: '#F5F5F5',
    borda: '#767676',
    texto: '#000000',
    textoFraco: '#525252',
    primaria: '#000000',
    primariaTexto: '#FFFFFF',
    // Erro é o mais escuro dos três: sem matiz, quem grita é o peso.
    negativo: '#000000',
    atencao: '#3D3D3D',
    positivo: '#525252',
    negativoFraco: '#E6E6E6',
    atencaoFraco: '#EDEDED',
    positivoFraco: '#F5F5F5',
  },
  dark: {
    fundo: '#000000',
    superficie: '#121212',
    superficieAlt: '#1C1C1C',
    borda: '#6B6B6B',
    texto: '#FFFFFF',
    textoFraco: '#ABABAB',
    primaria: '#FFFFFF',
    primariaTexto: '#000000',
    negativo: '#FFFFFF',
    atencao: '#D4D4D4',
    positivo: '#ABABAB',
    // No escuro a densidade inverte: a faixa de erro é a mais CLARA, que é a
    // que mais se descola do preto. O peso continua no erro.
    negativoFraco: '#333333',
    atencaoFraco: '#262626',
    positivoFraco: '#1C1C1C',
  },
};

/**
 * Tinta das barras do gráfico — SEPARADA das cores de texto acima, porque o
 * trabalho é outro.
 *
 * Em preto e branco, três séries não cabem em três cinzas. Dois cinzas já é o
 * limite do que se distingue numa barra de 20 px vista de lado no balcão, e o
 * terceiro estado (dia no prejuízo) teria que ser um cinza no meio dos outros
 * dois -- exatamente onde ninguém separa.
 *
 * Então a terceira série NÃO é uma terceira tinta: é TEXTURA. O dia de
 * prejuízo é desenhado com hachura diagonal (`<Pattern>` em `grafico-dias`)
 * na mesma tinta do lucro, mais um contorno pra barra não se perder no fundo.
 * Por isso `prejuizo` e `lucro` têm o mesmo valor aqui: não é engano nem
 * copy-paste, é a mesma tinta usada de duas maneiras. Trocar `prejuizo` por
 * "um cinza diferente pra ficar coerente" desfaz justamente o que separa os
 * dois.
 *
 * Separação de luminosidade medida (WCAG 1.4.11 pede 3:1 pra elemento
 * gráfico), contra a superfície do cartão e entre os dois segmentos da mesma
 * barra empilhada:
 *
 *   claro   custo/superfície 3,45:1 · lucro/superfície 21,0:1 · custo/lucro 6,1:1
 *   escuro  custo/superfície 3,78:1 · lucro/superfície 18,7:1 · custo/lucro 5,0:1
 *
 * As três salvaguardas que já existiam continuam, e agora são o que sustenta a
 * leitura: a legenda é fixa, há 2 px de fundo entre os segmentos empilhados, e
 * tocar a barra abre os valores escritos.
 */
export const Grafico: Record<Esquema, { custo: string; lucro: string; prejuizo: string }> = {
  light: { custo: '#8A8A8A', lucro: '#000000', prejuizo: '#000000' },
  dark: { custo: '#707070', lucro: '#FFFFFF', prejuizo: '#FFFFFF' },
};

/** Escala de 4 px: todo espaçamento do app sai daqui, nada de número solto. */
export const Espaco = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Raio = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

export const Fonte = {
  rotulo: 13,
  corpo: 15,
  titulo: 19,
  numero: 30,
  numeroGrande: 40,
} as const;

export const Touch = {
  /** Altura mínima de qualquer coisa clicável. */
  alvo: 56,
  /** Botão de venda rápida: dá pra acertar sem mirar. */
  alvoGrande: 84,
  /**
   * Ação secundária DESTRUTIVA (desfazer venda, remover item da receita).
   *
   * Menor que `alvo` de propósito, e essa é a única exceção aos 56 px: aqui o
   * erro caro é o toque acidental, não o toque que não pega. 44 px é o piso da
   * Apple HIG -- abaixo disso vira difícil de acertar de propósito também, que
   * era o caso dos 40 px que estavam no cadastro.
   */
  alvoSecundario: 44,
} as const;

/** Largura em que o layout para de crescer, pro app não virar planilha no desktop. */
export const LarguraMax = 560;
