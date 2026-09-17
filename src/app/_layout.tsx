import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { StatusBar } from 'expo-status-bar';
import { forwardRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

// Em `components/`, não em `app/`: dentro de `app/` o arquivo viraria a rota
// `/login`, alcançável por URL e renderizada FORA das abas -- uma tela de
// login aparecendo pra quem já está logado.
import { TelaLogin } from '@/components/tela-login';
import { Espaco, Raio, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import { useSessao } from '@/lib/sessao';

/**
 * `expo-router/ui` (headless) em vez de `NativeTabs` do template e de
 * `expo-router`/Tabs: é o único que dá a MESMA barra no navegador e no
 * celular. O template vinha com duas implementações (`app-tabs.tsx` e
 * `app-tabs.web.tsx`), e dois arquivos de navegação é onde o app que a Nany
 * abre no Chrome começa a divergir do que roda no APK sem ninguém notar.
 */
export default function Layout() {
  // Fora do componente o cliente viraria global de módulo e, no export web
  // estático (SSR), o cache seria compartilhado entre requisições -- dados de
  // uma conta vazando pra outra. `useState` dá um cliente por montagem.
  const [cliente] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Ela abre e fecha o app o dia todo. 30 s evita refazer as somas a
            // cada troca de aba, sem deixar o número velho o suficiente pra
            // ela desconfiar depois de registrar uma venda.
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: Platform.OS === 'web',
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={cliente}>
      <SafeAreaProvider>
        <Portao />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/**
 * Sem sessão, a tela de login entra no LUGAR das abas em vez de redirecionar.
 * Redirecionar faria as abas montarem, disparar as consultas, tomar 401 e só
 * então navegar -- um piscar de telas vazias a cada abertura do app.
 */
function Portao() {
  const { esquema, cores } = useTema();
  const { entrou, carregando } = useSessao();

  if (carregando) {
    return <View style={{ flex: 1, backgroundColor: cores.fundo }} />;
  }

  return (
    <>
      <StatusBar style={esquema === 'dark' ? 'light' : 'dark'} />
      {entrou ? <Abas /> : <TelaLogin />}
    </>
  );
}

function Abas() {
  return (
    <Tabs>
      <TabSlot />
      <BarraDeAbas />
    </Tabs>
  );
}

function BarraDeAbas() {
  const { cores } = useTema();
  const inset = useSafeAreaInsets();

  return (
    <TabList
      style={[
        estilos.barra,
        {
          backgroundColor: cores.superficie,
          borderTopColor: cores.borda,
          paddingBottom: Math.max(inset.bottom, Espaco.sm),
        },
      ]}>
      <TabTrigger name="hoje" href="/" asChild>
        <ItemDeAba icone="◆" rotulo="Hoje" />
      </TabTrigger>
      <TabTrigger name="vender" href="/vender" asChild>
        <ItemDeAba icone="＋" rotulo="Vender" />
      </TabTrigger>
      <TabTrigger name="notinha" href="/notinha" asChild>
        <ItemDeAba icone="▣" rotulo="Notinha" />
      </TabTrigger>
      <TabTrigger name="cadastro" href="/cadastro" asChild>
        <ItemDeAba icone="☰" rotulo="Cadastro" />
      </TabTrigger>
    </TabList>
  );
}

/**
 * `forwardRef` porque o `asChild` do TabTrigger passa ref e props de aba pro
 * filho; sem encaminhar, o React avisa e o toque não navega.
 */
const ItemDeAba = forwardRef<
  View,
  TabTriggerSlotProps & { icone: string; rotulo: string }
>(({ icone, rotulo, isFocused, ...props }, ref) => {
  const { cores } = useTema();
  const cor = isFocused ? cores.primaria : cores.textoFraco;

  return (
    <Pressable
      ref={ref}
      {...props}
      accessibilityRole="tab"
      accessibilityState={{ selected: Boolean(isFocused) }}
      style={({ pressed }) => [estilos.item, { opacity: pressed ? 0.6 : 1 }]}>
      <Text style={{ fontSize: 20, color: cor, lineHeight: 24 }}>{icone}</Text>
      {/* O rótulo escrito fica sempre visível, nunca só o ícone: são quatro
          telas que ela vai aprender uma vez, e "▣" não quer dizer nada sozinho. */}
      <Text style={{ fontSize: 11, color: cor, fontWeight: isFocused ? '700' : '400' }}>
        {rotulo}
      </Text>
    </Pressable>
  );
});

ItemDeAba.displayName = 'ItemDeAba';

const estilos = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Espaco.sm,
    paddingHorizontal: Espaco.sm,
  },
  item: {
    flex: 1,
    minHeight: Touch.alvo,
    borderRadius: Raio.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
});
