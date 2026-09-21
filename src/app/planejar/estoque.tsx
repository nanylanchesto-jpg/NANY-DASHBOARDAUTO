import { router } from 'expo-router';
import { Fragment, useState } from 'react';
import { View } from 'react-native';

import {
  Aviso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  Divisor,
  Ficha,
  Tela,
  Txt,
  Vazio,
  type TomTexto,
} from '@/components/ui';
import { Espaco, Touch } from '@/constants/theme';
import { useParaComprar, useSalvarIngrediente, type ParaComprar } from '@/lib/dados';
import { saldo } from '@/lib/formato';
import { ROTULO_UNIDADE, type Unidade } from '@/lib/unidades';

/** Abaixo disto o ingrediente pede atenção: dá tempo de ir ao mercado. */
const DIAS_DE_FOLGA = 3;

type Estado = { palavra: string; tom: TomTexto; atencao: boolean };

/**
 * O estado de cada linha em PALAVRA, não em cor: "lançar compra" e "acaba
 * hoje" têm que ser lidos por quem não distingue o tom de atenção do de texto
 * (e pelo leitor de tela, que não vê cor nenhuma).
 *
 * Saldo negativo vem antes de tudo e não quer dizer "comprar": é venda feita
 * com uma compra que ainda não foi LANÇADA (o gatilho baixou estoque que não
 * tinha entrado). O conserto é fotografar a nota, não ir ao mercado.
 *
 * `dias_restantes` null = não girou na semana; "dias" não significaria nada.
 */
function estadoDe(item: ParaComprar): Estado {
  if (item.estoque_base < 0) return { palavra: 'lançar compra', tom: 'negativo', atencao: true };
  if (item.dias_restantes === null) return { palavra: 'parado', tom: 'textoFraco', atencao: false };
  const dias = Math.floor(item.dias_restantes);
  if (item.dias_restantes < DIAS_DE_FOLGA) {
    const palavra = dias < 1 ? 'acaba hoje' : `acaba em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
    return { palavra, tom: 'atencao', atencao: true };
  }
  return { palavra: `~${dias} dias`, tom: 'textoFraco', atencao: false };
}

export default function Estoque() {
  const consulta = useParaComprar();
  const [formulario, setFormulario] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  // A ordem já vem do banco (negativo, depois o que acaba antes, parado por
  // último): a tela não reordena, senão teria duas regras de urgência.
  const itens = consulta.data ?? [];
  const estados = itens.map(estadoDe);
  const pedem = estados.filter((e) => e.atencao).length;

  return (
    <Tela
      titulo="Estoque"
      voltar
      atualizando={consulta.isFetching && !consulta.isLoading}>
      {consulta.error ? (
        <Aviso tom="negativo">
          {consulta.error instanceof Error ? consulta.error.message : 'Não consegui carregar o estoque.'}
        </Aviso>
      ) : consulta.isLoading ? (
        <Carregando />
      ) : itens.length === 0 ? (
        <View style={{ gap: Espaco.md }}>
          <Vazio
            titulo="Nenhum ingrediente"
            dica="Eles entram sozinhos quando você fotografa uma nota."
          />
          {/* Estoque vazio tem UMA saída de verdade, a nota; o cadastro à mão
              lá embaixo é a exceção. Mostarda só aqui, e some com o formulário
              aberto, que traz a sua. */}
          {formulario ? null : (
            <Botao icone="camera" onPress={() => router.push('/planejar/compras')}>
              Fotografar nota
            </Botao>
          )}
        </View>
      ) : (
        <View style={{ gap: Espaco.lg }}>
          {pedem > 0 ? (
            <Aviso
              tom="atencao"
              acao={{ rotulo: 'Lançar compra', onPress: () => router.push('/planejar/compras') }}>
              {`${pedem} ${pedem === 1 ? 'precisa' : 'precisam'} de atenção`}
            </Aviso>
          ) : (
            <Aviso tom="positivo">Tudo em ordem</Aviso>
          )}

          <Cartao style={{ paddingVertical: Espaco.xs }}>
            {itens.map((item, indice) => {
              const estado = estados[indice];
              const quanto = saldo(item.estoque_base, item.unidade);
              return (
                <Fragment key={item.id}>
                  {indice > 0 ? <Divisor /> : null}
                  <View
                    accessible
                    accessibilityLabel={`${item.nome}, ${quanto}, ${estado.palavra}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Espaco.md,
                      minHeight: Touch.alvo,
                      paddingVertical: Espaco.md,
                    }}>
                    <View style={{ flex: 1 }}>
                      <Txt tipo="corpo" negrito numberOfLines={2}>
                        {item.nome}
                      </Txt>
                      <Txt tipo="rotulo" tom={estado.tom} negrito={estado.atencao}>
                        {estado.palavra}
                      </Txt>
                    </View>
                    <Txt tipo="secao" tom={item.estoque_base < 0 ? 'negativo' : 'texto'}>
                      {quanto}
                    </Txt>
                  </View>
                </Fragment>
              );
            })}
          </Cartao>
        </View>
      )}

      <View style={{ marginTop: Espaco.xl, gap: Espaco.md }}>
        {recado ? <Aviso tom="positivo">{recado}</Aviso> : null}
        {formulario ? (
          <NovoIngrediente
            onFechar={() => setFormulario(false)}
            onCriado={(nome) => {
              setFormulario(false);
              setRecado(`${nome} entrou no estoque`);
            }}
          />
        ) : (
          <Botao
            variante="secundaria"
            icone="mais"
            rotuloAcessivel="Novo ingrediente"
            onPress={() => {
              setRecado(null);
              setFormulario(true);
            }}>
            Ingrediente
          </Botao>
        )}
      </View>
    </Tela>
  );
}

/**
 * Cadastro à mão, escondido atrás de um toque porque é exceção: ingrediente
 * costuma nascer sozinho da nota fotografada. Serve pra montar a receita de um
 * produto antes da primeira compra.
 *
 * A unidade é a de COMPRA ("kg" de salsicha); o saldo aparece na de uso
 * sozinho (ver `unidadeDeExibicao`), então não há o que escolher duas vezes.
 */
function NovoIngrediente({
  onFechar,
  onCriado,
}: {
  onFechar: () => void;
  onCriado: (nome: string) => void;
}) {
  const salvar = useSalvarIngrediente();
  const [nome, setNome] = useState('');
  const [unidade, setUnidade] = useState<Unidade>('unidade');
  const [erro, setErro] = useState<string | null>(null);

  return (
    <Cartao style={{ gap: Espaco.md }}>
      <Txt tipo="secao" cabecalho>
        Novo ingrediente
      </Txt>
      <Campo
        rotulo="Nome"
        value={nome}
        onChangeText={setNome}
        placeholder="Ex.: pão"
        maxLength={120}
      />
      <View style={{ gap: Espaco.xs }}>
        <Txt tipo="rotulo" tom="textoFraco">
          Como você compra
        </Txt>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Como você compra"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Espaco.sm }}>
          {(['unidade', 'kg', 'g', 'l', 'ml'] as Unidade[]).map((u) => (
            <Ficha
              key={u}
              rotulo={ROTULO_UNIDADE[u]}
              ativo={unidade === u}
              onPress={() => setUnidade(u)}
            />
          ))}
        </View>
      </View>
      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
      <Botao
        desabilitado={nome.trim().length === 0}
        ocupado={salvar.isPending}
        onPress={async () => {
          setErro(null);
          try {
            await salvar.mutateAsync({ nome, unidade });
            onCriado(nome.trim());
          } catch (falha) {
            setErro(falha instanceof Error ? falha.message : 'Não consegui cadastrar.');
          }
        }}>
        Cadastrar
      </Botao>
      <Botao variante="fantasma" onPress={onFechar}>
        Cancelar
      </Botao>
    </Cartao>
  );
}
