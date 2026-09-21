import { Stack } from 'expo-router';

import { useTema } from '@/hooks/use-tema';

/**
 * Planejar é uma pilha dentro da aba: o hub em `index` e cada assunto (metas,
 * compras, estoque...) um nível abaixo. É o que deixa a aba mostrar só os
 * números que importam e esconder o detalhe atrás de um toque.
 *
 * `anchor: 'index'` garante o hub EMBAIXO de qualquer tela interna, inclusive
 * quando ela chega direto -- o aviso de estoque da aba Hoje abre
 * `/planejar/estoque`, e sem a âncora o "voltar" dali não teria pra onde ir.
 */
export const unstable_settings = { anchor: 'index' };

export default function LayoutPlanejar() {
  const { cores } = useTema();
  return (
    <Stack
      screenOptions={{
        // Cabeçalho próprio (`Tela` com `voltar`), igual na web e no celular:
        // o nativo mudaria de cara entre iOS, Android e navegador.
        headerShown: false,
        contentStyle: { backgroundColor: cores.fundo },
      }}
    />
  );
}
