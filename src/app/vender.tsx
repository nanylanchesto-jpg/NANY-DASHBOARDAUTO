/**
 * Vender: o caixa da barraca.
 *
 * Tocar no produto soma 1 ao pedido, o "−" tira 1. Com a forma de pagamento
 * escolhida, "Finalizar" grava o pedido inteiro numa chamada só
 * (`registrar_pedido`). É um toque a mais por venda do que gravar cada toque
 * na hora, e é ele que permite saber a forma de pagamento e contar 2 hot-dogs
 * + 1 suco como UM atendimento.
 *
 * O que ela toca a cada venda fica embaixo, no alcance do polegar: forma de
 * pagamento e "Finalizar" moram no rodapé fixo do `Tela`, fora da rolagem, e a
 * grade rola acima dele sem nunca ficar escondida atrás. O rodapé só existe
 * com pedido aberto (ou com um recado a dar): sem pedido, a tela é só a grade.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icone, type NomeIcone } from '@/components/icone';
import {
  Aviso,
  Botao,
  Carregando,
  Linha,
  Segmentos,
  Tela,
  Txt,
  Vazio,
  estiloSombra,
} from '@/components/ui';
import { Espaco, Peso, Raio, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import {
  useCancelarPedido,
  useProdutos,
  useRegistrarPedido,
  type Pagamento,
  type Produto,
} from '@/lib/dados';
import { dinheiro, inteiro } from '@/lib/formato';

/** produto_id → quantidade. Só fica quem tem 1 ou mais. */
type Carrinho = Record<string, number>;

/** O que o rodapé tem a dizer além do pedido. Um recado por vez. */
type Recado =
  | { tipo: 'registrada'; pedido: string; total: number; itens: Carrinho }
  | { tipo: 'desfeita' }
  | { tipo: 'erro'; texto: string }
  | { tipo: 'erroAoDesfazer'; texto: string; pedido: string; itens: Carrinho };

const FORMAS: { valor: Pagamento; rotulo: string; icone: NomeIcone }[] = [
  { valor: 'dinheiro', rotulo: 'Dinheiro', icone: 'dinheiro' },
  { valor: 'pix', rotulo: 'Pix', icone: 'pix' },
  { valor: 'cartao', rotulo: 'Cartão', icone: 'cartao' },
];

const CHAVE_FORMA = 'nany.forma-de-pagamento';

/**
 * Tempo do "Desfazer" na tela. ~6 s dá pra perceber o engano enquanto entrega
 * o lanche; mais que isso, o recado da venda anterior ainda estaria ali no meio
 * do atendimento seguinte.
 */
const JANELA_DESFAZER = 6000;
const TEMPO_DESFEITA = 3000;

/**
 * Borda do bloco escolhido. Desenhada SEMPRE (transparente quando não
 * escolhido): se ela só aparecesse no toque, o conteúdo do bloco andaria
 * 2,5 px bem debaixo do dedo.
 */
const BORDA = 2.5;

/**
 * A forma da última venda. Quase toda venda do dia sai do mesmo jeito, e
 * escolher de novo a cada cliente seria um toque a mais por venda.
 *
 * Na primeira vez, NENHUMA vem marcada: um "dinheiro" inventado gravaria a
 * forma errada calado sempre que ela esquecesse de trocar -- o mesmo motivo
 * pelo qual o banco deixa nula a forma das vendas antigas.
 *
 * AsyncStorage (localStorage no web) e não o banco: é conveniência deste
 * aparelho, não dado. E com try/catch porque aba anônima e armazenamento
 * bloqueado lançam, e sem lembrar a forma o app continua vendendo.
 */
async function lerFormaLembrada(): Promise<Pagamento | null> {
  try {
    const lida = await AsyncStorage.getItem(CHAVE_FORMA);
    return lida === 'dinheiro' || lida === 'pix' || lida === 'cartao' ? lida : null;
  } catch {
    return null;
  }
}

async function lembrarForma(forma: Pagamento) {
  try {
    await AsyncStorage.setItem(CHAVE_FORMA, forma);
  } catch {
    // Só deixa de lembrar na próxima abertura; a venda de agora não depende disso.
  }
}

/** A mensagem do banco já vem em pt-BR; a de rede não ("Failed to fetch"). */
function motivo(falha: unknown): string {
  const mensagem = falha instanceof Error ? falha.message : '';
  if (!mensagem || /fetch|network/i.test(mensagem)) return 'Confira a internet e tente de novo.';
  return mensagem;
}

/** Tira do carrinho o que já foi gravado, sem apagar o que entrou depois. */
function descontar(carrinho: Carrinho, gravado: Carrinho): Carrinho {
  const resto: Carrinho = { ...carrinho };
  for (const [id, quantidade] of Object.entries(gravado)) {
    const sobra = (resto[id] ?? 0) - quantidade;
    if (sobra > 0) resto[id] = sobra;
    else delete resto[id];
  }
  return resto;
}

/**
 * Em pares, e não `flexWrap` com largura em %: a porcentagem não desconta o
 * `gap`, e o bloco que sobrasse sozinho na última fileira esticaria na largura
 * inteira. No par, os dois blocos também ficam da mesma altura quando um nome
 * quebra em duas linhas.
 */
function emPares<T>(lista: T[]): [T, T | undefined][] {
  const pares: [T, T | undefined][] = [];
  for (let i = 0; i < lista.length; i += 2) pares.push([lista[i], lista[i + 1]]);
  return pares;
}

export default function Vender() {
  const produtos = useProdutos();
  const registrar = useRegistrarPedido();
  const cancelar = useCancelarPedido();
  const router = useRouter();

  const [carrinho, setCarrinho] = useState<Carrinho>({});
  const [forma, setForma] = useState<Pagamento | null>(null);
  const [recado, setRecado] = useState<Recado | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `ocupado` trava o botão, mas só no render seguinte: um toque duplo rápido
  // chega antes dele e gravaria o pedido duas vezes. A trava de verdade é esta.
  const enviando = useRef(false);
  const desfazendo = useRef(false);

  // Sem isso o timer dispara depois da tela sair e o React avisa de atualização
  // em componente desmontado -- e o aviso reapareceria na volta pra aba.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    let montada = true;
    lerFormaLembrada().then((lida) => {
      // `atual ??`: se ela já tocou numa forma antes da leitura voltar, vale o toque.
      if (montada && lida) setForma((atual) => atual ?? lida);
    });
    return () => {
      montada = false;
    };
  }, []);

  const ativos = (produtos.data ?? []).filter((produto) => produto.ativo);
  // Montado a partir de `ativos`: produto desativado noutra tela no meio do
  // pedido sai sozinho do total, em vez de ir pro banco e voltar como erro.
  const itens = ativos.flatMap((produto) => {
    const quantidade = carrinho[produto.id] ?? 0;
    return quantidade > 0 ? [{ produto, quantidade }] : [];
  });
  const unidades = itens.reduce((soma, item) => soma + item.quantidade, 0);
  // Estimativa pra ela cobrar o cliente. Quem grava o preço é o banco, pela
  // tabela (`fecha_venda`), então um cache velho aqui não vira venda errada.
  const total = itens.reduce((soma, item) => soma + item.produto.preco_venda * item.quantidade, 0);

  function pararTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function mostrar(novo: Recado | null, duracao?: number) {
    pararTimer();
    setRecado(novo);
    if (novo && duracao) timer.current = setTimeout(() => setRecado(null), duracao);
  }

  function somar(produto: Produto) {
    setCarrinho((atual) => ({ ...atual, [produto.id]: (atual[produto.id] ?? 0) + 1 }));
  }

  function tirar(produto: Produto) {
    setCarrinho((atual) => descontar(atual, { [produto.id]: 1 }));
  }

  function limpar() {
    setCarrinho({});
    // O erro era sobre o pedido que acabou de sair; o recado de uma venda já
    // gravada continua, com o Desfazer dela.
    if (recado?.tipo === 'erro') mostrar(null);
  }

  function escolherForma(nova: Pagamento) {
    setForma(nova);
    void lembrarForma(nova);
  }

  async function finalizar() {
    if (enviando.current || !forma || itens.length === 0) return;
    enviando.current = true;
    const gravado: Carrinho = Object.fromEntries(
      itens.map(({ produto, quantidade }) => [produto.id, quantidade]),
    );
    const valor = total;
    mostrar(null);
    try {
      const pedido = await registrar.mutateAsync({ itens, pagamento: forma });
      // Descontar, e não zerar: o que ela tocou enquanto a chamada ia e voltava
      // já é o pedido do próximo cliente.
      setCarrinho((atual) => descontar(atual, gravado));
      mostrar({ tipo: 'registrada', pedido, total: valor, itens: gravado }, JANELA_DESFAZER);
    } catch (falha) {
      // O pedido fica como estava: é só tocar em Finalizar de novo.
      mostrar({ tipo: 'erro', texto: `Venda não registrada. ${motivo(falha)}` });
    } finally {
      enviando.current = false;
    }
  }

  /**
   * Desfazer é voltar ao estado de antes do Finalizar: com o carrinho vazio, o
   * pedido desfeito volta pra ele. O motivo comum de desfazer é engano (item ou
   * forma errados), e aí ela corrige e finaliza de novo em vez de tocar tudo
   * outra vez. Se já começou o pedido seguinte, ele não é misturado.
   */
  async function desfazer(pedido: string, itensDoPedido: Carrinho) {
    if (desfazendo.current) return;
    desfazendo.current = true;
    // O recado não pode sumir no meio da chamada: o rodapé piscaria.
    pararTimer();
    try {
      await cancelar.mutateAsync(pedido);
      setCarrinho((atual) => (Object.keys(atual).length === 0 ? itensDoPedido : atual));
      mostrar({ tipo: 'desfeita' }, TEMPO_DESFEITA);
    } catch (falha) {
      mostrar({
        tipo: 'erroAoDesfazer',
        texto: `Não consegui desfazer. ${motivo(falha)}`,
        pedido,
        itens: itensDoPedido,
      });
    } finally {
      desfazendo.current = false;
    }
  }

  let aviso: ReactNode = null;
  if (recado?.tipo === 'registrada') {
    const { pedido, itens: doPedido } = recado;
    aviso = (
      <Aviso
        tom="positivo"
        // Sem ação enquanto desfaz: o spinner do cabeçalho diz que está indo.
        acao={
          cancelar.isPending
            ? undefined
            : { rotulo: 'Desfazer', onPress: () => desfazer(pedido, doPedido) }
        }>
        {`Venda de ${dinheiro(recado.total)} registrada`}
      </Aviso>
    );
  } else if (recado?.tipo === 'desfeita') {
    aviso = <Aviso tom="positivo">Venda desfeita</Aviso>;
  } else if (recado?.tipo === 'erro') {
    aviso = <Aviso tom="negativo">{recado.texto}</Aviso>;
  } else if (recado?.tipo === 'erroAoDesfazer') {
    const { pedido, itens: doPedido } = recado;
    aviso = (
      <Aviso
        tom="negativo"
        acao={
          cancelar.isPending
            ? undefined
            : { rotulo: 'Tentar de novo', onPress: () => desfazer(pedido, doPedido) }
        }>
        {recado.texto}
      </Aviso>
    );
  }

  const temPedido = itens.length > 0;
  const rotuloItens = `${inteiro(unidades)} ${unidades === 1 ? 'item' : 'itens'}`;

  const rodape =
    temPedido || aviso ? (
      <>
        {aviso}
        {/* Sem internet no web, a mutation espera a conexão em vez de falhar.
            O spinner do Finalizar sozinho pareceria travado. */}
        {registrar.isPaused ? (
          <Aviso tom="atencao">Sem internet: a venda vai quando a conexão voltar</Aviso>
        ) : null}
        {temPedido ? (
          <>
            <Linha entre>
              <View
                accessible
                accessibilityLabel={`Total ${dinheiro(total)}, ${rotuloItens}`}
                style={estilos.total}>
                <Txt tipo="numero" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {dinheiro(total)}
                </Txt>
                <Txt tipo="rotulo" tom="textoFraco" numberOfLines={1}>
                  {rotuloItens}
                </Txt>
              </View>
              <Botao
                variante="fantasma"
                onPress={limpar}
                desabilitado={registrar.isPending}
                rotuloAcessivel="Limpar pedido"
                style={estilos.limpar}>
                Limpar
              </Botao>
            </Linha>
            <Segmentos
              opcoes={FORMAS}
              valor={forma}
              onMudar={escolherForma}
              rotuloAcessivel="Forma de pagamento"
            />
            <Botao
              grande
              icone="ok"
              onPress={finalizar}
              ocupado={registrar.isPending}
              desabilitado={!forma}
              // Travado sem forma, o botão não diz por quê a quem não vê o
              // trilho vazio logo acima; o nome acessível diz.
              rotuloAcessivel={
                forma
                  ? `Finalizar venda de ${dinheiro(total)}`
                  : 'Finalizar. Escolha a forma de pagamento'
              }>
              Finalizar
            </Botao>
          </>
        ) : null}
      </>
    ) : undefined;

  let conteudo: ReactNode;
  if (produtos.isPending) {
    // `isPending` e não `isLoading`: sem internet a consulta fica pausada, e
    // `isLoading` falso cairia no "Cadastre seus produtos" -- mandando ela
    // cadastrar de novo o que já existe.
    conteudo =
      produtos.fetchStatus === 'paused' ? (
        <Aviso tom="atencao">Sem internet: os produtos aparecem quando a conexão voltar</Aviso>
      ) : (
        <Carregando />
      );
  } else if (produtos.isError && !produtos.data) {
    conteudo = (
      <Aviso
        tom="negativo"
        acao={{ rotulo: 'Tentar de novo', onPress: () => void produtos.refetch() }}>
        {`Não consegui abrir os produtos. ${motivo(produtos.error)}`}
      </Aviso>
    );
  } else if (ativos.length === 0) {
    conteudo = (
      <View style={estilos.centro}>
        <Vazio
          titulo="Cadastre seus produtos"
          acao={{ rotulo: 'Ir para Produtos', onPress: () => router.push('/planejar/produtos') }}
        />
      </View>
    );
  } else {
    conteudo = (
      <View style={estilos.grade}>
        {emPares(ativos).map(([a, b]) => (
          <View key={a.id} style={estilos.fileira}>
            <BlocoDeProduto
              produto={a}
              quantidade={carrinho[a.id] ?? 0}
              onSomar={() => somar(a)}
              onTirar={() => tirar(a)}
            />
            {b ? (
              <BlocoDeProduto
                produto={b}
                quantidade={carrinho[b.id] ?? 0}
                onSomar={() => somar(b)}
                onTirar={() => tirar(b)}
              />
            ) : (
              <View style={estilos.celula} />
            )}
          </View>
        ))}
      </View>
    );
  }

  return (
    <Tela titulo="Vender" rodape={rodape} atualizando={cancelar.isPending}>
      {conteudo}
    </Tela>
  );
}

/**
 * Bloco de um produto. Alto (`alvoGrande`) e com o nome grande porque o toque
 * acontece de lado, com uma mão, enquanto ela atende -- é o momento em que o
 * registro mais provavelmente deixa de acontecer.
 *
 * Sem custo nem lucro aqui: o aviso de produto sem custo mora em Hoje e em
 * Produtos. No meio do atendimento ele só disputaria atenção com o preço, que
 * é o único número que ela confere com o cliente.
 *
 * O "−" é IRMÃO do bloco, por cima do canto, e não filho dele: botão dentro de
 * botão some pro leitor de tela no iOS (o de fora engole o de dentro) e é HTML
 * inválido no web.
 */
function BlocoDeProduto({
  produto,
  quantidade,
  onSomar,
  onTirar,
}: {
  produto: Produto;
  quantidade: number;
  onSomar: () => void;
  onTirar: () => void;
}) {
  const { cores } = useTema();
  const escolhido = quantidade > 0;
  const preco = dinheiro(produto.preco_venda);

  return (
    <View style={estilos.celula}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          escolhido ? `${produto.nome}, ${preco}, ${quantidade} no pedido` : `${produto.nome}, ${preco}`
        }
        accessibilityHint="Soma um ao pedido"
        onPress={onSomar}
        style={({ pressed }) => [
          estilos.bloco,
          estiloSombra(cores.sombra),
          {
            backgroundColor: pressed ? cores.superficieAlt : cores.superficie,
            borderColor: escolhido ? cores.marca : 'transparent',
          },
        ]}>
        <Txt tipo="secao" numberOfLines={2} style={estilos.nome}>
          {produto.nome}
        </Txt>
        <View style={estilos.linhaPreco}>
          <Txt tipo="corpo" tom="textoFraco" numberOfLines={1}>
            {preco}
          </Txt>
        </View>
      </Pressable>

      {escolhido ? (
        <>
          {/* Decorativo pro leitor de tela: a quantidade já está no nome do
              bloco. `pointerEvents: none` deixa o toque na quina chegar ao
              bloco em vez de morrer no contador. */}
          <View
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[estilos.contador, { backgroundColor: cores.inverso, borderColor: cores.fundo }]}>
            <Txt tipo="corpo" tom="inversoTexto" style={estilos.numeroContador}>
              {inteiro(quantidade)}
            </Txt>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Tirar 1 ${produto.nome}`}
            onPress={onTirar}
            style={({ pressed }) => [
              estilos.menos,
              {
                backgroundColor: pressed ? cores.superficieAlt : cores.superficie,
                borderColor: cores.borda,
              },
            ]}>
            <Icone nome="menos" tamanho={22} cor={cores.texto} espessura={2.5} />
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

/** Diâmetro do contador de itens na quina do bloco. */
const CONTADOR = 32;

const estilos = StyleSheet.create({
  centro: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  grade: {
    gap: Espaco.lg,
    // O contador sai `Espaco.sm` pra fora da quina: sem este respiro, o da
    // primeira fileira seria cortado pela borda de cima da rolagem.
    paddingTop: Espaco.sm,
  },
  fileira: {
    flexDirection: 'row',
    gap: Espaco.lg,
  },
  celula: {
    flex: 1,
  },
  bloco: {
    flexGrow: 1,
    minHeight: Touch.alvoGrande,
    borderRadius: Raio.lg,
    borderWidth: BORDA,
    paddingTop: Espaco.lg,
    paddingHorizontal: Espaco.lg,
    paddingBottom: Espaco.sm,
    justifyContent: 'space-between',
    gap: Espaco.xs,
  },
  nome: {
    fontWeight: Peso.pesado,
    // Folga pro contador, que invade um pouco a quina de cima.
    paddingRight: Espaco.sm,
  },
  linhaPreco: {
    // Da altura do "−" e alinhada com ele; o recuo à direita é o lugar dele.
    minHeight: Touch.alvoSecundario,
    justifyContent: 'center',
    paddingRight: Touch.alvoSecundario,
  },
  contador: {
    position: 'absolute',
    top: -Espaco.sm,
    right: -Espaco.sm,
    minWidth: CONTADOR,
    minHeight: CONTADOR,
    paddingHorizontal: Espaco.xs,
    borderRadius: Raio.pill,
    // Anel na cor do fundo: separa o contador da borda tomate que ele cruza.
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  numeroContador: {
    fontWeight: Peso.pesado,
    fontVariant: ['tabular-nums'],
  },
  menos: {
    position: 'absolute',
    right: BORDA + Espaco.sm,
    bottom: BORDA + Espaco.sm,
    width: Touch.alvoSecundario,
    height: Touch.alvoSecundario,
    borderRadius: Raio.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  total: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Espaco.sm,
    flexShrink: 1,
  },
  limpar: {
    minHeight: Touch.alvoSecundario,
    paddingHorizontal: Espaco.md,
    // Alinha o texto do botão transparente com a borda do Finalizar abaixo.
    marginRight: -Espaco.md,
  },
});
