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
  Indicador,
  ItemLista,
  Linha,
  Secao,
  Tela,
  Txt,
  Vazio,
} from '@/components/ui';
import { Espaco, Touch } from '@/constants/theme';
import { useApagarDespesa, useDespesas, useResumoPorDia, useSalvarDespesa } from '@/lib/dados';
import { diaDaSemana, diaMes, dinheiro, numeroDeTexto } from '@/lib/formato';
import { fimDoPeriodo, hojeDaSerie, inicioDoPeriodo, somaPeriodo } from '@/lib/periodo';

/**
 * O que mais se repete no balcão. Ficha em vez de lista de categorias: gasto
 * aqui é texto livre (a tabela não tem categoria), e a ficha só poupa ela de
 * digitar "Embalagem" pela décima vez com uma mão.
 */
const RAPIDOS = ['Gás', 'Embalagem', 'Transporte', 'Taxa'] as const;

/** Botão quadrado de 44 px só com o ícone: o `gap` zerado centraliza o ✕. */
const QUADRADO = {
  width: Touch.alvoSecundario,
  minHeight: Touch.alvoSecundario,
  paddingHorizontal: 0,
  gap: 0,
} as const;

export default function Gastos() {
  // 7 dias cobrem a semana inteira: ela nunca começou há mais de 6.
  const serie = useResumoPorDia(7);
  const despesas = useDespesas();

  const dias = serie.data ?? [];
  // "Hoje" do banco (`dia_local()`), não do relógio do celular: a semana tem
  // que virar no mesmo dia em que o fechamento vira.
  const hoje = hojeDaSerie(dias);
  const semana = somaPeriodo(dias, 'semana', hoje);

  return (
    <Tela
      titulo="Gastos"
      voltar
      atualizando={
        (serie.isFetching && !serie.isLoading) || (despesas.isFetching && !despesas.isLoading)
      }>
      {serie.error ? (
        <Aviso tom="negativo">
          {serie.error instanceof Error ? serie.error.message : 'Não consegui carregar a semana.'}
        </Aviso>
      ) : serie.isLoading ? (
        <Carregando />
      ) : (
        // Mercado e Outros somados, porque pro bolso dela é tudo saída; mas
        // separados embaixo, porque só o mercado vira estoque -- e é ele que
        // tem tela própria pra conferir e desfazer.
        <Cartao style={{ paddingBottom: Espaco.xs }}>
          <Indicador
            grande
            rotulo="Esta semana"
            valor={dinheiro(semana.compras + semana.despesas)}
            legenda={
              hoje
                ? `${diaMes(inicioDoPeriodo('semana', hoje))} – ${diaMes(fimDoPeriodo('semana', hoje))}`
                : undefined
            }
          />
          <View style={{ marginTop: Espaco.md }}>
            <Divisor />
            <ItemLista
              icone="compras"
              titulo="Mercado"
              valor={dinheiro(semana.compras)}
              rotuloAcessivel={`Mercado, ${dinheiro(semana.compras)}. Ver compras`}
              onPress={() => router.push('/planejar/compras')}
            />
            <Divisor />
            <ItemLista icone="gastos" titulo="Outros" valor={dinheiro(semana.despesas)} />
          </View>
        </Cartao>
      )}

      <NovoGasto />

      <Secao titulo="Recentes">
        <ListaDeGastos consulta={despesas} hoje={hoje} />
      </Secao>
    </Tela>
  );
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

function NovoGasto() {
  const salvar = useSalvarDespesa();
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const pronto = descricao.trim().length > 0 && numeroDeTexto(valor) > 0;

  // O recado de "adicionado" sai assim que ela começa o próximo: senão ele
  // fica na tela falando de um gasto que já não é o que está nos campos.
  function mudarDescricao(texto: string) {
    setRecado(null);
    setDescricao(texto);
  }

  async function adicionar() {
    setErro(null);
    setRecado(null);
    const numero = numeroDeTexto(valor);
    try {
      // Sem `dia`: quem decide o dia é o `DEFAULT dia_local()` do banco.
      await salvar.mutateAsync({ descricao, valor: numero });
      setRecado(`${descricao.trim()} · ${dinheiro(numero)} adicionado`);
      setDescricao('');
      setValor('');
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não consegui adicionar.');
    }
  }

  return (
    <Secao titulo="Novo gasto">
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Gasto rápido"
        // `xs` e não `sm`: com 4 px as quatro cabem numa linha em 390 px.
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Espaco.xs }}>
        {RAPIDOS.map((rotulo) => (
          <Ficha
            key={rotulo}
            rotulo={rotulo}
            ativo={descricao.trim() === rotulo}
            onPress={() => mudarDescricao(rotulo)}
          />
        ))}
      </View>
      <Campo
        rotulo="Descrição"
        value={descricao}
        onChangeText={mudarDescricao}
        // Não "Gás": a tinta do placeholder é forte (7:1) e ele parecia já
        // preenchido, ao lado de uma ficha "Gás" desmarcada.
        placeholder="Ex.: gelo"
        maxLength={120}
      />
      <Campo
        rotulo="Valor"
        prefixo="R$"
        value={valor}
        onChangeText={(texto) => {
          setRecado(null);
          setValor(texto);
        }}
        placeholder="0,00"
        inputMode="decimal"
        keyboardType="decimal-pad"
      />
      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
      {recado ? <Aviso tom="positivo">{recado}</Aviso> : null}
      <Botao icone="mais" onPress={adicionar} desabilitado={!pronto} ocupado={salvar.isPending}>
        Adicionar
      </Botao>
    </Secao>
  );
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

function ListaDeGastos({
  consulta,
  hoje,
}: {
  consulta: ReturnType<typeof useDespesas>;
  hoje: string;
}) {
  const apagar = useApagarDespesa();
  const [erro, setErro] = useState<string | null>(null);

  if (consulta.error) {
    return (
      <Aviso tom="negativo">
        {consulta.error instanceof Error ? consulta.error.message : 'Não consegui carregar os gastos.'}
      </Aviso>
    );
  }
  if (consulta.isLoading) return <Carregando />;

  const lista = consulta.data ?? [];
  if (lista.length === 0) {
    return <Vazio titulo="Nenhum gasto ainda" dica="Gás, embalagem, transporte, taxa." />;
  }

  return (
    <>
      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
      <Cartao style={{ paddingVertical: Espaco.xs }}>
        {lista.map((despesa, indice) => {
          const quando =
            despesa.dia === hoje ? 'hoje' : `${diaDaSemana(despesa.dia)}, ${diaMes(despesa.dia)}`;
          return (
            <Fragment key={despesa.id}>
              {indice > 0 ? <Divisor /> : null}
              <Linha style={{ minHeight: Touch.alvo, paddingVertical: Espaco.sm, gap: Espaco.md }}>
                <View style={{ flex: 1 }}>
                  <Txt tipo="corpo" negrito numberOfLines={2}>
                    {despesa.descricao}
                  </Txt>
                  <Txt tipo="rotulo" tom="textoFraco">
                    {quando}
                  </Txt>
                </View>
                <Txt tipo="corpo" negrito>
                  {dinheiro(despesa.valor)}
                </Txt>
                {/* Despesa não se edita (a tela só tem INSERT e DELETE nela):
                    errou, remove e lança de novo. */}
                <Botao
                  variante="perigo"
                  icone="fechar"
                  rotuloAcessivel={`Remover ${despesa.descricao}, ${dinheiro(despesa.valor)}, ${quando}`}
                  ocupado={apagar.isPending && apagar.variables === despesa.id}
                  style={QUADRADO}
                  onPress={async () => {
                    setErro(null);
                    try {
                      await apagar.mutateAsync(despesa.id);
                    } catch (falha) {
                      setErro(falha instanceof Error ? falha.message : 'Não consegui remover.');
                    }
                  }}>
                  {''}
                </Botao>
              </Linha>
            </Fragment>
          );
        })}
      </Cartao>
    </>
  );
}
