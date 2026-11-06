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
  Linha,
  Secao,
  Tela,
  Txt,
  Vazio,
} from '@/components/ui';
import { Espaco, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import { useApagarProduto, useProdutos, useSalvarProduto, type Produto } from '@/lib/dados';
import { dinheiro, numeroDeTexto } from '@/lib/formato';

/**
 * Produtos: o que ela vende e por quanto. Só isso.
 *
 * Aqui já morou a receita de cada produto (1 pão, 1 salsicha, 20 g de molho),
 * o "eu faço / compro pronto" e o custo estimado. Era o que fazia o lucro por
 * produto existir, e era também a parte que a dona achou difícil demais -- e
 * que, pulada, deixava o lucro igual ao preço cheio. Agora o lucro é vendas
 * menos gastos (ver `lucroDe`), e o produto só precisa de nome e preço pra
 * aparecer no Vender.
 *
 * A receita que já estava cadastrada continua no banco e não atrapalha: a
 * venda segue baixando estoque por baixo, e nenhuma tela mostra.
 */

/** Valor de `aberto` quando o que está aberto é o formulário de produto novo. */
const NOVO = 'novo';

/** "12,50": o número como ela digita, pra preencher campo de texto. */
const paraCampo = (valor: number) => valor.toFixed(2).replace('.', ',');

const erroDe = (falha: unknown, padrao: string) =>
  falha instanceof Error ? falha.message : padrao;

export default function Produtos() {
  const produtos = useProdutos();
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
            aberto={aberto === produto.id}
            onAlternar={() => alternar(produto.id)}
            onFeito={(texto) => {
              setAberto(null);
              setRecado(texto);
            }}
          />
        </Fragment>
      ))}
    </Cartao>
  );

  return (
    <Tela titulo="Produtos" voltar atualizando={produtos.isFetching && !produtos.isLoading}>
      {produtos.error ? (
        <Aviso tom="negativo">{erroDe(produtos.error, 'Não consegui carregar os produtos.')}</Aviso>
      ) : produtos.isLoading ? (
        <Carregando />
      ) : (
        <>
          <Txt tipo="rotulo" tom="textoFraco" style={{ marginBottom: Espaco.md }}>
            O que você vende e por quanto. Toque num produto pra mudar o preço.
          </Txt>
          {recado ? (
            <View style={{ marginBottom: Espaco.md }}>
              <Aviso tom="positivo">{recado}</Aviso>
            </View>
          ) : null}

          {lista.length === 0 ? (
            <Vazio titulo="Nenhum produto ainda" dica="Comece pelo hot-dog." />
          ) : null}
          {ativos.length > 0 ? grupo(ativos) : null}
          {/* Separados, e com título escrito: o desativado não aparece no
              Vender, e isso tem que estar dito, não só num tom mais apagado. */}
          {inativos.length > 0 ? (
            <Secao titulo="Fora do Vender">{grupo(inativos)}</Secao>
          ) : null}

          <View style={{ marginTop: Espaco.xl, gap: Espaco.md }}>
            {aberto === NOVO ? (
              <NovoProduto
                onFechar={() => setAberto(null)}
                onCriado={(nome) => {
                  setAberto(null);
                  setRecado(`${nome} cadastrado. Já aparece no Vender.`);
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

function LinhaDeProduto({
  produto,
  aberto,
  onAlternar,
  onFeito,
}: {
  produto: Produto;
  aberto: boolean;
  onAlternar: () => void;
  onFeito: (recado: string) => void;
}) {
  const { cores } = useTema();

  return (
    <View>
      {/* `aria-expanded` porque isto é um expansor, não um botão comum: sem o
          estado, o leitor de tela anuncia a mesma coisa com o produto aberto e
          fechado. `aria-*` e não `accessibilityState`, que o react-native-web
          descarta (ver ui.tsx). */}
      <Pressable
        accessibilityRole="button"
        aria-expanded={aberto}
        accessibilityLabel={`${produto.nome}, ${dinheiro(produto.preco_venda)}`}
        onPress={onAlternar}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: Espaco.md,
          minHeight: Touch.alvo,
          paddingVertical: Espaco.md,
          opacity: pressed ? 0.6 : 1,
        })}>
        <Txt tipo="secao" numberOfLines={2} style={{ flex: 1 }}>
          {produto.nome}
        </Txt>
        <Txt tipo="numero">{dinheiro(produto.preco_venda)}</Txt>
        <View style={{ transform: [{ rotate: aberto ? '-90deg' : '90deg' }] }}>
          <Icone nome="seguir" tamanho={20} cor={cores.textoFraco} />
        </View>
      </Pressable>

      {aberto ? <EditorDeProduto produto={produto} onFeito={onFeito} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Edição
// ---------------------------------------------------------------------------

function EditorDeProduto({
  produto,
  onFeito,
}: {
  produto: Produto;
  onFeito: (recado: string) => void;
}) {
  const salvar = useSalvarProduto();
  const apagar = useApagarProduto();
  const [nome, setNome] = useState(produto.nome);
  const [preco, setPreco] = useState(paraCampo(produto.preco_venda));
  const [erro, setErro] = useState<string | null>(null);

  const alterado =
    nome.trim() !== produto.nome || Math.abs(numeroDeTexto(preco) - produto.preco_venda) > 0.001;

  // As duas escritas passam pela mesma mutation; `ativo` na variável diz qual
  // delas está em andamento, pra girar só o botão que ela tocou.
  const trocandoVenda = salvar.isPending && salvar.variables?.ativo !== undefined;
  const salvandoDados = salvar.isPending && salvar.variables?.ativo === undefined;

  return (
    <View style={{ gap: Espaco.md, paddingBottom: Espaco.lg }}>
      <Campo rotulo="Nome" value={nome} onChangeText={setNome} maxLength={120} />
      <Campo
        rotulo="Preço de venda"
        prefixo="R$"
        value={preco}
        onChangeText={setPreco}
        inputMode="decimal"
        keyboardType="decimal-pad"
      />
      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
      {alterado ? (
        <Botao
          ocupado={salvandoDados}
          desabilitado={!nome.trim() || numeroDeTexto(preco) <= 0}
          onPress={async () => {
            setErro(null);
            try {
              await salvar.mutateAsync({
                id: produto.id,
                nome,
                preco_venda: numeroDeTexto(preco),
                ordem: produto.ordem,
              });
              onFeito(`${nome.trim()} salvo`);
            } catch (falha) {
              setErro(erroDe(falha, 'Não consegui salvar.'));
            }
          }}>
          Salvar
        </Botao>
      ) : null}

      <Linha style={{ gap: Espaco.sm }}>
        {/* Tirar do Vender some com o produto da tela de venda sem tocar no
            histórico. É a saída pro produto que ela parou de fazer: apagar
            não é permitido quando já houve venda (a FK é restrita, senão o
            fechamento daqueles dias mudaria sozinho). */}
        <Botao
          variante="secundaria"
          ocupado={trocandoVenda}
          style={{ flex: 1 }}
          onPress={async () => {
            setErro(null);
            try {
              await salvar.mutateAsync({
                id: produto.id,
                nome: produto.nome,
                preco_venda: produto.preco_venda,
                ordem: produto.ordem,
                ativo: !produto.ativo,
              });
              onFeito(
                produto.ativo
                  ? `${produto.nome} saiu do Vender`
                  : `${produto.nome} voltou pro Vender`,
              );
            } catch (falha) {
              setErro(erroDe(falha, 'Não consegui salvar.'));
            }
          }}>
          {produto.ativo ? 'Tirar do Vender' : 'Voltar pro Vender'}
        </Botao>
        <Botao
          variante="perigo"
          icone="lixo"
          rotuloAcessivel={`Apagar ${produto.nome}`}
          confirmar="Apagar mesmo?"
          ocupado={apagar.isPending}
          style={{ minHeight: Touch.alvoSecundario, paddingHorizontal: Espaco.md }}
          onPress={async () => {
            setErro(null);
            try {
              await apagar.mutateAsync(produto.id);
              onFeito(`${produto.nome} apagado`);
            } catch (falha) {
              setErro(erroDe(falha, 'Não consegui apagar.'));
            }
          }}>
          Apagar
        </Botao>
      </Linha>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Produto novo
// ---------------------------------------------------------------------------

function NovoProduto({
  onFechar,
  onCriado,
}: {
  onFechar: () => void;
  onCriado: (nome: string) => void;
}) {
  const salvar = useSalvarProduto();
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const pronto = nome.trim().length > 0 && numeroDeTexto(preco) > 0;

  async function cadastrar() {
    setErro(null);
    try {
      await salvar.mutateAsync({ nome, preco_venda: numeroDeTexto(preco) });
      onCriado(nome.trim());
    } catch (falha) {
      setErro(erroDe(falha, 'Não consegui cadastrar.'));
    }
  }

  return (
    <Cartao style={{ gap: Espaco.md }}>
      <Txt tipo="secao" cabecalho>
        Novo produto
      </Txt>
      {/* Exemplo com "Ex.:" e preço zerado: a tinta de placeholder é forte,
          então "Hot-dog" e "10,00" pareciam já digitados -- e o "Cadastrar"
          travado ao lado parecia defeito. */}
      <Campo
        rotulo="Nome"
        value={nome}
        onChangeText={setNome}
        placeholder="Ex.: hot-dog, suco, Coca lata"
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
      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
      <Botao desabilitado={!pronto} ocupado={salvar.isPending} onPress={cadastrar}>
        Cadastrar
      </Botao>
      <Botao variante="fantasma" onPress={onFechar}>
        Cancelar
      </Botao>
    </Cartao>
  );
}
