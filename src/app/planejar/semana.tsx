import { router } from 'expo-router';
import { Fragment } from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';

import { GraficoBarras } from '@/components/grafico-barras';
import {
  Aviso,
  BarraProgresso,
  Botao,
  Carregando,
  Cartao,
  Divisor,
  Indicador,
  Linha,
  Secao,
  Tela,
  Txt,
  Vazio,
} from '@/components/ui';
import { Espaco, Touch } from '@/constants/theme';
import { useMetas, useParaComprar, useResumoPorDia, type ParaComprar } from '@/lib/dados';
import { dinheiro, intervaloCurto, saldo } from '@/lib/formato';
import {
  diasDaSemana,
  diasRestantes,
  fimDoPeriodo,
  hojeDaSerie,
  inicioDoPeriodo,
  planoDeCompras,
  somaPeriodo,
  type ItemDoPlano,
} from '@/lib/periodo';

/** A mesma série do hub: a semana sai do cache, sem outra ida ao banco. */
const SERIE = 31;

/** Quantos dias de estoque a lista de compras cobre: a semana que vem inteira. */
const DIAS_DO_PLANO = 7;

const NUMERAL: TextStyle = { fontVariant: ['tabular-nums'] };

function mensagem(falha: unknown, padrao: string) {
  return falha instanceof Error ? falha.message : padrao;
}

export default function Semana() {
  const serie = useResumoPorDia(SERIE);
  const metas = useMetas();
  const estoque = useParaComprar();

  const dias = serie.data ?? [];
  // Hoje do banco: com o relógio do celular a semana poderia virar num dia
  // diferente do que o fechamento soma.
  const hoje = hojeDaSerie(dias);
  const soma = somaPeriodo(dias, 'semana', hoje);

  const metaSemana = metas.data?.find((m) => m.periodo === 'semana' && m.valor > 0)?.valor ?? null;
  const metaDia = metas.data?.find((m) => m.periodo === 'dia' && m.valor > 0)?.valor;

  // Segunda a domingo, com zero nos dias sem linha na série. Os dias que
  // ainda não chegaram o gráfico deixa em branco (prop `hoje`), em vez de
  // desenhar como dia de venda zero.
  const receitaDoDia = new Map(dias.map((d) => [d.dia.slice(0, 10), d.receita]));
  const pontos = diasDaSemana(hoje).map((dia) => ({ dia, valor: receitaDoDia.get(dia) ?? 0 }));

  return (
    <Tela titulo="Semana" voltar atualizando={serie.isFetching && !serie.isLoading}>
      {serie.error ? (
        <Aviso tom="negativo">{mensagem(serie.error, 'Não consegui carregar a semana.')}</Aviso>
      ) : serie.isLoading ? (
        <Carregando />
      ) : (
        <Cartao style={{ gap: Espaco.xl }}>
          <Indicador
            grande
            rotulo="Vendas"
            valor={dinheiro(soma.receita)}
            legenda={intervaloCurto(inicioDoPeriodo('semana', hoje), fimDoPeriodo('semana', hoje))}
          />
          {metaSemana ? (
            <MetaDaSemana
              atual={soma.receita}
              alvo={metaSemana}
              restantes={diasRestantes('semana', hoje)}
            />
          ) : null}
          <GraficoBarras modo="vendas" pontos={pontos} hoje={hoje} meta={metaDia} />
        </Cartao>
      )}

      <Secao titulo="Comprar pra semana">
        {estoque.error ? (
          <Aviso tom="negativo">
            {mensagem(estoque.error, 'Não consegui carregar o estoque.')}
          </Aviso>
        ) : estoque.isLoading ? (
          <Carregando />
        ) : (
          <ListaDeCompra itens={estoque.data ?? []} />
        )}
      </Secao>

      {/* A ação da tela: a lista acima vira compra, e a compra entra pela
          foto da nota -- é ela que faz o estoque subir e a lista encolher. */}
      <Botao
        grande
        icone="camera"
        onPress={() => router.push('/planejar/compras')}
        style={{ marginTop: Espaco.xl }}>
        Fotografar nota
      </Botao>
    </Tela>
  );
}

function MetaDaSemana({
  atual,
  alvo,
  restantes,
}: {
  atual: number;
  alvo: number;
  /** Dias até domingo, contando hoje (nunca menos que 1). */
  restantes: number;
}) {
  const falta = alvo - atual;
  const batida = falta <= 0;

  return (
    <View style={{ gap: Espaco.sm }}>
      <Linha entre>
        <Txt tipo="rotulo" tom="textoFraco">
          Meta da semana
        </Txt>
        {/* A palavra diz que bateu; a barra cheia só muda de tinta. */}
        <Txt tipo="rotulo" negrito tom={batida ? 'positivo' : 'texto'} style={NUMERAL}>
          {batida ? '✓ batida' : `faltam ${dinheiro(falta)}`}
        </Txt>
      </Linha>
      <BarraProgresso atual={atual} alvo={alvo} rotuloAcessivel="Meta da semana" />
      {/* O quanto por dia é o que vira ação ("hoje preciso de R$ 60"). No
          domingo não aparece: o "faltam" acima já é o de hoje. */}
      {!batida && restantes > 1 ? (
        <Txt tipo="rotulo" tom="textoFraco" style={NUMERAL}>
          {dinheiro(falta / restantes)} por dia até domingo
        </Txt>
      ) : null}
    </View>
  );
}

function ListaDeCompra({ itens }: { itens: ParaComprar[] }) {
  if (itens.length === 0) {
    return <Vazio titulo="Nenhum ingrediente" dica="Eles entram com a primeira nota." />;
  }

  const plano = planoDeCompras(itens, DIAS_DO_PLANO);
  if (plano.length === 0) return <Vazio titulo="Nada a comprar" />;

  // Soma de estimativas pra exibir, não saldo de estoque: quem guarda o
  // estoque é o banco. O til no valor diz que é estimativa.
  const total = plano.reduce((soma, item) => soma + item.custo, 0);

  return (
    <Cartao style={{ paddingVertical: Espaco.xs }}>
      {plano.map((item, i) => (
        <Fragment key={item.id}>
          {i > 0 ? <Divisor /> : null}
          <LinhaDoPlano item={item} />
        </Fragment>
      ))}
      {/* Só sem nenhum preço o total some: "~R$ 0,00" diria que a compra da
          semana sai de graça. */}
      {total > 0 ? (
        <>
          <Divisor />
          <View
            accessible
            accessibilityLabel={`Total estimado, cerca de ${dinheiro(total)}`}
            style={estilos.linha}>
            <Txt tipo="corpo" negrito style={{ flex: 1 }}>
              Total estimado
            </Txt>
            <Txt tipo="secao" style={NUMERAL}>
              ~{dinheiro(total)}
            </Txt>
          </View>
        </>
      ) : null}
    </Cartao>
  );
}

function LinhaDoPlano({ item }: { item: ItemDoPlano }) {
  const quanto = saldo(item.necessidade, item.unidade);
  // Ingrediente que nunca foi comprado não tem custo médio: "~R$ 0,00" diria
  // que é de graça.
  const temPreco = item.custo > 0;

  return (
    <View
      accessible
      accessibilityLabel={`${item.nome}, ${quanto}, ${temPreco ? `cerca de ${dinheiro(item.custo)}` : 'sem preço'}`}
      style={estilos.linha}>
      <View style={{ flex: 1, gap: Espaco.xs }}>
        <Txt tipo="corpo" negrito numberOfLines={1}>
          {item.nome}
        </Txt>
        <Txt tipo="rotulo" tom="textoFraco" style={NUMERAL}>
          {quanto}
        </Txt>
      </View>
      {temPreco ? (
        <Txt tipo="corpo" negrito style={NUMERAL}>
          ~{dinheiro(item.custo)}
        </Txt>
      ) : (
        <Txt tipo="rotulo" tom="textoFraco">
          sem preço
        </Txt>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Espaco.md,
    minHeight: Touch.alvo,
    paddingVertical: Espaco.md,
  },
});
