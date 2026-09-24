/**
 * Painel: os gráficos, numa aba só.
 *
 * Nasceu a pedido da dona, e tirou do Planejar o que era desenho (a antiga
 * tela Lucro saiu inteira pra cá). A divisão que ficou: a Hoje responde o dia,
 * o Painel responde o período, e o Planejar é onde ela MEXE nas coisas
 * (metas, compras, gastos, estoque, produtos, histórico).
 *
 * Três leituras, nesta ordem, que é a ordem das perguntas dela:
 *   1. quanto entrou e quanto sobrou, dia a dia;
 *   2. qual produto sustenta o resultado;
 *   3. quanto do que entrou foi embora em compra e gasto.
 *
 * Tudo sai da MESMA série de 31 dias do hub do Planejar: trocar 7 ↔ 30 é um
 * recorte em memória, sem ida nova ao banco a cada toque.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { View, type TextStyle, type ViewStyle } from 'react-native';

import { GraficoBarras } from '@/components/grafico-barras';
import {
  Aviso,
  Botao,
  Carregando,
  Cartao,
  Indicador,
  Linha,
  Secao,
  Segmentos,
  Tela,
  Txt,
  Vazio,
  type TomTexto,
} from '@/components/ui';
import { Espaco, Raio, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import {
  custoDoProduto,
  useProdutos,
  useResumoPorDia,
  useVendasPorProduto,
  type DiaResumo,
  type ProdutoVendas,
} from '@/lib/dados';
import { dinheiro, dinheiroSemSinal } from '@/lib/formato';

type Janela = '7' | '30';

const JANELAS: { valor: Janela; rotulo: string }[] = [
  { valor: '7', rotulo: '7 dias' },
  { valor: '30', rotulo: '30 dias' },
];

/** 31 dias: a mesma série que o hub do Planejar já pede, e cabe o mês inteiro. */
const SERIE = 31;

/** Altura da barra de "Por produto": dá pra ver o contorno da vazada. */
const ALTURA_BARRA = 10;
/** Altura das duas barras de "Gastos x vendas", que são leitura de proporção. */
const ALTURA_PROPORCAO = 18;

const NUMERAL: TextStyle = { fontVariant: ['tabular-nums'] };

function mensagem(falha: unknown, padrao: string) {
  return falha instanceof Error ? falha.message : padrao;
}

export default function Painel() {
  const [janela, setJanela] = useState<Janela>('7');
  const n = Number(janela);

  const serie = useResumoPorDia(SERIE);
  const porProduto = useVendasPorProduto(n);
  const produtos = useProdutos();

  // Os últimos N dias, terminando no hoje do banco. Ordena antes de cortar pra
  // não depender da ordem em que a série veio.
  const recorte = [...(serie.data ?? [])]
    .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0))
    .slice(-n);

  const soma = recorte.reduce(
    (t, d) => ({
      receita: t.receita + (d.receita || 0),
      lucro: t.lucro + (d.lucro_vendas || 0),
      gastos: t.gastos + (d.compras || 0) + (d.despesas || 0),
      compras: t.compras + (d.compras || 0),
      despesas: t.despesas + (d.despesas || 0),
    }),
    { receita: 0, lucro: 0, gastos: 0, compras: 0, despesas: 0 },
  );

  // "Sem custo" aqui inclui o produto que só tem custo ESTIMADO: o palpite não
  // entra em `vendas.custo_unitario` (ver a migration da revenda), então cada
  // venda dele conta o preço cheio como lucro nestes gráficos. Na aba Hoje o
  // critério é mais estreito, porque lá a pergunta é outra ("falta cadastrar o
  // custo?"); aqui é "este lucro está inflado?".
  const semCustoReal = (produtos.data ?? []).filter(
    (p) => p.ativo && custoDoProduto(p).tipo !== 'apurado',
  );

  const tomLucro: TomTexto = soma.lucro > 0 ? 'positivo' : soma.lucro < 0 ? 'negativo' : 'texto';
  const vazio = recorte.every((d) => (d.receita || 0) === 0);

  return (
    <Tela titulo="Painel" atualizando={serie.isFetching && !serie.isLoading}>
      <Segmentos opcoes={JANELAS} valor={janela} onMudar={setJanela} rotuloAcessivel="Período" />

      {serie.error ? (
        <View style={{ marginTop: Espaco.lg }}>
          <Aviso tom="negativo">{mensagem(serie.error, 'Não consegui carregar os números.')}</Aviso>
        </View>
      ) : serie.isLoading ? (
        <Carregando />
      ) : vazio ? (
        <View style={{ marginTop: Espaco.lg }}>
          <Vazio
            titulo="Nenhuma venda no período"
            dica="Os gráficos aparecem quando houver movimento."
            acao={{ rotulo: 'Vender', onPress: () => router.navigate('/vender') }}
          />
        </View>
      ) : (
        <>
          <View style={{ marginTop: Espaco.lg }}>
            <Cartao style={{ gap: Espaco.xl }}>
              <Indicador
                grande
                rotulo="Vendas"
                valor={dinheiro(soma.receita)}
                legenda={`${n} dias`}
              />
              <Linha style={{ gap: Espaco.lg, alignItems: 'flex-start' }}>
                {/* "Prejuízo" escrito no rótulo, e o valor sem sinal: quem diz
                    o lado é a palavra. */}
                <Indicador
                  style={{ flex: 1 }}
                  rotulo={soma.lucro < 0 ? 'Prejuízo' : 'Lucro'}
                  valor={dinheiroSemSinal(soma.lucro)}
                  tom={tomLucro}
                />
                <Indicador style={{ flex: 1 }} rotulo="Gastos" valor={dinheiro(soma.gastos)} />
              </Linha>
            </Cartao>
          </View>

          <Secao titulo="Vendas por dia">
            <Cartao>
              <GraficoBarras
                modo="vendas"
                pontos={recorte.map((d) => ({ dia: d.dia.slice(0, 10), valor: d.receita || 0 }))}
              />
            </Cartao>
          </Secao>

          <Secao titulo="Lucro por dia">
            <Cartao>
              <GraficoBarras
                modo="lucro"
                pontos={recorte.map((d) => ({
                  dia: d.dia.slice(0, 10),
                  valor: d.lucro_vendas || 0,
                }))}
              />
            </Cartao>
          </Secao>

          {semCustoReal.length > 0 ? (
            <View style={{ marginTop: Espaco.lg }}>
              <Aviso
                tom="atencao"
                acao={{ rotulo: 'Ver', onPress: () => router.push('/planejar/produtos') }}>
                {semCustoReal.length === 1
                  ? `${semCustoReal[0]!.nome} sem custo real`
                  : `${semCustoReal.length} produtos sem custo real`}
              </Aviso>
            </View>
          ) : null}

          <Secao titulo="Por produto">
            {porProduto.error ? (
              <Aviso tom="negativo">
                {mensagem(porProduto.error, 'Não consegui carregar os produtos.')}
              </Aviso>
            ) : porProduto.isLoading ? (
              <Carregando />
            ) : (
              <PorProduto linhas={porProduto.data ?? []} />
            )}
          </Secao>

          <Secao titulo="Gastos x vendas">
            <Cartao style={{ gap: Espaco.lg }}>
              <GastosContraVendas soma={soma} dias={recorte} />
            </Cartao>
          </Secao>
        </>
      )}

      {/* A foto da nota é o que alimenta metade destes gráficos (o custo do
          produto e a linha de gastos), e vivia escondida dentro do Planejar.
          Secundária, não mostarda: no Painel a ação principal é olhar. */}
      <Botao
        variante="secundaria"
        icone="camera"
        onPress={() => router.push('/planejar/compras')}
        style={{ marginTop: Espaco.xl }}>
        Fotografar nota
      </Botao>
    </Tela>
  );
}

// ---------------------------------------------------------------------------
// Por produto
// ---------------------------------------------------------------------------

function PorProduto({ linhas }: { linhas: ProdutoVendas[] }) {
  const vendidos = linhas.filter((linha) => linha.unidades > 0);
  if (vendidos.length === 0) return <Vazio titulo="Nenhuma venda no período" />;

  // A barra é proporcional ao MAIOR lucro em módulo: um produto no prejuízo
  // aparece do tamanho de um lucro equivalente. A comparação é de peso no
  // resultado; o sinal vai na forma da barra e na palavra.
  const teto = Math.max(0, ...vendidos.map((linha) => Math.abs(linha.lucro)));

  return (
    <Cartao style={{ gap: Espaco.lg }}>
      {vendidos.map((linha) => (
        <LinhaDeProduto key={linha.produto_id} linha={linha} teto={teto} />
      ))}
    </Cartao>
  );
}

function LinhaDeProduto({ linha, teto }: { linha: ProdutoVendas; teto: number }) {
  const { grafico } = useTema();
  const prejuizo = linha.lucro < 0;
  const fracao = teto > 0 ? Math.abs(linha.lucro) / teto : 0;

  return (
    <View
      accessible
      accessibilityLabel={`${linha.nome}, ${prejuizo ? 'prejuízo' : 'lucro'} ${dinheiroSemSinal(
        linha.lucro,
      )}`}
      style={{ gap: Espaco.sm }}>
      <Linha style={{ alignItems: 'baseline' }}>
        <Txt tipo="corpo" negrito numberOfLines={1} style={{ flex: 1 }}>
          {linha.nome}
        </Txt>
        {prejuizo ? (
          <Txt tipo="rotulo" negrito tom="negativo">
            prejuízo
          </Txt>
        ) : null}
        <Txt tipo="corpo" negrito tom={prejuizo ? 'negativo' : 'texto'} style={NUMERAL}>
          {dinheiroSemSinal(linha.lucro)}
        </Txt>
      </Linha>
      <View style={{ height: ALTURA_BARRA }}>
        {fracao > 0 ? (
          <View
            style={{
              width: `${fracao * 100}%`,
              // Um lucro pequeno ainda aparece, e o contorno da vazada ainda
              // fecha um retângulo.
              minWidth: ALTURA_BARRA,
              height: '100%',
              borderRadius: Raio.pill,
              // `Grafico.prejuizo` e `Grafico.lucro` quase empatam em
              // luminosidade (ver o tema), e são o par vermelho/verde que
              // protan e deutan confundem. O que separa os dois aqui é a barra
              // VAZADA, com contorno -- o mesmo papel da hachura no gráfico de
              // dias -- e a palavra "prejuízo" ao lado. Pintar as duas de
              // sólido deixaria o prejuízo idêntico ao lucro pra quem não
              // enxerga a diferença de matiz.
              backgroundColor: prejuizo ? 'transparent' : grafico.lucro,
              borderWidth: prejuizo ? 1.5 : 0,
              borderColor: grafico.prejuizo,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Gastos x vendas
// ---------------------------------------------------------------------------

/**
 * Duas barras na MESMA escala, uma embaixo da outra: o que entrou e o que
 * saiu. Escala comum é o que faz a comparação existir -- duas barras
 * normalizadas cada uma pelo seu próprio total pareceriam sempre iguais.
 *
 * Nada aqui depende de cor: cada barra tem o rótulo e o valor escritos do
 * lado, e a conclusão ("sobrou" / "faltou") vem por extenso embaixo.
 */
function GastosContraVendas({
  soma,
  dias,
}: {
  soma: { receita: number; gastos: number; compras: number; despesas: number };
  dias: DiaResumo[];
}) {
  const { cores, grafico } = useTema();
  const teto = Math.max(soma.receita, soma.gastos);
  const sobrou = soma.receita - soma.gastos;
  const comGasto = dias.filter((d) => (d.compras || 0) + (d.despesas || 0) > 0).length;

  // `ViewStyle` explícito: sem ele o TypeScript infere `width: string` e recusa,
  // porque a largura em porcentagem é o tipo literal `${number}%`.
  const barra = (valor: number, cor: string): ViewStyle => ({
    // O mínimo de 2% é pra um gasto pequeno não sumir; valor zero não desenha.
    width: `${teto > 0 ? Math.max((valor / teto) * 100, valor > 0 ? 2 : 0) : 0}%`,
    height: '100%',
    borderRadius: Raio.pill,
    backgroundColor: cor,
  });

  return (
    <>
      <View accessible accessibilityLabel={`Entrou ${dinheiro(soma.receita)}`} style={{ gap: Espaco.xs }}>
        <Linha entre>
          <Txt tipo="rotulo" tom="textoFraco">
            Entrou
          </Txt>
          <Txt tipo="corpo" negrito style={NUMERAL}>
            {dinheiro(soma.receita)}
          </Txt>
        </Linha>
        <View style={{ height: ALTURA_PROPORCAO }}>
          <View style={barra(soma.receita, grafico.barra)} />
        </View>
      </View>

      <View
        accessible
        accessibilityLabel={`Saiu ${dinheiro(soma.gastos)}: mercado ${dinheiro(
          soma.compras,
        )}, outros gastos ${dinheiro(soma.despesas)}`}
        style={{ gap: Espaco.xs }}>
        <Linha entre>
          <Txt tipo="rotulo" tom="textoFraco">
            Saiu
          </Txt>
          <Txt tipo="corpo" negrito style={NUMERAL}>
            {dinheiro(soma.gastos)}
          </Txt>
        </Linha>
        <View style={{ height: ALTURA_PROPORCAO }}>
          <View style={barra(soma.gastos, cores.marca)} />
        </View>
        {/* O que saiu, aberto: mercado vira estoque, o resto não. São contas
            diferentes na cabeça dela. */}
        <Txt tipo="rotulo" tom="textoFraco" style={NUMERAL}>
          mercado {dinheiro(soma.compras)} · outros {dinheiro(soma.despesas)}
        </Txt>
      </View>

      <View style={{ minHeight: Touch.alvoSecundario, justifyContent: 'center' }}>
        <Txt tipo="corpo" negrito tom={sobrou < 0 ? 'negativo' : 'texto'}>
          {sobrou < 0
            ? `Faltou ${dinheiroSemSinal(sobrou)} no caixa`
            : `Sobrou ${dinheiro(sobrou)} no caixa`}
        </Txt>
        {/* Compra grande concentrada em poucos dias é o caso em que "saiu mais
            que entrou" não quer dizer mês ruim -- a nota cobre as semanas
            seguintes. Sem esta linha, o período parece prejuízo. */}
        {comGasto > 0 && comGasto <= 3 && soma.gastos > 0 ? (
          <Txt tipo="rotulo" tom="textoFraco">
            {comGasto === 1
              ? 'a compra do período saiu num dia só'
              : `as compras saíram em ${comGasto} dias`}
          </Txt>
        ) : null}
      </View>
    </>
  );
}
