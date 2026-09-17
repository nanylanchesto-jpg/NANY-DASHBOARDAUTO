/**
 * Cliente Supabase único do app, com a sessão sobrevivendo ao fechar o app.
 *
 * Persistir a sessão não é conforto, é requisito: se ela tiver que digitar
 * e-mail e senha antes de marcar um hot-dog no pico da tarde, o registro não
 * acontece -- e sem registro o dashboard inteiro fica vazio.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// `URL` e `URLSearchParams` não existem no runtime do React Native, e o
// supabase-js usa os dois pra montar as rotas do PostgREST. Sem o polyfill,
// toda consulta estoura "URL is not a constructor" no celular -- mas no web já
// são nativos, e aí importar o polyfill só carrega peso morto no bundle e
// sobrescreve uma implementação nativa melhor por uma em JS.
//
// `require` e não `import`: um import estático é içado pro topo do módulo e
// roda ANTES do `if`, ou seja, executaria no web também -- é o contrário do
// que a condição quer. Um `import()` dinâmico resolveria o içamento, mas é
// assíncrono, e o polyfill precisa estar de pé antes do `createClient` logo
// abaixo.
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (Platform.OS !== 'web') require('react-native-url-polyfill/auto');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const chave = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !chave) {
  // Falha no import, não na primeira consulta. Variável esquecida no Vercel
  // daria um app que abre, faz login e só então mostra erro de rede em toda
  // tela -- muito mais difícil de diagnosticar que um build que não sobe.
  throw new Error(
    'Faltam EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copie .env.example para .env (local) ou cadastre as duas no Vercel.',
  );
}

export const supabase = createClient(url, chave, {
  auth: {
    // No web o supabase-js já usa localStorage sozinho; passar AsyncStorage
    // aqui atrapalharia o fluxo de recuperação de senha por link.
    ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
    persistSession: true,
    autoRefreshToken: true,
    // Só o web volta de um link (confirmação de e-mail, redefinição de senha)
    // com o token no fragmento da URL.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
