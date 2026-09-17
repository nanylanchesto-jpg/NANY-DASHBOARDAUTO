import { Cores, Grafico } from '@/constants/theme';
// Não trocar por `react-native` direto: a versão .web deste hook segura o tema
// em 'light' até a hidratação, porque o app é exportado com `web.output:
// "static"` e o HTML é gerado sem saber a preferência do aparelho. Sem essa
// espera, o React acusa mismatch de hidratação e a tela pisca do claro pro
// escuro no primeiro carregamento.
import { useColorScheme } from './use-color-scheme';

export function useTema() {
  // Já vem 'light' | 'dark' das duas plataformas — sem nulo pra normalizar.
  const esquema = useColorScheme();
  return { esquema, cores: Cores[esquema], grafico: Grafico[esquema] };
}
