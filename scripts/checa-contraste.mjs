/**
 * Validador da paleta. Roda sozinho: `node scripts/checa-contraste.mjs`.
 *
 * Lê os valores de `src/constants/theme.ts` em vez de repetir os hex aqui --
 * duas listas de cor divergem na primeira vez que alguém mexe só numa.
 *
 * O que ele cobra, e por quê:
 *
 * - Texto a 7:1 (AAA), não os 4,5:1 mínimos. Está no topo do theme.ts: o
 *   celular fica no balcão sob luz de rua, e tela barata no sol perde muito
 *   mais que a conta teórica.
 * - Cada tom de texto contra as TRÊS superfícies em que ele pode cair, não só
 *   contra `fundo`. O placeholder do campo mora em `superficie`, e o texto do
 *   estado vazio mora em `superficieAlt`.
 * - Contorno de campo e barra de gráfico a 3:1 (WCAG 1.4.11, elemento
 *   gráfico). Não é texto, então o alvo é outro.
 *
 * Com a paleta em preto e branco não há mais o que checar de daltonismo: cinza
 * é imune. O que restou é separação de luminosidade, que é o que está aqui.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'src/constants/theme.ts'), 'utf8');

/** Pega `light: { ... }` / `dark: { ... }` de dentro de um `export const <nome>`. */
function leParte(nomeDoExport, esquema) {
  const bloco = fonte.split(`export const ${nomeDoExport}`)[1];
  if (!bloco) throw new Error(`não achei "export const ${nomeDoExport}" no theme.ts`);
  const parte = bloco.split(`${esquema}: {`)[1];
  if (!parte) throw new Error(`não achei "${esquema}" em ${nomeDoExport}`);
  const corpo = parte.split('},')[0];
  return Object.fromEntries(
    [...corpo.matchAll(/(\w+)\s*:\s*'(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2]]),
  );
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

const AAA = 7;
const GRAFICO = 3;

let reprovou = 0;
const fmt = (n) => n.toFixed(2).replace('.', ',');

function checa(rotulo, frente, fundo, minimo) {
  const r = razao(frente, fundo);
  const ok = r >= minimo;
  if (!ok) reprovou += 1;
  console.log(
    `  ${ok ? 'ok   ' : 'FALHA'} ${rotulo.padEnd(38)} ${fmt(r).padStart(6)}:1   (min ${minimo})`,
  );
}

for (const esquema of ['light', 'dark']) {
  const c = leParte('Cores', esquema);
  const g = leParte('Grafico', esquema);
  console.log(`\n=== ${esquema} ===`);

  // Texto: cada tom contra toda superfície em que ele pode cair.
  const superficies = [
    ['fundo', c.fundo],
    ['superficie', c.superficie],
    ['superficieAlt', c.superficieAlt],
  ];
  for (const tom of ['texto', 'textoFraco']) {
    for (const [nome, sup] of superficies) checa(`${tom} / ${nome}`, c[tom], sup, AAA);
  }

  // Estado: a tinta sempre sobre a faixa da própria família.
  checa('primariaTexto / primaria', c.primariaTexto, c.primaria, AAA);
  checa('negativo / negativoFraco', c.negativo, c.negativoFraco, AAA);
  checa('positivo / positivoFraco', c.positivo, c.positivoFraco, AAA);
  checa('atencao / atencaoFraco', c.atencao, c.atencaoFraco, AAA);

  // Contorno e barras: elemento gráfico, alvo 3:1.
  for (const [nome, sup] of superficies) checa(`borda / ${nome}`, c.borda, sup, GRAFICO);
  checa('grafico.custo / superficie', g.custo, c.superficie, GRAFICO);
  checa('grafico.lucro / superficie', g.lucro, c.superficie, GRAFICO);
  // Os dois segmentos da mesma barra empilhada, um encostado no outro.
  checa('grafico.custo / grafico.lucro', g.custo, g.lucro, GRAFICO);
}

console.log(
  reprovou === 0
    ? '\nTudo passa.\n'
    : `\n${reprovou} par(es) reprovado(s). A paleta não pode ir assim.\n`,
);
process.exit(reprovou === 0 ? 0 : 1);
