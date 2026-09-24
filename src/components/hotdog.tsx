/**
 * O hot-dog desenhado, sem animação nenhuma.
 *
 * Arquivo separado da chuva DE PROPÓSITO: a chuva importa o Reanimated, e
 * quem só quer a figura (um estado vazio, uma ilustração) não deve carregar
 * uma biblioteca de animação junto.
 */

import Svg, { Path, Rect } from 'react-native-svg';

/**
 * Um hot-dog de lado: pão embaixo, salsicha em cima, zigue-zague de mostarda.
 *
 * Desenhado em SVG e não em imagem: escala sem borrar, pesa alguns bytes e
 * acompanha o tamanho pedido sem precisar de três arquivos.
 */
export function Hotdog({ tamanho = 56 }: { tamanho?: number }) {
  const altura = (tamanho * 34) / 64;
  return (
    <Svg width={tamanho} height={altura} viewBox="0 0 64 34">
      {/* Pão de baixo */}
      <Rect x="1" y="12" width="62" height="21" rx="10.5" fill="#E3A85C" />
      {/* Salsicha */}
      <Rect x="5" y="6" width="54" height="17" rx="8.5" fill="#C8412D" />
      {/* Pão de cima, mais claro pra separar da salsicha */}
      <Rect x="1" y="1" width="62" height="12" rx="6" fill="#EFC07E" />
      {/* Mostarda */}
      <Path
        d="M11 15 L19 20 L27 15 L35 20 L43 15 L51 20"
        stroke="#F4BE45"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
