import { router } from 'expo-router';
import { useState } from 'react';
import { View, type TextStyle } from 'react-native';

import { GraficoBarras } from '@/components/grafico-barras';
import {
  Aviso,
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
import { Espaco, Raio } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import {
  custoDoProduto,
  useProdutos,
  useResumoPorDia,
  useVendasPorProduto,
  type ProdutoVendas,
} from '@/lib/dados';
import { dinheiro, dinheiroSemSinal } from '@/lib/formato';

type Janela = '7' | '30';

const JANELAS: { valor: Janela; rotulo: string }[] = [
  { valor: '7', rotulo: '7 dias' },
  { valor: '30', rotulo: '30 dias' },
];

/**
 * A mesma série de 31 dias do hub, recortada aqui: trocar 7 ↔ 30 fica
 * instantâneo, sem outra ida ao banco a cada toque.
 */
const SERIE = 31;

/** Altura da barra de "Por produto": dá pra ver o contorno da vazada. */
const ALTURA_BARRA = 10;

const NUMERAL: TextStyle = { fontVariant: ['tabular-nums'] };

function mensagem(falha: unknown, padrao: string) {
  return falha instanceof Error ? falha.message : padrao;
}

export default function Lucro() {
  const [janela, setJanela] = useState<Janela>('7');
  const n = Number(janela);

  const serie = useResumoPorDia(SERIE);
  const porProduto = useVendasPorProduto(n);
  const produtos = useProdutos();

  // Os últimos N dias, terminando no hoje do banco. Ordena antes de cortar
  // pra não depender da ordem em que a série veio.
  const recorte = [...(serie.data ?? [])]
    .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0))
    .slice(-n);
  const lucro = recorte.reduce((soma, d) => soma + (d.lucro_vendas || 0), 0);
  const receita = recorte.reduce((soma, d) => soma + (d.receita || 0), 0);
  const pontos = recorte.map((d) => ({ dia: d.dia.slice(0, 10), valor: d.lucro_vendas || 0 }));

  // "Sem custo" aqui inclui o produto que só tem custo ESTIMADO: o palpite
  // não entra em `vendas.custo_unitario` (ver a migration da revenda), então
  // cada venda dele conta o preço cheio como lucro neste gráfico. Na aba Hoje
  // o critério é mais estreito porque lá a pergunta é outra ("falta cadastrar
  // o custo?"); aqui é "este lucro está inflado?".
  const semCustoReal = (produtos.data ?? []).filter(
    (p) => p.ativo && custoDoProduto(p).tipo !== 'apurado',
  );

  const tom: TomTexto = lucro > 0 ? 'positivo' : lucro < 0 ? 'negativo' : 'texto';

  return (
    <Tela titulo="Lucro" voltar atualizando={serie.isFetching && !serie.isLoading}>
      <Segmentos opcoes={JANELAS} valor={janela} onMudar={setJanela} rotuloAcessivel="Período" />

      <View style={{ marginTop: Espaco.lg }}>
        {serie.error ? (
          <Aviso tom="negativo">{mensagem(serie.error, 'Não consegui carregar o lucro.')}</Aviso>
        ) : serie.isLoading ? (
          <Carregando />
        ) : (
          <Cartao style={{ gap: Espaco.xl }}>
            {/* "Prejuízo" escrito no rótulo: o sinal de menos some de relance,
                e a cor não chega pra quem não separa vermelho de verde. */}
            <Indicador
              grande
              rotulo={lucro < 0 ? 'Prejuízo' : 'Lucro'}
              valor={dinheiroSemSinal(lucro)}
              tom={tom}
              legenda={`de ${dinheiro(receita)} em vendas`}
            />
            <GraficoBarras modo="lucro" pontos={pontos} />
          </Cartao>
        )}
      </View>

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
    </Tela>
  );
}

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
      accessibilityLabel={`${linha.nome}, ${prejuizo ? 'prejuízo' : 'lucro'} ${dinheiroSemSinal(linha.lucro)}`}
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
              // protan e deutan confundem. O que separa os dois aqui é a
              // barra VAZADA, com contorno -- o mesmo papel da hachura no
              // gráfico de dias -- e a palavra "prejuízo" acima. Pintar as
              // duas de sólido deixaria o prejuízo idêntico ao lucro pra
              // quem não enxerga a diferença de matiz.
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
