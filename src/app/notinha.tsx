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

export default function Notinha() {
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
      setErro('Nenhum item com nome e quantidade para salvar.');
      return;
    }
    try {
      await salvar.mutateAsync({ fornecedor, data, itens: itensValidos, origem: 'foto' });
      setSalvo(
        `${itensValidos.length} ${itensValidos.length === 1 ? 'item' : 'itens'} lançados · ${dinheiro(total)}`,
      );
      recomecar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não consegui salvar a compra.');
    }
  }

  return (
    <Tela atualizando={salvar.isPending || cancelar.isPending}>
      <Titulo>Notinha</Titulo>

      {salvo ? <Aviso tom="positivo">{salvo}</Aviso> : null}
      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}

      {lendo ? (
        <Cartao style={{ gap: Espaco.sm, alignItems: 'center' }}>
          <Carregando />
          <Txt tipo="corpo" negrito centro>
            Lendo a nota…
          </Txt>
          <Txt tipo="rotulo" tom="textoFraco" centro>
            Isso leva alguns segundos. Você confere tudo antes de salvar.
          </Txt>
        </Cartao>
      ) : linhas === null ? (
        <View style={{ gap: Espaco.md }}>
          <Cartao tom="superficieAlt" style={{ gap: Espaco.xs }}>
            <Txt tipo="corpo" negrito>
              Fotografe a nota do mercado
            </Txt>
            <Txt tipo="rotulo" tom="textoFraco">
              A leitura preenche os ingredientes, as quantidades e os preços. Você confere e
              corrige antes de salvar — nada entra no estoque sem sua conferência.
            </Txt>
          </Cartao>
          <Botao onPress={() => capturar('camera')}>Tirar foto da nota</Botao>
          <Botao variante="secundaria" onPress={() => capturar('galeria')}>
            Escolher da galeria
          </Botao>
        </View>
      ) : (
        <View style={{ gap: Espaco.md }}>
          <Cartao style={{ gap: Espaco.md }}>
            <Campo
              rotulo="Mercado / fornecedor"
              value={fornecedor}
              onChangeText={setFornecedor}
              placeholder="Opcional"
            />
            <Campo
              rotulo="Data da compra (AAAA-MM-DD)"
              value={data}
              onChangeText={setData}
              placeholder="Vazio = hoje"
              autoCapitalize="none"
              inputMode="numeric"
            />
            {!data ? (
              <Txt tipo="rotulo" tom="textoFraco">
                Sem data na nota: a compra entra no dia de hoje.
              </Txt>
            ) : null}
          </Cartao>

          {linhas.length === 0 ? (
            <Vazio titulo="Nenhum item restou" dica="Tire outra foto ou lance manualmente." />
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

          {/* "Total dos ingredientes", não "Total lido" -- e o rótulo importa.
              Num teste com nota real, a leitura excluiu corretamente a sacola
              plástica de R$ 0,10 e somou R$ 78,60 contra R$ 78,70 impressos.
              Pedir "compare com o total da nota" ensinaria a Nany a estranhar
              justamente quando a IA acertou; ela aprenderia a ignorar a
              conferência, que é a única defesa contra a leitura errada.
              O texto agora diz o que esperar: a diferença é o que não é
              ingrediente. */}
          <Cartao tom="superficieAlt">
            <Linha entre>
              <Txt tipo="corpo" negrito>
                Total dos ingredientes
              </Txt>
              <Txt tipo="numero">{dinheiro(total)}</Txt>
            </Linha>
            <Txt tipo="rotulo" tom="textoFraco">
              Pode dar menos que o total da nota: sacola, desconto e outros itens que não são
              ingrediente ficam de fora. Confira as linhas acima.
            </Txt>
          </Cartao>

          <Botao onPress={confirmar} ocupado={salvar.isPending}>
            Salvar {itensValidos.length} {itensValidos.length === 1 ? 'item' : 'itens'}
          </Botao>
          <Botao variante="fantasma" onPress={recomecar}>
            Descartar e tirar outra foto
          </Botao>
        </View>
      )}

      {fotos.length > 1 ? (
        <Txt tipo="rotulo" tom="textoFraco">
          {fotos.length} fotos lidas juntas.
        </Txt>
      ) : null}

      <Titulo>Compras recentes</Titulo>
      {historico.isLoading ? (
        <Carregando />
      ) : (historico.data ?? []).length === 0 ? (
        <Vazio titulo="Nenhuma compra lançada ainda" />
      ) : (
        <Cartao style={{ gap: Espaco.md }}>
          {(historico.data ?? []).map((compra) => (
            <Linha key={compra.id} entre>
              <View style={{ flex: 1 }}>
                <Txt tipo="corpo" negrito numberOfLines={1}>
                  {compra.fornecedor || 'Compra sem fornecedor'}
                </Txt>
                <Txt tipo="rotulo" tom="textoFraco">
                  {diaMes(compra.comprada_em)} · {compra.itens} itens · {dinheiro(compra.total)}
                </Txt>
              </View>
              <Botao
                variante="perigo"
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
          ))}
        </Cartao>
      )}
    </Tela>
  );
}

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
      <Campo rotulo="Ingrediente" value={linha.nome} onChangeText={(v) => onMudar('nome', v)} />

      <Linha style={{ alignItems: 'flex-end' }}>
        <Campo
          rotulo="Quantidade"
          value={linha.quantidade}
          onChangeText={(v) => onMudar('quantidade', v)}
          inputMode="decimal"
          keyboardType="decimal-pad"
          style={{ flex: 1 }}
        />
        <SeletorUnidade valor={linha.unidade} onMudar={(u) => onMudar('unidade', u)} />
        <Campo
          rotulo="Preço un."
          value={linha.preco}
          onChangeText={(v) => onMudar('preco', v)}
          placeholder="0,00"
          inputMode="decimal"
          keyboardType="decimal-pad"
          style={{ flex: 1 }}
        />
      </Linha>

      <Linha entre>
        <Txt tipo="rotulo" tom="textoFraco">
          {linha.observacao || 'Subtotal'}
        </Txt>
        <Txt tipo="corpo" negrito>
          {dinheiro(subtotal)}
        </Txt>
      </Linha>

      <Botao variante="perigo" style={{ minHeight: Touch.alvoSecundario }} onPress={onRemover}>
        Remover item
      </Botao>
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
          minHeight: 56,
          minWidth: 64,
          paddingHorizontal: Espaco.sm,
          borderRadius: Raio.md,
          borderWidth: 1,
          borderColor: cores.borda,
          backgroundColor: pressed ? cores.superficieAlt : cores.superficie,
          alignItems: 'center',
          justifyContent: 'center',
        })}>
        <Txt tipo="corpo" negrito>
          {ROTULO_UNIDADE[valor]}
        </Txt>
      </Pressable>
    </View>
  );
}
