import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { GraficoBarras } from '@/components/grafico-barras';
import { Icone } from '@/components/icone';
import { Logotipo } from '@/components/tela-login';
import {
  Aviso,
  BarraProgresso,
  Botao,
  Carregando,
  Cartao,
  Indicador,
  Linha,
  Secao,
  Tela,
  Txt,
} from '@/components/ui';
import { Espaco, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import {
  gastosDe,
  lucroDe,
  useFechamento,
  useMetas,
  useResumoPorDia,
  type DiaResumo,
  type Fechamento,
  type Meta,
  type Periodo,
} from '@/lib/dados';
import { dataLocal, diaDaSemana, dinheiro, dinheiroSemSinal, inteiro } from '@/lib/formato';
import { hojeDaSerie, metaAtiva, somaPeriodo } from '@/lib/periodo';

/**
 * Hoje: a tela que ela abre de relance entre um cliente e outro.
 *
 * Responde, nesta ordem, a três perguntas -- quanto vendi, quanto gastei e
 * quanto sobrou, preciso vender mais -- e oferece UMA ação: vender.
 * Tudo o que não responde a nenhuma delas mora no Planejar; o que só às vezes
 * responde (meta, avisos) só aparece quando existe.
 */
export default function Hoje() {
  const fechamento = useFechamento();
  const serie = useResumoPorDia(7);
  const metas = useMetas();
  const meta = metaAtiva(metas.data);
  // A meta do mês precisa do mês inteiro, e 7 dias não cobrem. Hook não pode
  // ser condicional, então o condicional está no argumento: sem meta de mês a
  // chave é a mesma da linha de cima e o React Query não busca duas vezes.
  const serieDaMeta = useResumoPorDia(meta?.periodo === 'mes' ? 31 : 7);

  // A meta entra na espera de propósito: ela fica ACIMA do botão Vender, e
  // aparecer depois empurraria o botão pra baixo do dedo que já ia tocar.
  const carregando =
    fechamento.isLoading || serie.isLoading || metas.isLoading || serieDaMeta.isLoading;
  const falha = fechamento.error ?? serie.error;
  const atualizando = !carregando && (fechamento.isFetching || serie.isFetching);

  const dias = serie.data ?? [];
  // O "hoje" é o do banco (`dia_local()`), nunca o relógio do celular.
  const hoje = hojeDaSerie(dias) || (fechamento.data?.dia ?? '');

  return (
    <Tela atualizando={atualizando}>
      <Linha entre style={estilos.cabecalho}>
        <Logotipo tamanho={28} />
        {hoje ? (
          <Txt tipo="rotulo" tom="textoFraco" rotuloAcessivel={DATA_EXTENSO.format(dataLocal(hoje))}>
            {dataCurta(hoje)}
          </Txt>
        ) : null}
      </Linha>

      {falha ? (
        <View style={{ gap: Espaco.xl }}>
          <Aviso
            tom="negativo"
            acao={{
              rotulo: 'Tentar de novo',
              onPress: () => {
                fechamento.refetch();
                serie.refetch();
              },
            }}>
            {falha instanceof Error ? falha.message : 'Não consegui carregar os números.'}
          </Aviso>
          {/* Sem os números ela ainda precisa conseguir vender e anotar gasto. */}
          <BotaoVender />
          <BotaoAnotarGasto />
        </View>
      ) : carregando ? (
        <Carregando />
      ) : (
        <>
          <View style={{ gap: Espaco.xl }}>
            <Numeros dados={fechamento.data ?? null} />
            {meta ? (
              <BlocoMeta
                meta={meta}
                realizado={realizadoDaMeta(meta, fechamento.data ?? null, serieDaMeta.data, hoje)}
              />
            ) : null}
            <BotaoVender />
            <BotaoAnotarGasto />
          </View>

          <View style={{ paddingTop: Espaco.sm }}>
            <UltimosDias dias={dias} metaDiaria={meta?.periodo === 'dia' ? meta.valor : undefined} />
          </View>
        </>
      )}
    </Tela>
  );
}

// ---------------------------------------------------------------------------
// Data do cabeçalho
// ---------------------------------------------------------------------------

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Pro leitor de tela: "segunda-feira, 21 de setembro", sem abreviação pra decifrar. */
const DATA_EXTENSO = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/**
 * "seg, 21 set". Montada à mão e não com `Intl` de mês curto: o pt-BR do
 * `Intl` devolve "21 de set.", com "de" e ponto, que é mais comprido do que o
 * canto do cabeçalho comporta.
 */
function dataCurta(iso: string) {
  const mes = MESES[Number(iso.slice(5, 7)) - 1] ?? '';
  return `${diaDaSemana(iso)}, ${Number(iso.slice(8, 10))} ${mes}`;
}

// ---------------------------------------------------------------------------
// Vendas, lucro e caixa
// ---------------------------------------------------------------------------

function Numeros({ dados }: { dados: Fechamento | null }) {
  const receita = dados?.receita ?? 0;
  const gastos = dados ? gastosDe(dados) : 0;
  const lucro = dados ? lucroDe(dados) : 0;
  const pedidos = dados?.atendimentos ?? 0;

  // No dia do mercado o lucro do dia fica negativo mesmo com a lanchonete
  // vendendo bem: a compra cobre a semana. Sem dizer POR QUÊ, isso parece
  // prejuízo de verdade e ela conclui que o app está errado. Uma legenda curta
  // basta; o lucro da semana (Planejar, Painel) é onde a compra se dilui.
  const motivo = lucro < 0 && gastos > 0 ? 'o gasto rende outros dias' : undefined;

  return (
    <>
      {/* Vendas é o herói porque é a primeira pergunta ("quanto vendi?") e o
          número que ela confere contra a gaveta. */}
      <Indicador
        grande
        rotulo="Vendas"
        valor={dinheiro(receita)}
        legenda={
          pedidos === 0
            ? 'Nenhuma venda ainda'
            : `${inteiro(pedidos)} ${pedidos === 1 ? 'venda' : 'vendas'}`
        }
      />

      <Cartao>
        <Linha style={{ gap: Espaco.lg, alignItems: 'flex-start' }}>
          <Indicador style={{ flex: 1 }} rotulo="Gastos" valor={dinheiro(gastos)} />
          {/* Lucro = vendas − gastos, a conta que ela faz de cabeça. No
              negativo o RÓTULO vira "Prejuízo" e o valor vai sem sinal: a
              palavra carrega o estado, não o tom de vermelho nem um "−" fácil
              de não ver. */}
          <Indicador
            style={{ flex: 1 }}
            rotulo={lucro < 0 ? 'Prejuízo' : 'Lucro'}
            valor={dinheiroSemSinal(lucro)}
            tom={lucro > 0 ? 'positivo' : lucro < 0 ? 'negativo' : 'texto'}
            legenda={motivo}
          />
        </Linha>
      </Cartao>
    </>
  );
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const NOME_DA_META: Record<Periodo, string> = {
  dia: 'Meta do dia',
  semana: 'Meta da semana',
  mes: 'Meta do mês',
};

/**
 * Quanto já foi vendido no período da meta. `null` quando a série do período
 * não veio: aí a meta some, em vez de mostrar "faltam" a meta inteira.
 */
function realizadoDaMeta(
  meta: Meta,
  dados: Fechamento | null,
  serie: DiaResumo[] | undefined,
  hoje: string,
): number | null {
  // A do dia sai do MESMO número do herói: somada por outro caminho, uma
  // diferença de centavo entre os dois faria ela desconfiar dos dois.
  if (meta.periodo === 'dia') return dados?.receita ?? 0;
  if (!serie || !hoje) return null;
  return somaPeriodo(serie, meta.periodo, hoje).receita;
}

function BlocoMeta({ meta, realizado }: { meta: Meta; realizado: number | null }) {
  const { cores } = useTema();
  if (realizado === null) return null;

  const nome = NOME_DA_META[meta.periodo];
  const batida = realizado >= meta.valor;

  return (
    <View style={{ gap: Espaco.sm }}>
      <Linha entre>
        <Txt tipo="rotulo" tom="textoFraco">
          {nome}
        </Txt>
        {/* "batida" escrito, com o ✓: a barra cheia muda de tinta, mas é a
            palavra que diz que acabou. */}
        {batida ? (
          <Linha style={{ gap: Espaco.xs }}>
            <Icone nome="ok" tamanho={18} cor={cores.positivo} espessura={2.5} />
            <Txt tipo="corpo" tom="positivo" negrito>
              batida
            </Txt>
          </Linha>
        ) : (
          <Txt tipo="corpo" negrito>
            faltam {dinheiro(meta.valor - realizado)}
          </Txt>
        )}
      </Linha>
      <BarraProgresso
        atual={realizado}
        alvo={meta.valor}
        rotuloAcessivel={`${nome}: ${dinheiro(realizado)} de ${dinheiro(meta.valor)}`}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// A ação da tela
// ---------------------------------------------------------------------------

function BotaoVender() {
  return (
    <Botao grande icone="vender" onPress={() => router.push('/vender')}>
      Vender
    </Botao>
  );
}

/**
 * Atalho pra anotar gasto (foto da nota ou valor digitado).
 *
 * Sem ele, o gasto vivia dois toques fundo (Planejar → Gastos) e ela esquecia
 * de anotar -- e sem gasto o lucro sai igual às vendas.
 *
 * Secundária, e essa é a parte que não pode mudar: a mostarda é UMA por tela,
 * e nesta tela ela é o Vender. Anotar gasto é coisa de fim de expediente,
 * vender é coisa do balcão -- se as duas gritassem igual, a que importa no
 * aperto da tarde deixaria de ser óbvia.
 */
function BotaoAnotarGasto() {
  return (
    <Botao variante="secundaria" icone="camera" onPress={() => router.push('/planejar/gastos')}>
      Anotar gasto
    </Botao>
  );
}

// ---------------------------------------------------------------------------
// Últimos dias
// ---------------------------------------------------------------------------

function UltimosDias({ dias, metaDiaria }: { dias: DiaResumo[]; metaDiaria?: number }) {
  // Sete barras zeradas são uma régua vazia, não informação: sem venda na
  // semana, o bloco não aparece (o "Nenhuma venda ainda" do topo já diz).
  if (!dias.some((d) => d.receita > 0)) return null;

  const pontos = [...dias]
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .map((d) => ({ dia: d.dia, valor: d.receita }));

  return (
    <Secao titulo="Últimos dias">
      <Cartao>
        {/* A linha da meta só com meta DIÁRIA: é a única comparável com a
            barra de um dia. */}
        <GraficoBarras modo="vendas" pontos={pontos} meta={metaDiaria} />
      </Cartao>
    </Secao>
  );
}

const estilos = StyleSheet.create({
  cabecalho: {
    // Mesma altura e mesmo centro do cabeçalho das outras abas (`Tela` com
    // título): trocar de aba não faz o topo pular.
    minHeight: Touch.alvoSecundario,
    marginTop: -Espaco.xs,
    marginBottom: Espaco.lg,
  },
});
