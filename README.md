# Nany Lanches — controle de compras, vendas e lucro

App React Native (Expo) para a Nany Lanches (MEI), do Projeto Integrador I em TI.
Ela fotografa a nota do mercado, a IA extrai os ingredientes, e o app calcula o
custo por produto e o resultado do dia.

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
npx supabase db push                      # aplica as 4 migrations
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
2. Aba **Cadastro** → cadastrar "Hot-dog" a R$ 10,00 e "Suco" a R$ 5,00.
3. Aba **Notinha** → fotografar uma nota do mercado. Os ingredientes entram com
   preço e quantidade; confira antes de salvar.
4. Voltar ao **Cadastro** → abrir o hot-dog e montar a receita (1 pão, 1
   salsicha, 20 g de molho). É isso que faz o custo existir.
5. Aba **Vender** → tocar no produto a cada venda.
6. Aba **Hoje** → o fechamento e o gráfico.

O passo 4 é o que a maioria pula, e sem ele o lucro aparece igual ao preço
cheio. O app avisa em cada produto sem receita, em vez de mostrar um número
bonito e falso.

## Decisões que valem saber

**Lucro e caixa são dois números diferentes, e os dois aparecem.** `lucro_vendas`
é a receita menos o custo dos ingredientes que as vendas do dia consumiram — a
margem do negócio. `caixa` é o que entrou de venda menos o que ela pagou de
compra naquele dia. Num dia de feira o caixa afunda mesmo com a lanchonete
vendendo bem, porque a compra cobre a semana. Mostrar só o caixa faria um dia
normal parecer prejuízo; mostrar só a margem esconderia o aperto que ela sente
de verdade.

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

**As cores do gráfico foram calculadas, não escolhidas.** Verde para lucro e
âmbar para custo era a ideia óbvia e reprovou: ΔE 5,6 no protan, ou seja, as
duas partes da barra viram a mesma cor para a deficiência de visão de cor mais
comum entre homens. O par em uso (`#C0611F` / `#1F8D5C` no claro, `#D97534` /
`#2AAE74` no escuro) passa os seis testes de paleta. A cor nunca carrega a
informação sozinha: legenda fixa, 2 px de fundo entre os segmentos e os valores
escritos ao tocar a barra.

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
| `npm run build:web` | passa — 4 rotas pré-renderizadas |
| 5 migrations aplicadas | ✅ 7 tabelas e as RPCs respondendo |
| RLS e permissões | ✅ anônimo recusado nas 6 funções de leitura; `cota_leitura` fechada para todos |
| `dia_local()` | ✅ devolveu a data civil correta, não a de UTC |
| Cadastro sem confirmação de e-mail | ✅ `signUp` devolve sessão na hora |
| Edge Function `ler-notinha` | ✅ publicada; recusa sem login (401), recusa `dataUrl` que não seja `data:` (400) |
| Cota por usuário | ✅ 31 requisições inválidas não consumiram nenhuma leitura |
| Leitura de nota real pelo Gemini | **não testada** — falta `supabase secrets set GEMINI_API_KEY` |
| Edge Function type-checada | **não** — Deno não instalado; `deno check supabase/functions/ler-notinha/index.ts` |
| Fluxo na mão da Nany | **não testado** — falta produto, receita e uma nota de verdade |

Restam duas contas de teste descartáveis em Authentication → Users
(`teste.claude.*@exemplo-descartavel.com`), criadas para essa verificação.
Podem ser apagadas.

## Estrutura

```
src/
  app/            telas (expo-router: Hoje, Vender, Notinha, Cadastro)
  components/     ui.tsx (primitivas), grafico-dias.tsx, tela-login.tsx
  lib/
    notinha.ts    câmera → compressão → Edge Function
    dados.ts      tipos e hooks de consulta/gravação
    unidades.ts   unidade-base (espelha unidade_base()/fator_base() do banco)
    formato.ts    dinheiro, quantidade e data em pt-BR
  constants/
    theme.ts      cores, espaçamento, alvos de toque, paleta do gráfico
supabase/
  migrations/     4 migrations: base, compras/vendas, dashboard, registrar_compra
  functions/
    ler-notinha/  a leitura por IA (Deno)
```
