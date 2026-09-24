import { Fragment, useState } from 'react';
import { Pressable, View } from 'react-native';

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
import { Espaco, Raio, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import { useCancelarCompra, useHistoricoCompras, useSalvarCompra } from '@/lib/dados';
import { diaMes, dinheiro, numeroDeTexto } from '@/lib/formato';
import {
  escolherDaGaleria,
  fotografarNotinha,
  lerNotinha,
  type FotoPronta,
  type ItemLido,
} from '@/lib/notinha';
import { ROTULO_UNIDADE, UNIDADES, type Unidade } from '@/lib/unidades';

/**
 * Quantidade e preço ficam como TEXTO enquanto ela edita, não como número.
 *
 * Guardar número obriga a converter a cada tecla, e aí "12," vira 12 e o campo
 * apaga a vírgula que ela acabou de digitar; e um campo vazio viraria 0,
 * impossibilitando limpar pra redigitar. A conversão acontece uma vez, ao
 * salvar.
 */
type LinhaEditavel = {
  chave: string;
  nome: string;
  quantidade: string;
  unidade: Unidade;
  preco: string;
  observacao: string;
};

let contador = 0;
/** Chave estável: com índice, remover uma linha faria o foco saltar de campo. */
const novaChave = () => `linha-${(contador += 1)}`;

const paraEditavel = (item: ItemLido): LinhaEditavel => ({
  chave: novaChave(),
  nome: item.nome,
  quantidade: String(item.quantidade).replace('.', ','),
  unidade: item.unidade,
  preco: item.preco_unitario ? String(item.preco_unitario.toFixed(2)).replace('.', ',') : '',
  observacao: item.observacao,
});

const itens = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

/** Botão quadrado de 44 px só com o ícone: o `gap` zerado centraliza o ✕. */
const QUADRADO = {
  width: Touch.alvoSecundario,
  minHeight: Touch.alvoSecundario,
  paddingHorizontal: 0,
  gap: 0,
} as const;

export default function Compras() {
  const [fotos, setFotos] = useState<FotoPronta[]>([]);
  const [linhas, setLinhas] = useState<LinhaEditavel[] | null>(null);
  const [fornecedor, setFornecedor] = useState('');
  const [data, setData] = useState('');
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);

  const salvar = useSalvarCompra();
  const historico = useHistoricoCompras();
  const cancelar = useCancelarCompra();

  function recomecar() {
    setFotos([]);
    setLinhas(null);
    setFornecedor('');
    setData('');
    setErro(null);
  }

  async function capturar(origem: 'camera' | 'galeria') {
    setErro(null);
    setSalvo(null);
    setLendo(true);
    try {
      const novas =
        origem === 'camera'
          ? await (async () => {
              const foto = await fotografarNotinha();
              return foto ? [foto] : [];
            })()
          : await escolherDaGaleria();

      if (novas.length === 0) {
        setLendo(false);
        return;
      }

      setFotos(novas);
      const lida = await lerNotinha(novas);
      setLinhas(lida.itens.map(paraEditavel));
      setFornecedor(lida.fornecedor);
      setData(lida.data);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não consegui ler a nota.');
    }
    setLendo(false);
  }

  function mudar(chave: string, campo: keyof LinhaEditavel, valor: string | Unidade) {
    setLinhas((atuais) =>
      (atuais ?? []).map((linha) => (linha.chave === chave ? { ...linha, [campo]: valor } : linha)),
    );
  }

  function remover(chave: string) {
    setLinhas((atuais) => (atuais ?? []).filter((linha) => linha.chave !== chave));
  }

  const itensValidos = (linhas ?? [])
    .map(
      (linha): ItemLido => ({
        nome: linha.nome.trim(),
        quantidade: numeroDeTexto(linha.quantidade),
        unidade: linha.unidade,
        preco_unitario: numeroDeTexto(linha.preco),
        observacao: linha.observacao.trim(),
      }),
    )
    .filter((item) => item.nome.length > 0 && item.quantidade > 0);

  const total = itensValidos.reduce(
    (soma, item) => soma + item.quantidade * item.preco_unitario,
    0,
  );

  async function confirmar() {
    setErro(null);
    if (itensValidos.length === 0) {
      setErro('Nenhum item com nome e quantidade.');
      return;
    }
    try {
      await salvar.mutateAsync({ fornecedor, data, itens: itensValidos, origem: 'foto' });
      setSalvo(`${itens(itensValidos.length)} no estoque · ${dinheiro(total)}`);
      recomecar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não consegui salvar a compra.');
    }
  }

  const conferindo = linhas !== null && !lendo;

  // O "Salvar" fica no rodapé, fora da rolagem: numa nota de 15 itens ele
  // estaria 15 cartões abaixo, e o total junto dele é o que ela confere por
  // último antes de tocar.
  const rodape =
    conferindo && linhas.length > 0 ? (
      <>
        {/* O erro de salvar aparece aqui, colado no botão: no topo da rolagem
            ele ficaria atrás de quinze cartões e o toque pareceria ignorado. */}
        {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
        {/* "Total dos ingredientes", não "Total lido" -- e o rótulo importa.
            Num teste com nota real, a leitura excluiu corretamente a sacola
            plástica de R$ 0,10 e somou R$ 78,60 contra R$ 78,70 impressos.
            Pedir "compare com o total da nota" ensinaria a Nany a estranhar
            justamente quando a IA acertou; ela aprenderia a ignorar a
            conferência, que é a única defesa contra a leitura errada. A
            legenda diz o que esperar: a diferença é o que não é ingrediente
            (sacola, desconto), e é normal. */}
        <Linha style={{ gap: Espaco.md }}>
          <View style={{ flex: 1 }}>
            <Txt tipo="corpo" negrito>
              Total dos ingredientes
            </Txt>
            <Txt tipo="rotulo" tom="textoFraco">
              Pode dar menos que a nota
            </Txt>
          </View>
          <Txt tipo="numero">{dinheiro(total)}</Txt>
        </Linha>
        <Botao grande onPress={confirmar} ocupado={salvar.isPending}>
          {`Salvar ${itens(itensValidos.length)}`}
        </Botao>
      </>
    ) : undefined;

  return (
    <Tela
      titulo="Compras"
      voltar
      atualizando={cancelar.isPending || (historico.isFetching && !historico.isLoading)}
      acao={
        conferindo ? (
          // No canto de cima, longe do polegar: descartar joga fora uma
          // leitura que custou cota, e não pode ficar onde se toca sem querer.
          <Botao
            variante="fantasma"
            rotuloAcessivel="Descartar leitura"
            onPress={recomecar}
            style={{
              minHeight: Touch.alvoSecundario,
              paddingHorizontal: Espaco.sm,
              marginRight: -Espaco.sm,
            }}>
            Descartar
          </Botao>
        ) : undefined
      }
      rodape={rodape}>
      {lendo ? (
        // A espera com chuva mora AQUI, e só aqui: a leitura pelo Gemini leva
        // de 3 a 18 segundos medidos, e é a única tela do app em que ela fica
        // parada olhando. Nas esperas curtas, um hot-dog caindo seria susto,
        // não companhia.
        <Cartao style={{ gap: Espaco.sm, alignItems: 'center' }}>
          <Carregando chuva />
          <Txt tipo="secao" centro>
            Lendo a nota…
          </Txt>
          <Txt tipo="rotulo" tom="textoFraco" centro>
            Leva alguns segundos.
          </Txt>
        </Cartao>
      ) : conferindo ? (
        <View style={{ gap: Espaco.md }}>
          {fotos.length > 1 ? (
            <Txt tipo="rotulo" tom="textoFraco">
              {fotos.length} fotos lidas juntas
            </Txt>
          ) : null}
          <Campo
            rotulo="Mercado"
            value={fornecedor}
            onChangeText={setFornecedor}
            placeholder="Opcional"
          />
          <Campo
            rotulo="Data (AAAA-MM-DD)"
            value={data}
            onChangeText={setData}
            // Nota sem data legível entra no dia de hoje, decidido pelo banco.
            placeholder="Vazio = hoje"
            autoCapitalize="none"
            inputMode="numeric"
          />

          {linhas.length === 0 ? (
            <Vazio
              titulo="Nenhum item restou"
              acao={{ rotulo: 'Tirar outra foto', onPress: recomecar }}
            />
          ) : (
            linhas.map((linha) => (
              <LinhaDeItem
                key={linha.chave}
                linha={linha}
                onMudar={(campo, valor) => mudar(linha.chave, campo, valor)}
                onRemover={() => remover(linha.chave)}
              />
            ))
          )}
        </View>
      ) : (
        <>
          <View style={{ gap: Espaco.md }}>
            {salvo ? <Aviso tom="positivo">{salvo}</Aviso> : null}
            {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
            <Botao grande icone="camera" onPress={() => capturar('camera')}>
              Fotografar nota
            </Botao>
            <Botao variante="secundaria" icone="galeria" onPress={() => capturar('galeria')}>
              Escolher da galeria
            </Botao>
            <Txt tipo="rotulo" tom="textoFraco" centro>
              Você confere tudo antes de entrar no estoque.
            </Txt>
          </View>

          <Recentes historico={historico} cancelar={cancelar} />
        </>
      )}
    </Tela>
  );
}

// ---------------------------------------------------------------------------
// Conferência
// ---------------------------------------------------------------------------

function LinhaDeItem({
  linha,
  onMudar,
  onRemover,
}: {
  linha: LinhaEditavel;
  onMudar: (campo: keyof LinhaEditavel, valor: string | Unidade) => void;
  onRemover: () => void;
}) {
  const subtotal = numeroDeTexto(linha.quantidade) * numeroDeTexto(linha.preco);

  return (
    <Cartao style={{ gap: Espaco.md }}>
      <Linha style={{ alignItems: 'flex-end' }}>
        <Campo
          rotulo="Ingrediente"
          value={linha.nome}
          onChangeText={(v) => onMudar('nome', v)}
          style={{ flex: 1 }}
        />
        <Botao
          variante="perigo"
          icone="fechar"
          rotuloAcessivel={`Remover ${linha.nome.trim() || 'item'}`}
          onPress={onRemover}
          // Meio da altura do campo (56) menos a do botão (44): centraliza o
          // ✕ na caixa do campo, não na linha do rótulo.
          style={[QUADRADO, { marginBottom: (Touch.alvo - Touch.alvoSecundario) / 2 }]}>
          {''}
        </Botao>
      </Linha>

      <Linha style={{ alignItems: 'flex-end' }}>
        <Campo
          rotulo="Qtd."
          // A abreviação cabe na linha; lida em voz alta, "q t d" não.
          accessibilityLabel={`Quantidade de ${linha.nome.trim() || 'item'}`}
          value={linha.quantidade}
          onChangeText={(v) => onMudar('quantidade', v)}
          inputMode="decimal"
          keyboardType="decimal-pad"
          style={{ flex: 1 }}
        />
        <SeletorUnidade valor={linha.unidade} onMudar={(u) => onMudar('unidade', u)} />
        <Campo
          rotulo="Preço un."
          accessibilityLabel={`Preço por unidade de ${linha.nome.trim() || 'item'}`}
          prefixo="R$"
          value={linha.preco}
          onChangeText={(v) => onMudar('preco', v)}
          placeholder="0,00"
          inputMode="decimal"
          keyboardType="decimal-pad"
          style={{ flex: 1.3 }}
        />
      </Linha>

      <Linha entre>
        <Txt tipo="rotulo" tom="textoFraco" style={{ flexShrink: 1 }}>
          {linha.observacao || 'Subtotal'}
        </Txt>
        <Txt tipo="corpo" negrito>
          {dinheiro(subtotal)}
        </Txt>
      </Linha>
    </Cartao>
  );
}

/**
 * Unidade por toque que cicla, em vez de lista suspensa.
 *
 * São cinco opções e ela quase nunca precisa mexer (a leitura já acerta a
 * unidade na maioria das linhas). Um `Picker` nativo abriria um modal diferente
 * no iOS, no Android e no navegador -- três comportamentos pra manter por uma
 * escolha que é exceção.
 */
function SeletorUnidade({
  valor,
  onMudar,
}: {
  valor: Unidade;
  onMudar: (unidade: Unidade) => void;
}) {
  const { cores } = useTema();
  const proxima = UNIDADES[(UNIDADES.indexOf(valor) + 1) % UNIDADES.length] as Unidade;

  return (
    <View style={{ gap: Espaco.xs }}>
      <Txt tipo="rotulo" tom="textoFraco">
        Unid.
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Unidade: ${ROTULO_UNIDADE[valor]}. Toque para mudar para ${ROTULO_UNIDADE[proxima]}.`}
        onPress={() => onMudar(proxima)}
        style={({ pressed }) => ({
          minHeight: Touch.alvo,
          minWidth: 60,
          paddingHorizontal: Espaco.sm,
          borderRadius: Raio.md,
          // Mesma borda do `Campo`: na linha, os três têm que ler como caixas
          // de um mesmo formulário.
          borderWidth: 1.5,
          borderColor: cores.borda,
          backgroundColor: pressed ? cores.superficieAlt : cores.superficie,
          alignItems: 'center',
          justifyContent: 'center',
        })}>
        <Txt tipo="secao">{ROTULO_UNIDADE[valor]}</Txt>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

function Recentes({
  historico,
  cancelar,
}: {
  historico: ReturnType<typeof useHistoricoCompras>;
  cancelar: ReturnType<typeof useCancelarCompra>;
}) {
  // Erro próprio, e não o do topo da tela: o "Desfazer" fica lá embaixo, e o
  // recado tem que aparecer onde ela está olhando.
  const [erro, setErro] = useState<string | null>(null);
  const compras = historico.data ?? [];

  return (
    <Secao titulo="Recentes">
      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
      {historico.error ? (
        <Aviso tom="negativo">
          {historico.error instanceof Error
            ? historico.error.message
            : 'Não consegui carregar as compras.'}
        </Aviso>
      ) : historico.isLoading ? (
        <Carregando />
      ) : compras.length === 0 ? (
        <Vazio titulo="Nenhuma compra ainda" />
      ) : (
        <Cartao style={{ paddingVertical: Espaco.xs }}>
          {compras.map((compra, indice) => {
            const nome = compra.fornecedor || 'Sem mercado';
            return (
              <Fragment key={compra.id}>
                {indice > 0 ? <Divisor /> : null}
                <Linha style={{ minHeight: Touch.alvo, paddingVertical: Espaco.md, gap: Espaco.md }}>
                  <View style={{ flex: 1 }}>
                    <Txt tipo="corpo" negrito numberOfLines={1}>
                      {nome}
                    </Txt>
                    <Txt tipo="rotulo" tom="textoFraco">
                      {diaMes(compra.comprada_em)} · {itens(compra.itens)} · {dinheiro(compra.total)}
                    </Txt>
                  </View>
                  {/* Desfazer passa por `cancelar_compra()`, que estorna o
                      estoque na mesma transação -- a tela não tem DELETE em
                      `compra_itens` (ver AGENTS.md). 44 px: é destrutivo, e
                      aqui o erro caro é o toque sem querer. */}
                  <Botao
                    variante="perigo"
                    rotuloAcessivel={`Desfazer compra ${nome}, ${diaMes(compra.comprada_em)}, ${dinheiro(compra.total)}`}
                    style={{ minHeight: Touch.alvoSecundario, paddingHorizontal: Espaco.md }}
                    ocupado={cancelar.isPending && cancelar.variables === compra.id}
                    onPress={async () => {
                      setErro(null);
                      try {
                        await cancelar.mutateAsync(compra.id);
                      } catch (falha) {
                        setErro(falha instanceof Error ? falha.message : 'Não consegui desfazer.');
                      }
                    }}>
                    Desfazer
                  </Botao>
                </Linha>
              </Fragment>
            );
          })}
        </Cartao>
      )}
    </Secao>
  );
}
