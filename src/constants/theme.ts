/**
 * Tokens visuais do app da Nany.
 *
 * Três restrições vindas do uso real, não de gosto:
 *
 * 1. Ela registra venda no pico da tarde, com uma mão. Alvo de toque mínimo de
 *    56 px (`Touch.alvo`), bem acima dos 44 px de praxe -- o produto precisa
 *    acertar de primeira, de lado, sem olhar.
 * 2. O celular fica no balcão, sob luz de rua. Contraste de TEXTO acima de 7:1
 *    (AAA) em vez dos 4,5:1 mínimos, porque tela de celular barato no sol
 *    perde muito mais que a conta teórica.
 * 3. Dinheiro se lê de longe: `Fonte.destaque` e `Fonte.numero` existem pra
 *    valor monetário e são grandes de propósito.
 *
 * PALETA DE LANCHONETE: tomate (marca), mostarda (ação), creme (fundo),
 * marrom (texto), verde (resultado bom). Voltou a pedido da dona do app, depois
 * de uma fase em preto e branco -- o PI06 registra "abandono do registro
 * diário" como o risco mais alto, e uma tela que ela reconhece como sua é
 * parte de não ser abandonada.
 *
 * O que a cor NÃO resolve sozinha, e continua valendo da fase monocromática:
 *
 * - Tomate e verde são o par clássico que some pra quem tem protanopia ou
 *   deuteranopia. Então estado NUNCA viaja só na cor: `Aviso` tem símbolo
 *   (✓ / ✕ / !), número negativo vem com a palavra ("prejuízo"), e no gráfico
 *   o dia de prejuízo tem hachura E desce abaixo da linha de base.
 * - O tomate (`marca`) e o verde suave da identidade (#57A773) ficam longe
 *   dos 7:1 de texto sobre o creme: dão 3,96:1 e 2,75:1. Por isso existem
 *   DOIS tons de cada família: o vivo, pra preencher (ícone, indicador, barra,
 *   faixa), e o escuro, pra escrever (`negativo`, `positivo`). Escrever com
 *   `marca` só no logotipo "Nany", que é marca e está fora da regra de
 *   contraste de texto. O #57A773 não chega nem nos 3:1 de barra (2,92:1 no
 *   cartão branco), então `Grafico.lucro` é o mesmo matiz um pouco mais
 *   escuro (#3E8E5A, 4,02:1).
 * - A mostarda (`acao`) contra o creme tem pouca separação de luminosidade
 *   (1,61:1): o botão se destaca pelo matiz e pelo tamanho, e ganha a borda
 *   `acaoBorda` (3,35:1 contra o fundo) pra silhueta não depender do matiz.
 */

export type Esquema = 'light' | 'dark';

type Paleta = {
  fundo: string;
  /** Cartão. Branco sobre creme, com sombra leve em vez de contorno. */
  superficie: string;
  /** Fundo recuado: trilho da barra de progresso, ficha solta, estado vazio. */
  superficieAlt: string;
  /** Contorno de campo e de ficha. 3:1 contra as três superfícies. */
  borda: string;
  /** Linha divisória. Decorativa, sem requisito de contraste. */
  divisor: string;
  texto: string;
  textoFraco: string;
  /**
   * Texto do `placeholder`, e SÓ dele: 4,5:1 contra o branco do campo, não os
   * 7:1 do resto. É a única exceção da regra de texto, e é de propósito --
   * escrito no mesmo tom do valor digitado, o exemplo parecia campo já
   * preenchido ("seu@email.com" no login, "0,00" no valor do gasto).
   */
  placeholder: string;
  /** Tomate. Preenchimento, ícone, indicador -- NÃO texto corrido. */
  marca: string;
  /** Ícone sobre `marca` (a aba ativa). */
  sobreMarca: string;
  /** Mostarda. Fundo do botão principal. */
  acao: string;
  acaoTexto: string;
  acaoBorda: string;
  /** Marrom cheio com texto creme: opção escolhida, contador de itens. */
  inverso: string;
  inversoTexto: string;
  /** Texto de estado. 7:1 contra as três superfícies e contra o `*Fraco` da família. */
  positivo: string;
  negativo: string;
  atencao: string;
  /** Fundo tênue das faixas de estado. */
  positivoFraco: string;
  negativoFraco: string;
  atencaoFraco: string;
  /** Sombra do cartão, no formato de `boxShadow`. */
  sombra: string;
};

/**
 * Medido por `scripts/checa-contraste.mjs` (AAA pede 7:1 pra texto; WCAG
 * 1.4.11 pede 3:1 pra contorno, ícone e barra). Cada tom de texto é conferido
 * contra as TRÊS superfícies em que ele pode cair, e o número que importa é o
 * pior caso. Mexeu aqui, roda `npm run checa-paleta`.
 *
 * Os mais apertados, todos no claro e todos contra `superficieAlt`:
 * `atencao` 7,03:1, `textoFraco` 7,12:1, `Grafico.barra` 3,01:1. Escurecer o
 * creme recuado, mesmo pouco, derruba esses três antes de qualquer outro.
 */
export const Cores: Record<Esquema, Paleta> = {
  light: {
    fundo: '#FFF7EA',
    superficie: '#FFFFFF',
    superficieAlt: '#F8EBD6',
    borda: '#8A7263',
    divisor: '#EADBC6',
    texto: '#2B211C',
    textoFraco: '#5C4A3F',
    placeholder: '#866E5F',
    marca: '#D94A35',
    sobreMarca: '#FFFFFF',
    acao: '#F4BE45',
    acaoTexto: '#2B211C',
    acaoBorda: '#B07F14',
    inverso: '#2B211C',
    inversoTexto: '#FFF7EA',
    positivo: '#1A5430',
    negativo: '#86271A',
    atencao: '#6A4800',
    positivoFraco: '#E3F1E7',
    negativoFraco: '#FBE4DE',
    atencaoFraco: '#FCEFC7',
    sombra: '0px 1px 2px rgba(43, 33, 28, 0.06), 0px 6px 16px rgba(43, 33, 28, 0.07)',
  },
  dark: {
    fundo: '#1A1411',
    superficie: '#251D19',
    superficieAlt: '#302621',
    borda: '#9C8778',
    divisor: '#3A2F29',
    texto: '#FFF7EA',
    textoFraco: '#D2C2B4',
    placeholder: '#9C8778',
    marca: '#EE6A52',
    sobreMarca: '#1A1411',
    acao: '#F4BE45',
    acaoTexto: '#2B211C',
    acaoBorda: '#C99A2E',
    inverso: '#FFF7EA',
    inversoTexto: '#2B211C',
    positivo: '#8FD6A6',
    negativo: '#FFA593',
    atencao: '#F6C95E',
    positivoFraco: '#1C3325',
    negativoFraco: '#3E2019',
    atencaoFraco: '#3A2D12',
    sombra: '0px 1px 2px rgba(0, 0, 0, 0.4)',
  },
};

/**
 * Tinta das barras dos gráficos, separada das cores de texto porque o
 * trabalho é outro (3:1 de elemento gráfico, não 7:1 de texto).
 *
 * - `barra`: dia comum no gráfico de vendas.
 * - `destaque`: o dia de hoje no gráfico de vendas.
 * - `lucro` / `prejuizo`: o gráfico de lucro.
 *
 * `prejuizo` tem matiz próprio (tomate), mas NÃO depende dele: vermelho contra
 * verde é justamente o par que protan e deutan confundem, e em luminosidade os
 * dois quase empatam (1,23:1 no claro, 1,29:1 no escuro). O dia de prejuízo é
 * desenhado com hachura e abaixo da linha de base, e a leitura do dia escreve
 * "prejuízo". Tirar a hachura "porque agora tem cor" apaga a única distinção
 * que sobra pra quem não enxerga a diferença entre os dois.
 */
export const Grafico: Record<
  Esquema,
  { barra: string; destaque: string; lucro: string; prejuizo: string }
> = {
  light: { barra: '#9A8474', destaque: '#D94A35', lucro: '#3E8E5A', prejuizo: '#C8412D' },
  dark: { barra: '#8C7A6C', destaque: '#EE6A52', lucro: '#5DBA7E', prejuizo: '#EE6A52' },
};

/** Escala de 4 px: todo espaçamento do app sai daqui, nada de número solto. */
export const Espaco = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const Raio = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/**
 * Escala tipográfica. Pouca variedade de propósito: hierarquia vem de tamanho
 * E peso, e cada tela usa no máximo três degraus.
 */
export const Fonte = {
  rotulo: 14,
  corpo: 16,
  secao: 18,
  titulo: 26,
  numero: 30,
  /** O número-herói da tela. Um por tela. */
  destaque: 46,
} as const;

export const Peso = {
  normal: '400',
  medio: '600',
  forte: '700',
  pesado: '800',
} as const;

export const Touch = {
  /** Altura mínima de qualquer coisa clicável. */
  alvo: 56,
  /** Botão da ação principal da tela (VENDER, FINALIZAR). */
  alvoPrincipal: 72,
  /** Bloco de produto na tela de venda: dá pra acertar sem mirar. */
  alvoGrande: 104,
  /**
   * Ação secundária DESTRUTIVA (desfazer, remover). Menor que `alvo` de
   * propósito: aqui o erro caro é o toque acidental, não o toque que não pega.
   * 44 px é o piso da Apple HIG.
   */
  alvoSecundario: 44,
} as const;

/** Largura em que o layout para de crescer, pro app não virar planilha no desktop. */
export const LarguraMax = 560;
