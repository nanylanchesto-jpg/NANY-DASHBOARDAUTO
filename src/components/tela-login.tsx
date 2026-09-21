import { useState } from 'react';
import { Text, View } from 'react-native';

import { Espaco, Peso, Raio } from '@/constants/theme';
import { useTema } from '@/hooks/use-tema';
import { criarConta, entrar } from '@/lib/sessao';

import { Aviso, Botao, Campo, Txt, Tela } from './ui';

/**
 * O "Nany" em tomate, com um ponto final de mostarda.
 *
 * É o ÚNICO lugar em que `marca` vira cor de texto: tomate no creme dá 3,96:1,
 * abaixo dos 7:1 que o app cobra de texto, e só passa aqui porque isto é
 * marca, grande e pesado, e não informação que ela precise ler.
 *
 * Mora aqui porque o login é onde ele aparece grande; a tela Hoje usa o mesmo
 * componente no cabeçalho, pra os dois nunca divergirem de proporção.
 */
export function Logotipo({ tamanho }: { tamanho: number }) {
  const { cores } = useTema();
  const ponto = Math.round(tamanho * 0.2);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <Text
        accessibilityRole="header"
        // O ponto é uma <View> medida em px e não cresceria junto com a fonte
        // do sistema. Logotipo não é texto de leitura: fica no tamanho em que
        // foi desenhado, e o ponto continua sentado na linha de base.
        allowFontScaling={false}
        style={{
          color: cores.marca,
          fontSize: tamanho,
          fontWeight: Peso.pesado,
          letterSpacing: -tamanho * 0.03,
          // Sem o respiro extra que o Android põe em cima e embaixo do texto:
          // com ele, a conta da linha de base abaixo erraria só no Android.
          includeFontPadding: false,
        }}>
        Nany
      </Text>
      <View
        style={{
          width: ponto,
          height: ponto,
          borderRadius: Raio.pill,
          backgroundColor: cores.acao,
          marginLeft: tamanho * 0.06,
          // A caixa do texto termina na descida do "y", não na linha de base.
          // A descida das fontes de sistema (SF, Roboto, Segoe) fica em torno
          // de 24% do tamanho; subir isso põe o ponto onde iria um ponto final.
          marginBottom: tamanho * 0.24,
        }}
      />
    </View>
  );
}

export function TelaLogin() {
  const [modo, setModo] = useState<'entrar' | 'criar'>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const criando = modo === 'criar';

  async function enviar() {
    setErro(null);
    setRecado(null);

    if (!email.trim() || !senha) {
      setErro('Preencha e-mail e senha.');
      return;
    }
    // Conferido aqui além do servidor pra ela não descobrir o limite depois de
    // esperar a resposta -- o Supabase recusa com a mensagem em inglês.
    if (criando && senha.length < 6) {
      setErro('A senha precisa de pelo menos 6 caracteres.');
      return;
    }

    setOcupado(true);
    try {
      if (criando) {
        await criarConta(email, senha);
        // Se a confirmação de e-mail estiver ligada no projeto, `signUp` não
        // abre sessão -- sem este recado a tela só ficaria parada.
        setRecado('Conta criada. Se pedir confirmação, veja o link no seu e-mail.');
      } else {
        await entrar(email, senha);
        // Sem setOcupado(false) aqui de propósito: `onAuthStateChange` troca a
        // tela inteira, e desligar o spinner antes disso faz o botão voltar ao
        // normal por um instante, parecendo que nada aconteceu.
        return;
      }
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não consegui entrar agora.');
    }
    setOcupado(false);
  }

  return (
    <Tela>
      <View style={{ flex: 1, justifyContent: 'center', paddingVertical: Espaco.xxl }}>
        <View style={{ gap: Espaco.sm, marginBottom: Espaco.xxl }}>
          <Logotipo tamanho={40} />
          <Txt tipo="corpo" tom="textoFraco">
            Vendas, caixa e estoque
          </Txt>
        </View>

        {/* Sem `Cartao`: a tela já é só o formulário, e a moldura em volta dele
            era uma caixa dentro de outra caixa sem separar nada. */}
        <View style={{ gap: Espaco.md }}>
          <Campo
            rotulo="E-mail"
            value={email}
            onChangeText={setEmail}
            placeholder="seu@email.com"
            autoCapitalize="none"
            // O corretor do iOS "arruma" o domínio do e-mail enquanto ela
            // digita, e o login falha sem que ela veja por quê.
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
          />
          <Campo
            rotulo="Senha"
            value={senha}
            onChangeText={setSenha}
            placeholder="••••••"
            secureTextEntry
            autoCapitalize="none"
            autoComplete={criando ? 'new-password' : 'current-password'}
            onSubmitEditing={enviar}
            returnKeyType="go"
          />

          {erro ? <Aviso tom="negativo">{erro}</Aviso> : null}
          {recado ? <Aviso tom="positivo">{recado}</Aviso> : null}

          <Botao grande onPress={enviar} ocupado={ocupado} style={{ marginTop: Espaco.sm }}>
            {criando ? 'Criar conta' : 'Entrar'}
          </Botao>
        </View>

        {/* Fora do grupo do formulário de propósito: colado no botão de enviar,
            os dois pareciam a mesma decisão. O alvo de toque segue sendo o do
            `Botao` — trocar por texto tocável encolheria pra menos que 56 px. */}
        <Botao
          variante="fantasma"
          style={{ marginTop: Espaco.xl }}
          onPress={() => {
            setModo(criando ? 'entrar' : 'criar');
            setErro(null);
            setRecado(null);
          }}>
          {criando ? 'Já tenho conta' : 'Criar uma conta'}
        </Botao>
      </View>
    </Tela>
  );
}
