# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Nany Lanches — invariantes

O `README.md` explica o produto e o *porquê* das decisões. Isto aqui é a lista
curta do que se quebra em silêncio: coisas que parecem melhorias e não são.

**A aritmética de estoque mora em gatilho no Postgres, não na tela.** Se o
saldo de um ingrediente vier errado, o erro está em `aplica_compra()`,
`baixa_receita()` ou `cancelar_*()` — não na tela. Corrigir na tela cria duas
verdades, porque a leitura por foto e o lançamento manual passam pelo mesmo
`INSERT`.

**Os `REVOKE` nas migrations são deliberados.** A tela não tem `UPDATE`/`DELETE`
em `compra_itens`, em `vendas` nem nas colunas `estoque_base`/`custo_base` de
`ingredientes`. Não são esquecimento de `GRANT`: os gatilhos são `AFTER INSERT`,
então um `UPDATE` direto muda o total sem mexer no saldo, e um `DELETE` deixa
estoque que nunca foi comprado. Desfazer passa por `cancelar_compra()` e
`cancelar_venda()`. E lembre que o Supabase concede `ALL` em tabela nova por
*default privileges* — sem o `REVOKE`, `GRANT` por coluna não restringe nada.

**`vendas.preco_unitario` e `vendas.custo_unitario` são fotografia.** Não troque
por `JOIN` com `produtos`/`ingredientes` "pra não duplicar dado": o fechamento
de um dia passado voltaria a mudar a cada compra nova.

**`src/lib/unidades.ts` espelha `unidade_base()`/`fator_base()` do banco.**
Mudar um lado sem o outro erra o estoque por mil. Quem decide de verdade é o
banco: `compra_itens.quantidade_base` e `.custo_base` são colunas `GENERATED`.

**Dia civil vem de `public.dia_local()`, nunca de `CURRENT_DATE`.** O servidor
roda em UTC, onde a venda das 21h30 de sábado já é domingo.

**A paleta é preto e branco, e isso tem consequência.** Mexeu em `Cores` ou em
`Grafico` no `constants/theme.ts`, rode `npm run checa-paleta`: ele lê os hex do
próprio arquivo e cobra 7:1 pra texto contra as TRÊS superfícies em que ele pode
cair, e 3:1 pra contorno de campo e barra de gráfico. Sem matiz, estado NUNCA
viaja sozinho -- onde havia cor agora tem símbolo (✓/✕/! no `Aviso`), palavra
escrita ("prejuízo" ao lado do número) ou textura. E `Grafico.prejuizo` é IGUAL
a `Grafico.lucro` de propósito: o que separa os dois é a hachura no gráfico de
dias e a barra vazada em "Por produto". "Arrumar" essa igualdade apaga a única
distinção que sobrou.

A paleta antiga era de lanchonete (tomate, mostarda, brasa), escolhida porque o
PI06 registra "abandono do registro diário" como o risco mais alto. Foi trocada
a pedido da dona do app, não por acidente.

**A `GEMINI_API_KEY` nunca vai pro cliente.** Só `EXPO_PUBLIC_*` entra no
bundle, e tudo ali é legível no DevTools. Na Edge Function, três detalhes que
já custaram bug no Almoxá: PDF vai como `image_url` (a camada
compatível-com-OpenAI recusa content part `file`); `dataUrl` tem que começar com
`data:` (URL `http` faria a API do Google buscar o endereço que o cliente
escolher, com a nossa chave); e a cota por usuário roda antes de chamar o
modelo.

**Uma implementação só para web e nativo.** Sem `.web.tsx` em `components/` —
o template vinha com `app-tabs.tsx` + `app-tabs.web.tsx` e os dois foram
trocados por `expo-router/ui`. As duas exceções são `use-color-scheme.*`, onde
a diferença é real (hidratação do export estático).

# Verificação

```
npm run typecheck     # passa
npm run lint          # passa
npm run build:web     # passa; gera dist/ com as 4 rotas
```

Migrations e Edge Function **não** foram executadas (faltavam Docker e Deno na
máquina onde foram escritas):

```
npx supabase db reset                                  # valida as migrations
deno check supabase/functions/ler-notinha/index.ts     # valida a função
```
