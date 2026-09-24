import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Se a pessoa pediu MENOS MOVIMENTO no sistema.
 *
 * iOS: Ajustes → Acessibilidade → Movimento. Android: Acessibilidade → Remover
 * animações. Navegador: `prefers-reduced-motion`, que o react-native-web lê do
 * `matchMedia`. Uma chamada serve às três.
 *
 * Quem liga isso costuma ter motivo de saúde -- enjoo, vertigem, sensibilidade
 * a piscada. Então a chuva de hot-dogs não é "menos intensa" nesse caso: ela
 * não acontece.
 *
 * Começa em `true` e só libera depois da resposta. Ao contrário, a animação
 * dispararia no primeiro quadro e seria cortada em seguida -- exatamente o
 * susto que a preferência existe pra evitar.
 */
export function useAnimacaoReduzida(): boolean {
  const [reduzida, setReduzida] = useState(true);

  useEffect(() => {
    let montado = true;
    AccessibilityInfo.isReduceMotionEnabled().then((ligado) => {
      if (montado) setReduzida(ligado);
    });
    const inscricao = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduzida);
    return () => {
      montado = false;
      inscricao.remove();
    };
  }, []);

  return reduzida;
}
