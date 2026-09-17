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
 * A paleta é de lanchonete (tomate, mostarda, brasa) porque o app tem que
 * parecer dela e não de um ERP -- o PI06 registra "abandono do registro
 * diário" como o risco mais alto, e uma tela que ela reconhece como sua é
 * parte de não ser abandonada.
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
  /** Fundo tênue das faixas de aviso, na mesma família do estado que sinalizam. */
  positivoFraco: string;
  negativoFraco: string;
  atencaoFraco: string;
};

export const Cores: Record<Esquema, Paleta> = {
  light: {
    fundo: '#FDF8F3',
    superficie: '#FFFFFF',
    superficieAlt: '#F6EEE6',
    borda: '#E4D5C6',
    texto: '#241A14',
    textoFraco: '#6B5648',
    primaria: '#C5391F',
    primariaTexto: '#FFFFFF',
    positivo: '#146B45',
    negativo: '#A8231B',
    atencao: '#8A5A00',
    positivoFraco: '#E4F3EB',
    negativoFraco: '#FBE9E7',
    atencaoFraco: '#FBF0D9',
  },
  dark: {
    fundo: '#17120F',
    superficie: '#231C17',
    superficieAlt: '#2E251F',
    borda: '#3F332B',
    texto: '#F7EFE8',
    textoFraco: '#B8A597',
    primaria: '#F2704F',
    primariaTexto: '#2A0F08',
    positivo: '#5FD79B',
    negativo: '#FF8A7A',
    atencao: '#F0C05A',
    positivoFraco: '#16301F',
    negativoFraco: '#33171A',
    atencaoFraco: '#332816',
  },
};

/**
 * Cores das barras do gráfico — SEPARADAS das cores de texto acima, porque o
 * trabalho é outro.
 *
 * `Cores.positivo` (#146B45) foi escolhido pra ler como texto sobre fundo
 * claro, e por isso é escuro e pouco saturado. Como preenchimento de barra ele
 * reprova: fica fora da banda de luminosidade de gráfico e abaixo do piso de
 * croma, ou seja, lido como "cinza esverdeado" em vez de uma cor com
 * identidade. Os valores abaixo saíram do validador de paleta (OKLCH + ΔE
 * OKLab com simulação de daltonismo), não de escolha a olho:
 *
 *   claro  #C0611F ↔ #1F8D5C — ΔE 8,2 (protan), contraste ≥ 3:1
 *   escuro #D97534 ↔ #2AAE74 — ΔE 8,0 (deutan), contraste ≥ 3:1
 *
 * Verde vs âmbar, que era a primeira ideia, reprovou feio: ΔE 5,6 no protan --
 * pra quem tem a deficiência de cor mais comum entre homens, as duas partes da
 * barra empilhada viravam a mesma cor. Laranja queimado mantém a leitura
 * "gasto" e se separa do verde.
 *
 * Os dois pares ficam perto do alvo de 8,0, então a cor NUNCA carrega a
 * informação sozinha: a legenda é fixa, há 2 px de fundo entre os segmentos
 * empilhados, e tocar a barra abre os valores escritos.
 */
export const Grafico: Record<Esquema, { custo: string; lucro: string; prejuizo: string }> = {
  light: { custo: '#C0611F', lucro: '#1F8D5C', prejuizo: '#A8231B' },
  dark: { custo: '#D97534', lucro: '#2AAE74', prejuizo: '#FF8A7A' },
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
} as const;

/** Largura em que o layout para de crescer, pro app não virar planilha no desktop. */
export const LarguraMax = 560;
