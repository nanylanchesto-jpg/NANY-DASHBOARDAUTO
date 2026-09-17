
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.cwd();

/** Decodifica o payload de um JWT sem validar assinatura -- so pra ler `role`. */
function papelDoJwt(valor) {
  const partes = valor.split('.');
  if (partes.length !== 3) return null;
  try {
    // base64url -> base64 antes de decodificar.
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** Por que este valor nao pode ser publico, ou null se pode. */
function motivoDeRisco(valor) {
  const limpo = valor.trim().replace(/^["']|["']$/g, '');
  if (!limpo) return null;

  if (limpo.startsWith('sb_secret_')) {
    return 'e uma chave `sb_secret_` (acesso total, ignora a RLS)';
  }

  const papel = papelDoJwt(limpo);
  if (papel && papel !== 'anon') {
    return `e um JWT com role "${papel}" (so \`anon\` pode ser publica)`;
  }

  // Chave de API do Google/Gemini. Diferente das de cima: nao da acesso ao
  // banco, mas da pra queimar a cota paga de quem publicar a pagina.
  //
  // DOIS formatos, e o segundo custou o furo: escrevi esta trava conhecendo so
  // o `AIza...` classico, e a chave que o AI Studio emitiu de verdade veio como
  // `AQ.Ab8...`. A trava teria aprovado ela com prefixo EXPO_PUBLIC_ sem
  // reclamar -- uma trava que so pega o formato velho da a impressao de estar
  // protegendo e nao protege.
  if (/^AIza[0-9A-Za-z_-]{30,}$/.test(limpo) || /^AQ\.[0-9A-Za-z_-]{20,}$/.test(limpo)) {
    return 'parece uma chave de API do Google (a do Gemini vai em `supabase secrets set`)';
  }

  return null;
}

function ler(caminho) {
  try {
    return readFileSync(join(RAIZ, caminho), 'utf8');
  } catch {
    return null;
  }
}

// Checa todo .env que o Expo carrega, não só o principal.
const ARQUIVOS = ['.env', '.env.local', '.env.development', '.env.production'];
const problemas = [];

for (const arquivo of ARQUIVOS) {
  const conteudo = ler(arquivo);
  if (conteudo === null) continue;

  conteudo.split(/\r?\n/).forEach((linha, indice) => {
    const texto = linha.trim();
    if (!texto || texto.startsWith('#')) return;

    const divisor = texto.indexOf('=');
    if (divisor < 1) return;

    const nome = texto.slice(0, divisor).trim();
    if (!nome.startsWith('EXPO_PUBLIC_')) return; // sem prefixo, nao vai pro bundle

    const motivo = motivoDeRisco(texto.slice(divisor + 1));
    if (motivo) {
      problemas.push({ arquivo, linha: indice + 1, nome, motivo });
    }
  });
}

if (problemas.length > 0) {
  console.error('\n  BUILD INTERROMPIDO: segredo na rota do bundle\n');
  for (const p of problemas) {
    console.error(`  ${p.arquivo}:${p.linha}  ${p.nome}`);
    console.error(`      ${p.motivo}\n`);
  }
  console.error('  Tudo com prefixo EXPO_PUBLIC_ e embutido no JavaScript que o');
  console.error('  navegador baixa -- o .gitignore nao muda isso.\n');
  console.error('  Para corrigir:');
  console.error('    1. tire o prefixo EXPO_PUBLIC_ (a variavel fica so no disco), ou');
  console.error('    2. troque pela chave publicavel: Settings > API Keys > publishable\n');
  console.error('  E rotacione a chave exposta: ela ja passou por um build.\n');
  process.exit(1);
}

// Silencioso quando esta tudo bem: aviso que sempre aparece e aviso que
// ninguem le. So fala se o app nao vai conseguir subir.
const principal = ler('.env') ?? '';
const faltando = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'].filter(
  (nome) => !new RegExp(`^${nome}=.+`, 'm').test(principal),
);

if (faltando.length > 0) {
  console.error(`\n  .env incompleto: falta ${faltando.join(' e ')}`);
  console.error('  Copie de .env.example e preencha com Settings > API do seu projeto.\n');
  process.exit(1);
}
