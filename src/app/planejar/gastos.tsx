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
  Linha,
  Secao,
  Tela,
  Txt,
  Vazio,
} from '@/components/ui';
import { Espaco, Touch } from '@/constants/theme';
import {
  gastosDe,
  useApagarDespesa,
  useCancelarCompra,
  useDespesas,
  useHistoricoCompras,
  useResumoPorDia,
  useSalvarDespesa,
} from '@/lib/dados';
import { diaDaSemana, diaMes, dinheiro, hojeISO, intervaloCurto, numeroDeTexto } from '@/lib/formato';
import {
  escolherDaGaleria,
  fotografarNotinha,
  lerNotinha,
  totalDaNota,
} from '@/lib/notinha';
import { fimDoPeriodo, hojeDaSerie, inicioDoPeriodo, somaPeriodo, somarDias } from '@/lib/periodo';

/**
 * Gastos: TODO dinheiro que saiu, num lugar só.
 *
 * Antes eram três telas -- Compras (a nota lida item por item, com quantidade,
 * unidade e preço de cada ingrediente), Gastos (gás, embalagem) e Estoque -- e
 * a dona achou complicado demais. O que ela quer registrar é "gastei R$ 87 no
 * mercado", não "1,2 kg de salsicha a R$ 18,90 o quilo". Então a nota virou um
 * gasto como outro qualquer: a foto lê o TOTAL, ela confere com o papel e
 * salva. Quem não quer foto digita o valor.
 *
 * Tudo vai pra tabela `despesas`, que é o que entra no lucro (vendas menos
 * gastos). As compras antigas, da época da leitura por item, continuam
 * aparecendo na lista e somando no dia delas.
 */

/** O que mais se repete. Ficha só poupa digitar; o texto continua livre. */
const RAPIDOS = ['Mercado', 'Gás', 'Embalagem', 'Transporte'] as const;

/** Botão quadrado de 44 px só com o ícone: o `gap` zerado centraliza o ✕. */
const QUADRADO = {
  width: Touch.alvoSecundario,
  minHeight: Touch.alvoSecundario,
  paddingHorizontal: 0,
  gap: 0,
} as const;

/** O que a foto leu, já em texto editável (ver `Campo`: número só ao salvar). */
type Leitura = {
  valor: string;
  onde: string;
  /** "AAAA-MM-DD" ou "" (nota sem data legível). */
  dataDaNota: string;
  dia: string;
  itens: number;
  fotos: number;
};

const paraCampo = (valor: number) => (valor > 0 ? valor.toFixed(2).replace('.', ',') : '');

const erroDe = (falha: unknown, padrao: string) =>
  falha instanceof Error ? falha.message : padrao;

/** "Mercado · Atacadão", cortado no limite de 120 do CHECK de `despesas`. */
function descricaoDoMercado(onde: string) {
  const nome = onde.trim();
  return (nome ? `Mercado · ${nome}` : 'Mercado').slice(0, 120);
}

export default function Gastos() {
  // 7 dias cobrem a semana inteira: ela nunca começou há mais de 6.
  const serie = useResumoPorDia(7);
  const despesas = useDespesas();
  const compras = useHistoricoCompras();
  const salvar = useSalvarDespesa();

  const [lendo, setLendo] = useState(false);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const dias = serie.data ?? [];
  // "Hoje" do banco (`dia_local()`), não do relógio do celular. O do celular
  // só entra enquanto a série não chegou, pra tela não ficar travada.
  const hoje = hojeDaSerie(dias) || hojeISO();
  const semana = somaPeriodo(dias, 'semana', hoje);

  async function capturar(origem: 'camera' | 'galeria') {
    setErro(null);
    setRecado(null);
    setLendo(true);
    try {
      const fotos =
        origem === 'camera'
          ? await fotografarNotinha().then((foto) => (foto ? [foto] : []))
          : await escolherDaGaleria();
      if (fotos.length === 0) return;

      const nota = await lerNotinha(fotos);
      // Data da nota só vale se não for depois de hoje: o modelo às vezes lê
      // a validade do produto, e um gasto no futuro sumiria das contas.
      const dataDaNota = nota.data && nota.data <= hoje ? nota.data : '';
      setLeitura({
        valor: paraCampo(totalDaNota(nota)),
        onde: nota.fornecedor,
        dataDaNota,
        dia: dataDaNota || hoje,
        itens: nota.itens.length,
        fotos: fotos.length,
      });
    } catch (falha) {
      setErro(erroDe(falha, 'Não consegui ler a nota.'));
    } finally {
      setLendo(false);
    }
  }

  async function salvarLeitura() {
    if (!leitura) return;
    setErro(null);
    const valor = numeroDeTexto(leitura.valor);
    if (!(valor > 0)) {
      setErro('Digite quanto deu a nota.');
      return;
    }
    try {
      await salvar.mutateAsync({
        descricao: descricaoDoMercado(leitura.onde),
        valor,
        // Hoje vai sem `dia`: quem decide é o `DEFAULT dia_local()` do banco,
        // e não um "hoje" que pode ter vindo do relógio do celular.
        ...(leitura.dia !== hoje ? { dia: leitura.dia } : {}),
      });
      setRecado(`Gasto de ${dinheiro(valor)} anotado`);
      setLeitura(null);
    } catch (falha) {
      setErro(erroDe(falha, 'Não consegui salvar o gasto.'));
    }
  }

  // ---- Lendo a nota ------------------------------------------------------
  if (lendo) {
    return (
      <Tela titulo="Gastos" voltar>
        {/* A espera com chuva mora AQUI, e só aqui: a leitura pelo Gemini leva
            de 3 a 18 segundos medidos, e é a única tela do app em que ela fica
            parada olhando. */}
        <Cartao style={{ gap: Espaco.sm, alignItems: 'center' }}>
          <Carregando chuva />
          <Txt tipo="secao" centro>
            Lendo a nota…
          </Txt>
          <Txt tipo="rotulo" tom="textoFraco" centro>
            Leva alguns segundos.
          </Txt>
        </Cartao>
      </Tela>
    );
  }

  // ---- Conferindo o que a foto leu --------------------------------------
  if (leitura) {
    const valor = numeroDeTexto(leitura.valor);
    return (
      <Tela
        titulo="Conferir nota"
        // Sem seta de voltar: voltar jogaria fora, calado, uma leitura que
        // custou cota. A saída é o "Descartar", que pergunta antes.
        acao={
          // No canto de cima, longe do polegar: descartar joga fora uma
          // leitura que custou cota.
          <Botao
            variante="fantasma"
            rotuloAcessivel="Descartar leitura"
            confirmar="Descartar?"
            onPress={() => setLeitura(null)}
            style={{
              minHeight: Touch.alvoSecundario,
              paddingHorizontal: Espaco.sm,
              marginRight: -Espaco.sm,
            }}>
            Descartar
          </Botao>
        }
        rodape={
          <>
            {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
            <Botao
              grande
              icone="ok"
              onPress={salvarLeitura}
              ocupado={salvar.isPending}
              desabilitado={!(valor > 0)}>
              {valor > 0 ? `Salvar gasto de ${dinheiro(valor)}` : 'Salvar gasto'}
            </Botao>
          </>
        }>
        <View style={{ gap: Espaco.lg }}>
          {/* Um número só pra conferir, e grande: é o que ela compara com o
              papel na mão. A lista de itens não aparece -- era ela que fazia
              a tela parecer planilha. */}
          <Cartao style={{ gap: Espaco.md }}>
            <Campo
              rotulo="Quanto deu a nota"
              prefixo="R$"
              value={leitura.valor}
              onChangeText={(texto) => setLeitura({ ...leitura, valor: texto })}
              placeholder="0,00"
              inputMode="decimal"
              keyboardType="decimal-pad"
            />
            <Txt tipo="rotulo" tom="textoFraco">
              {valor > 0
                ? 'Confira com o TOTAL impresso na nota. Se estiver diferente, é só corrigir.'
                : 'Não consegui ler o total. Digite o valor que está na nota.'}
            </Txt>
          </Cartao>

          <DiaDoGasto
            hoje={hoje}
            valor={leitura.dia}
            dataDaNota={leitura.dataDaNota}
            onMudar={(dia) => setLeitura({ ...leitura, dia })}
          />

          <Campo
            rotulo="Onde comprou"
            value={leitura.onde}
            onChangeText={(texto) => setLeitura({ ...leitura, onde: texto })}
            placeholder="Opcional"
            maxLength={100}
          />

          {leitura.itens > 0 ? (
            <Txt tipo="rotulo" tom="textoFraco" centro>
              {leitura.fotos > 1 ? `${leitura.fotos} fotos lidas juntas · ` : ''}
              {leitura.itens} {leitura.itens === 1 ? 'item lido' : 'itens lidos'} na nota
            </Txt>
          ) : null}
        </View>
      </Tela>
    );
  }

  // ---- Tela normal -------------------------------------------------------
  return (
    <Tela
      titulo="Gastos"
      voltar
      atualizando={
        (serie.isFetching && !serie.isLoading) || (despesas.isFetching && !despesas.isLoading)
      }>
      <View style={{ gap: Espaco.md }}>
        {recado ? <Aviso tom="positivo">{recado}</Aviso> : null}
        {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
        {/* A ação da tela (a única mostarda): é o jeito mais fácil, um toque
            e a câmera abre. */}
        <Botao grande icone="camera" onPress={() => capturar('camera')}>
          Tirar foto da nota
        </Botao>
        <Botao variante="secundaria" icone="galeria" onPress={() => capturar('galeria')}>
          Usar foto que já tirei
        </Botao>
        <Txt tipo="rotulo" tom="textoFraco" centro>
          O app lê o total da nota. Você confere antes de salvar.
        </Txt>
      </View>

      <DigitarValor hoje={hoje} onAnotado={setRecado} />

      <Secao titulo="Esta semana">
        {serie.error ? (
          <Aviso tom="negativo">{erroDe(serie.error, 'Não consegui carregar a semana.')}</Aviso>
        ) : serie.isLoading ? (
          <Carregando />
        ) : (
          <Cartao>
            <Indicador
              rotulo="Total gasto"
              valor={dinheiro(gastosDe(semana))}
              legenda={intervaloCurto(
                inicioDoPeriodo('semana', hoje),
                fimDoPeriodo('semana', hoje),
              )}
            />
          </Cartao>
        )}
      </Secao>

      <Secao titulo="Últimos gastos">
        <ListaDeGastos despesas={despesas} compras={compras} hoje={hoje} />
      </Secao>
    </Tela>
  );
}

// ---------------------------------------------------------------------------
// Dia do gasto
// ---------------------------------------------------------------------------

/**
 * Hoje / Ontem / a data da nota, por toque. Nada de digitar "dd/mm/aaaa": o
 * gasto quase sempre é de hoje ou de ontem, e quando a foto leu outra data
 * ela aparece pronta como terceira opção.
 */
function DiaDoGasto({
  hoje,
  valor,
  dataDaNota,
  onMudar,
}: {
  hoje: string;
  valor: string;
  dataDaNota?: string;
  onMudar: (dia: string) => void;
}) {
  const ontem = somarDias(hoje, -1);
  const opcoes = [
    { dia: hoje, rotulo: 'Hoje' },
    { dia: ontem, rotulo: 'Ontem' },
  ];
  if (dataDaNota && dataDaNota !== hoje && dataDaNota !== ontem) {
    opcoes.push({ dia: dataDaNota, rotulo: `${diaMes(dataDaNota)} (da nota)` });
  }

  return (
    <View style={{ gap: Espaco.xs }}>
      <Txt tipo="rotulo" tom="textoFraco">
        Quando
      </Txt>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Dia do gasto"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Espaco.sm }}>
        {opcoes.map((opcao) => (
          <Ficha
            key={opcao.dia}
            rotulo={opcao.rotulo}
            ativo={valor === opcao.dia}
            onPress={() => onMudar(opcao.dia)}
          />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Digitar o valor
// ---------------------------------------------------------------------------

function DigitarValor({
  hoje,
  onAnotado,
}: {
  hoje: string;
  onAnotado: (recado: string | null) => void;
}) {
  const salvar = useSalvarDespesa();
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  // '' = hoje. Guardar a data já resolvida prenderia o gasto em "ontem" de
  // anteontem se a tela ficasse aberta da noite pro dia.
  const [dia, setDia] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const pronto = descricao.trim().length > 0 && numeroDeTexto(valor) > 0;

  // O recado de "anotado" sai assim que ela começa o próximo: senão ele fica
  // na tela falando de um gasto que já não é o que está nos campos.
  function mudarDescricao(texto: string) {
    onAnotado(null);
    setDescricao(texto);
  }

  async function anotar() {
    setErro(null);
    onAnotado(null);
    const numero = numeroDeTexto(valor);
    try {
      // Sem `dia` quando é hoje: quem decide é o `DEFAULT dia_local()` do banco.
      await salvar.mutateAsync({
        descricao,
        valor: numero,
        ...(dia && dia !== hoje ? { dia } : {}),
      });
      onAnotado(`${descricao.trim()} · ${dinheiro(numero)} anotado`);
      setDescricao('');
      setValor('');
      setDia('');
    } catch (falha) {
      setErro(erroDe(falha, 'Não consegui anotar.'));
    }
  }

  return (
    <Secao titulo="Ou digite o valor">
      <Cartao style={{ gap: Espaco.md }}>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Tipo de gasto"
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
          rotulo="Com o quê"
          value={descricao}
          onChangeText={mudarDescricao}
          // Não "Gás": a tinta do placeholder é forte e ele parecia já
          // preenchido, ao lado de uma ficha "Gás" desmarcada.
          placeholder="Ex.: gelo"
          maxLength={120}
        />
        <Campo
          rotulo="Quanto"
          prefixo="R$"
          value={valor}
          onChangeText={(texto) => {
            onAnotado(null);
            setValor(texto);
          }}
          placeholder="0,00"
          inputMode="decimal"
          keyboardType="decimal-pad"
        />
        <DiaDoGasto hoje={hoje} valor={dia || hoje} onMudar={setDia} />
        {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
        {/* Secundária: a mostarda da tela é a foto. */}
        <Botao
          variante="secundaria"
          icone="mais"
          onPress={anotar}
          desabilitado={!pronto}
          ocupado={salvar.isPending}>
          Anotar gasto
        </Botao>
      </Cartao>
    </Secao>
  );
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

type Lancamento = {
  chave: string;
  /** `despesa` apaga a linha; `compra` (antiga, por item) estorna o estoque. */
  tipo: 'despesa' | 'compra';
  id: string;
  titulo: string;
  dia: string;
  valor: number;
};

function ListaDeGastos({
  despesas,
  compras,
  hoje,
}: {
  despesas: ReturnType<typeof useDespesas>;
  compras: ReturnType<typeof useHistoricoCompras>;
  hoje: string;
}) {
  const apagar = useApagarDespesa();
  const cancelar = useCancelarCompra();
  const [erro, setErro] = useState<string | null>(null);

  if (despesas.error) {
    return <Aviso tom="negativo">{erroDe(despesas.error, 'Não consegui carregar os gastos.')}</Aviso>;
  }
  if (despesas.isLoading || compras.isLoading) return <Carregando />;

  // Uma lista só, do mais novo pro mais velho: pra ela, compra antiga e gasto
  // novo são a mesma coisa -- dinheiro que saiu. Se as compras falharem, os
  // gastos ainda aparecem.
  const lista: Lancamento[] = [
    ...(despesas.data ?? []).map((d) => ({
      chave: `d-${d.id}`,
      tipo: 'despesa' as const,
      id: d.id,
      titulo: d.descricao,
      dia: d.dia.slice(0, 10),
      valor: d.valor,
    })),
    ...(compras.data ?? []).map((c) => ({
      chave: `c-${c.id}`,
      tipo: 'compra' as const,
      id: c.id,
      titulo: descricaoDoMercado(c.fornecedor),
      dia: c.comprada_em.slice(0, 10),
      valor: c.total,
    })),
  ].sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0));

  if (lista.length === 0) {
    return <Vazio titulo="Nenhum gasto ainda" dica="Mercado, gás, embalagem, transporte." />;
  }

  return (
    <>
      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
      <Cartao style={{ paddingVertical: Espaco.xs }}>
        {lista.map((item, indice) => {
          const quando =
            item.dia === hoje
              ? 'hoje'
              : item.dia === somarDias(hoje, -1)
                ? 'ontem'
                : `${diaDaSemana(item.dia)}, ${diaMes(item.dia)}`;
          const ocupado =
            item.tipo === 'despesa'
              ? apagar.isPending && apagar.variables === item.id
              : cancelar.isPending && cancelar.variables === item.id;
          return (
            <Fragment key={item.chave}>
              {indice > 0 ? <Divisor /> : null}
              <Linha style={{ minHeight: Touch.alvo, paddingVertical: Espaco.sm, gap: Espaco.md }}>
                <View style={{ flex: 1 }}>
                  <Txt tipo="corpo" negrito numberOfLines={2}>
                    {item.titulo}
                  </Txt>
                  <Txt tipo="rotulo" tom="textoFraco">
                    {quando}
                  </Txt>
                </View>
                <Txt tipo="corpo" negrito>
                  {dinheiro(item.valor)}
                </Txt>
                {/* Gasto não se edita: errou, apaga e anota de novo. A compra
                    antiga passa por `cancelar_compra()`, que estorna o estoque
                    na mesma transação (ver AGENTS.md). */}
                <Botao
                  variante="perigo"
                  icone="fechar"
                  rotuloAcessivel={`Apagar ${item.titulo}, ${dinheiro(item.valor)}, ${quando}`}
                  confirmar="Apagar?"
                  ocupado={ocupado}
                  style={QUADRADO}
                  onPress={async () => {
                    setErro(null);
                    try {
                      if (item.tipo === 'despesa') await apagar.mutateAsync(item.id);
                      else await cancelar.mutateAsync(item.id);
                    } catch (falha) {
                      setErro(erroDe(falha, 'Não consegui apagar.'));
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
