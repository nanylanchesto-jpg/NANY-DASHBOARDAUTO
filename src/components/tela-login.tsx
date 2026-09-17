import { useState } from 'react';
import { View } from 'react-native';

import { Espaco } from '@/constants/theme';
import { criarConta, entrar } from '@/lib/sessao';

import { Aviso, Botao, Campo, Cartao, Txt, Tela } from './ui';

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
      <View style={{ flex: 1, justifyContent: 'center', gap: Espaco.lg, paddingVertical: Espaco.xxl }}>
        <View style={{ gap: Espaco.xs }}>
          <Txt tipo="numero">Nany Lanches</Txt>
          <Txt tipo="corpo" tom="textoFraco">
            Controle de compras, vendas e lucro do dia.
          </Txt>
        </View>

        <Cartao style={{ gap: Espaco.md }}>
          <Campo
            rotulo="E-mail"
            value={email}
            onChangeText={setEmail}
            placeholder="seu@email.com"
            autoCapitalize="none"
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

          <Botao onPress={enviar} ocupado={ocupado}>
            {criando ? 'Criar conta' : 'Entrar'}
          </Botao>

          <Botao
            variante="fantasma"
            onPress={() => {
              setModo(criando ? 'entrar' : 'criar');
              setErro(null);
              setRecado(null);
            }}>
            {criando ? 'Já tenho conta' : 'Criar uma conta'}
          </Botao>
        </Cartao>
      </View>
    </Tela>
  );
}
