import type { Esquema } from '@/constants/theme';
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

/**
 * Tema do aparelho no web, com render estático (`web.output: "static"`).
 *
 * O HTML é gerado no build, quando não existe aparelho nem preferência de
 * tema. Se o primeiro render do cliente já devolvesse "dark", o React acusaria
 * mismatch de hidratação e a tela piscaria do claro pro escuro.
 *
 * O template do Expo resolvia com um `useState(false)` virado pra `true` dentro
 * de um `useEffect` -- funciona, mas é setState em efeito: dois renders a cada
 * montagem, e o `react-hooks/set-state-in-effect` reprova com razão.
 *
 * `useSyncExternalStore` é feito exatamente pra isto: `noBuild` responde
 * durante o build e a hidratação, `agora` assume depois, e a troca acontece num
 * render só. De brinde, mudar o tema no sistema operacional passou a repintar o
 * app na hora -- o hook antigo lia `useColorScheme()` mas nunca reassinava,
 * então a mudança só aparecia no próximo reload.
 *
 * O retorno é 'light' | 'dark', nunca nulo: `Appearance.getColorScheme()` pode
 * devolver null ou undefined (aparelho sem preferência declarada), e empurrar
 * essa incerteza pra cada chamador só multiplica o mesmo `?? 'light'`.
 */

const assinar = (avisar: () => void) => {
  const inscricao = Appearance.addChangeListener(avisar);
  return () => inscricao.remove();
};

const agora = (): Esquema => (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');

// Claro no build e na hidratação: é o que o HTML estático já contém.
const noBuild = (): Esquema => 'light';

export function useColorScheme(): Esquema {
  return useSyncExternalStore(assinar, agora, noBuild);
}
