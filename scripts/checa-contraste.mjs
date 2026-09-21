/**
 * Validador da paleta. Roda sozinho: `node scripts/checa-contraste.mjs`
 * (ou `npm run checa-paleta`).
 *
 * Lê os valores de `src/constants/theme.ts` em vez de repetir os hex aqui --
 * duas listas de cor divergem na primeira vez que alguém mexe só numa.
 *
 * A paleta é de lanchonete (tomate, mostarda, creme, marrom, verde), e cor
 * viva não escreve bem: o tomate e o verde que dão cara ao app ficam longe dos
 * 7:1 sobre o creme. Por isso cada família tem dois tons com trabalhos
 * diferentes, e cada um é cobrado pelo seu trabalho:
 *
 * - Tom ESCURO, pra escrever (`texto`, `textoFraco`, `positivo`, `negativo`,
 *   `atencao`, `acaoTexto`, `inversoTexto`): 7:1 (AAA), não os 4,5:1 mínimos.
 *   Está no topo do theme.ts: o celular fica no balcão sob luz de rua, e tela
 *   barata no sol perde muito mais que a conta teórica. Cada um contra as TRÊS
 *   superfícies em que pode cair (o estado vazio mora em `superficieAlt`, o
 *   cartão em `superficie`), e o de estado também contra a faixa da própria
 *   família (`Aviso` sobre `*Fraco`).
 * - Tom VIVO, pra preencher (`marca`, as barras do `Grafico`, `borda`,
 *   `acaoBorda`, `inverso` como pílula): 3:1 (WCAG 1.4.11, elemento gráfico).
 *   Não é texto, então o alvo é outro -- e é esse alvo mais baixo que deixa o
 *   tomate e o verde da dona existirem no app.
 *
 * O que este script NÃO enxerga: matiz. Ele mede separação de luminosidade, e
 * tomate contra verde é justamente o par que protanopia e deuteranopia
 * confundem. Os dois têm quase a mesma luminosidade (a linha "info" no fim de
 * cada esquema mostra), então nenhuma conta aqui separa lucro de prejuízo.
 * Quem separa é o que está fora da cor: a hachura e a barra abaixo da base no
 * gráfico, a palavra "prejuízo", o símbolo do `Aviso`. Passar aqui não
 * autoriza tirar nenhum deles.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'src/constants/theme.ts'), 'utf8');

/**
 * Devolve o índice do `}` que fecha o `{` em `abre`, pulando o que está dentro
 * de string e de comentário. Recortar com `split('},')` funcionava enquanto
 * nenhum valor tinha vírgula nem parêntese; a `sombra` (`rgba(43, 33, 28, ...)`)
 * e qualquer `}` num comentário quebrariam o recorte em silêncio.
 */
function fechaChave(texto, abre) {
  let nivel = 0;
  for (let i = abre; i < texto.length; i += 1) {
    const ch = texto[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const fim = texto.indexOf(ch, i + 1);
      if (fim === -1) break;
      i = fim;
    } else if (ch === '/' && texto[i + 1] === '/') {
      const fim = texto.indexOf('\n', i);
      i = fim === -1 ? texto.length : fim;
    } else if (ch === '/' && texto[i + 1] === '*') {
      const fim = texto.indexOf('*/', i + 2);
      i = fim === -1 ? texto.length : fim + 1;
    } else if (ch === '{') {
      nivel += 1;
    } else if (ch === '}') {
      nivel -= 1;
      if (nivel === 0) return i;
    }
  }
  throw new Error('chave sem fechamento no theme.ts');
}

/** Pega `light: { ... }` / `dark: { ... }` do VALOR de um `export const <nome>`. */
function leParte(nomeDoExport, esquema) {
  const inicio = fonte.indexOf(`export const ${nomeDoExport}`);
  if (inicio === -1) throw new Error(`não achei "export const ${nomeDoExport}" no theme.ts`);
  // Pula a anotação de tipo: o `Grafico` tem `{ barra: string; ... }` dentro
  // do `Record<...>`, e aquele `{` não é o do valor.
  const igual = fonte.indexOf('= {', inicio);
  if (igual === -1) throw new Error(`não achei o valor de ${nomeDoExport}`);
  const objeto = fonte.slice(igual + 2, fechaChave(fonte, igual + 2) + 1);

  const cabeca = new RegExp(`\\b${esquema}\\s*:\\s*\\{`).exec(objeto);
  if (!cabeca) throw new Error(`não achei "${esquema}" em ${nomeDoExport}`);
  const abre = cabeca.index + cabeca[0].length - 1;
  const corpo = objeto.slice(abre + 1, fechaChave(objeto, abre));

  // Pega TODO par `nome: '...'`, e só depois separa o que é hex. A `sombra`
  // é rgba de `boxShadow`, não cor chapada: fica de fora sem quebrar nada.
  const valores = {};
  for (const m of corpo.matchAll(/(\w+)\s*:\s*'([^']*)'/g)) {
    if (/^#[0-9A-Fa-f]{6}$/.test(m[2])) valores[m[1]] = m[2];
  }
  // Token que sumiu ou deixou de ser #RRGGBB não pode virar NaN e "passar".
  return new Proxy(valores, {
    get(alvo, nome) {
      if (typeof nome === 'string' && !(nome in alvo)) {
        throw new Error(`${nomeDoExport}.${esquema}.${nome} não existe ou não é #RRGGBB`);
      }
      return alvo[nome];
    },
  });
}

const canal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminancia(hex) {
  const n = hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => canal(parseInt(n.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function razao(a, b) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

const TEXTO = 7;
const GRAFICO = 3;

let reprovou = 0;
let conferidos = 0;
const fmt = (n) => n.toFixed(2).replace('.', ',');

function checa(rotulo, frente, fundo, minimo) {
  const r = razao(frente, fundo);
  const ok = r >= minimo;
  conferidos += 1;
  if (!ok) reprovou += 1;
  console.log(
    `  ${ok ? 'ok   ' : 'FALHA'} ${rotulo.padEnd(40)} ${fmt(r).padStart(6)}:1   (min ${minimo})`,
  );
}

/** Medida sem mínimo: está aqui pra lembrar o que a luminosidade não resolve. */
function informa(rotulo, frente, fundo, motivo) {
  const r = fmt(razao(frente, fundo));
  console.log(`  info  ${rotulo.padEnd(40)} ${r.padStart(6)}:1   (${motivo})`);
}

for (const esquema of ['light', 'dark']) {
  const c = leParte('Cores', esquema);
  const g = leParte('Grafico', esquema);
  console.log(`\n=== ${esquema} ===`);

  const superficies = [
    ['fundo', c.fundo],
    ['superficie', c.superficie],
    ['superficieAlt', c.superficieAlt],
  ];
  const cartoes = superficies.slice(1);

  console.log('\n  texto, 7:1 contra as três superfícies');
  for (const tom of ['texto', 'textoFraco', 'positivo', 'negativo', 'atencao']) {
    for (const [nome, sup] of superficies) checa(`${tom} / ${nome}`, c[tom], sup, TEXTO);
  }

  console.log('\n  texto sobre o próprio fundo, 7:1');
  checa('positivo / positivoFraco', c.positivo, c.positivoFraco, TEXTO);
  checa('negativo / negativoFraco', c.negativo, c.negativoFraco, TEXTO);
  checa('atencao / atencaoFraco', c.atencao, c.atencaoFraco, TEXTO);
  checa('acaoTexto / acao', c.acaoTexto, c.acao, TEXTO);
  checa('inversoTexto / inverso', c.inversoTexto, c.inverso, TEXTO);

  console.log('\n  elemento gráfico, 3:1');
  for (const [nome, sup] of superficies) checa(`borda / ${nome}`, c.borda, sup, GRAFICO);
  // Pílula da aba ativa (sobre `superficie`), borda do produto escolhido,
  // preenchimento da barra de progresso (sobre o trilho `superficieAlt`).
  for (const [nome, sup] of superficies) checa(`marca / ${nome}`, c.marca, sup, GRAFICO);
  checa('sobreMarca / marca', c.sobreMarca, c.marca, GRAFICO);
  // A mostarda quase não se separa do creme; a silhueta do botão é a borda.
  // `superficie` também: Metas e Gastos põem o botão principal num cartão.
  checa('acaoBorda / fundo', c.acaoBorda, c.fundo, GRAFICO);
  checa('acaoBorda / superficie', c.acaoBorda, c.superficie, GRAFICO);
  // Opção ativa do `Segmentos` sobre o trilho; `Ficha` ativa e contador do
  // produto escolhido sobre o fundo e sobre o cartão.
  for (const [nome, sup] of superficies) checa(`inverso / ${nome}`, c.inverso, sup, GRAFICO);
  for (const serie of ['barra', 'destaque', 'lucro', 'prejuizo']) {
    for (const [nome, sup] of cartoes) checa(`grafico.${serie} / ${nome}`, g[serie], sup, GRAFICO);
  }

  console.log('\n  sem mínimo');
  informa(
    'acao / fundo',
    c.acao,
    c.fundo,
    razao(c.acao, c.fundo) < GRAFICO ? 'a silhueta vem da acaoBorda' : 'separa sozinha',
  );
  informa('grafico.lucro / grafico.prejuizo', g.lucro, g.prejuizo, 'quem separa é a hachura');
}

console.log(
  reprovou === 0
    ? `\nTudo passa (${conferidos} pares).\n`
    : `\n${reprovou} de ${conferidos} par(es) reprovado(s). A paleta não pode ir assim.\n`,
);
process.exit(reprovou === 0 ? 0 : 1);
