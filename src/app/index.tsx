import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { GraficoDias } from '@/components/grafico-dias';
import {
  Aviso,
  Botao,
  Carregando,
  Cartao,
  Linha,
  Tela,
  Titulo,
  Txt,
  Vazio,
} from '@/components/ui';
import { Espaco, Raio, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import { useFechamento, useParaComprar, useResumoPorDia, useVendasPorProduto } from '@/lib/dados';
import { dinheiro, dinheiroCurto, inteiro, quantidade, saldo } from '@/lib/formato';
import { sair } from '@/lib/sessao';

const JANELAS = [7, 14, 30] as const;

export default function Dashboard() {
  const [janela, setJanela] = useState<(typeof JANELAS)[number]>(7);

  const hoje = useFechamento();
  const serie = useResumoPorDia(janela);
  const porProduto = useVendasPorProduto(30);
  const comprar = useParaComprar();

  const carregando = hoje.isLoading || serie.isLoading;
  const falhou = hoje.error ?? serie.error;

  return (
    <Tela atualizando={hoje.isFetching || serie.isFetching}>
      <Titulo
        acao={
          // `minHeight: 0` deixava o alvo do tamanho da letra (~18 px). Alvo
          // secundário, com a margem negativa segurando a altura visual da
          // linha do título -- o dedo ganha os 44 px, o olho não vê diferença.
          <Botao
            variante="fantasma"
            onPress={sair}
            style={{
              minHeight: Touch.alvoSecundario,
              paddingHorizontal: Espaco.sm,
              marginVertical: -Espaco.md,
              marginRight: -Espaco.sm,
            }}>
            Sair
          </Botao>
        }>
        Hoje
      </Titulo>

      {falhou ? (
        <Aviso tom="negativo">
          {falhou instanceof Error ? falhou.message : 'Não consegui carregar os números.'}
        </Aviso>
      ) : carregando ? (
        <Carregando />
      ) : (
        <>
          <ResumoDeHoje dados={hoje.data} />

          <Titulo>Últimos dias</Titulo>
          <SeletorDeJanela valor={janela} onMudar={setJanela} />
          <View style={{ height: Espaco.md }} />
          {serie.data?.some((d) => d.receita > 0) ? (
            <GraficoDias dias={serie.data} />
          ) : (
            <Vazio
              titulo="Nenhuma venda registrada ainda"
              dica="Use a aba Vender para marcar o que sair do balcão."
            />
          )}

          <Titulo>Por produto (30 dias)</Titulo>
          <PorProduto linhas={porProduto.data ?? []} carregando={porProduto.isLoading} />

          <Titulo>Repor no mercado</Titulo>
          <ParaComprar linhas={comprar.data ?? []} carregando={comprar.isLoading} />
        </>
      )}
    </Tela>
  );
}

// ---------------------------------------------------------------------------
// Fechamento de hoje
// ---------------------------------------------------------------------------

function ResumoDeHoje({ dados }: { dados: ReturnType<typeof useFechamento>['data'] }) {
  if (!dados) return <Vazio titulo="Sem movimento hoje" />;

  const semVenda = dados.atendimentos === 0;

  return (
    <Cartao style={{ gap: Espaco.lg }}>
      {/* Número-herói: uma coisa só, grande. O lucro das vendas é a resposta
          pra "o negócio deu lucro hoje?" -- que é a pergunta do PI. */}
      <View style={{ gap: 2 }}>
        <Txt tipo="rotulo" tom="textoFraco">
          Lucro das vendas de hoje
        </Txt>
        <Txt
          tipo="numeroGrande"
          tom={dados.lucro_vendas < 0 ? 'negativo' : dados.lucro_vendas > 0 ? 'positivo' : 'texto'}>
          {dinheiro(dados.lucro_vendas)}
        </Txt>
        <Txt tipo="rotulo" tom="textoFraco">
          {inteiro(dados.unidades)} {dados.unidades === 1 ? 'item vendido' : 'itens vendidos'} em{' '}
          {inteiro(dados.atendimentos)}{' '}
          {dados.atendimentos === 1 ? 'registro' : 'registros'}
        </Txt>
      </View>

      <Linha style={{ flexWrap: 'wrap', rowGap: Espaco.md }}>
        <Numero rotulo="Entrou (vendas)" valor={dinheiroCurto(dados.receita)} />
        <Numero rotulo="Custo do vendido" valor={dinheiroCurto(dados.custo_vendido)} />
        <Numero rotulo="Compras do dia" valor={dinheiroCurto(dados.compras)} />
        <Numero
          rotulo="Caixa do dia"
          valor={dinheiroCurto(dados.caixa)}
          tom={dados.caixa < 0 ? 'negativo' : 'texto'}
        />
      </Linha>

      {/* A diferença entre os dois resultados precisa estar escrita na tela, e
          não só no código: sem isso, um dia de feira (caixa negativo, lucro
          positivo) parece prejuízo e ela conclui que o app está errado. */}
      {dados.caixa < 0 && dados.lucro_vendas > 0 ? (
        <Aviso tom="atencao">
          O caixa ficou negativo porque as compras de hoje cobrem os próximos dias. As vendas de
          hoje, em si, deram lucro.
        </Aviso>
      ) : null}

      {semVenda && dados.compras > 0 ? (
        <Aviso tom="atencao">
          Compras lançadas, mas nenhuma venda registrada hoje.
        </Aviso>
      ) : null}
    </Cartao>
  );
}

function Numero({
  rotulo,
  valor,
  tom = 'texto',
}: {
  rotulo: string;
  valor: string;
  tom?: 'texto' | 'negativo' | 'positivo';
}) {
  return (
    <View style={{ minWidth: 120, flexGrow: 1, gap: 2 }}>
      <Txt tipo="rotulo" tom="textoFraco">
        {rotulo}
      </Txt>
      <Txt tipo="corpo" negrito tom={tom}>
        {valor}
      </Txt>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Seletor de janela
// ---------------------------------------------------------------------------

function SeletorDeJanela({
  valor,
  onMudar,
}: {
  valor: number;
  onMudar: (dias: (typeof JANELAS)[number]) => void;
}) {
  const { cores } = useTema();
  return (
    <Linha style={{ gap: Espaco.xs }}>
      {JANELAS.map((dias) => {
        const ativo = dias === valor;
        return (
          <Pressable
            key={dias}
            accessibilityRole="button"
            accessibilityState={{ selected: ativo }}
            onPress={() => onMudar(dias)}
            style={{
              // Eram ~32 px de altura: é a troca de período do gráfico, ela
              // usa de verdade, e não é destrutiva.
              minHeight: Touch.alvoSecundario,
              justifyContent: 'center',
              paddingHorizontal: Espaco.md,
              borderRadius: Raio.pill,
              borderWidth: 1,
              borderColor: ativo ? cores.primaria : cores.borda,
              backgroundColor: ativo ? cores.primaria : 'transparent',
            }}>
            <Txt tipo="rotulo" negrito={ativo} tom={ativo ? 'primariaTexto' : 'textoFraco'}>
              {dias} dias
            </Txt>
          </Pressable>
        );
      })}
    </Linha>
  );
}

// ---------------------------------------------------------------------------
// Por produto
// ---------------------------------------------------------------------------

function PorProduto({
  linhas,
  carregando,
}: {
  linhas: { produto_id: string; nome: string; unidades: number; receita: number; lucro: number }[];
  carregando: boolean;
}) {
  const { grafico } = useTema();

  if (carregando) return <Carregando />;

  const comVenda = linhas.filter((linha) => linha.unidades > 0);
  if (comVenda.length === 0) {
    return <Vazio titulo="Nenhuma venda nos últimos 30 dias" />;
  }

  // A barra é proporcional ao MAIOR lucro em módulo, então um produto no
  // prejuízo aparece do mesmo tamanho que um lucro equivalente -- o que é o
  // ponto: a comparação é de peso no resultado, com o sinal na cor e no valor.
  const teto = Math.max(...comVenda.map((linha) => Math.abs(linha.lucro)), 1);

  return (
    <Cartao style={{ gap: Espaco.lg }}>
      {comVenda.map((linha) => {
        const negativo = linha.lucro < 0;
        return (
          <View key={linha.produto_id} style={{ gap: Espaco.xs }}>
            <Linha entre>
              <Txt tipo="corpo" negrito numberOfLines={1} style={{ flex: 1 }}>
                {linha.nome}
              </Txt>
              <Txt tipo="corpo" negrito tom={negativo ? 'negativo' : 'positivo'}>
                {dinheiro(linha.lucro)}
              </Txt>
            </Linha>
            <View
              style={{
                height: 10,
                borderRadius: Raio.sm,
                overflow: 'hidden',
                backgroundColor: 'transparent',
              }}>
              {/* Em preto e branco `prejuizo` e `lucro` são a MESMA tinta (ver
                  `Grafico` em constants/theme), então aqui o que separa é a
                  barra vazada com contorno -- o mesmo papel que a hachura faz
                  no gráfico de dias. Pintar as duas de sólido deixaria um
                  produto no prejuízo idêntico a um no lucro. */}
              <View
                style={{
                  height: '100%',
                  width: `${Math.max(2, (Math.abs(linha.lucro) / teto) * 100)}%`,
                  borderRadius: Raio.sm,
                  backgroundColor: negativo ? 'transparent' : grafico.lucro,
                  borderWidth: negativo ? 1.5 : 0,
                  borderColor: grafico.prejuizo,
                }}
              />
            </View>
            <Txt tipo="rotulo" tom="textoFraco">
              {inteiro(linha.unidades)} un. · {dinheiro(linha.receita)} de venda
              {negativo ? ' · vendendo abaixo do custo' : ''}
            </Txt>
          </View>
        );
      })}
    </Cartao>
  );
}

// ---------------------------------------------------------------------------
// Lista de reposição
// ---------------------------------------------------------------------------

function ParaComprar({
  linhas,
  carregando,
}: {
  linhas: ReturnType<typeof useParaComprar>['data'];
  carregando: boolean;
}) {
  if (carregando) return <Carregando />;
  if (!linhas || linhas.length === 0) {
    return (
      <Vazio
        titulo="Nenhum ingrediente cadastrado"
        dica="Fotografe uma nota na aba Notinha: os ingredientes entram sozinhos."
      />
    );
  }

  // Só o que pede atenção: negativo (compra não lançada) ou menos de 3 dias de
  // estoque. Listar tudo transformaria a seção em inventário e ela pararia de
  // olhar -- o que some junto é o aviso do que está acabando.
  const urgentes = linhas.filter(
    (linha) =>
      linha.estoque_base < 0 || (linha.dias_restantes !== null && linha.dias_restantes < 3),
  );

  if (urgentes.length === 0) {
    return <Vazio titulo="Estoque tranquilo" dica="Nada acabando nos próximos dias." />;
  }

  return (
    <Cartao style={{ gap: Espaco.md }}>
      {urgentes.map((linha) => {
        const negativo = linha.estoque_base < 0;
        return (
          <View key={linha.id} style={{ gap: 2 }}>
            <Linha entre>
              <Txt tipo="corpo" negrito numberOfLines={1} style={{ flex: 1 }}>
                {linha.nome}
              </Txt>
              <Txt tipo="corpo" tom={negativo ? 'negativo' : 'atencao'} negrito>
                {saldo(linha.estoque_base, linha.unidade)}
              </Txt>
            </Linha>
            <Txt tipo="rotulo" tom="textoFraco">
              {negativo
                ? 'Saldo negativo: falta lançar a nota dessa compra.'
                : `Dá para uns ${quantidade(Math.floor(linha.dias_restantes ?? 0))} dia(s) no ritmo da semana.`}
            </Txt>
          </View>
        );
      })}
    </Cartao>
  );
}
