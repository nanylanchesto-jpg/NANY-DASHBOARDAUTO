/**
 * Foto da notinha: câmera → compressão → Edge Function → itens conferíveis.
 *
 * `expo-image-picker` resolve o web e o nativo com uma chamada só:
 * `launchCameraAsync({ cameraType: 'back' })` abre a câmera nativa no celular
 * e, no navegador, monta um `<input type="file" capture="environment">` -- que
 * é exatamente o que a tela `receber.tsx` do Almoxá faz à mão. No Android e no
 * iOS isso abre a câmera direto, sem passar pela galeria.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { supabase } from './supabase';
import type { Unidade } from './unidades';

export type ItemLido = {
  nome: string;
  quantidade: number;
  unidade: Unidade;
  preco_unitario: number;
  observacao: string;
};

export type NotinhaLida = {
  fornecedor: string;
  /** "AAAA-MM-DD" ou "" quando a nota não trazia data legível. */
  data: string;
  itens: ItemLido[];
};

/** Foto escolhida, já pronta pra enviar. */
export type FotoPronta = { dataUrl: string; largura: number; altura: number };

export const MAX_ARQUIVOS = 4;

/**
 * Letra de cupom fiscal é pequena e térmica. 1600 px de largura é o ponto em
 * que o texto continua legível pro modelo e o arquivo cai pra ~300 KB -- uma
 * foto crua de celular tem 4 MB ou mais, o que no 3G da rua é meio minuto de
 * espera antes da leitura sequer começar.
 *
 * Só reduz, nunca amplia: ampliar uma foto de 900 px não cria detalhe nenhum e
 * ainda triplica o arquivo.
 */
const LARGURA_ALVO = 1600;
const QUALIDADE = 0.6;

async function comprimir(uri: string, larguraOriginal: number): Promise<FotoPronta> {
  const contexto = ImageManipulator.ImageManipulator.manipulate(uri);
  if (larguraOriginal > LARGURA_ALVO) {
    contexto.resize({ width: LARGURA_ALVO });
  }
  const imagem = await contexto.renderAsync();
  const salva = await imagem.saveAsync({
    format: ImageManipulator.SaveFormat.JPEG,
    compress: QUALIDADE,
    base64: true,
  });

  if (!salva.base64) throw new Error('Não consegui preparar a foto. Tente de novo.');

  return {
    dataUrl: `data:image/jpeg;base64,${salva.base64}`,
    largura: salva.width,
    altura: salva.height,
  };
}

/**
 * Abre a câmera e devolve a foto comprimida, ou null se ela desistir.
 *
 * `allowsEditing` fica desligado de propósito: o recorte obrigatório do iOS é
 * quadrado, e cupom é uma tira comprida -- ela perderia metade dos itens
 * tentando encaixar a nota no quadrado.
 */
export async function fotografarNotinha(): Promise<FotoPronta | null> {
  // No web não existe permissão de câmera pra pedir por antecipação: o próprio
  // navegador decide na hora em que o input é acionado.
  if (Platform.OS !== 'web') {
    const permissao = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissao.granted) {
      throw new Error('Preciso da câmera para ler a nota. Libere nos ajustes do celular.');
    }
  }

  const resultado = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    cameraType: ImagePicker.CameraType.back,
    allowsEditing: false,
    quality: 1,
  });

  const foto = resultado.assets?.[0];
  if (resultado.canceled || !foto) return null;
  return comprimir(foto.uri, foto.width);
}

/** Mesma coisa, pela galeria — pra nota que ela já tinha fotografado antes. */
export async function escolherDaGaleria(): Promise<FotoPronta[]> {
  const resultado = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_ARQUIVOS,
    quality: 1,
  });

  if (resultado.canceled || !resultado.assets?.length) return [];
  return Promise.all(
    resultado.assets.slice(0, MAX_ARQUIVOS).map((foto) => comprimir(foto.uri, foto.width)),
  );
}

/**
 * Manda as fotos pra Edge Function e devolve o que a IA leu.
 *
 * `functions.invoke` já anexa o token da sessão, que é o que permite a função
 * contar a cota na conta certa.
 */
export async function lerNotinha(fotos: FotoPronta[]): Promise<NotinhaLida> {
  if (fotos.length === 0) throw new Error('Tire a foto da nota primeiro.');

  const { data, error } = await supabase.functions.invoke<NotinhaLida>('ler-notinha', {
    body: {
      arquivos: fotos.slice(0, MAX_ARQUIVOS).map((foto, indice) => ({
        nome: `notinha-${indice + 1}.jpg`,
        mimeType: 'image/jpeg',
        dataUrl: foto.dataUrl,
      })),
    },
  });

  if (error) {
    // Sem isso a tela mostraria "Edge Function returned a non-2xx status
    // code" -- a função já devolve mensagem pronta em português no corpo
    // ("Muitas leituras seguidas...", "Tente uma foto mais nítida"), e é ela
    // que precisa chegar na Nany. O corpo só existe em FunctionsHttpError;
    // erro de rede não tem `context`.
    let mensagem: string | null = null;
    const contexto = (error as { context?: Response }).context;
    if (contexto && typeof contexto.json === 'function') {
      try {
        const corpo = (await contexto.json()) as { erro?: string };
        if (typeof corpo?.erro === 'string' && corpo.erro.trim()) mensagem = corpo.erro;
      } catch {
        // Corpo não-JSON (502 de gateway, HTML de erro): cai na mensagem
        // genérica abaixo em vez de despejar um SyntaxError na tela dela.
      }
    }
    throw new Error(
      mensagem ?? 'Não consegui ler a nota agora. Confira a internet e tente de novo.',
    );
  }

  if (!data?.itens?.length) throw new Error('Nenhum ingrediente foi identificado na nota.');
  return data;
}
