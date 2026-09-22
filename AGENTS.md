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
Isso inclui `TRUNCATE`, `REFERENCES` e `TRIGGER`, que as migrations antigas
tinham deixado passar e a seção 9 de `20260921120000` revoga: `TRUNCATE`
atravessa a RLS.

**A venda passa por `registrar_pedido()`, não por `INSERT` da tela.** Ela junta
2 hot-dogs e 1 suco num pedido só, e as colunas `vendas.pedido` e
`vendas.pagamento` NÃO têm `GRANT` de `INSERT` pra `authenticated` — quem grava
é a função. Com elas abertas, a tela gravaria forma de pagamento sem pedido, ou
o pedido de outra venda, e o "N vendas" do dia (que conta
`DISTINCT COALESCE(pedido, id)`) e a conferência da gaveta parariam de bater sem
erro nenhum. Desfazer um pedido é `cancelar_pedido()`, que chama
`cancelar_venda()` linha a linha em vez de reescrever o estorno.

**Venda antiga tem `pedido` e `pagamento` nulos, e é assim que fica.** Preencher
`'dinheiro'` "pra não ficar vazio" inventaria cédula em dia já fechado. A tela
lê o nulo como "sem forma" e o Histórico mostra a linha "Sem forma" quando a
soma das três não fecha com a receita do dia.

**`vendas.preco_unitario` e `vendas.custo_unitario` são fotografia.** Não troque
por `JOIN` com `produtos`/`ingredientes` "pra não duplicar dado": o fechamento
de um dia passado voltaria a mudar a cada compra nova.

**`src/lib/unidades.ts` espelha `unidade_base()`/`fator_base()` do banco.**
Mudar um lado sem o outro erra o estoque por mil. Quem decide de verdade é o
banco: `compra_itens.quantidade_base` e `.custo_base` são colunas `GENERATED`.

**Dia civil vem de `public.dia_local()`, nunca de `CURRENT_DATE`.** O servidor
roda em UTC, onde a venda das 21h30 de sábado já é domingo.

**A paleta é de lanchonete, e cada família tem DOIS tons.** Tomate (`marca`),
mostarda (`acao`), creme (`fundo`), marrom (`texto`), verde (`positivo`). O
tomate dá 3,96:1 sobre o creme e o verde da identidade 2,75:1 — nenhum dos dois
escreve. Por isso o tom vivo só PREENCHE (pílula da aba, borda do produto
escolhido, barra) e o tom escuro ESCREVE (`negativo`, `positivo`). `marca` como
cor de texto só no logotipo "Nany". Mexeu em `Cores` ou em `Grafico`, rode
`npm run checa-paleta`: ele lê os hex do próprio arquivo e cobra 7:1 pra texto
contra as TRÊS superfícies em que ele pode cair, 4,5:1 pro `placeholder` (a
única exceção: exemplo dentro do campo não é conteúdo, e na tinta do texto
digitado o campo parecia já preenchido) e 3:1 pra contorno, ícone e barra.

**Cor não carrega estado sozinha, mesmo agora que existe cor.** Tomate contra
verde é justamente o par que protanopia e deuteranopia confundem, e os dois têm
quase a mesma luminosidade (1,23:1 — o checador imprime na linha `info`). Então
estado vem sempre com símbolo (✓/✕/! no `Aviso`), palavra escrita ("prejuízo",
"lançar compra", "batida") ou textura. No `GraficoBarras` o dia de prejuízo tem
hachura E desce abaixo da linha de base; em "Por produto" a barra é vazada com
contorno. Tirar a hachura "porque agora tem cor" apaga a distinção pra quem não
enxerga a diferença de matiz.

**Onde a palavra "prejuízo" aparece, o número vai sem sinal** (`dinheiroSemSinal`
em `lib/formato.ts`); onde não aparece (Caixa), o menos fica. As duas coisas
juntas é negação dupla, e o mesmo dia chegou a aparecer de dois jeitos em duas
telas.

Antes desta versão a paleta foi preto e branco por um tempo, a pedido da dona.
A volta ao tomate/mostarda/creme também foi a pedido dela — o PI06 registra
"abandono do registro diário" como o risco mais alto, e uma tela que ela
reconhece como sua é parte de não ser abandonada.

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
a diferença é real (hidratação do export estático). Pelo mesmo motivo, estado
de acessibilidade vai em `aria-*` e não em `accessibilityState`: o
react-native-web 0.21 descarta esse objeto sem avisar, e o RN 0.86 entende as
duas formas.

**São TRÊS abas, e a quarta não volta.** Hoje (olhar), Vender (fazer), Planejar
(uma pilha com metas, semana, lucro, compras, gastos, estoque, produtos e
histórico). O que não responde "quanto vendi / quanto ganhei / preciso vender
agora / tem algo pedindo atenção" não fica na Hoje. `resetOnFocus` está
DESLIGADO no Planejar de propósito: a conferência de uma nota lida pelo Gemini
(que gasta cota) tem que sobreviver a uma ida ao Vender.

**"Hoje" vem do banco, nunca de `new Date()` na tela.** `hojeDaSerie()` lê o
último dia da série de `resumo_por_dia`, que termina em `dia_local()`. Com o
relógio do celular adiantado, a semana dela viraria num dia diferente do que o
fechamento soma.

# Verificação

```
npm run typecheck     # passa
npm run lint          # passa
npm run checa-paleta  # passa: 82 pares
npm run build:web     # passa; gera dist/ com as 13 rotas
```

A migration `20260921120000` (pedido, pagamento, metas, despesas) foi validada
num Postgres de verdade — PGlite, fora do repositório, 144 verificações,
incluindo os negativos (anônimo recusado, conta A não enxerga a B, estoque não
volta em dobro no segundo "Desfazer") e 11 mutações adulteradas que o teste
pegou. Mas **não foi aplicada no Supabase**: rode `supabase/aplicar-pedido.sql`
no SQL Editor ANTES de publicar o app novo, senão Vender, Histórico, Metas e
Gastos quebram (as RPCs e tabelas não existem lá).

Ainda não executados:

```
npx supabase db reset                                  # precisa de Docker
deno check supabase/functions/ler-notinha/index.ts     # precisa de Deno
```
