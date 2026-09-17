/**
 * Unidades de medida dos ingredientes.
 *
 * Portado de `src/lib/inventory.ts` do Almoxá, com a mesma regra: o saldo
 * SEMPRE mora na unidade-base da dimensão (g pra massa, ml pra volume,
 * unidade pra contagem), e a unidade escolhida no cadastro serve só pra
 * exibir e digitar.
 *
 * Espelha `public.unidade_base()` e `public.fator_base()` da migration
 * 20260917120000. Quem decide de verdade é o banco -- as colunas
 * `quantidade_base` e `custo_base` de `compra_itens` são GENERATED, então uma
 * conversão errada aqui não contamina o estoque. Isto existe pra tela não
 * pedir conta de cabeça pra ela ("2 kg de salsicha" em vez de "2000 g").
 */

export const UNIDADES = ['unidade', 'g', 'kg', 'ml', 'l'] as const;
export type Unidade = (typeof UNIDADES)[number];

export const ROTULO_UNIDADE: Record<Unidade, string> = {
  unidade: 'un.',
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
};

export type Dimensao = 'massa' | 'volume' | 'contagem';

export const dimensaoDe = (unidade: Unidade): Dimensao =>
  unidade === 'g' || unidade === 'kg'
    ? 'massa'
    : unidade === 'ml' || unidade === 'l'
      ? 'volume'
      : 'contagem';

/** As únicas trocas de unidade que fazem sentido dentro de cada dimensão. */
export const UNIDADES_POR_DIMENSAO: Record<Dimensao, Unidade[]> = {
  massa: ['g', 'kg'],
  volume: ['ml', 'l'],
  contagem: ['unidade'],
};

const FATOR: Record<Unidade, number> = { unidade: 1, g: 1, kg: 1000, ml: 1, l: 1000 };

export const paraBase = (valor: number, unidade: Unidade) => valor * FATOR[unidade];
export const daBase = (base: number, unidade: Unidade) => base / FATOR[unidade];

/**
 * Unidade em que faz sentido MOSTRAR um saldo, dentro da dimensão do
 * ingrediente.
 *
 * Existe porque a unidade de cadastro é a da compra, não a do uso. Ela compra
 * molho em kg e gasta em g: com 300 g em estoque, o cadastro em kg mostraria
 * "0,3 kg" -- tecnicamente certo e ilegível no balcão. Aqui 300 g aparece como
 * "300 g" e 2400 g como "2,4 kg", sem ela ter que reconfigurar nada.
 *
 * O corte fica em 1000 (1 kg / 1 l), e o valor absoluto cuida do saldo
 * negativo: −1500 g é "−1,5 kg", não cai pra grama por ser menor que mil.
 */
export const unidadeDeExibicao = (base: number, unidade: Unidade): Unidade => {
  const dimensao = dimensaoDe(unidade);
  if (dimensao === 'contagem') return 'unidade';
  const grande = Math.abs(base) >= 1000;
  if (dimensao === 'massa') return grande ? 'kg' : 'g';
  return grande ? 'l' : 'ml';
};
