import { useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Aviso,
  Botao,
  Campo,
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
import {
  custoDoProduto,
  useApagarItemReceita,
  useApagarProduto,
  useCriarProdutoDeRevenda,
  useIngredientes,
  useProdutos,
  useReceita,
  useSalvarIngrediente,
  useSalvarItemReceita,
  useSalvarProduto,
  type Ingrediente,
  type Produto,
} from '@/lib/dados';
import { dinheiro, numeroDeTexto, quantidade, saldo } from '@/lib/formato';
import {
  daBase,
  dimensaoDe,
  paraBase,
  ROTULO_UNIDADE,
  UNIDADES_POR_DIMENSAO,
  unidadeDeExibicao,
  type Unidade,
} from '@/lib/unidades';

export default function Cadastro() {
  const produtos = useProdutos();
  const ingredientes = useIngredientes();
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  return (
    <Tela>
      <Titulo>Cadastro</Titulo>

      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}

      <Cartao tom="superficieAlt" style={{ gap: Espaco.xs }}>
        <Txt tipo="corpo" negrito>
          Como o custo é calculado
        </Txt>
        <Txt tipo="rotulo" tom="textoFraco">
          Cadastre o que você vende (hot-dog, suco) com o preço. Depois diga o que entra em cada
          um — 1 pão, 1 salsicha, 20 g de molho. O custo sai do preço real das suas compras, e o
          lucro sai daí.
        </Txt>
      </Cartao>

      <Titulo>O que você vende</Titulo>
      {produtos.isLoading ? (
        <Carregando />
      ) : (
        <View style={{ gap: Espaco.md }}>
          {(produtos.data ?? []).map((produto) => (
            <CartaoProduto
              key={produto.id}
              produto={produto}
              ingredientes={ingredientes.data ?? []}
              aberto={aberto === produto.id}
              onAlternar={() => setAberto(aberto === produto.id ? null : produto.id)}
              onErro={setErro}
            />
          ))}
          {(produtos.data ?? []).length === 0 ? (
            <Vazio titulo="Nenhum produto ainda" dica="Comece pelo hot-dog e pelo suco." />
          ) : null}
          <NovoProduto onErro={setErro} />
        </View>
      )}

      

      <Titulo>Ingredientes</Titulo>
      {ingredientes.isLoading ? (
        <Carregando />
      ) : (
        <View style={{ gap: Espaco.md }}>
          {(ingredientes.data ?? []).length === 0 ? (
            <Vazio
              titulo="Nenhum ingrediente"
              dica="Eles entram sozinhos quando você fotografa uma nota."
            />
          ) : (
            <Cartao style={{ gap: Espaco.md }}>
              {(ingredientes.data ?? []).map((ingrediente) => (
                <Linha key={ingrediente.id} entre>
                  <View style={{ flex: 1 }}>
                    <Txt tipo="corpo" negrito numberOfLines={1}>
                      {ingrediente.nome}
                    </Txt>
                    <Txt tipo="rotulo" tom="textoFraco">
                      {/* Custo por unidade de USO, não por unidade-base: "R$ 0,02 / g"
                          não diz nada, "R$ 24,00 / kg" é o preço que ela viu na
                          nota. */}
                      {custoLegivel(ingrediente)}
                    </Txt>
                  </View>
                  <Txt
                    tipo="corpo"
                    negrito
                    tom={ingrediente.estoque_base < 0 ? 'negativo' : 'texto'}>
                    {saldo(ingrediente.estoque_base, ingrediente.unidade)}
                  </Txt>
                </Linha>
              ))}
            </Cartao>
          )}
          <NovoIngrediente onErro={setErro} />
        </View>
      )}
    </Tela>
  );
}

/**
 * "R$ 24,00 / kg" — o custo médio na unidade GRANDE da dimensão.
 *
 * `custo_base` é por unidade-base (grama, mililitro, unidade), e "R$ 0,024 / g"
 * não se compara com nada que ela tenha visto. O preço por quilo é o número da
 * etiqueta do mercado. `unidadeDeExibicao(1000, ...)` devolve justamente a
 * unidade grande da dimensão (kg, l, ou unidade), e `paraBase(1, essa)` é o
 * fator que converte o custo pra ela.
 */
function custoLegivel(ingrediente: Ingrediente) {
  if (ingrediente.custo_base <= 0) return 'Sem preço ainda — lance uma compra';
  const mostrar = unidadeDeExibicao(1000, ingrediente.unidade);
  const porUnidadeGrande = ingrediente.custo_base * paraBase(1, mostrar);
  return `${dinheiro(porUnidadeGrande)} / ${ROTULO_UNIDADE[mostrar]} (médio)`;
}

// ---------------------------------------------------------------------------
// Produto + receita
// ---------------------------------------------------------------------------

function CartaoProduto({
  produto,
  ingredientes,
  aberto,
  onAlternar,
  onErro,
}: {
  produto: Produto;
  ingredientes: Ingrediente[];
  aberto: boolean;
  onAlternar: () => void;
  onErro: (mensagem: string | null) => void;
}) {
  const { cores } = useTema();
  const salvar = useSalvarProduto();
  const apagar = useApagarProduto();
  const [preco, setPreco] = useState(String(produto.preco_venda.toFixed(2)).replace('.', ','));
  const [nome, setNome] = useState(produto.nome);
  // Vazio quando não há palpite, e não "0,00": um zero digitado no campo é
  // indistinguível de um zero que só quer dizer "não estimei".
  const [estimado, setEstimado] = useState(
    produto.custo_estimado > 0 ? String(produto.custo_estimado.toFixed(2)).replace('.', ',') : '',
  );

  const custo = custoDoProduto(produto);

  const alterado =
    nome.trim() !== produto.nome ||
    Math.abs(numeroDeTexto(preco) - produto.preco_venda) > 0.001 ||
    Math.abs(numeroDeTexto(estimado) - produto.custo_estimado) > 0.001;

  return (
    <Cartao style={{ gap: Espaco.md }}>
      {/* `expanded` porque isto é um expansor, não um botão comum: sem o
          estado, o leitor de tela anuncia a mesma coisa com a receita aberta e
          fechada, e a seta ▲/▼ que diz isso pro olho não é lida. */}
      <Pressable
        onPress={onAlternar}
        accessibilityRole="button"
        accessibilityState={{ expanded: aberto }}>
        <Linha entre>
          <View style={{ flex: 1 }}>
            <Txt tipo="titulo" negrito numberOfLines={1}>
              {produto.nome}
              {produto.ativo ? '' : ' (desativado)'}
            </Txt>
            {/* "estimado" escrito, não uma cor ou um til discreto: com a paleta
                em preto e branco não sobra matiz pra dizer isso, e é a diferença
                entre um número que ela pode levar pro fechamento e um que não. */}
            <Txt tipo="rotulo" tom={custo.tipo === 'apurado' ? 'textoFraco' : 'atencao'}>
              {custo.tipo === 'apurado'
                ? `custo ${dinheiro(custo.custo)} · lucro ${dinheiro(custo.lucro)}`
                : custo.tipo === 'estimado'
                  ? `estimado: custo ${dinheiro(custo.custo)} · lucro ${dinheiro(custo.lucro)}`
                  : 'sem receita e sem estimativa — o custo ainda é R$ 0,00'}
            </Txt>
          </View>
          <Txt tipo="numero">{dinheiro(produto.preco_venda)}</Txt>
        </Linha>
        <Txt tipo="rotulo" tom="primaria">
          {aberto ? '▲ fechar' : '▼ receita e preço'}
        </Txt>
      </Pressable>

      {aberto ? (
        <View style={{ gap: Espaco.md, borderTopWidth: 1, borderTopColor: cores.borda, paddingTop: Espaco.md }}>
          <Campo rotulo="Nome" value={nome} onChangeText={setNome} />
          <Campo
            rotulo="Preço de venda"
            value={preco}
            onChangeText={setPreco}
            inputMode="decimal"
            keyboardType="decimal-pad"
          />
          <Campo
            rotulo="Custo estimado"
            value={estimado}
            onChangeText={setEstimado}
            placeholder="deixe vazio se não quiser estimar"
            inputMode="decimal"
            keyboardType="decimal-pad"
          />
          <Txt tipo="rotulo" tom="textoFraco">
            {custo.tipo === 'apurado'
              ? 'A receita abaixo já dá o custo real, então esta estimativa fica guardada e não aparece mais nas telas.'
              : 'Palpite para ver a margem enquanto o custo real não existe. Ele some sozinho assim que a receita tiver o preço das suas compras.'}
          </Txt>
          {alterado ? (
            <Botao
              ocupado={salvar.isPending}
              onPress={async () => {
                onErro(null);
                try {
                  await salvar.mutateAsync({
                    id: produto.id,
                    nome,
                    preco_venda: numeroDeTexto(preco),
                    ordem: produto.ordem,
                    custo_estimado: numeroDeTexto(estimado),
                  });
                } catch (falha) {
                  onErro(falha instanceof Error ? falha.message : 'Não consegui salvar.');
                }
              }}>
              Salvar alterações
            </Botao>
          ) : null}

          <EditorDeReceita produto={produto} ingredientes={ingredientes} onErro={onErro} />

          {/* Desativar tira o produto dos botões de venda sem tocar no
              histórico. É a saída pro produto que ela parou de fazer: apagar
              não é permitido quando já houve venda (a FK é restrita, senão o
              fechamento daqueles dias mudaria sozinho). */}
          <Botao
            variante="secundaria"
            ocupado={salvar.isPending}
            onPress={async () => {
              onErro(null);
              try {
                await salvar.mutateAsync({
                  id: produto.id,
                  nome: produto.nome,
                  preco_venda: produto.preco_venda,
                  ordem: produto.ordem,
                  ativo: !produto.ativo,
                });
              } catch (falha) {
                onErro(falha instanceof Error ? falha.message : 'Não consegui salvar.');
              }
            }}>
            {produto.ativo ? 'Desativar (sai da tela de venda)' : 'Reativar'}
          </Botao>

          <Botao
            variante="perigo"
            ocupado={apagar.isPending}
            onPress={async () => {
              onErro(null);
              try {
                await apagar.mutateAsync(produto.id);
              } catch (falha) {
                onErro(falha instanceof Error ? falha.message : 'Não consegui apagar.');
              }
            }}>
            Apagar produto
          </Botao>
        </View>
      ) : null}
    </Cartao>
  );
}

function EditorDeReceita({
  produto,
  ingredientes,
  onErro,
}: {
  produto: Produto;
  ingredientes: Ingrediente[];
  onErro: (mensagem: string | null) => void;
}) {
  const receita = useReceita(produto.id);
  const salvarItem = useSalvarItemReceita();
  const apagarItem = useApagarItemReceita();

  const [escolhido, setEscolhido] = useState<Ingrediente | null>(null);
  const [qtd, setQtd] = useState('');
  const [unidade, setUnidade] = useState<Unidade>('unidade');

  const jaNaReceita = new Set((receita.data ?? []).map((item) => item.ingrediente_id));
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

      {receita.isLoading ? (
        <Carregando />
      ) : (receita.data ?? []).length === 0 ? (
        <Txt tipo="rotulo" tom="atencao">
          Sem ingredientes: enquanto isso, o lucro deste produto aparece igual ao preço cheio.
        </Txt>
      ) : (
        <View style={{ gap: Espaco.sm }}>
          {(receita.data ?? []).map((item) => {
            const ing = item.ingredientes;
            const unidadeIng = (ing?.unidade ?? 'unidade') as Unidade;
            const mostrar = unidadeDeExibicao(item.quantidade_base, unidadeIng);
            const custo = item.quantidade_base * (ing?.custo_base ?? 0);
            return (
              <Linha key={item.id} entre>
                <View style={{ flex: 1 }}>
                  <Txt tipo="corpo" numberOfLines={1}>
                    {quantidade(daBase(item.quantidade_base, mostrar))} {ROTULO_UNIDADE[mostrar]}{' '}
                    de {ing?.nome ?? 'ingrediente'}
                  </Txt>
                  <Txt tipo="rotulo" tom="textoFraco">
                    {dinheiro(custo)} por unidade
                  </Txt>
                </View>
                <Botao
                  variante="perigo"
                  rotuloAcessivel={`Remover ${ing?.nome ?? 'ingrediente'} da receita de ${produto.nome}`}
                  // Era 40 px de altura por ~25 de largura: o menor alvo do
                  // app inteiro, sem rótulo, e apaga item de receita.
                  style={{
                    minHeight: Touch.alvoSecundario,
                    minWidth: Touch.alvoSecundario,
                    paddingHorizontal: Espaco.sm,
                  }}
                  onPress={async () => {
                    onErro(null);
                    try {
                      await apagarItem.mutateAsync({ id: item.id, produto_id: produto.id });
                    } catch (falha) {
                      onErro(falha instanceof Error ? falha.message : 'Não consegui remover.');
                    }
                  }}>
                  ✕
                </Botao>
              </Linha>
            );
          })}
        </View>
      )}

      {disponiveis.length > 0 ? (
        <View style={{ gap: Espaco.sm }}>
          <Txt tipo="rotulo" tom="textoFraco">
            Adicionar ingrediente
          </Txt>
          <Linha style={{ flexWrap: 'wrap', gap: Espaco.xs }}>
            {disponiveis.map((ing) => (
              <Ficha
                key={ing.id}
                rotulo={ing.nome}
                ativo={escolhido?.id === ing.id}
                onPress={() => escolher(ing)}
              />
            ))}
          </Linha>

          {escolhido ? (
            <Linha style={{ alignItems: 'flex-end' }}>
              <Campo
                rotulo={`Quanto de ${escolhido.nome}`}
                value={qtd}
                onChangeText={setQtd}
                inputMode="decimal"
                keyboardType="decimal-pad"
                style={{ flex: 1 }}
              />
              <View style={{ gap: Espaco.xs }}>
                <Txt tipo="rotulo" tom="textoFraco">
                  Unid.
                </Txt>
                <Linha style={{ gap: Espaco.xs }}>
                  {UNIDADES_POR_DIMENSAO[dimensaoDe(escolhido.unidade)].map((u) => (
                    <Ficha
                      key={u}
                      rotulo={ROTULO_UNIDADE[u]}
                      ativo={unidade === u}
                      onPress={() => setUnidade(u)}
                    />
                  ))}
                </Linha>
              </View>
            </Linha>
          ) : null}

          {escolhido && numeroDeTexto(qtd) > 0 ? (
            <Botao
              ocupado={salvarItem.isPending}
              onPress={async () => {
                onErro(null);
                try {
                  await salvarItem.mutateAsync({
                    produto_id: produto.id,
                    ingrediente_id: escolhido.id,
                    quantidade_base: paraBase(numeroDeTexto(qtd), unidade),
                  });
                  setEscolhido(null);
                  setQtd('');
                } catch (falha) {
                  onErro(falha instanceof Error ? falha.message : 'Não consegui adicionar.');
                }
              }}>
              Adicionar à receita
            </Botao>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Novos cadastros
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
function NovoProduto({ onErro }: { onErro: (mensagem: string | null) => void }) {
  const salvar = useSalvarProduto();
  const criarRevenda = useCriarProdutoDeRevenda();

  const [revenda, setRevenda] = useState(false);
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');
  const [estimado, setEstimado] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [precoPago, setPrecoPago] = useState('');

  const ocupado = salvar.isPending || criarRevenda.isPending;
  const pronto = nome.trim().length > 0 && numeroDeTexto(preco) > 0;

  function limpar() {
    setNome('');
    setPreco('');
    setEstimado('');
    setQuantidade('');
    setPrecoPago('');
  }

  return (
    <Cartao tom="superficieAlt" style={{ gap: Espaco.md }}>
      <Txt tipo="corpo" negrito>
        Novo produto
      </Txt>

      <View style={{ gap: Espaco.xs }}>
        <Txt tipo="rotulo" tom="textoFraco">
          Como este item chega no balcão
        </Txt>
        <Linha style={{ flexWrap: 'wrap', gap: Espaco.xs }}>
          <Ficha rotulo="Eu faço" ativo={!revenda} onPress={() => setRevenda(false)} />
          <Ficha rotulo="Compro pronto" ativo={revenda} onPress={() => setRevenda(true)} />
        </Linha>
      </View>

      <Campo
        rotulo="Nome"
        value={nome}
        onChangeText={setNome}
        placeholder={revenda ? 'Coca lata 350ml' : 'Hot-dog'}
      />
      <Campo
        rotulo="Preço de venda"
        value={preco}
        onChangeText={setPreco}
        placeholder={revenda ? '5,00' : '10,00'}
        inputMode="decimal"
        keyboardType="decimal-pad"
      />

      {revenda ? (
        <>
          <Campo
            rotulo="Quantidade comprada (opcional)"
            value={quantidade}
            onChangeText={setQuantidade}
            placeholder="12"
            inputMode="decimal"
            keyboardType="decimal-pad"
          />
          <Campo
            rotulo="Preço pago por unidade"
            value={precoPago}
            onChangeText={setPrecoPago}
            placeholder="3,20"
            inputMode="decimal"
            keyboardType="decimal-pad"
          />
          <Txt tipo="rotulo" tom="textoFraco">
            Isto vira uma compra de verdade: entra no caixa de hoje, soma no estoque e o lucro
            passa a sair do que você pagou. Deixe a quantidade vazia para cadastrar agora e
            lançar a nota depois.
          </Txt>
        </>
      ) : (
        <>
          <Campo
            rotulo="Custo estimado (opcional)"
            value={estimado}
            onChangeText={setEstimado}
            placeholder="4,00"
            inputMode="decimal"
            keyboardType="decimal-pad"
          />
          <Txt tipo="rotulo" tom="textoFraco">
            Só um palpite, para você já ver a margem. Ele aparece marcado como estimado e some
            sozinho quando a receita tiver o preço real das suas compras.
          </Txt>
        </>
      )}

      <Botao
        desabilitado={!pronto}
        ocupado={ocupado}
        onPress={async () => {
          onErro(null);
          try {
            if (revenda) {
              await criarRevenda.mutateAsync({
                nome,
                preco_venda: numeroDeTexto(preco),
                quantidade: numeroDeTexto(quantidade),
                preco_pago: numeroDeTexto(precoPago),
              });
            } else {
              await salvar.mutateAsync({
                nome,
                preco_venda: numeroDeTexto(preco),
                custo_estimado: numeroDeTexto(estimado),
              });
            }
            limpar();
          } catch (falha) {
            onErro(falha instanceof Error ? falha.message : 'Não consegui cadastrar.');
          }
        }}>
        {revenda ? 'Cadastrar item de revenda' : 'Cadastrar produto'}
      </Botao>
    </Cartao>
  );
}

function NovoIngrediente({ onErro }: { onErro: (mensagem: string | null) => void }) {
  const salvar = useSalvarIngrediente();
  const [nome, setNome] = useState('');
  const [unidade, setUnidade] = useState<Unidade>('unidade');

  return (
    <Cartao tom="superficieAlt" style={{ gap: Espaco.md }}>
      <Txt tipo="corpo" negrito>
        Novo ingrediente
      </Txt>
      <Campo rotulo="Nome" value={nome} onChangeText={setNome} placeholder="Pão" />
      <View style={{ gap: Espaco.xs }}>
        <Txt tipo="rotulo" tom="textoFraco">
          Como você compra
        </Txt>
        <Linha style={{ flexWrap: 'wrap', gap: Espaco.xs }}>
          {(['unidade', 'kg', 'g', 'l', 'ml'] as Unidade[]).map((u) => (
            <Ficha
              key={u}
              rotulo={ROTULO_UNIDADE[u]}
              ativo={unidade === u}
              onPress={() => setUnidade(u)}
            />
          ))}
        </Linha>
      </View>
      <Botao
        desabilitado={nome.trim().length === 0}
        ocupado={salvar.isPending}
        onPress={async () => {
          onErro(null);
          try {
            await salvar.mutateAsync({ nome, unidade });
            setNome('');
          } catch (falha) {
            onErro(falha instanceof Error ? falha.message : 'Não consegui cadastrar.');
          }
        }}>
        Cadastrar ingrediente
      </Botao>
    </Cartao>
  );
}

function Ficha({
  rotulo,
  ativo,
  onPress,
}: {
  rotulo: string;
  ativo: boolean;
  onPress: () => void;
}) {
  const { cores } = useTema();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: ativo }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: Touch.alvoSecundario,
        paddingHorizontal: Espaco.md,
        justifyContent: 'center',
        borderRadius: Raio.pill,
        borderWidth: 1,
        borderColor: ativo ? cores.primaria : cores.borda,
        backgroundColor: ativo ? cores.primaria : pressed ? cores.superficieAlt : 'transparent',
      })}>
      <Txt tipo="rotulo" negrito={ativo} tom={ativo ? 'primariaTexto' : 'texto'}>
        {rotulo}
      </Txt>
    </Pressable>
  );
}
