import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, View, type TextStyle } from 'react-native';

import { Icone } from '@/components/icone';
import {
  Aviso,
  BarraProgresso,
  Botao,
  Campo,
  Carregando,
  Cartao,
  Divisor,
  Linha,
  Tela,
  Txt,
} from '@/components/ui';
import { Espaco, Touch } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import { useApagarMeta, useMetas, useResumoPorDia, useSalvarMeta, type Periodo } from '@/lib/dados';
import { dinheiro, numeroDeTexto } from '@/lib/formato';
import { hojeDaSerie, somaPeriodo } from '@/lib/periodo';

/** A mesma série do hub: o progresso sai do cache, sem outra ida ao banco. */
const SERIE = 31;

const PERIODOS: { periodo: Periodo; titulo: string; nome: string }[] = [
  { periodo: 'dia', titulo: 'Por dia', nome: 'Meta do dia' },
  { periodo: 'semana', titulo: 'Por semana', nome: 'Meta da semana' },
  { periodo: 'mes', titulo: 'Por mês', nome: 'Meta do mês' },
];

const NUMERAL: TextStyle = { fontVariant: ['tabular-nums'] };

function mensagem(falha: unknown, padrao: string) {
  return falha instanceof Error ? falha.message : padrao;
}

/**
 * Valor pro campo, no jeito que ela digitaria: "300" e não "300,00" (meta é
 * número redondo quase sempre), vírgula quando tem centavo.
 */
function paraCampo(valor: number) {
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(2).replace('.', ',');
}

export default function Metas() {
  const metas = useMetas();
  const serie = useResumoPorDia(SERIE);
  // Uma edição aberta por vez: com duas, o "Salvar" de uma fica colado no
  // campo da outra e o toque vai pro lugar errado.
  const [aberta, setAberta] = useState<Periodo | null>(null);

  const dias = serie.data ?? [];
  const hoje = hojeDaSerie(dias);

  return (
    <Tela titulo="Metas" voltar atualizando={metas.isFetching && !metas.isLoading}>
      <Txt tipo="rotulo" tom="textoFraco">
        Quanto vender em cada período.
      </Txt>

      <View style={{ marginTop: Espaco.lg }}>
        {metas.error ? (
          <Aviso tom="negativo">{mensagem(metas.error, 'Não consegui carregar as metas.')}</Aviso>
        ) : metas.isLoading ? (
          <Carregando />
        ) : (
          <Cartao style={{ paddingVertical: Espaco.xs }}>
            {PERIODOS.map(({ periodo, titulo, nome }, i) => (
              <Fragment key={periodo}>
                {i > 0 ? <Divisor /> : null}
                <LinhaDeMeta
                  periodo={periodo}
                  titulo={titulo}
                  nome={nome}
                  valor={
                    metas.data?.find((m) => m.periodo === periodo && m.valor > 0)?.valor ?? null
                  }
                  // Sem a série ainda não se sabe quanto já vendeu: nada de
                  // barra em zero, que diria "não vendeu nada".
                  realizado={hoje ? somaPeriodo(dias, periodo, hoje).receita : null}
                  aberta={aberta === periodo}
                  onAlternar={() => setAberta(aberta === periodo ? null : periodo)}
                  onFechar={() => setAberta(null)}
                />
              </Fragment>
            ))}
          </Cartao>
        )}
      </View>
    </Tela>
  );
}

function LinhaDeMeta({
  periodo,
  titulo,
  nome,
  valor,
  realizado,
  aberta,
  onAlternar,
  onFechar,
}: {
  periodo: Periodo;
  titulo: string;
  nome: string;
  valor: number | null;
  realizado: number | null;
  aberta: boolean;
  onAlternar: () => void;
  onFechar: () => void;
}) {
  const { cores } = useTema();

  return (
    <View>
      {/* `aria-expanded`: é um expansor, não um botão comum. Sem o estado o
          leitor de tela anuncia igual com a edição aberta e fechada, e a seta
          que diz isso pro olho não é lida. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${nome}, ${valor ? dinheiro(valor) : 'não definida'}`}
        aria-expanded={aberta}
        onPress={onAlternar}
        style={({ pressed }) => [estilos.cabecalho, { opacity: pressed ? 0.6 : 1 }]}>
        <Txt tipo="corpo" negrito style={{ flex: 1 }}>
          {titulo}
        </Txt>
        {valor ? (
          <Txt tipo="secao" style={NUMERAL}>
            {dinheiro(valor)}
          </Txt>
        ) : (
          <Txt tipo="secao" tom="textoFraco">
            —
          </Txt>
        )}
        <View style={{ transform: [{ rotate: aberta ? '-90deg' : '90deg' }] }}>
          <Icone nome="seguir" tamanho={20} cor={cores.textoFraco} />
        </View>
      </Pressable>

      {aberta ? (
        <EditorDeMeta periodo={periodo} nome={nome} valor={valor} onFechar={onFechar} />
      ) : valor && realizado !== null ? (
        <View style={estilos.progresso}>
          <BarraProgresso atual={realizado} alvo={valor} rotuloAcessivel={nome} />
          <Linha entre>
            <Txt tipo="rotulo" tom="textoFraco" style={NUMERAL}>
              {dinheiro(realizado)} de {dinheiro(valor)}
            </Txt>
            {realizado >= valor ? (
              <Txt tipo="rotulo" negrito tom="positivo">
                ✓ batida
              </Txt>
            ) : null}
          </Linha>
        </View>
      ) : null}
    </View>
  );
}

function EditorDeMeta({
  periodo,
  nome,
  valor,
  onFechar,
}: {
  periodo: Periodo;
  nome: string;
  valor: number | null;
  onFechar: () => void;
}) {
  const salvar = useSalvarMeta();
  const apagar = useApagarMeta();
  // Texto, não número: com `number` no estado, apagar o campo pra digitar de
  // novo viraria "0" na hora, e a vírgula do meio de "12,5" sumiria.
  const [texto, setTexto] = useState(valor ? paraCampo(valor) : '');
  const [erro, setErro] = useState<string | null>(null);

  async function aoSalvar() {
    const novo = numeroDeTexto(texto);
    // O banco recusa também (CHECK valor > 0), mas aqui a resposta é na hora
    // e não depende do 3G.
    if (!(novo > 0)) {
      setErro('Use um valor maior que zero.');
      return;
    }
    setErro(null);
    try {
      await salvar.mutateAsync({ periodo, valor: novo });
      onFechar();
    } catch (falha) {
      setErro(mensagem(falha, 'Não consegui salvar a meta.'));
    }
  }

  async function aoRemover() {
    setErro(null);
    try {
      await apagar.mutateAsync(periodo);
      onFechar();
    } catch (falha) {
      setErro(mensagem(falha, 'Não consegui remover a meta.'));
    }
  }

  return (
    <View style={estilos.editor}>
      <Campo
        accessibilityLabel={nome}
        prefixo="R$"
        value={texto}
        onChangeText={setTexto}
        placeholder="0"
        inputMode="decimal"
        keyboardType="decimal-pad"
        returnKeyType="done"
        onSubmitEditing={aoSalvar}
        autoFocus
      />
      {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
      <Linha style={{ gap: Espaco.md }}>
        <Botao
          onPress={aoSalvar}
          ocupado={salvar.isPending}
          desabilitado={apagar.isPending}
          style={{ flex: 1 }}>
          Salvar
        </Botao>
        {valor ? (
          <Botao
            variante="perigo"
            onPress={aoRemover}
            ocupado={apagar.isPending}
            desabilitado={salvar.isPending}
            rotuloAcessivel={`Remover ${nome.toLowerCase()}`}>
            Remover
          </Botao>
        ) : null}
      </Linha>
    </View>
  );
}

const estilos = StyleSheet.create({
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Espaco.md,
    minHeight: Touch.alvo,
    paddingVertical: Espaco.md,
  },
  progresso: {
    gap: Espaco.sm,
    paddingBottom: Espaco.lg,
  },
  editor: {
    gap: Espaco.md,
    paddingBottom: Espaco.lg,
  },
});
