import { router } from 'expo-router';
import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, View, type TextStyle } from 'react-native';

import { Icone, type NomeIcone } from '@/components/icone';
import {
  Aviso,
  Botao,
  Carregando,
  Cartao,
  Divisor,
  Linha,
  Tela,
  Txt,
  Vazio,
} from '@/components/ui';
import { Espaco, Raio, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import {
  useCancelarPedido,
  useCancelarVenda,
  useFechamento,
  useResumoPorDia,
  useVendasDoDia,
  type DiaResumo,
  type Fechamento,
  type Pagamento,
  type VendaDoDia,
} from '@/lib/dados';
import {
  diaDaSemana,
  diaMes,
  dinheiro,
  dinheiroSemSinal,
  hora,
  inteiro,
  quantidade,
} from '@/lib/formato';
import { hojeDaSerie, somarDias } from '@/lib/periodo';

/**
 * A mesma série de 31 dias do hub (a lista abre do cache), mostrando só os
 * últimos 30.
 */
const SERIE = 31;
const DIAS = 30;

const NUMERAL: TextStyle = { fontVariant: ['tabular-nums'] };

const FORMAS: {
  forma: Pagamento;
  rotulo: string;
  campo: 'em_dinheiro' | 'em_pix' | 'em_cartao';
}[] = [
  { forma: 'dinheiro', rotulo: 'Dinheiro', campo: 'em_dinheiro' },
  { forma: 'pix', rotulo: 'Pix', campo: 'em_pix' },
  { forma: 'cartao', rotulo: 'Cartão', campo: 'em_cartao' },
];

const NOME_DA_FORMA: Record<Pagamento, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao: 'Cartão',
};

/** Resposta do Desfazer. */
type Recado = { tom: 'positivo' | 'negativo' | 'atencao'; texto: string };

function mensagem(falha: unknown, padrao: string) {
  return falha instanceof Error ? falha.message : padrao;
}

export default function Historico() {
  const serie = useResumoPorDia(SERIE);
  // Um dia aberto por vez: cada um abre uma lista inteira de vendas, e dois
  // abertos empurram o segundo pra fora da tela.
  const [aberto, setAberto] = useState<string | null>(null);
  // Mora aqui, e não no dia aberto: desfazer a última venda do dia tira o dia
  // da lista (a série refaz), e o recado sumiria junto com ele.
  const [recado, setRecado] = useState<Recado | null>(null);

  const dias = serie.data ?? [];
  // O "hoje" do banco: é ele que decide onde o Desfazer aparece. Com o relógio
  // do celular, a venda das 23h50 poderia ficar sem Desfazer (ou ganhar um no
  // dia seguinte).
  const hoje = hojeDaSerie(dias);
  const desde = somarDias(hoje, -(DIAS - 1));

  // Só dia com venda: o que abre embaixo é a lista de vendas, e um dia só de
  // compra abriria vazio. A série já exclui as canceladas das somas.
  const comMovimento = dias
    .filter((d) => d.dia.slice(0, 10) >= desde && (d.atendimentos > 0 || d.receita > 0))
    .sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0));

  return (
    <Tela titulo="Histórico" voltar atualizando={serie.isFetching && !serie.isLoading}>
      {recado ? (
        <View style={{ marginBottom: Espaco.md }}>
          <Aviso tom={recado.tom}>{recado.texto}</Aviso>
        </View>
      ) : null}

      {serie.error ? (
        <Aviso tom="negativo">{mensagem(serie.error, 'Não consegui carregar o histórico.')}</Aviso>
      ) : serie.isLoading ? (
        <Carregando />
      ) : comMovimento.length === 0 ? (
        <Vazio
          titulo="Nenhuma venda ainda"
          acao={{ rotulo: 'Vender', onPress: () => router.navigate('/vender') }}
        />
      ) : (
        <>
          <Txt tipo="rotulo" tom="textoFraco">
            Últimos {DIAS} dias
          </Txt>
          <Cartao style={{ marginTop: Espaco.md, paddingVertical: Espaco.xs }}>
            {comMovimento.map((resumo, i) => {
              const dia = resumo.dia.slice(0, 10);
              return (
                <Fragment key={dia}>
                  {i > 0 ? <Divisor /> : null}
                  <Dia
                    resumo={resumo}
                    ehHoje={dia === hoje}
                    aberto={aberto === dia}
                    onAlternar={() => {
                      setRecado(null);
                      setAberto(aberto === dia ? null : dia);
                    }}
                    onRecado={setRecado}
                  />
                </Fragment>
              );
            })}
          </Cartao>
        </>
      )}
    </Tela>
  );
}

function Dia({
  resumo,
  ehHoje,
  aberto,
  onAlternar,
  onRecado,
}: {
  resumo: DiaResumo;
  ehHoje: boolean;
  aberto: boolean;
  onAlternar: () => void;
  onRecado: (recado: Recado | null) => void;
}) {
  const { cores } = useTema();
  const dia = resumo.dia.slice(0, 10);
  const nome = `${ehHoje ? 'hoje' : diaDaSemana(dia)}, ${diaMes(dia)}`;
  const prejuizo = resumo.lucro_vendas < 0;
  const vendas = resumo.atendimentos;
  const palavra = prejuizo ? 'prejuízo' : 'lucro';

  return (
    <View>
      {/* `aria-expanded`: sem ele o leitor de tela anuncia igual com o dia
          aberto e fechado, e a seta que diz isso pro olho não é lida. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${nome}: vendas ${dinheiro(resumo.receita)}, ${palavra} ${dinheiroSemSinal(resumo.lucro_vendas)}`}
        aria-expanded={aberto}
        onPress={onAlternar}
        style={({ pressed }) => [estilos.cabecalho, { opacity: pressed ? 0.6 : 1 }]}>
        <View style={{ flex: 1, gap: Espaco.xs }}>
          <Linha entre>
            <Txt tipo="corpo" negrito>
              {nome}
            </Txt>
            <Txt tipo="secao" style={NUMERAL}>
              {dinheiro(resumo.receita)}
            </Txt>
          </Linha>
          <Linha entre>
            <Txt tipo="rotulo" tom="textoFraco">
              {vendas === 1 ? '1 venda' : `${inteiro(vendas)} vendas`}
            </Txt>
            {/* A palavra vem escrita ("lucro"/"prejuízo"): é ela, não o tom,
                que diz de que lado o dia fechou. */}
            <Txt
              tipo="rotulo"
              tom={prejuizo ? 'negativo' : 'textoFraco'}
              negrito={prejuizo}
              style={NUMERAL}>
              {palavra} {dinheiroSemSinal(resumo.lucro_vendas)}
            </Txt>
          </Linha>
        </View>
        <View style={{ transform: [{ rotate: aberto ? '-90deg' : '90deg' }] }}>
          <Icone nome="seguir" tamanho={20} cor={cores.textoFraco} />
        </View>
      </Pressable>

      {/* Montado só quando aberto: as duas consultas do dia saem na hora do
          toque, não trinta de uma vez ao abrir a tela. */}
      {aberto ? <DetalheDoDia dia={dia} ehHoje={ehHoje} onRecado={onRecado} /> : null}
    </View>
  );
}

/** Um pedido (ou uma venda antiga, de antes do pedido existir). */
type Pedido = {
  /** `pedido ?? id`: a venda antiga vira um "pedido" de uma linha só. */
  chave: string;
  pedido: string | null;
  linhas: VendaDoDia[];
  total: number;
  pagamento: Pagamento | null;
  vendida_em: string;
};

/**
 * Junta as linhas do mesmo pedido. `vendas_do_dia` já entrega as linhas de um
 * pedido juntas e a mais recente primeiro; o `Map` guarda a ordem de chegada,
 * então a lista sai na mesma ordem.
 */
function agruparPedidos(vendas: VendaDoDia[]): Pedido[] {
  const pedidos = new Map<string, Pedido>();
  for (const venda of vendas) {
    const chave = venda.pedido ?? venda.id;
    const atual = pedidos.get(chave);
    if (atual) {
      atual.linhas.push(venda);
      atual.total += venda.total || 0;
    } else {
      pedidos.set(chave, {
        chave,
        pedido: venda.pedido,
        linhas: [venda],
        total: venda.total || 0,
        pagamento: venda.pagamento,
        vendida_em: venda.vendida_em,
      });
    }
  }
  return [...pedidos.values()];
}

function DetalheDoDia({
  dia,
  ehHoje,
  onRecado,
}: {
  dia: string;
  ehHoje: boolean;
  onRecado: (recado: Recado | null) => void;
}) {
  const vendas = useVendasDoDia(dia);
  const fechamento = useFechamento(dia);
  const cancelarPedido = useCancelarPedido();
  const cancelarVenda = useCancelarVenda();
  // O RPC devolve as canceladas também (o banco guarda o rastro); quem
  // esconde é a tela.
  const pedidos = agruparPedidos((vendas.data ?? []).filter((v) => v.cancelada_em === null));

  async function desfazer(p: Pedido) {
    onRecado(null);
    try {
      // Pedido desfaz inteiro, num caminho só no banco. A venda antiga, sem
      // pedido, só tem o caminho de uma linha.
      const desfez = p.pedido
        ? (await cancelarPedido.mutateAsync(p.pedido)) > 0
        : await cancelarVenda.mutateAsync(p.chave);
      onRecado(
        desfez
          ? { tom: 'positivo', texto: `Venda de ${dinheiro(p.total)} desfeita` }
          : { tom: 'atencao', texto: 'Essa venda já estava desfeita.' },
      );
    } catch (falha) {
      onRecado({ tom: 'negativo', texto: mensagem(falha, 'Não consegui desfazer a venda.') });
    }
  }

  const desfazendo = (p: Pedido) =>
    p.pedido
      ? cancelarPedido.isPending && cancelarPedido.variables === p.pedido
      : cancelarVenda.isPending && cancelarVenda.variables === p.chave;

  return (
    <View style={estilos.detalhe}>
      {fechamento.data ? <PorForma fechamento={fechamento.data} /> : null}

      {vendas.error ? (
        <Aviso tom="negativo">{mensagem(vendas.error, 'Não consegui carregar as vendas.')}</Aviso>
      ) : vendas.isLoading ? (
        <Carregando />
      ) : pedidos.length === 0 ? (
        <Txt tipo="rotulo" tom="textoFraco">
          Nenhuma venda neste dia.
        </Txt>
      ) : (
        pedidos.map((p) => (
          <LinhaDePedido
            key={p.chave}
            pedido={p}
            ehHoje={ehHoje}
            ocupado={desfazendo(p)}
            onDesfazer={() => desfazer(p)}
          />
        ))
      )}
    </View>
  );
}

/**
 * Quanto entrou em cada forma: é a conferência do fim do dia (o dinheiro na
 * gaveta, o Pix no extrato, o cartão na maquininha).
 */
function PorForma({ fechamento }: { fechamento: Fechamento }) {
  const { cores } = useTema();
  const linhas: { chave: string; icone: NomeIcone | null; rotulo: string; valor: number }[] =
    FORMAS.map(({ forma, rotulo, campo }) => ({
      chave: forma,
      icone: forma,
      rotulo,
      valor: fechamento[campo] || 0,
    })).filter((linha) => linha.valor > 0);

  // Venda de antes do campo existir não tem forma e não entra em nenhuma das
  // três. Sem esta linha, as formas somariam menos que o dia e pareceria que
  // sumiu dinheiro.
  const semForma =
    (fechamento.receita || 0) -
    (fechamento.em_dinheiro || 0) -
    (fechamento.em_pix || 0) -
    (fechamento.em_cartao || 0);
  if (semForma > 0.005) {
    linhas.push({ chave: 'sem-forma', icone: null, rotulo: 'Sem forma', valor: semForma });
  }

  if (linhas.length === 0) return null;

  return (
    <Cartao tom="superficieAlt" plano style={estilos.formas}>
      {linhas.map((linha) => (
        <View
          key={linha.chave}
          accessible
          accessibilityLabel={`${linha.rotulo}, ${dinheiro(linha.valor)}`}
          style={estilos.forma}>
          <View style={estilos.iconeForma}>
            {linha.icone ? <Icone nome={linha.icone} tamanho={20} cor={cores.texto} /> : null}
          </View>
          <Txt tipo="corpo" style={{ flex: 1 }}>
            {linha.rotulo}
          </Txt>
          <Txt tipo="corpo" negrito style={NUMERAL}>
            {dinheiro(linha.valor)}
          </Txt>
        </View>
      ))}
    </Cartao>
  );
}

function LinhaDePedido({
  pedido,
  ehHoje,
  ocupado,
  onDesfazer,
}: {
  pedido: Pedido;
  ehHoje: boolean;
  ocupado: boolean;
  onDesfazer: () => void;
}) {
  const { cores } = useTema();
  const itens = pedido.linhas
    .map((linha) => `${quantidade(linha.quantidade)}× ${linha.nome}`)
    .join(', ');
  const quando = hora(pedido.vendida_em);
  // Venda antiga não tem forma: fica sem palavra, em vez de um "Dinheiro"
  // inventado.
  const forma = pedido.pagamento ? NOME_DA_FORMA[pedido.pagamento] : null;

  return (
    <View style={{ gap: Espaco.xs }}>
      {/* Um elemento só pro leitor de tela com tudo do pedido; a linha de
          baixo repete hora e forma pro olho e fica escondida dele. */}
      <View
        accessible
        accessibilityLabel={[itens, quando, forma, dinheiro(pedido.total)]
          .filter(Boolean)
          .join(', ')}
        style={estilos.linhaPedido}>
        <Txt tipo="corpo" negrito style={{ flex: 1 }}>
          {itens}
        </Txt>
        <Txt tipo="corpo" negrito style={NUMERAL}>
          {dinheiro(pedido.total)}
        </Txt>
      </View>
      <Linha entre style={{ minHeight: ehHoje ? Touch.alvoSecundario : undefined }}>
        <View
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={estilos.quando}>
          {pedido.pagamento ? (
            <Icone nome={pedido.pagamento} tamanho={16} cor={cores.textoFraco} />
          ) : null}
          <Txt tipo="rotulo" tom="textoFraco" style={NUMERAL}>
            {forma ? `${quando} · ${forma}` : quando}
          </Txt>
        </View>
        {/* Só hoje: desfazer venda de dia passado mudaria um fechamento que
            ela já conferiu. 44 px e não 56 de propósito -- aqui o erro caro é
            o toque sem querer. */}
        {ehHoje ? (
          <Botao
            variante="perigo"
            onPress={onDesfazer}
            ocupado={ocupado}
            rotuloAcessivel={`Desfazer venda das ${quando}, ${dinheiro(pedido.total)}`}
            style={estilos.desfazer}>
            Desfazer
          </Botao>
        ) : null}
      </Linha>
    </View>
  );
}

const estilos = StyleSheet.create({
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Espaco.md,
    minHeight: Touch.alvo,
    paddingVertical: Espaco.md,
  },
  detalhe: {
    gap: Espaco.lg,
    paddingBottom: Espaco.lg,
  },
  formas: {
    padding: Espaco.md,
    gap: Espaco.sm,
    borderRadius: Raio.md,
  },
  forma: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Espaco.sm,
  },
  iconeForma: {
    width: 20,
    alignItems: 'center',
  },
  linhaPedido: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Espaco.md,
  },
  quando: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Espaco.xs,
    flexShrink: 1,
  },
  desfazer: {
    minHeight: Touch.alvoSecundario,
    paddingHorizontal: Espaco.md,
  },
});
