# Nany Lanches — controle de compras, vendas e lucro

App React Native (Expo) para a Nany Lanches (MEI), do Projeto Integrador I em TI.
Ela registra as vendas, anota os gastos (fotografando a nota do mercado, que a
IA lê, ou digitando o valor) e o app mostra quanto vendeu, quanto gastou e
quanto sobrou.

Responde ao problema validado no Documento 04: *"as informações de compras,
custos e vendas não são registradas de forma sistemática e ficam principalmente
na memória da empreendedora"*.

## Como roda nos dois lugares

Um código, duas saídas — é o que permite entregar "app de celular" e "link que
abre no navegador" sem manter dois projetos:

```
npm start                 # dev (celular via Expo Go, ou w para o navegador)
npx expo export -p web    # site estático em dist/ → Vercel, Netlify, Pages
npx eas build -p android  # APK, quando/se quiser instalar no celular dela
```

A Nany usa pelo navegador do celular: abre o link, sem instalar nada. A câmera
funciona igual — `expo-image-picker` vira `<input capture="environment">` no
navegador, que é o que abre a câmera direto no Android e no iOS.

## Configuração

### 1. Projeto Supabase

```bash
npx supabase link --project-ref SEU_REF
npx supabase db push                      # aplica as 6 migrations
npx supabase functions deploy ler-notinha
npx supabase secrets set GEMINI_API_KEY=sua-chave
```

A chave do Gemini sai de https://aistudio.google.com/apikey e **fica só no
Supabase**. Ela nunca entra no bundle: tudo que o app web carrega é legível no
DevTools de quem abrir a página.

### 2. Variáveis do app

```bash
cp .env.example .env      # preencha URL e anon key do seu projeto
```

No Vercel, cadastre as mesmas duas em *Settings → Environment Variables*.

### 3. Primeiro uso

1. Criar conta no app (e-mail e senha).
2. **Planejar → Produtos** → cadastrar "Hot-dog" a R$ 12,00 e "Suco" a R$ 6,00.
   Só nome e preço.
3. **Vender** → tocar nos produtos, escolher a forma de pagamento, finalizar.
4. **Anotar gasto** (na Hoje) → tirar foto da nota do mercado. O app lê o total;
   ela confere com o papel e salva. Gás, embalagem e o resto: digita o valor.
5. **Hoje** → quanto vendeu, quanto gastou e quanto sobrou.
6. **Painel** → os gráficos do período: vendas por dia, o que mais vende e
   quanto do que entrou foi embora em gasto.

Até a versão de novembro/2026 o app pedia a receita de cada produto
(ingrediente por ingrediente) e conferia a nota item a item, pra calcular o
custo de cada hot-dog. A dona achou complicado demais, e é por isso que saiu:
um app que ela abandona não registra nada.

Opcional, e é o que faz o Planejar valer: **Planejar → Metas** define quanto
vender por dia, semana ou mês. Com uma meta ativa, a Hoje mostra quanto falta
logo acima do botão Vender.

## Decisões que valem saber

**Lucro é vendas menos gastos.** É a conta que ela já faz de cabeça e não
depende de cadastro nenhum. Antes havia dois números — a margem dos
ingredientes (`lucro_vendas`) e o caixa —, mas a margem só existia com a receita
de cada produto montada, e sem ela saía igual ao preço cheio. No dia do mercado
o lucro do dia fica negativo, porque a compra cobre a semana: a Hoje diz "o
gasto rende outros dias", e o lucro da semana e do mês (Planejar, Painel) é
onde isso se dilui.

**O mercado é um gasto com o total da nota.** A foto vai pra IA, que devolve o
total impresso (e os itens, que a tela só conta). Ela confere um número só e
salva em `despesas`, junto com gás e embalagem. As compras antigas, lançadas
item por item, continuam somando no dia delas e aparecem na lista de Gastos.

**Uma venda é um pedido, não um toque.** Ela junta 2 hot-dogs e 1 suco, escolhe
Dinheiro, Pix ou Cartão e finaliza: sai uma linha em `vendas` por produto
(preço e custo são fotografados por produto), todas com o mesmo `pedido`. O "N
vendas" do dia conta `DISTINCT pedido`, então é o número de clientes atendidos,
que é o que ela confere de cabeça. A forma de pagamento existe pra fechar a
gaveta no fim do dia: quanto tem que ter em cédula, quanto caiu no Pix e quanto
está na maquininha. Venda de antes desta versão fica com pedido e forma nulos,
e o Histórico diz "Sem forma" em vez de inventar dinheiro.

**Preço e custo da venda são fotografia, não referência.** `vendas` guarda o
custo do momento em que a venda aconteceu. Quando a salsicha subir em novembro,
o lucro que o dashboard mostra para outubro não muda — senão o fechamento de um
dia fechado se reescreveria sozinho a cada compra nova.

**Custo do ingrediente é média ponderada móvel, não último preço.** O pão
comprado a R$ 0,50 e depois a R$ 0,60 custa algo entre os dois enquanto os dois
pacotes estão no estoque.

**Estoque pode ficar negativo, de propósito.** Ela registra venda no aperto da
tarde e lança a nota do mercado à noite. Barrar a venda por falta de saldo faria
o sistema atrapalhar mais do que ajudar. Saldo negativo é lido como "falta
lançar a compra" no dashboard.

**Toda aritmética de estoque mora em gatilho no Postgres, não na tela.** A
leitura por foto e o lançamento manual desembocam no mesmo `INSERT`, então a
conta escrita uma vez no banco garante que as duas portas chegam ao mesmo saldo.
Por isso a tela não tem `UPDATE`/`DELETE` em `compra_itens` nem em `vendas`:
desfazer passa por `cancelar_compra()` e `cancelar_venda()`, que estornam o
saldo na mesma transação.

**O dia civil é de Porto Alegre, não de UTC.** O servidor do Supabase roda em
UTC, onde uma venda das 21h30 de sábado já é domingo. Tudo que fecha o dia passa
por `public.dia_local()`.

**A cor é da lanchonete, e nenhuma informação depende dela.** Tomate, mostarda,
creme, marrom e verde — a paleta que a dona reconhece como sua. Mas tomate
contra verde é justamente o par que protanopia e deuteranopia confundem, e em
luminosidade os dois quase empatam (1,23:1). Então o estado vem sempre escrito
ou desenhado além da cor: o dia de prejuízo tem hachura E desce abaixo da linha
de base, a barra de um produto no prejuízo é vazada, o `Aviso` tem ✓ / ✕ / !, e
a palavra "prejuízo" fica ao lado do número. `npm run checa-paleta` mede os 82
pares (7:1 pra texto, 4,5:1 pro placeholder, 3:1 pra contorno e barra) lendo os
hex do próprio `theme.ts` — mas não mede matiz, e é por isso que nada acima
pode ser removido.

## O que veio do Almoxá

A leitura de notinha é portada de
[`almoxa/src/lib/intake.functions.ts`](../almoxa/src/lib/intake.functions.ts).
Mudou o que o contexto exigia:

| Almoxá (loja) | Aqui (lanchonete) |
|---|---|
| Extrai produto para revenda, com `sale_price` | Extrai **ingrediente**; quem tem preço de venda é o hot-dog, via receita |
| Quantidade sem unidade (em loja "2" é 2 peças) | Pede `unidade`: "2" pode ser 2 kg de salsicha ou 2 pacotes de pão |
| Não lê data nem fornecedor | Lê os dois — ela fotografa a nota de ontem hoje |
| `createServerFn` do TanStack Start | Edge Function em Deno |
| Estoque e receita em `products` com `is_ingredient` | Tabelas separadas: preço de compra e de venda nunca dividem coluna |

Mantido do original, porque cada um custou um bug lá: PDF vai como `image_url`
(a camada compatível-com-OpenAI do Gemini recusa content part `file`);
`dataUrl` tem que começar com `data:` (aceitar URL http faria a API do Google
buscar o endereço que o cliente escolher, com a nossa chave); cota por usuário
antes de chamar o modelo; e mensagem própria para 429/403/503.

## Estado da verificação

Projeto Supabase `vllnhhwlblszkmcvtgno`, verificado contra o servidor em 17/09/2026.

| O que | Situação |
|---|---|
| `npm run typecheck` | passa |
| `npm run lint` | passa |
| `npm run build:web` | passa — 10 rotas pré-renderizadas |
| `npm run checa-paleta` | passa — 82 pares de contraste |
| 5 migrations aplicadas | ✅ 7 tabelas e as RPCs respondendo |
| 6ª migration (pedido, pagamento, metas, gastos) | ✅ aplicada em 22/09/2026 pelo SQL Editor |
| 6ª migration testada | ✅ 144 verificações num Postgres real (PGlite), com negativos e 11 mutações adulteradas |
| RLS e permissões | ✅ anônimo recusado nas 6 funções de leitura; `cota_leitura` fechada para todos |
| `dia_local()` | ✅ devolveu a data civil correta, não a de UTC |
| Cadastro sem confirmação de e-mail | ✅ `signUp` devolve sessão na hora |
| Edge Function `ler-notinha` | ✅ publicada; recusa sem login (401), recusa `dataUrl` que não seja `data:` (400) |
| Cota por usuário | ✅ 31 requisições inválidas não consumiram nenhuma leitura |
| Leitura de nota pelo Gemini | ✅ testada ponta a ponta em 22/09/2026: cupom lido certo (4 ingredientes, sacola excluída, embalagem convertida em unidade de uso) |
| Tempo de leitura | 3,2 s e 18,1 s nas leituras boas, com o raciocínio do modelo desligado; era 32 s |
| Congestionamento do Gemini | ~1 em 3 chamadas volta 503 mesmo com 4 tentativas; o erro chega em ~78 s (era 146 s) |
| Edge Function type-checada | **não** — Deno não instalado; `deno check supabase/functions/ler-notinha/index.ts` |
| Fluxo na mão da Nany | **não testado** — falta produto, receita e uma nota de verdade |

Restam duas contas de teste descartáveis em Authentication → Users
(`teste.claude.*@exemplo-descartavel.com`), criadas para essa verificação.
Podem ser apagadas.

## Estrutura

```
src/
  app/
    _layout.tsx   as 4 abas (expo-router/ui) e o portão de login
    index.tsx     Hoje
    vender.tsx    Vender
    painel.tsx    Painel
    planejar/     hub + gastos, produtos, metas, histórico (pilha própria)
  components/     ui.tsx (primitivas), icone.tsx, grafico-barras.tsx, tela-login.tsx
  lib/
    notinha.ts    câmera → compressão → Edge Function → total da nota
    dados.ts      tipos e hooks de consulta/gravação
    periodo.ts    semana, mês e meta (funções puras)
    unidades.ts   unidade-base (espelha unidade_base()/fator_base() do banco)
    formato.ts    dinheiro, quantidade e data em pt-BR
  constants/
    theme.ts      cores, espaçamento, alvos de toque, paleta do gráfico
supabase/
  migrations/     6 migrations: base, compras/vendas, dashboard,
                  registrar_compra, revenda, pedido/pagamento/metas/gastos
  functions/
    ler-notinha/  a leitura por IA (Deno)
```
