/**
 * Leitura da notinha por IA — portado de `src/lib/intake.functions.ts` do
 * Almoxá para Edge Function (Deno).
 *
 * POR QUE NO SERVIDOR: a GEMINI_API_KEY não pode ir pro celular. Tudo que o
 * app web embarca é legível no DevTools, e uma chave vazada é cota da Nany
 * (e conta do Ricardo) na mão de qualquer um. O celular manda a foto, esta
 * função fala com o Gemini.
 *
 * O QUE MUDOU NA PORTAGEM (o Almoxá lê estoque de loja; aqui é lanchonete):
 *
 *  - Extrai INGREDIENTE comprado, não produto pra revenda. Pão e salsicha não
 *    têm preço de venda -- quem tem é o hot-dog, cadastrado à parte com a
 *    receita. O campo `sale_price` do Almoxá simplesmente não existe aqui, em
 *    vez de vir sempre 0 e sujar a conferência.
 *  - Pede `unidade` junto da quantidade. Numa loja "2" é sempre 2 peças; numa
 *    lanchonete "2" pode ser 2 kg de salsicha ou 2 pacotes de pão, e sem a
 *    unidade o estoque erra por mil.
 *  - Pede `fornecedor` e `data` da nota. Ela fotografa a nota de ontem hoje, e
 *    o fechamento do dia tem que lançar a despesa no dia certo (`comprada_em`).
 *
 * O QUE FOI MANTIDO DE PROPÓSITO (cada um custou um bug lá):
 *
 *  - PDF vai como `image_url`, não como content part `file`: a camada
 *    compatível-com-OpenAI do Gemini não conhece `file` e devolve 400
 *    "Invalid content part type" -- ou seja, TODA nota em PDF falharia.
 *  - `dataUrl` tem que começar com "data:". Aceitar URL http faria a API do
 *    Google buscar o endereço que o cliente escolher, com a nossa chave.
 *  - Cota por usuário ANTES de chamar o Gemini.
 *  - 429/403/503 têm mensagem própria: mandar ela tirar outra foto quando o
 *    modelo está congestionado não resolve nada e queima outra leitura.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { z } from 'npm:zod@3.25.76';

const MAX_ARQUIVOS = 4;
// ~6 MB de arquivo real, já descontando o crescimento de 4/3 do base64. Uma
// foto de celular comprimida pelo app fica bem abaixo disso.
const MAX_DATA_URL = 8_000_000;

const MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const;

const entrada = z.object({
  arquivos: z
    .array(
      z.object({
        nome: z.string().max(300),
        mimeType: z.enum(MIMES, { message: 'Tipo de arquivo não suportado.' }),
        dataUrl: z
          .string()
          .max(MAX_DATA_URL, { message: 'Arquivo grande demais.' })
          .refine((v) => v.startsWith('data:'), { message: 'Arquivo inválido.' }),
      }),
    )
    .min(1)
    .max(MAX_ARQUIVOS),
});

const UNIDADES = ['unidade', 'g', 'kg', 'ml', 'l'] as const;

const ferramenta = {
  type: 'function' as const,
  function: {
    name: 'registrar_compra',
    description: 'Registra os ingredientes comprados que aparecem na nota ou no cupom.',
    parameters: {
      type: 'object',
      properties: {
        fornecedor: {
          type: 'string',
          description: 'Nome do mercado/fornecedor no topo da nota. Vazio se não aparecer.',
        },
        data: {
          type: 'string',
          description: 'Data da compra no formato AAAA-MM-DD. Vazio se não aparecer na nota.',
        },
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nome: {
                type: 'string',
                description:
                  'Nome do ingrediente, limpo de códigos e abreviações do cupom. ' +
                  'Ex.: "SALSICHA HOT DOG PERD 500G" vira "Salsicha".',
              },
              quantidade: {
                type: 'number',
                description: 'Quantidade comprada, na unidade escolhida. 1 se não informado.',
              },
              unidade: {
                type: 'string',
                enum: UNIDADES,
                description:
                  'Unidade da quantidade: "unidade" para itens contáveis (pão, salsicha, ' +
                  'garrafa), "kg"/"g" para peso, "l"/"ml" para volume.',
              },
              preco_unitario: {
                type: 'number',
                description:
                  'Preço de UMA unidade da medida escolhida, em reais decimais. ' +
                  'Se a nota só traz o total da linha, divida pela quantidade.',
              },
              observacao: {
                type: 'string',
                description: 'Marca, embalagem ou detalhe curto. Vazio se não houver.',
              },
            },
            required: ['nome', 'quantidade', 'unidade', 'preco_unitario', 'observacao'],
            additionalProperties: false,
          },
        },
      },
      required: ['fornecedor', 'data', 'itens'],
      additionalProperties: false,
    },
  },
};

const PROMPT = `Você lê notas de compra de uma lanchonete brasileira (hot-dogs e sucos).
Extraia os ingredientes comprados com máxima precisão.

Regras:
- Valores em número decimal (ex: 12.5), sem "R$" nem separador de milhar.
- Se a linha traz só o total, divida pela quantidade para achar o preço unitário.
- Converta embalagem em conteúdo quando a nota disser: "1 pacote de 50 pães" são
  50 unidades a preço unitário do pão (total do pacote dividido por 50), não 1 pacote.
- "500G", "1KG", "2L" no nome do produto são a EMBALAGEM, não a quantidade comprada:
  2 pacotes de salsicha de 500 g são 1 kg no total.
- Ignore linhas que não são ingrediente: sacola, desconto, troco, taxa, total da nota.
- Nome limpo e curto, do jeito que ela chamaria no balcão ("Pão", "Salsicha", "Molho").
- Nunca invente preço: se não houver preço na nota, use 0.
- Sempre chame registrar_compra, mesmo que encontre um único item.`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const erro = (mensagem: string, status: number) => json({ erro: mensagem }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return erro('Método não permitido.', 405);

  // ---- Autenticação -------------------------------------------------------
  // O token do usuário é repassado ao PostgREST para que `consome_cota_leitura()`
  // rode como ela: a cota é por conta, e sem o token a função contaria tudo
  // numa conta só (ou em nenhuma).
  const autorizacao = req.headers.get('Authorization');
  if (!autorizacao) return erro('Faça login para usar a leitura.', 401);

  // Aceita os dois nomes: o projeto migrou pro sistema novo de chaves
  // (`sb_publishable_`/`sb_secret_`), e desabilitar as chaves legadas pode
  // trocar qual variável a plataforma injeta aqui. Ler só uma delas daria uma
  // função que para de autenticar no dia em que as chaves antigas caírem --
  // com erro de sessão, que manda investigar login em vez de ambiente.
  const chavePublica =
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', chavePublica, {
    global: { headers: { Authorization: autorizacao } },
  });

  const { data: usuario, error: erroAuth } = await db.auth.getUser();
  if (erroAuth || !usuario?.user) return erro('Sessão expirada. Entre de novo.', 401);

  // ---- Entrada ------------------------------------------------------------
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return erro('Requisição inválida.', 400);
  }

  const validado = entrada.safeParse(corpo);
  if (!validado.success) {
    return erro(validado.error.issues[0]?.message ?? 'Arquivo inválido.', 400);
  }

  const chave = Deno.env.get('GEMINI_API_KEY');
  if (!chave) {
    console.error('GEMINI_API_KEY ausente');
    return erro('Serviço de leitura indisponível.', 503);
  }

  // ---- Cota ---------------------------------------------------------------
  // DEPOIS de validar o arquivo e de confirmar que a chave existe, não antes.
  //
  // O Almoxá cobra a cota logo após a autenticação, e portar essa ordem foi um
  // erro que só apareceu testando contra o servidor: uma requisição com
  // `dataUrl` inválida era recusada com 400 -- e a leitura dela já tinha sido
  // debitada, sem nunca chegar ao Gemini.
  //
  // A cota existe pra proteger UM recurso: a chamada paga ao Gemini. Cobrar
  // por uma requisição que morre na validação não protege nada e gasta o que
  // ela tem: uma foto grande demais, ou um 503 de serviço mal configurado,
  // comia uma das 30 leituras da hora dela sem ler nota nenhuma.
  //
  // Contra abuso isso não afrouxa nada: quem manda lixo em massa nunca alcança
  // o Gemini de qualquer forma, e a cota continua sendo a última porta antes
  // da única chamada que custa dinheiro.
  const { data: liberado, error: erroCota } = await db.rpc('consome_cota_leitura');
  if (erroCota) {
    console.error('cota', erroCota.message);
    return erro('Não foi possível validar a leitura agora.', 500);
  }
  // Mensagem distinta da do 429 do Google, logo abaixo. As duas eram idênticas
  // ("Muitas leituras seguidas"), e isso escondeu um diagnóstico durante o
  // teste: passei minutos achando que a cota daqui tinha estourado quando o
  // limite atingido era o da conta gratuita do Gemini. São causas diferentes e
  // com saídas diferentes -- uma passa esperando, a outra pede outro plano.
  if (!liberado) {
    return erro('Você já fez muitas leituras nesta hora. Tente mais tarde.', 429);
  }

  // ---- Gemini -------------------------------------------------------------
  const conteudo: unknown[] = [
    {
      type: 'text',
      text: 'Esta é a nota/cupom da compra de ingredientes. Liste tudo que foi comprado.',
    },
  ];
  for (const arquivo of validado.data.arquivos) {
    conteudo.push({ type: 'image_url', image_url: { url: arquivo.dataUrl } });
  }

  /**
   * PENSAMENTO DO MODELO DESLIGADO, e é daqui que sai a velocidade.
   *
   * Nos flash da família 3.x o "thinking" vem ligado por padrão: antes de
   * responder, o modelo gasta tokens raciocinando, e isso é a maior fatia do
   * tempo de uma leitura. A camada compatível-com-OpenAI expõe isso em
   * `reasoning_effort`, e `none` desliga.
   *
   * Ler cupom não precisa de raciocínio longo: é transcrever o que está escrito
   * e aplicar as regras do PROMPT. Quem confere o resultado é ela, na tela de
   * conferência, que existe justamente porque a leitura pode errar.
   *
   * `GEMINI_ESFORCO` deixa voltar atrás sem publicar de novo: `low` traz um
   * pouco de raciocínio, e qualquer outro valor (ex.: `padrao`) manda o pedido
   * sem o campo, que é o comportamento de antes.
   */
  const ESFORCO = Deno.env.get('GEMINI_ESFORCO') ?? 'none';
  const PEDE_ESFORCO = ESFORCO === 'none' || ESFORCO === 'low' || ESFORCO === 'medium';

  /**
   * Teto de saída. A resposta é UMA chamada de ferramenta com os itens da nota:
   * 60 itens (o teto de `registrar_compra`) cabem folgados em 4096. Existe pra
   * uma resposta que desande não ficar gerando até o timeout -- e não pra
   * cortar nota grande, que truncada quebraria o JSON da ferramenta.
   */
  const MAX_SAIDA = 4096;

  const montarCorpo = (comEsforco: boolean) =>
    JSON.stringify({
      model: Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash',
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: conteudo },
      ],
      tools: [ferramenta],
      tool_choice: { type: 'function', function: { name: 'registrar_compra' } },
      max_tokens: MAX_SAIDA,
      ...(comEsforco && PEDE_ESFORCO ? { reasoning_effort: ESFORCO } : {}),
    });

  let comEsforco = PEDE_ESFORCO;
  let corpoGemini = montarCorpo(comEsforco);

  // RETRY, e ele é a diferença entre o app servir e não servir.
  //
  // Medido contra a API de verdade com esta mesma nota: `gemini-3.6-flash`
  // devolveu 503 "overloaded" em 3 de 4 chamadas na primeira medição e 1 de 3
  // na segunda -- perto de metade. Sem retry, a Nany fotografa a nota e vê
  // "está congestionada" na maioria das vezes; ela desiste do app na primeira
  // tarde, que é exatamente o risco de abandono do PI06.
  //
  // Trocar de modelo NÃO resolve: `gemini-3.8-flash` deu 503 em 3 de 3, e
  // `gemini-2.5-flash` responde 404 nesta rota (está na lista de modelos, mas
  // o endpoint compatível-com-OpenAI não o serve). O 3.6 é o melhor
  // disponível; o que falta é insistir.
  //
  // Só 503 e falha de rede são repetidos. 429 é cota estourada e repetir piora;
  // 403 é chave inválida e não melhora sozinho; 4xx é problema do pedido.
  //
  // A cota dela é debitada UMA vez, acima, não por tentativa: as tentativas são
  // a mesma leitura insistindo, não leituras novas.
  const TENTATIVAS = 4;
  /**
   * Orçamento de tempo, medido contra a API de verdade.
   *
   * Uma leitura que dá certo volta em ~30 s; o que passa muito disso não está
   * lendo, está pendurado. Eram 35 s por tentativa e nenhum teto total, e o
   * pior caso somava 146 s -- dois minutos e meio de "Lendo a nota…" pra no fim
   * dizer que não deu. Com 20 s por tentativa e 75 s de teto, o pior caso cabe
   * em pouco mais de um minuto e ela volta a decidir o que fazer.
   *
   * O teto é conferido ANTES de cada tentativa: começar uma que não caberia no
   * prazo só adia a mensagem de erro.
   */
  const TIMEOUT_MS = 20_000;
  const PRAZO_TOTAL_MS = 75_000;
  const comecou = Date.now();
  let resposta: Response | null = null;
  let ultimaFalha = '';

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa += 1) {
    const sobrando = PRAZO_TOTAL_MS - (Date.now() - comecou);
    if (tentativa > 1 && sobrando < 3_000) {
      ultimaFalha = `${ultimaFalha} (prazo esgotado)`;
      break;
    }

    // Timeout por tentativa: as falhas rápidas (503 em 2-4 s) precisam liberar
    // a vez pra próxima, e uma chamada pendurada não pode consumir o tempo de
    // execução da função inteira sem nunca deixar tentar de novo.
    const aborta = new AbortController();
    const relogio = setTimeout(() => aborta.abort(), Math.min(TIMEOUT_MS, Math.max(sobrando, 1)));

    try {
      const r = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
          body: corpoGemini,
          signal: aborta.signal,
        },
      );

      // 400 com `reasoning_effort` no corpo: modelo que não aceita o campo.
      // Repete UMA vez sem ele, em vez de transformar uma opção de desempenho
      // em leitura perdida -- a cota dela já foi debitada lá em cima.
      if (r.status === 400 && comEsforco) {
        console.error('Gemini 400 com reasoning_effort; repetindo sem', (await r.text()).slice(0, 200));
        comEsforco = false;
        corpoGemini = montarCorpo(false);
        continue;
      }

      if (r.ok || (r.status !== 503 && r.status < 500)) {
        resposta = r; // sucesso, ou erro que repetir não conserta
        break;
      }
      ultimaFalha = `HTTP ${r.status}`;
      console.error('Gemini', r.status, (await r.text()).slice(0, 300));
    } catch (falha) {
      // AbortError (estourou o timeout) ou rede: vale insistir.
      ultimaFalha = falha instanceof Error ? falha.name : 'erro de rede';
      console.error('fetch Gemini', ultimaFalha);
    } finally {
      clearTimeout(relogio);
    }

    if (tentativa < TENTATIVAS) {
      // Backoff curto com jitter. Curto porque ela está olhando a tela; jitter
      // pra duas fotos mandadas juntas não voltarem a bater no mesmo instante.
      const espera = 600 * 2 ** (tentativa - 1) + Math.random() * 400;
      await new Promise((pronto) => setTimeout(pronto, espera));
    }
  }

  if (resposta === null) {
    console.error('Gemini esgotou as tentativas', ultimaFalha);
    return erro('A leitura está congestionada. Tente de novo em alguns segundos.', 503);
  }

  // Aqui só chega 4xx: o laço acima repete todo 5xx e, se esgotar, já saiu com
  // 503 logo acima. Por isso não há mais um ramo pra 503 nesta altura -- ele
  // seria código morto, do tipo que faz alguém depois achar que 503 é tratado
  // aqui e mexer no lugar errado.
  if (!resposta.ok) {
    console.error('Gemini', resposta.status, (await resposta.text()).slice(0, 300));
    // 429 do Google, não da cota desta conta: o limite da chave do Gemini
    // (requisições por minuto / por dia do plano). Texto próprio pra quem lê o
    // log saber de qual dos dois limites se trata.
    if (resposta.status === 429) {
      return erro('O serviço de leitura atingiu o limite do plano. Tente mais tarde.', 429);
    }
    if (resposta.status === 403) return erro('Chave da leitura inválida ou sem permissão.', 502);
    return erro('Não consegui ler esta nota. Tente uma foto mais nítida.', 422);
  }

  const payload = (await resposta.json()) as {
    choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
  };
  const bruto = payload.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!bruto) return erro('Nenhum ingrediente foi identificado na nota.', 422);

  let lido: unknown;
  try {
    lido = JSON.parse(bruto);
  } catch {
    return erro('A leitura veio incompleta. Tente novamente.', 422);
  }

  const saida = z
    .object({
      fornecedor: z.string().default(''),
      data: z.string().default(''),
      itens: z.array(
        z.object({
          nome: z.string().default(''),
          quantidade: z.coerce.number().default(1),
          unidade: z.enum(UNIDADES).catch('unidade'),
          preco_unitario: z.coerce.number().default(0),
          observacao: z.string().default(''),
        }),
      ),
    })
    .safeParse(lido);

  if (!saida.success) return erro('A leitura veio incompleta. Tente novamente.', 422);

  // Toda saída do modelo é limpa e limitada antes de virar resposta: nome
  // gigante, quantidade negativa e preço absurdo são saída plausível de um
  // modelo com uma foto ruim, e a tela de conferência não deve ter que
  // defender contra isso.
  const itens = saida.data.itens
    .filter((item) => item.nome.trim().length > 0)
    .slice(0, 40)
    .map((item) => ({
      nome: item.nome.trim().slice(0, 120),
      quantidade: item.quantidade > 0 ? Number(item.quantidade.toFixed(3)) : 1,
      unidade: item.unidade,
      preco_unitario: Math.max(0, Number(item.preco_unitario.toFixed(2))),
      observacao: item.observacao.trim().slice(0, 160),
    }));

  if (itens.length === 0) return erro('Nenhum ingrediente foi identificado na nota.', 422);

  // Data só passa se for uma AAAA-MM-DD de verdade e não estiver no futuro: o
  // modelo às vezes devolve a data de validade do produto ou inventa o ano, e
  // uma compra lançada em 2027 desapareceria do fechamento sem deixar rastro.
  const hoje = new Date().toISOString().slice(0, 10);
  const data = /^\d{4}-\d{2}-\d{2}$/.test(saida.data.data) && saida.data.data <= hoje
    ? saida.data.data
    : '';

  return json({ fornecedor: saida.data.fornecedor.trim().slice(0, 160), data, itens });
});
