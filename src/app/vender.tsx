import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Aviso,
  Botao,
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
  useCancelarVenda,
  useFechamento,
  useProdutos,
  useRegistrarVenda,
  useVendasDoDia,
  type Produto,
} from '@/lib/dados';
import { dinheiro, hora, inteiro } from '@/lib/formato';

export default function Vender() {
  const produtos = useProdutos();
  const hoje = useFechamento();
  const vendas = useVendasDoDia();
  const registrar = useRegistrarVenda();
  const cancelar = useCancelarVenda();
  const router = useRouter();

  const [erro, setErro] = useState<string | null>(null);
  /** Confirmação instantânea do último toque, pra ela não tocar duas vezes na dúvida. */
  const [eco, setEco] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sem isso o timer dispara depois da tela sair e o React avisa de atualização
  // em componente desmontado -- e o eco reapareceria na volta pra aba.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function mostrarEco(texto: string) {
    setEco(texto);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setEco(null), 1600);
  }

  async function vender(produto: Produto) {
    setErro(null);
    mostrarEco(`+1 ${produto.nome}`);
    try {
      await registrar.mutateAsync({ produto, quantidade: 1 });
    } catch (falha) {
      setEco(null);
      setErro(falha instanceof Error ? falha.message : 'Não consegui registrar a venda.');
    }
  }

  const ativos = (produtos.data ?? []).filter((produto) => produto.ativo);
  const recentes = (vendas.data ?? []).filter((venda) => !venda.cancelada_em).slice(0, 6);

  return (
    <Tela atualizando={registrar.isPending || cancelar.isPending}>
      <Titulo>Vender</Titulo>

      <Cartao tom="superficieAlt" style={{ gap: 2 }}>
        <Txt tipo="rotulo" tom="textoFraco">
          Vendas de hoje
        </Txt>
        <Linha entre>
          <Txt tipo="numero">{dinheiro(hoje.data?.receita ?? 0)}</Txt>
          <Txt tipo="rotulo" tom="textoFraco">
            {inteiro(hoje.data?.unidades ?? 0)} itens
          </Txt>
        </Linha>
      </Cartao>

      {eco ? (
        <View style={{ marginTop: Espaco.md }}>
          <Aviso tom="positivo">{eco}</Aviso>
        </View>
      ) : null}
      {erro ? (
        <View style={{ marginTop: Espaco.md }}>
          <Aviso tom="negativo">{erro}</Aviso>
        </View>
      ) : null}

      <Titulo>Toque no que saiu</Titulo>

      {produtos.isLoading ? (
        <Carregando />
      ) : ativos.length === 0 ? (
        <View style={{ gap: Espaco.md }}>
          <Vazio
            titulo="Nenhum produto cadastrado"
            dica="Cadastre o hot-dog e o suco com o preço de venda para começar."
          />
          <Botao onPress={() => router.push('/cadastro')}>Ir para o cadastro</Botao>
        </View>
      ) : (
        <View style={{ gap: Espaco.md }}>
          {ativos.map((produto) => (
            <BotaoDeVenda key={produto.id} produto={produto} onPress={() => vender(produto)} />
          ))}
        </View>
      )}

      {recentes.length > 0 ? (
        <>
          <Titulo>Últimas vendas</Titulo>
          <Cartao style={{ gap: Espaco.md }}>
            {recentes.map((venda) => (
              <Linha key={venda.id} entre>
                <View style={{ flex: 1 }}>
                  <Txt tipo="corpo" numberOfLines={1}>
                    {venda.produtos?.nome ?? 'Produto'}
                  </Txt>
                  <Txt tipo="rotulo" tom="textoFraco">
                    {hora(venda.vendida_em)} · {dinheiro(venda.total)}
                  </Txt>
                </View>
                <Botao
                  variante="perigo"
                  style={{ minHeight: Touch.alvoSecundario, paddingHorizontal: Espaco.md }}
                  ocupado={cancelar.isPending && cancelar.variables === venda.id}
                  onPress={async () => {
                    setErro(null);
                    try {
                      await cancelar.mutateAsync(venda.id);
                    } catch (falha) {
                      setErro(falha instanceof Error ? falha.message : 'Não consegui desfazer.');
                    }
                  }}>
                  Desfazer
                </Botao>
              </Linha>
            ))}
          </Cartao>
        </>
      ) : null}
    </Tela>
  );
}

/**
 * Botão de uma venda. Alto (84 px) e com o nome grande porque o toque acontece
 * de lado, com uma mão, enquanto ela atende -- é o momento em que o registro
 * mais provavelmente deixa de acontecer.
 */
function BotaoDeVenda({ produto, onPress }: { produto: Produto; onPress: () => void }) {
  const { cores } = useTema();
  const custo = custoDoProduto(produto);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Vender um ${produto.nome} por ${dinheiro(produto.preco_venda)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: Touch.alvoGrande,
        borderRadius: Raio.lg,
        borderWidth: 1,
        borderColor: cores.borda,
        backgroundColor: pressed ? cores.superficieAlt : cores.superficie,
        paddingHorizontal: Espaco.lg,
        paddingVertical: Espaco.md,
        justifyContent: 'center',
        gap: 2,
      })}>
      <Linha entre>
        <Txt tipo="titulo" negrito numberOfLines={1} style={{ flex: 1 }}>
          {produto.nome}
        </Txt>
        <Txt tipo="titulo" negrito>
          {dinheiro(produto.preco_venda)}
        </Txt>
      </Linha>
      {/* Produto sem custo apurado tem custo 0, e aí o "lucro" mostrado seria o
          preço cheio. Melhor dizer que a conta está incompleta do que exibir um
          número bonito e falso -- é exatamente o erro que o PI quer corrigir.
          O palpite dela entra aqui, mas SEMPRE com a palavra "estimado" junto:
          é o que separa o número que vai pro fechamento do que não vai. */}
      {custo.tipo === 'apurado' ? (
        <Txt tipo="rotulo" tom="textoFraco">
          lucro {dinheiro(custo.lucro)} · custo {dinheiro(custo.custo)}
        </Txt>
      ) : custo.tipo === 'estimado' ? (
        <Txt tipo="rotulo" tom="atencao">
          estimado: lucro {dinheiro(custo.lucro)} · custo {dinheiro(custo.custo)}
        </Txt>
      ) : (
        <Txt tipo="rotulo" tom="atencao">
          sem receita: o lucro deste item ainda não é real
        </Txt>
      )}
    </Pressable>
  );
}
