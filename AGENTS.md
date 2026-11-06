# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Nany Lanches — invariantes

O `README.md` explica o produto e o *porquê* das decisões. Isto aqui é a lista
curta do que se quebra em silêncio: coisas que parecem melhorias e não são.

**O app NÃO pede ingrediente, receita nem estoque — e isso é decisão da dona.**
Ela achou a versão anterior complicada demais (a nota conferida item por item,
com quantidade, unidade e preço; a receita de cada hot-dog montada ingrediente
a ingrediente). Agora produto é só nome e preço, e o mercado é um GASTO com o
total da nota (`despesas`, descrição "Mercado · <onde>"), lido pela foto ou
digitado. Não traga de volta tela de receita, estoque ou "lista de compras"
como melhoria: foi exatamente o que a fez travar. O banco continua com as
tabelas e os gatilhos (compra antiga e receita antiga seguem valendo por
baixo), mas nada novo entra em `compras`/`compra_itens`.

**Lucro é vendas menos gastos, em TODA tela.** `lucroDe()` em `lib/dados.ts`:
`receita − compras − despesas` do período. `lucro_vendas` (a margem dos
ingredientes) não aparece mais em lugar nenhum — sem receita cadastrada ela
sai igual ao preço cheio, que é um número bonito e falso. No dia do mercado o
lucro do dia fica negativo; a Hoje explica com "o gasto rende outros dias", e
é na semana/mês (Planejar, Painel) que a compra se dilui. Não troque por
`lucro_vendas` "porque é o lucro de verdade": só seria com receita, e receita
é o que ela não vai cadastrar.

**A aritmética de estoque mora em gatilho no Postgres, não na tela.** Nenhuma
tela mostra mais estoque, mas a venda de um produto que ainda tem receita
antiga continua baixando saldo, e o "Apagar" de uma compra antiga em Gastos
estorna. Se o saldo vier errado, o erro está em `aplica_compra()`,
`baixa_receita()` ou `cancelar_*()` — não na tela.

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

**A foto da nota grava o TOTAL impresso, não a soma dos itens.** A Edge
Function devolve `total` (sacola e desconto incluídos) e `totalDaNota()` só
soma os itens quando ele não vem — que é o caso da função publicada antes deste
campo. A tela mostra um número só, pra ela conferir com o papel. Data do gasto
é escolhida por toque (Hoje / Ontem / a data da nota) e vai pro banco como
`AAAA-MM-DD`: texto "10/09/2026" o Postgres lê como mês/dia.

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

**São QUATRO abas, e cada uma tem um verbo.** Hoje (olhar o dia), Vender
(fazer), Painel (olhar o período) e Planejar (mexer: gastos, produtos, metas,
histórico — numa pilha). Começou com três; o Painel entrou depois, a pedido da
dona, e levou junto a tela Lucro. O Planejar já teve sete itens (com Semana,
Compras e Estoque) e ela se perdia; ficaram quatro. A regra da Hoje: o que não
responde "quanto vendi / quanto gastei e sobrou / preciso vender agora" NÃO
fica lá. Cinco abas não cabem — em 360 px o rótulo quebra.

`resetOnFocus` está DESLIGADO no Planejar de propósito: a conferência de uma
nota lida pelo Gemini (que gasta cota), em Gastos, tem que sobreviver a uma ida
ao Vender.

**Uma mostarda por tela.** `Botao variante="primaria"` é a resposta pra "o que
eu faço aqui?", e duas respostas não respondem nada. Por isso o atalho
"Anotar gasto" é `secundaria` na Hoje e no Painel, mesmo sendo metade da conta
do lucro: no aperto da tarde, quem tem que gritar é o Vender. Em Gastos a
mostarda é "Tirar foto da nota"; o "Anotar gasto" digitado é `secundaria`.

**A chuva de hot-dogs nunca atrasa um toque.** `ChuvaDeHotdogs` é sempre
`pointerEvents: 'none'` e sempre desenhada POR CIMA de uma tela já pronta --
nada espera a animação terminar. Ela some inteira pra quem liga "reduzir
movimento" no sistema (`useAnimacaoReduzida`), e nesse caso a transição avisa
`aoTerminar` na hora, senão a camada ficaria pendurada. Só `transform` e
`opacity`, que não refazem layout no aparelho de entrada dela. E a espera com
chuva mora SÓ na leitura da nota, que leva de 3 a 18 s medidos: nas esperas
curtas, `Carregando` continua sendo o indicador de sempre.

**O desenho (`hotdog.tsx`) é separado da animação (`chuva-de-hotdogs.tsx`).**
Quem só quer a figura não carrega o Reanimated junto -- e o Reanimated 4 estoura
ao ser importado onde o plugin de worklets não roda, o que derruba o módulo
inteiro. O plugin vem do `babel-preset-expo` sozinho, porque
`react-native-worklets` está instalado; não há `babel.config.js` no projeto e
não precisa haver.

**"Hoje" vem do banco, nunca de `new Date()` na tela.** `hojeDaSerie()` lê o
último dia da série de `resumo_por_dia`, que termina em `dia_local()`. Com o
relógio do celular adiantado, a semana dela viraria num dia diferente do que o
fechamento soma.

# Verificação

```
npm run typecheck     # passa
npm run lint          # passa
npm run checa-paleta  # passa: 82 pares
npm run build:web     # passa; gera dist/ com as 10 rotas
```

A migration `20260921120000` (pedido, pagamento, metas, despesas) foi validada
num Postgres de verdade — PGlite, fora do repositório, 144 verificações,
incluindo os negativos (anônimo recusado, conta A não enxerga a B, estoque não
volta em dobro no segundo "Desfazer") e 11 mutações adulteradas que o teste
pegou. Ela **já foi aplicada** no projeto `vllnhhwlblszkmcvtgno` em 22/09/2026,
pelo SQL Editor (`supabase/aplicar-pedido.sql`). Em outro banco, aplique ANTES
de publicar o app: sem ela, Vender, Histórico, Metas e Gastos quebram, porque
as RPCs e tabelas não existem.

A Edge Function `ler-notinha` foi publicada em 22/09/2026 com o raciocínio do
modelo desligado (`reasoning_effort: none`, ajustável pelo secret
`GEMINI_ESFORCO`), teto de saída e orçamento de tempo. Medido contra a API de
verdade: leitura boa em 3,2 s e 18,1 s (era 32 s); quando o Gemini congestiona
— ~1 em 3 chamadas — o erro chega em ~78 s (era 146 s).

A versão simplificada (gasto pelo total, sem receita/estoque) mudou a Edge
Function pra devolver `total`. Até ela ser publicada de novo
(`npx supabase functions deploy ler-notinha`), o app funciona com a soma dos
itens, que costuma dar alguns centavos a menos que a nota.

Ainda não executados:

```
npx supabase db reset                                  # precisa de Docker
deno check supabase/functions/ler-notinha/index.ts     # precisa de Deno
```
