import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View, type TextStyle } from 'react-native';

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
  Segmentos,
  Tela,
  Txt,
  type TomTexto,
} from '@/components/ui';
import { Espaco } from '@/constants/theme';
import { gastosDe, useMetas, useProdutos, useResumoPorDia, type Periodo } from '@/lib/dados';
import { dinheiro, dinheiroCurto, dinheiroSemSinal } from '@/lib/formato';
import { hojeDaSerie, metaAtiva, somaPeriodo, type SomaPeriodo } from '@/lib/periodo';
import { sair } from '@/lib/sessao';

type Recorte = 'semana' | 'mes';

/**
 * 31 dias: cabe o mês mais longo inteiro, e a semana de sobra. É a MESMA série
 * que Metas, Histórico e o Painel pedem -- quem abre qualquer uma delas
 * depois do hub recebe do cache, sem carregando no meio.
 */
const SERIE = 31;

const RECORTES: { valor: Recorte; rotulo: string }[] = [
  { valor: 'semana', rotulo: 'Semana' },
  { valor: 'mes', rotulo: 'Mês' },
];

/** "R$ 300/dia": o valor curto do item Metas, que mostra só a meta que vale agora. */
const POR: Record<Periodo, string> = { dia: 'dia', semana: 'semana', mes: 'mês' };

const NUMERAL: TextStyle = { fontVariant: ['tabular-nums'] };

function mensagem(falha: unknown) {
  return falha instanceof Error ? falha.message : 'Não consegui carregar os números.';
}

export default function Planejar() {
  const [recorte, setRecorte] = useState<Recorte>('semana');
  const [saindo, setSaindo] = useState(false);
  const qc = useQueryClient();

  const serie = useResumoPorDia(SERIE);
  const metas = useMetas();
  const produtos = useProdutos();

  const dias = serie.data ?? [];
  // "Hoje" do banco (`dia_local()`), não do relógio do celular: a semana dela
  // tem que virar no mesmo dia em que o fechamento vira.
  const hoje = hojeDaSerie(dias);
  const soma = somaPeriodo(dias, recorte, hoje);
  const metaDoRecorte = metas.data?.find((m) => m.periodo === recorte && m.valor > 0) ?? null;
  const ativa = metaAtiva(metas.data);

  const ativos = (produtos.data ?? []).filter((p) => p.ativo);

  async function aoSair() {
    setSaindo(true);
    try {
      await sair();
      // O cache de consultas mora no layout raiz, ACIMA do login. Sem limpar,
      // quem entrar em seguida neste aparelho veria por um instante os números
      // da conta anterior, até cada consulta refazer.
      qc.clear();
    } finally {
      setSaindo(false);
    }
  }

  return (
    <Tela titulo="Planejar" atualizando={serie.isFetching && !serie.isLoading}>
      <Segmentos
        opcoes={RECORTES}
        valor={recorte}
        onMudar={setRecorte}
        rotuloAcessivel="Período dos números"
      />

      <View style={{ marginTop: Espaco.lg }}>
        {serie.error ? (
          <Aviso tom="negativo">{mensagem(serie.error)}</Aviso>
        ) : serie.isLoading ? (
          <Carregando />
        ) : (
          <Resumo soma={soma} recorte={recorte} meta={metaDoRecorte?.valor ?? null} />
        )}
      </View>

      {/* A navegação não depende dos números: se a série falhar, ela ainda
          chega em Gastos e em Produtos. Por isso o cartão fica fora do
          carregando/erro acima. Os valores só aparecem quando existem --
          valor "R$ 0" enquanto carrega seria um número falso.

          Quatro itens, na ordem do uso: gasto ela anota toda semana, produto
          quase nunca muda. Já foram sete (com Semana, Compras e Estoque), e
          a dona se perdia. */}
      <Cartao style={{ marginTop: Espaco.xl, paddingVertical: Espaco.xs }}>
        <ItemLista
          icone="gastos"
          titulo="Gastos"
          valor={serie.data ? dinheiroCurto(gastosDe(soma)) : undefined}
          rotuloAcessivel={
            serie.data
              ? `Gastos, ${dinheiroCurto(gastosDe(soma))} ${recorte === 'semana' ? 'na semana' : 'no mês'}`
              : 'Gastos'
          }
          onPress={() => router.push('/planejar/gastos')}
        />
        <Divisor />
        <ItemLista
          icone="produtos"
          titulo="Produtos"
          valor={
            !produtos.data
              ? undefined
              : ativos.length > 0
                ? `${ativos.length} à venda`
                : 'Cadastrar'
          }
          onPress={() => router.push('/planejar/produtos')}
        />
        <Divisor />
        <ItemLista
          icone="meta"
          titulo="Metas"
          valor={
            !metas.data
              ? undefined
              : ativa
                ? `${dinheiroCurto(ativa.valor)}/${POR[ativa.periodo]}`
                : 'Definir'
          }
          rotuloAcessivel={
            ativa ? `Metas, ${dinheiroCurto(ativa.valor)} por ${POR[ativa.periodo]}` : 'Metas'
          }
          onPress={() => router.push('/planejar/metas')}
        />
        <Divisor />
        <ItemLista
          icone="historico"
          titulo="Histórico de vendas"
          onPress={() => router.push('/planejar/historico')}
        />
      </Cartao>

      <Botao
        variante="fantasma"
        icone="sair"
        ocupado={saindo}
        rotuloAcessivel="Sair da conta"
        // Pra voltar ela precisa da senha; sair sem querer no meio do dia é
        // ficar sem registrar venda até lembrar dela.
        confirmar="Sair mesmo? Vai pedir a senha"
        onPress={aoSair}
        style={{ marginTop: Espaco.xl, alignSelf: 'center', paddingHorizontal: Espaco.xl }}>
        Sair
      </Botao>
    </Tela>
  );
}

// ---------------------------------------------------------------------------
// Números do período
// ---------------------------------------------------------------------------

/**
 * Um número grande (o lucro) e dois pequenos. O lucro é a pergunta do
 * planejamento -- "a semana valeu?" --; vendas e gastos explicam de onde ele
 * veio (lucro = vendas − gastos), e por isso ficam num degrau abaixo.
 */
function Resumo({
  soma,
  recorte,
  meta,
}: {
  soma: SomaPeriodo;
  recorte: Recorte;
  meta: number | null;
}) {
  // "Prejuízo" escrito no rótulo, e não só o tom: o sinal de menos se perde
  // de relance, e a cor não chega pra quem não separa vermelho de verde.
  const tomLucro: TomTexto = soma.lucro > 0 ? 'positivo' : soma.lucro < 0 ? 'negativo' : 'texto';

  return (
    <Cartao style={{ gap: Espaco.xl }}>
      <Indicador
        grande
        rotulo={soma.lucro < 0 ? 'Prejuízo' : 'Lucro'}
        valor={dinheiroSemSinal(soma.lucro)}
        tom={tomLucro}
      />
      <Linha style={{ gap: Espaco.md, alignItems: 'flex-start' }}>
        <Miudo rotulo="Vendas" valor={dinheiroCurto(soma.receita)} />
        {/* Gastos = mercado + o resto (gás, embalagem...). É o que saiu do
            bolso no período, que é o que ela compara com o que entrou. */}
        <Miudo rotulo="Gastos" valor={dinheiroCurto(gastosDe(soma))} />
      </Linha>
      {meta ? (
        <MetaDoRecorte
          nome={recorte === 'semana' ? 'Meta da semana' : 'Meta do mês'}
          atual={soma.receita}
          alvo={meta}
        />
      ) : null}
    </Cartao>
  );
}

/**
 * Número pequeno, três por linha. Sem centavos: "R$ 1.234" cabe em um terço
 * de celular de 360 px; "R$ 1.234,56" quebraria justamente o número.
 */
function Miudo({
  rotulo,
  valor,
  tom = 'texto',
}: {
  rotulo: string;
  valor: string;
  tom?: TomTexto;
}) {
  return (
    <View accessible accessibilityLabel={`${rotulo} ${valor}`} style={{ flex: 1, gap: Espaco.xs }}>
      <Txt tipo="rotulo" tom="textoFraco">
        {rotulo}
      </Txt>
      <Txt tipo="secao" tom={tom} numberOfLines={1} style={NUMERAL}>
        {valor}
      </Txt>
    </View>
  );
}

function MetaDoRecorte({ nome, atual, alvo }: { nome: string; atual: number; alvo: number }) {
  const batida = atual >= alvo;
  return (
    <View style={{ gap: Espaco.sm }}>
      <Linha entre>
        <Txt tipo="rotulo" tom="textoFraco">
          {nome}
        </Txt>
        {/* "✓ batida" escrito: a barra cheia muda de tinta, mas quem diz que
            bateu é a palavra. */}
        <Txt tipo="rotulo" negrito tom={batida ? 'positivo' : 'texto'} style={NUMERAL}>
          {batida ? '✓ batida' : `faltam ${dinheiro(alvo - atual)}`}
        </Txt>
      </Linha>
      <BarraProgresso atual={atual} alvo={alvo} rotuloAcessivel={nome} />
    </View>
  );
}
