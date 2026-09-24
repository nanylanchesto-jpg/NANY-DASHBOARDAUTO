import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tabs, TabList, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { StatusBar } from 'expo-status-bar';
import { forwardRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icone, type NomeIcone } from '@/components/icone';
// Em `components/`, não em `app/`: dentro de `app/` o arquivo viraria a rota
// `/login`, alcançável por URL e renderizada FORA das abas -- uma tela de
// login aparecendo pra quem já está logado.
import { TelaLogin } from '@/components/tela-login';
import { Espaco, Fonte, LarguraMax, Peso, Raio, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import { useSessao } from '@/lib/sessao';

/**
 * A pílula da aba ativa: larga o bastante pro ícone não encostar na borda, e
 * não mais que isso -- com quatro abas num celular de 360 px, 56 px é o limite
 * antes de uma pílula quase encostar na vizinha.
 */
const LARGURA_PILULA = 56;
const ALTURA_PILULA = 32;

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

/**
 * Quatro abas: Hoje (olhar), Vender (fazer), Painel (os gráficos) e Planejar
 * (o administrativo, numa pilha).
 *
 * Começou com três, e o Painel entrou a pedido da dona. O custo é real e vale
 * saber: cada aba a mais é um alvo menor no polegar e mais uma palavra pra
 * aprender. Cinco não cabem -- em 360 px o rótulo já começaria a quebrar.
 *
 * O `<TabList>` tem que ser filho DIRETO de `<Tabs>`.
 *
 * `Tabs` não renderiza os filhos pra descobrir as abas: ele percorre o JSX e
 * compara `child.type === TabList` (`parseTriggersFromChildren`, em
 * `expo-router/build/ui/Tabs.js`). Extrair a barra pra um componente próprio --
 * que é a limpeza óbvia, e era como estava -- esconde os `TabTrigger` desse
 * percurso: o navegador fica com zero telas e o app quebra com "Couldn't find
 * any screens for the navigator" na hora em que ela entra.
 *
 * O `npm run build:web` NÃO pega isso. No export estático a sessão ainda está
 * carregando, o `Portao` devolve a tela vazia, e as abas nunca chegam a montar.
 */
function Abas() {
  const { cores } = useTema();
  const inset = useSafeAreaInsets();

  return (
    <Tabs>
      {/* `minHeight: 0` + `flexShrink: 1` sobrescrevem o `flexShrink: 0` que o
          próprio TabSlot põe no contêiner das telas e na tela focada. Sem isso,
          tela mais alta que o visor não encolhe: a coluna transborda e a
          `TabList`, que vem DEPOIS dela, é empurrada pra fora da área visível --
          no antigo Cadastro (hoje Produtos, dentro do Planejar), que era a tela
          mais longa, a barra de navegação sumia e não tinha como trocar de aba.

          Só acontece na web: no app nativo o react-native-screens recorta o
          contêiner, e aí o `flexShrink: 0` não faz diferença. Como este é o
          mesmo bundle nos dois lugares, o bug existia só de um lado. */}
      <TabSlot style={{ minHeight: 0, flexShrink: 1 }} />
      <TabList
        accessibilityRole="tablist"
        style={[
          estilos.barra,
          {
            backgroundColor: cores.superficie,
            borderTopColor: cores.divisor,
            paddingBottom: Math.max(inset.bottom, Espaco.sm),
          },
        ]}>
        <TabTrigger name="hoje" href="/" asChild>
          <ItemDeAba icone="hoje" rotulo="Hoje" />
        </TabTrigger>
        <TabTrigger name="vender" href="/vender" asChild>
          <ItemDeAba icone="vender" rotulo="Vender" />
        </TabTrigger>
        <TabTrigger name="painel" href="/painel" asChild>
          <ItemDeAba icone="painel" rotulo="Painel" />
        </TabTrigger>
        {/* `resetOnFocus` DESLIGADO de propósito (é a prop do `TabTrigger`
            instalado; conferido em `expo-router/build/ui/TabTrigger.d.ts`).

            Ligado, voltar pra aba zera a pilha do Planejar (`TabRouter.js`
            apaga o `state` da rota). E o caso real é este: ela está conferindo
            a nota que o Gemini acabou de ler, chega cliente, ela pula pro
            Vender, vende, volta -- e a conferência tem que estar onde ficou. As
            telas das abas continuam montadas escondidas (`TabSlot.js`), então
            sem o reset o estado sobrevive; com ele, a leitura (que gasta cota)
            iria pro lixo.

            Pra voltar ao hub, basta tocar de novo em Planejar com ela aberta:
            o `TabTrigger` emite `tabPress` e a pilha faz `popToTop` sozinha
            (`fork/native-stack/createNativeStackNavigator.js`) -- o mesmo
            gesto do app nativo. */}
        <TabTrigger name="planejar" href="/planejar" asChild resetOnFocus={false}>
          <ItemDeAba icone="planejar" rotulo="Planejar" />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}

/**
 * `forwardRef` porque o `asChild` do TabTrigger passa ref e props de aba pro
 * filho; sem encaminhar, o React avisa e o toque não navega.
 *
 * Desenho de barra de app, não de site: a aba ativa ganha uma pílula tomate
 * atrás do ícone, e o rótulo escrito fica SEMPRE visível. Não é só enfeite: a
 * pílula diz "você está aqui" por forma e tamanho, então a aba ativa não
 * depende de distinguir tomate de marrom -- e o rótulo ainda engrossa.
 */
const ItemDeAba = forwardRef<
  View,
  TabTriggerSlotProps & { icone: NomeIcone; rotulo: string }
>(({ icone, rotulo, isFocused, ...props }, ref) => {
  const { cores } = useTema();
  const ativo = Boolean(isFocused);

  return (
    <Pressable
      ref={ref}
      {...props}
      accessibilityRole="tab"
      accessibilityLabel={rotulo}
      // `aria-selected` e não `accessibilityState`: o react-native-web descarta
      // o objeto sem avisar (ver o cabeçalho do ui.tsx), e o leitor de tela do
      // Safari nunca sabia qual aba estava aberta. O RN nativo converte.
      aria-selected={ativo}
      style={estilos.item}>
      {({ pressed }) => (
        <>
          <View
            style={[
              estilos.pilula,
              {
                // Na inativa, o toque acende a pílula em creme: o retorno
                // aparece onde o dedo está, como na barra do Android.
                backgroundColor: ativo
                  ? cores.marca
                  : pressed
                    ? cores.superficieAlt
                    : 'transparent',
                opacity: ativo && pressed ? 0.85 : 1,
              },
            ]}>
            {/* O ícone é decorativo (o `Icone` já sai escondido do leitor de
                tela): quem nomeia a aba é o rótulo. Um pouco mais grosso na
                ativa, pra o traço fino não se perder sobre o tomate. */}
            <Icone
              nome={icone}
              tamanho={24}
              cor={ativo ? cores.sobreMarca : cores.textoFraco}
              espessura={ativo ? 2.25 : 2}
            />
          </View>
          {/* Sem `lineHeight` fixo: o React Native escala `fontSize` com a fonte
              do sistema mas NÃO escala `lineHeight`, então um valor cravado
              cortava o glifo assim que alguém aumentava a fonte do aparelho --
              e quem trabalha em balcão é justamente quem costuma aumentar.

              O rótulo fica sempre visível, nunca só o ícone: são três telas que
              ela vai aprender uma vez, e uma prancheta sozinha não diz
              "Planejar". */}
          <Text
            style={{
              fontSize: Fonte.rotulo,
              color: ativo ? cores.texto : cores.textoFraco,
              fontWeight: ativo ? Peso.forte : Peso.medio,
            }}>
            {rotulo}
          </Text>
        </>
      )}
    </Pressable>
  );
});

ItemDeAba.displayName = 'ItemDeAba';

const estilos = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    // No desktop da apresentação, as abas esticadas em 1400 px viram menu de
    // site; centradas e com largura de celular, continuam barra de app.
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Espaco.sm,
    paddingHorizontal: Espaco.sm,
  },
  item: {
    flex: 1,
    maxWidth: LarguraMax / 4,
    minHeight: Touch.alvo,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Espaco.xs,
  },
  pilula: {
    width: LARGURA_PILULA,
    height: ALTURA_PILULA,
    borderRadius: Raio.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
