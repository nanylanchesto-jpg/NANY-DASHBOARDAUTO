import { router } from 'expo-router';
import { Fragment } from 'react';
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
  Divisor,
  Indicador,
  ItemLista,
  Linha,
  Secao,
  Tela,
  Txt,
} from '@/components/ui';
import { Espaco, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import {
  custoDoProduto,
  useFechamento,
  useMetas,
  useParaComprar,
  useProdutos,
  useResumoPorDia,
  type DiaResumo,
  type Fechamento,
  type Meta,
  type ParaComprar,
  type Periodo,
  type Produto,
} from '@/lib/dados';
import { dataLocal, diaDaSemana, dinheiro, inteiro } from '@/lib/formato';
import { hojeDaSerie, metaAtiva, somaPeriodo } from '@/lib/periodo';

/**
 * Hoje: a tela que ela abre de relance entre um cliente e outro.
 *
 * Responde, nesta ordem, a quatro perguntas -- quanto vendi, quanto ganhei,
 * preciso vender mais, tem algo pedindo atenção -- e oferece UMA ação: vender.
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
  const comprar = useParaComprar();
  const produtos = useProdutos();

  // A meta entra na espera de propósito: ela fica ACIMA do botão Vender, e
  // aparecer depois empurraria o botão pra baixo do dedo que já ia tocar.
  // Os avisos e o gráfico ficam abaixo dele e podem chegar quando chegarem.
  const carregando =
    fechamento.isLoading || serie.isLoading || metas.isLoading || serieDaMeta.isLoading;
  const falha = fechamento.error ?? serie.error;
  const atualizando =
    !carregando &&
    (fechamento.isFetching || serie.isFetching || comprar.isFetching || produtos.isFetching);

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
          {/* Sem os números ela ainda precisa conseguir vender. */}
          <BotaoVender />
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
          </View>

          <View style={{ paddingTop: Espaco.sm }}>
            {/* Espera as duas listas: chegando uma de cada vez, os avisos de
                produto apareceriam e depois desceriam pra dar lugar aos de
                estoque, que são mais urgentes. */}
            {comprar.isLoading || produtos.isLoading ? null : (
              <Atencao ingredientes={comprar.data} produtos={produtos.data} />
            )}
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
  const lucro = dados?.lucro_vendas ?? 0;
  const caixa = dados?.caixa ?? 0;
  const pedidos = dados?.atendimentos ?? 0;

  // Lucro e caixa discordam no dia de feira: ela compra a semana inteira
  // hoje, e o caixa fica negativo com as vendas dando lucro. Sem dizer POR QUÊ
  // na tela, isso parece prejuízo e ela conclui que o app está errado. Uma
  // legenda de duas palavras basta; o parágrafo que havia aqui ninguém lia.
  const motivoDoCaixa =
    caixa < 0 && dados
      ? dados.compras > 0
        ? 'compras de hoje'
        : dados.despesas > 0
          ? 'gastos de hoje'
          : undefined
      : undefined;

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
          {/* No negativo o RÓTULO vira "Prejuízo" e o valor vai sem sinal: a
              palavra carrega o estado, não o tom de vermelho nem um "−" fácil
              de não ver. */}
          <Indicador
            style={{ flex: 1 }}
            rotulo={lucro < 0 ? 'Prejuízo' : 'Lucro'}
            valor={dinheiro(Math.abs(lucro))}
            tom={lucro > 0 ? 'positivo' : lucro < 0 ? 'negativo' : 'texto'}
          />
          <Indicador
            style={{ flex: 1 }}
            rotulo="Caixa"
            valor={dinheiro(caixa)}
            tom={caixa < 0 ? 'negativo' : 'texto'}
            legenda={motivoDoCaixa}
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

// ---------------------------------------------------------------------------
// Atenção
// ---------------------------------------------------------------------------

/** Acima disso a lista vira inventário; o resto fica atrás de um "Mais N". */
const MAX_AVISOS = 3;

type Alerta = {
  chave: string;
  titulo: string;
  valor: string;
  tom: 'negativo' | 'atencao';
  destino: 'estoque' | 'produtos';
};

/**
 * Só o que pede ação, na ordem da urgência: saldo negativo (compra que não
 * foi lançada), ingrediente que acaba em menos de 3 dias, produto à venda sem
 * custo nenhum (o lucro dele está saindo igual ao preço cheio).
 *
 * Listar o estoque inteiro transformaria o bloco em inventário, e ela pararia
 * de olhar -- o que some junto é justamente o aviso do que está acabando. A
 * ordem entre ingredientes já vem do banco (`ingredientes_para_comprar`).
 */
function alertas(ingredientes: ParaComprar[], produtos: Produto[]): Alerta[] {
  const lista: Alerta[] = [];
  for (const i of ingredientes) {
    if (i.estoque_base < 0) {
      lista.push({
        chave: i.id,
        titulo: i.nome,
        valor: 'lançar compra',
        tom: 'negativo',
        destino: 'estoque',
      });
    } else if (i.dias_restantes !== null && i.dias_restantes < 3) {
      // Arredonda pra baixo: "acaba em 2 dias" com 2,9 no estoque é o aviso
      // que chega a tempo; com 3 ela deixaria pra depois.
      const d = Math.floor(i.dias_restantes);
      lista.push({
        chave: i.id,
        titulo: i.nome,
        valor: d < 1 ? 'acaba hoje' : `acaba em ${d} ${d === 1 ? 'dia' : 'dias'}`,
        tom: 'atencao',
        destino: 'estoque',
      });
    }
  }
  for (const p of produtos) {
    if (p.ativo && custoDoProduto(p).tipo === 'ausente') {
      lista.push({
        chave: p.id,
        titulo: p.nome,
        valor: 'sem custo',
        tom: 'atencao',
        destino: 'produtos',
      });
    }
  }
  return lista;
}

function abrir(destino: Alerta['destino']) {
  if (destino === 'produtos') router.push('/planejar/produtos');
  else router.push('/planejar/estoque');
}

function Atencao({
  ingredientes,
  produtos,
}: {
  ingredientes: ParaComprar[] | undefined;
  produtos: Produto[] | undefined;
}) {
  const lista = alertas(ingredientes ?? [], produtos ?? []);
  if (lista.length === 0) return null;

  // Nunca mais que MAX_AVISOS linhas: passando, a última vira o "Mais N".
  const visiveis = lista.length > MAX_AVISOS ? lista.slice(0, MAX_AVISOS - 1) : lista;
  const escondidos = lista.slice(visiveis.length);
  const destinoDoResto: Alerta['destino'] = escondidos.every((a) => a.destino === 'produtos')
    ? 'produtos'
    : 'estoque';

  return (
    <Secao titulo="Atenção">
      <Cartao style={{ paddingVertical: Espaco.xs }}>
        {visiveis.map((a, i) => (
          <Fragment key={a.chave}>
            {i > 0 ? <Divisor /> : null}
            <ItemLista
              alerta
              titulo={a.titulo}
              valor={a.valor}
              tomValor={a.tom}
              onPress={() => abrir(a.destino)}
            />
          </Fragment>
        ))}
        {escondidos.length > 0 ? (
          <>
            <Divisor />
            <ItemLista
              icone="mais"
              titulo={`Mais ${escondidos.length}`}
              rotuloAcessivel={`Mais ${escondidos.length} ${
                escondidos.length === 1 ? 'aviso' : 'avisos'
              }`}
              onPress={() => abrir(destinoDoResto)}
            />
          </>
        ) : null}
      </Cartao>
    </Secao>
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
