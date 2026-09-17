/**
 * Sessão do usuário.
 *
 * `onAuthStateChange` é assinado antes do `getSession()` de propósito: o
 * inverso deixa uma janela em que o token expira entre as duas chamadas e o
 * app fica achando que está logado, mostrando toda tela vazia sem dizer por
 * quê.
 */

import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { supabase } from './supabase';

export function useSessao() {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const { data: assinatura } = supabase.auth.onAuthStateChange((_evento, nova) => {
      setSessao(nova);
      setCarregando(false);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      setCarregando(false);
    });

    return () => assinatura.subscription.unsubscribe();
  }, []);

  return { sessao, carregando, entrou: Boolean(sessao) };
}

/** Mensagens do Supabase Auth vêm em inglês; estas são as que ela veria de fato. */
const TRADUCAO: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme o e-mail pelo link que enviamos.',
  'User already registered': 'Esse e-mail já tem conta. Faça login.',
  'Password should be at least 6 characters': 'A senha precisa de pelo menos 6 caracteres.',
  'Unable to validate email address: invalid format': 'Esse e-mail não parece válido.',
};

export const mensagemDeAuth = (bruta: string) =>
  TRADUCAO[bruta] ?? bruta ?? 'Não consegui entrar agora. Tente de novo.';

export async function entrar(email: string, senha: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password: senha,
  });
  if (error) throw new Error(mensagemDeAuth(error.message));
}

export async function criarConta(email: string, senha: string) {
  const { error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password: senha,
  });
  if (error) throw new Error(mensagemDeAuth(error.message));
}

export async function sair() {
  await supabase.auth.signOut();
}
