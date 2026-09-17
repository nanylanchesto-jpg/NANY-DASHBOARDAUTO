import type { Esquema } from '@/constants/theme';
import { useColorScheme as useColorSchemeRN } from 'react-native';

/**
 * Tema do aparelho no celular.
 *
 * Normaliza pra 'light' | 'dark' e nunca devolve nulo, igual à versão .web --
 * as duas plataformas têm que ter a MESMA assinatura, senão um `?? 'light'`
 * esquecido só aparece na plataforma que ninguém testou naquele dia.
 * `useColorScheme()` do React Native devolve null quando o aparelho não
 * declara preferência.
 */
export function useColorScheme(): Esquema {
  return useColorSchemeRN() === 'dark' ? 'dark' : 'light';
}
