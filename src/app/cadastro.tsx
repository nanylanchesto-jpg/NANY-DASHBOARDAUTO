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
import { Espaco, Raio } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import {
  useApagarItemReceita,
  useApagarProduto,
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

  const alterado =
    nome.trim() !== produto.nome || Math.abs(numeroDeTexto(preco) - produto.preco_venda) > 0.001;

  return (
    <Cartao style={{ gap: Espaco.md }}>
      <Pressable onPress={onAlternar} accessibilityRole="button">
        <Linha entre>
          <View style={{ flex: 1 }}>
            <Txt tipo="titulo" negrito numberOfLines={1}>
              {produto.nome}
              {produto.ativo ? '' : ' (desativado)'}
            </Txt>
            <Txt tipo="rotulo" tom={produto.tem_receita ? 'textoFraco' : 'atencao'}>
              {produto.tem_receita
                ? `custo ${dinheiro(produto.custo_unitario)} · lucro ${dinheiro(produto.lucro_unitario)}`
                : 'sem receita — o custo ainda é R$ 0,00'}
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
                  style={{ minHeight: 40, paddingHorizontal: Espaco.sm }}
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

function NovoProduto({ onErro }: { onErro: (mensagem: string | null) => void }) {
  const salvar = useSalvarProduto();
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');

  const pronto = nome.trim().length > 0 && numeroDeTexto(preco) > 0;

  return (
    <Cartao tom="superficieAlt" style={{ gap: Espaco.md }}>
      <Txt tipo="corpo" negrito>
        Novo produto
      </Txt>
      <Campo rotulo="Nome" value={nome} onChangeText={setNome} placeholder="Hot-dog" />
      <Campo
        rotulo="Preço de venda"
        value={preco}
        onChangeText={setPreco}
        placeholder="10,00"
        inputMode="decimal"
        keyboardType="decimal-pad"
      />
      <Botao
        desabilitado={!pronto}
        ocupado={salvar.isPending}
        onPress={async () => {
          onErro(null);
          try {
            await salvar.mutateAsync({ nome, preco_venda: numeroDeTexto(preco) });
            setNome('');
            setPreco('');
          } catch (falha) {
            onErro(falha instanceof Error ? falha.message : 'Não consegui cadastrar.');
          }
        }}>
        Cadastrar produto
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
        minHeight: 44,
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
