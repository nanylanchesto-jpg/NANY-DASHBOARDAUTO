import { Fragment, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Icone } from '@/components/icone';
import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  Divisor,
  Ficha,
  Linha,
  Secao,
  Tela,
  Txt,
  Vazio,
  type TomTexto,
} from '@/components/ui';
import { Espaco, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import {
  custoDoProduto,
  useApagarItemReceita,
  useApagarProduto,
  useCriarProdutoDeRevenda,
  useIngredientes,
  useProdutos,
  useReceita,
  useSalvarItemReceita,
  useSalvarProduto,
  type Ingrediente,
  type Produto,
} from '@/lib/dados';
import { dinheiro, numeroDeTexto, quantidade } from '@/lib/formato';
import {
  daBase,
  dimensaoDe,
  paraBase,
  ROTULO_UNIDADE,
  UNIDADES_POR_DIMENSAO,
  unidadeDeExibicao,
  type Unidade,
} from '@/lib/unidades';

/** Valor de `aberto` quando o que está aberto é o formulário de produto novo. */
const NOVO = 'novo';

/** Botão quadrado de 44 px só com o ícone: o `gap` zerado centraliza o ✕. */
const QUADRADO = {
  width: Touch.alvoSecundario,
  minHeight: Touch.alvoSecundario,
  paddingHorizontal: 0,
  gap: 0,
} as const;

/** "12,50": o número como ela digita, pra preencher campo de texto. */
const paraCampo = (valor: number) => valor.toFixed(2).replace('.', ',');

const erroDe = (falha: unknown, padrao: string) =>
  falha instanceof Error ? falha.message : padrao;

export default function Produtos() {
  const produtos = useProdutos();
  const ingredientes = useIngredientes();
  // Um aberto por vez (produto ou o formulário novo): dois formulários
  // abertos numa tela de celular são dois lugares pra perder o que digitou.
  const [aberto, setAberto] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const lista = produtos.data ?? [];
  const ativos = lista.filter((p) => p.ativo);
  const inativos = lista.filter((p) => !p.ativo);

  function alternar(id: string) {
    setRecado(null);
    setAberto((atual) => (atual === id ? null : id));
  }

  const grupo = (itens: Produto[]) => (
    <Cartao style={{ paddingVertical: Espaco.xs }}>
      {itens.map((produto, indice) => (
        <Fragment key={produto.id}>
          {indice > 0 ? <Divisor /> : null}
          <LinhaDeProduto
            produto={produto}
            ingredientes={ingredientes.data ?? []}
            aberto={aberto === produto.id}
            onAlternar={() => alternar(produto.id)}
            onApagado={() => setAberto(null)}
          />
        </Fragment>
      ))}
    </Cartao>
  );

  return (
    <Tela
      titulo="Produtos"
      voltar
      atualizando={produtos.isFetching && !produtos.isLoading}>
      {produtos.error ? (
        <Aviso tom="negativo">{erroDe(produtos.error, 'Não consegui carregar os produtos.')}</Aviso>
      ) : produtos.isLoading ? (
        <Carregando />
      ) : (
        <>
          {lista.length === 0 ? (
            <Vazio titulo="Nenhum produto ainda" dica="Comece pelo hot-dog." />
          ) : null}
          {ativos.length > 0 ? grupo(ativos) : null}
          {/* Separados, e com título escrito: o desativado não aparece no
              Vender, e isso tem que estar dito, não só num tom mais apagado. */}
          {inativos.length > 0 ? <Secao titulo="Fora da venda">{grupo(inativos)}</Secao> : null}

          <View style={{ marginTop: Espaco.xl, gap: Espaco.md }}>
            {recado ? <Aviso tom="positivo">{recado}</Aviso> : null}
            {aberto === NOVO ? (
              <NovoProduto
                onFechar={() => setAberto(null)}
                onCriado={(id, montarReceita) => {
                  // Produto feito por ela nasce sem receita, e receita é o
                  // próximo passo: já abre ele. O de revenda já nasce com a
                  // receita de 1 unidade montada pelo banco.
                  setAberto(montarReceita ? id : null);
                  setRecado(montarReceita ? 'Produto cadastrado. Agora, a receita.' : 'Produto cadastrado');
                }}
              />
            ) : aberto === null ? (
              // Some enquanto um produto está aberto: aí a ação da tela é o
              // "Salvar" dele, e mostarda é uma por tela.
              <Botao
                icone="mais"
                onPress={() => {
                  setRecado(null);
                  setAberto(NOVO);
                }}>
                Novo produto
              </Botao>
            ) : null}
          </View>
        </>
      )}
    </Tela>
  );
}

// ---------------------------------------------------------------------------
// Linha da lista
// ---------------------------------------------------------------------------

type EstadoDoCusto = { texto: string; tom: TomTexto; alerta: boolean };

/**
 * A linha de baixo de cada produto. A regra de QUAL custo mostrar é de
 * `custoDoProduto` (apurado ganha do estimado); aqui só vira texto.
 *
 * "estimado" escrito, não uma cor ou um til discreto: é a diferença entre um
 * número que ela pode levar pro fechamento e um que não, e a cor sozinha não
 * diz isso a quem não distingue o tom. Pelo mesmo motivo o negativo vem com a
 * palavra "prejuízo", e não só com o sinal.
 */
function estadoDoCusto(produto: Produto): EstadoDoCusto {
  const custo = custoDoProduto(produto);
  if (custo.tipo === 'ausente') {
    // Desativado sem custo não pede nada: ele não está sendo vendido.
    return { texto: 'sem custo', tom: produto.ativo ? 'atencao' : 'textoFraco', alerta: produto.ativo };
  }
  const resultado =
    custo.lucro < 0 ? `prejuízo ${dinheiro(-custo.lucro)}` : `lucro ${dinheiro(custo.lucro)}`;
  if (custo.tipo === 'estimado') {
    return { texto: `estimado: ${resultado}`, tom: 'atencao', alerta: false };
  }
  return {
    texto: resultado,
    tom: custo.lucro < 0 ? 'negativo' : custo.lucro > 0 ? 'positivo' : 'textoFraco',
    alerta: false,
  };
}

function LinhaDeProduto({
  produto,
  ingredientes,
  aberto,
  onAlternar,
  onApagado,
}: {
  produto: Produto;
  ingredientes: Ingrediente[];
  aberto: boolean;
  onAlternar: () => void;
  onApagado: () => void;
}) {
  const { cores } = useTema();
  const estado = estadoDoCusto(produto);

  return (
    <View>
      {/* `aria-expanded` porque isto é um expansor, não um botão comum: sem o
          estado, o leitor de tela anuncia a mesma coisa com o produto aberto e
          fechado, e a seta que diz isso pro olho não é lida. `aria-*` e não
          `accessibilityState`, que o react-native-web descarta (ver ui.tsx). */}
      <Pressable
        accessibilityRole="button"
        aria-expanded={aberto}
        accessibilityLabel={`${produto.nome}, ${dinheiro(produto.preco_venda)}, ${estado.texto}`}
        onPress={onAlternar}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: Espaco.md,
          minHeight: Touch.alvo,
          paddingVertical: Espaco.md,
          opacity: pressed ? 0.6 : 1,
        })}>
        <View style={{ flex: 1 }}>
          <Txt tipo="secao" numberOfLines={2}>
            {produto.nome}
          </Txt>
          <Linha style={{ gap: Espaco.xs }}>
            {estado.alerta ? (
              <Icone nome="alerta" tamanho={16} cor={cores.atencao} espessura={2.5} />
            ) : null}
            <Txt tipo="rotulo" tom={estado.tom} negrito={estado.alerta} style={{ flexShrink: 1 }}>
              {estado.texto}
            </Txt>
          </Linha>
        </View>
        <Txt tipo="numero">{dinheiro(produto.preco_venda)}</Txt>
        <View style={{ transform: [{ rotate: aberto ? '-90deg' : '90deg' }] }}>
          <Icone nome="seguir" tamanho={20} cor={cores.textoFraco} />
        </View>
      </Pressable>

      {aberto ? (
        <EditorDeProduto produto={produto} ingredientes={ingredientes} onApagado={onApagado} />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Edição
// ---------------------------------------------------------------------------

function EditorDeProduto({
  produto,
  ingredientes,
  onApagado,
}: {
  produto: Produto;
  ingredientes: Ingrediente[];
  onApagado: () => void;
}) {
  const salvar = useSalvarProduto();
  const apagar = useApagarProduto();
  const [nome, setNome] = useState(produto.nome);
  const [preco, setPreco] = useState(paraCampo(produto.preco_venda));
  // Vazio quando não há palpite, e não "0,00": um zero digitado no campo é
  // indistinguível de um zero que só quer dizer "não estimei".
  const [estimado, setEstimado] = useState(
    produto.custo_estimado > 0 ? paraCampo(produto.custo_estimado) : '',
  );
  // Um recado por lugar: o erro do "Salvar" lá em cima não pode aparecer
  // embaixo, perto do "Apagar", e vice-versa.
  const [erroDados, setErroDados] = useState<string | null>(null);
  const [erroFim, setErroFim] = useState<string | null>(null);

  const apurado = custoDoProduto(produto).tipo === 'apurado';

  const alterado =
    nome.trim() !== produto.nome ||
    Math.abs(numeroDeTexto(preco) - produto.preco_venda) > 0.001 ||
    Math.abs(numeroDeTexto(estimado) - produto.custo_estimado) > 0.001;

  // As duas escritas passam pela mesma mutation; `ativo` na variável diz qual
  // delas está em andamento, pra girar só o botão que ela tocou.
  const trocandoVenda = salvar.isPending && salvar.variables?.ativo !== undefined;
  const salvandoDados = salvar.isPending && salvar.variables?.ativo === undefined;

  return (
    <View style={{ gap: Espaco.md, paddingBottom: Espaco.lg }}>
      <Campo rotulo="Nome" value={nome} onChangeText={setNome} maxLength={120} />
      <Linha style={{ alignItems: 'flex-start' }}>
        <Campo
          rotulo="Preço"
          prefixo="R$"
          value={preco}
          onChangeText={setPreco}
          inputMode="decimal"
          keyboardType="decimal-pad"
          style={{ flex: 1 }}
        />
        <Campo
          rotulo="Custo estimado"
          prefixo="R$"
          value={estimado}
          onChangeText={setEstimado}
          placeholder="opcional"
          inputMode="decimal"
          keyboardType="decimal-pad"
          style={{ flex: 1 }}
        />
      </Linha>
      {/* O palpite só vale enquanto não há custo apurado (ver
          `custoDoProduto`): depois da primeira nota ele fica guardado, mas
          nenhuma tela mostra mais -- e ela precisa saber disso ao editar. */}
      <Txt tipo="rotulo" tom="textoFraco">
        {apurado ? 'A receita já dá o custo real.' : 'Palpite até a receita ter o custo real.'}
      </Txt>
      {erroDados ? <Aviso tom="negativo">{erroDados}</Aviso> : null}
      {alterado ? (
        <Botao
          ocupado={salvandoDados}
          onPress={async () => {
            setErroDados(null);
            try {
              await salvar.mutateAsync({
                id: produto.id,
                nome,
                preco_venda: numeroDeTexto(preco),
                ordem: produto.ordem,
                custo_estimado: numeroDeTexto(estimado),
              });
            } catch (falha) {
              setErroDados(erroDe(falha, 'Não consegui salvar.'));
            }
          }}>
          Salvar
        </Botao>
      ) : null}

      <Divisor />
      <EditorDeReceita produto={produto} ingredientes={ingredientes} />
      <Divisor />

      {erroFim ? <Aviso tom="negativo">{erroFim}</Aviso> : null}
      <Linha style={{ gap: Espaco.sm }}>
        {/* Tirar da venda some com o produto do Vender sem tocar no
            histórico. É a saída pro produto que ela parou de fazer: apagar
            não é permitido quando já houve venda (a FK é restrita, senão o
            fechamento daqueles dias mudaria sozinho). */}
        <Botao
          variante="secundaria"
          ocupado={trocandoVenda}
          style={{ flex: 1 }}
          onPress={async () => {
            setErroFim(null);
            try {
              await salvar.mutateAsync({
                id: produto.id,
                nome: produto.nome,
                preco_venda: produto.preco_venda,
                ordem: produto.ordem,
                ativo: !produto.ativo,
              });
            } catch (falha) {
              setErroFim(erroDe(falha, 'Não consegui salvar.'));
            }
          }}>
          {produto.ativo ? 'Tirar da venda' : 'Voltar à venda'}
        </Botao>
        <Botao
          variante="perigo"
          icone="lixo"
          rotuloAcessivel={`Apagar ${produto.nome}`}
          ocupado={apagar.isPending}
          style={{ minHeight: Touch.alvoSecundario, paddingHorizontal: Espaco.md }}
          onPress={async () => {
            setErroFim(null);
            try {
              await apagar.mutateAsync(produto.id);
              onApagado();
            } catch (falha) {
              setErroFim(erroDe(falha, 'Não consegui apagar.'));
            }
          }}>
          Apagar
        </Botao>
      </Linha>
    </View>
  );
}

function EditorDeReceita({
  produto,
  ingredientes,
}: {
  produto: Produto;
  ingredientes: Ingrediente[];
}) {
  const { cores } = useTema();
  const receita = useReceita(produto.id);
  const salvarItem = useSalvarItemReceita();
  const apagarItem = useApagarItemReceita();

  const [escolhido, setEscolhido] = useState<Ingrediente | null>(null);
  const [qtd, setQtd] = useState('');
  const [unidade, setUnidade] = useState<Unidade>('unidade');
  const [erro, setErro] = useState<string | null>(null);

  const itens = receita.data ?? [];
  const jaNaReceita = new Set(itens.map((item) => item.ingrediente_id));
  const disponiveis = ingredientes.filter((ing) => !jaNaReceita.has(ing.id));

  function escolher(ingrediente: Ingrediente) {
    setEscolhido(ingrediente);
    // Já abre na unidade de USO: molho comprado em kg entra na receita em g,
    // porque ninguém escreve "0,02 kg de molho" numa receita.
    const opcoes = UNIDADES_POR_DIMENSAO[dimensaoDe(ingrediente.unidade)];
    setUnidade((opcoes[0] ?? 'unidade') as Unidade);
  }

  return (
    <View style={{ gap: Espaco.md }}>
      <Txt tipo="corpo" negrito>
        Receita de 1 {produto.nome.toLowerCase()}
      </Txt>

      {receita.error ? (
        <Aviso tom="negativo">{erroDe(receita.error, 'Não consegui carregar a receita.')}</Aviso>
      ) : receita.isLoading ? (
        <Carregando />
      ) : itens.length === 0 ? (
        <Linha style={{ gap: Espaco.xs }}>
          <Icone nome="alerta" tamanho={16} cor={cores.atencao} espessura={2.5} />
          <Txt tipo="rotulo" tom="atencao" negrito style={{ flexShrink: 1 }}>
            Sem ingredientes: o custo real ainda não existe.
          </Txt>
        </Linha>
      ) : (
        <View>
          {itens.map((item) => {
            const ing = item.ingredientes;
            const nomeIng = ing?.nome ?? 'ingrediente';
            const unidadeIng = (ing?.unidade ?? 'unidade') as Unidade;
            const mostrar = unidadeDeExibicao(item.quantidade_base, unidadeIng);
            // Custo desta linha pra UM produto, pelo custo médio atual. É só
            // exibição: o custo que vale é o de `produtos_com_custo`.
            const custo = item.quantidade_base * (ing?.custo_base ?? 0);
            return (
              <Linha key={item.id} style={{ minHeight: Touch.alvo, gap: Espaco.md }}>
                <Txt tipo="corpo" numberOfLines={2} style={{ flex: 1 }}>
                  {quantidade(daBase(item.quantidade_base, mostrar))} {ROTULO_UNIDADE[mostrar]} de{' '}
                  {nomeIng}
                </Txt>
                {/* "sem preço", não "R$ 0,00": ingrediente nunca comprado não
                    custa zero, só ainda não tem custo. */}
                <Txt tipo="rotulo" tom="textoFraco">
                  {custo > 0 ? dinheiro(custo) : 'sem preço'}
                </Txt>
                <Botao
                  variante="perigo"
                  icone="fechar"
                  rotuloAcessivel={`Remover ${nomeIng} da receita de ${produto.nome}`}
                  ocupado={apagarItem.isPending && apagarItem.variables?.id === item.id}
                  style={QUADRADO}
                  onPress={async () => {
                    setErro(null);
                    try {
                      await apagarItem.mutateAsync({ id: item.id, produto_id: produto.id });
                    } catch (falha) {
                      setErro(erroDe(falha, 'Não consegui remover.'));
                    }
                  }}>
                  {''}
                </Botao>
              </Linha>
            );
          })}
        </View>
      )}

      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}

      {disponiveis.length > 0 ? (
        <View style={{ gap: Espaco.sm }}>
          <Txt tipo="rotulo" tom="textoFraco">
            Adicionar ingrediente
          </Txt>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={`Ingrediente para a receita de ${produto.nome}`}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Espaco.sm }}>
            {disponiveis.map((ing) => (
              <Ficha
                key={ing.id}
                rotulo={ing.nome}
                ativo={escolhido?.id === ing.id}
                onPress={() => escolher(ing)}
              />
            ))}
          </View>

          {escolhido ? (
            <Linha style={{ alignItems: 'flex-end', marginTop: Espaco.xs }}>
              <Campo
                rotulo={`Quanto de ${escolhido.nome}`}
                value={qtd}
                onChangeText={setQtd}
                inputMode="decimal"
                keyboardType="decimal-pad"
                style={{ flex: 1 }}
              />
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Unidade"
                // Centraliza as fichas (44) na caixa do campo (56).
                style={{
                  flexDirection: 'row',
                  gap: Espaco.xs,
                  marginBottom: (Touch.alvo - Touch.alvoSecundario) / 2,
                }}>
                {UNIDADES_POR_DIMENSAO[dimensaoDe(escolhido.unidade)].map((u) => (
                  <Ficha
                    key={u}
                    rotulo={ROTULO_UNIDADE[u]}
                    ativo={unidade === u}
                    onPress={() => setUnidade(u)}
                  />
                ))}
              </View>
            </Linha>
          ) : null}

          {escolhido && numeroDeTexto(qtd) > 0 ? (
            <Botao
              variante="secundaria"
              icone="mais"
              ocupado={salvarItem.isPending}
              onPress={async () => {
                setErro(null);
                try {
                  await salvarItem.mutateAsync({
                    produto_id: produto.id,
                    ingrediente_id: escolhido.id,
                    quantidade_base: paraBase(numeroDeTexto(qtd), unidade),
                  });
                  setEscolhido(null);
                  setQtd('');
                } catch (falha) {
                  setErro(erroDe(falha, 'Não consegui adicionar.'));
                }
              }}>
              Adicionar à receita
            </Botao>
          ) : null}
        </View>
      ) : ingredientes.length === 0 ? (
        <Txt tipo="rotulo" tom="textoFraco">
          Ingrediente entra pela nota ou pelo Estoque.
        </Txt>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Produto novo
// ---------------------------------------------------------------------------

/**
 * Cadastro de produto, nos dois jeitos que ela realmente vende.
 *
 * FEITO POR MIM: hot-dog, suco. O custo sai da receita, que ela monta depois
 * ingrediente a ingrediente. Até a primeira nota entrar, o custo é 0 -- e é pra
 * essa espera que existe o palpite opcional.
 *
 * REVENDA: Coca, água, salgadinho. Comprado pronto, vendido pronto. Por baixo
 * continua sendo produto + ingrediente + receita de 1 unidade, igualzinho ao
 * hot-dog; o que muda é que a tela monta os três de uma vez, porque ninguém
 * descobre sozinho que pra vender uma Coca precisa cadastrar um "ingrediente
 * Coca". E o preço pago vira COMPRA de verdade, não um número digitado: entra
 * no caixa do dia, soma no estoque e alimenta a média ponderada.
 */
function NovoProduto({
  onFechar,
  onCriado,
}: {
  onFechar: () => void;
  /** `montarReceita`: produto feito por ela, que ainda não tem receita. */
  onCriado: (id: string, montarReceita: boolean) => void;
}) {
  const salvar = useSalvarProduto();
  const criarRevenda = useCriarProdutoDeRevenda();

  const [revenda, setRevenda] = useState(false);
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');
  const [estimado, setEstimado] = useState('');
  const [comprada, setComprada] = useState('');
  const [precoPago, setPrecoPago] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const ocupado = salvar.isPending || criarRevenda.isPending;
  const pronto = nome.trim().length > 0 && numeroDeTexto(preco) > 0;

  async function cadastrar() {
    setErro(null);
    try {
      if (revenda) {
        const id = await criarRevenda.mutateAsync({
          nome,
          preco_venda: numeroDeTexto(preco),
          quantidade: numeroDeTexto(comprada),
          preco_pago: numeroDeTexto(precoPago),
        });
        onCriado(id, false);
      } else {
        const id = await salvar.mutateAsync({
          nome,
          preco_venda: numeroDeTexto(preco),
          custo_estimado: numeroDeTexto(estimado),
        });
        onCriado(id, true);
      }
    } catch (falha) {
      setErro(erroDe(falha, 'Não consegui cadastrar.'));
    }
  }

  return (
    <Cartao style={{ gap: Espaco.md }}>
      <Txt tipo="secao" cabecalho>
        Novo produto
      </Txt>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Como chega no balcão"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Espaco.sm }}>
        <Ficha rotulo="Eu faço" ativo={!revenda} onPress={() => setRevenda(false)} />
        <Ficha rotulo="Compro pronto" ativo={revenda} onPress={() => setRevenda(true)} />
      </View>

      {/* Exemplo com "Ex.:" e preço zerado: a tinta de placeholder passa 7:1
          (é `textoFraco`), então "Hot-dog" e "10,00" pareciam já digitados --
          e o "Cadastrar" travado ao lado parecia defeito. */}
      <Campo
        rotulo="Nome"
        value={nome}
        onChangeText={setNome}
        placeholder={revenda ? 'Ex.: Coca lata' : 'Ex.: hot-dog'}
        maxLength={120}
      />
      <Campo
        rotulo="Preço de venda"
        prefixo="R$"
        value={preco}
        onChangeText={setPreco}
        placeholder="0,00"
        inputMode="decimal"
        keyboardType="decimal-pad"
      />

      {revenda ? (
        <>
          <Linha style={{ alignItems: 'flex-start' }}>
            <Campo
              rotulo="Qtd. comprada"
              accessibilityLabel="Quantidade comprada"
              value={comprada}
              onChangeText={setComprada}
              placeholder="opcional"
              inputMode="decimal"
              keyboardType="decimal-pad"
              style={{ flex: 1 }}
            />
            <Campo
              rotulo="Pago por un."
              accessibilityLabel="Preço pago por unidade"
              prefixo="R$"
              value={precoPago}
              onChangeText={setPrecoPago}
              placeholder="0,00"
              inputMode="decimal"
              keyboardType="decimal-pad"
              style={{ flex: 1 }}
            />
          </Linha>
          <Txt tipo="rotulo" tom="textoFraco">
            Vira compra de hoje: entra no caixa e no estoque.
          </Txt>
        </>
      ) : (
        <>
          <Campo
            rotulo="Custo estimado"
            prefixo="R$"
            value={estimado}
            onChangeText={setEstimado}
            placeholder="opcional"
            inputMode="decimal"
            keyboardType="decimal-pad"
          />
          <Txt tipo="rotulo" tom="textoFraco">
            Palpite até a receita ter o custo real.
          </Txt>
        </>
      )}

      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
      <Botao desabilitado={!pronto} ocupado={ocupado} onPress={cadastrar}>
        Cadastrar
      </Botao>
      <Botao variante="fantasma" onPress={onFechar}>
        Cancelar
      </Botao>
    </Cartao>
  );
}
