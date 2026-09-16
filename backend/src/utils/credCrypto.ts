import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Criptografia das credenciais de email dos clientes (senha de app do Gmail).
 *
 * AES-256-GCM com IV aleatório por gravação e tag de autenticação. O AAD amarra o texto
 * cifrado à empresa e à conta: um valor copiado pra outra linha/empresa não descriptografa.
 *
 * Chave: EMAIL_CRED_KEY (32 bytes em base64), só no servidor (Railway) — nunca no bot,
 * no repositório ou no frontend. Sem a chave, nada criptografa nem descriptografa (fail-closed).
 *
 * Formato guardado: "v1:iv:tag:dados" (cada parte em base64). O prefixo permite rotação futura.
 */

const VERSAO = 'v1';

function lerChave(): Buffer {
  const bruta = process.env.EMAIL_CRED_KEY;
  if (!bruta) {
    throw new Error('EMAIL_CRED_KEY não configurada');
  }
  const chave = Buffer.from(bruta, 'base64');
  if (chave.length !== 32) {
    throw new Error('EMAIL_CRED_KEY inválida: precisa ter 32 bytes em base64');
  }
  return chave;
}

/** Usado na subida do servidor e nas rotas de conta pra responder 503 em vez de quebrar no meio. */
export function chaveConfigurada(): boolean {
  try {
    lerChave();
    return true;
  } catch {
    return false;
  }
}

/** Amarra o texto cifrado à empresa + conta (AAD). */
export function aadDaConta(empresaId: string, contaId: string): string {
  return `${empresaId}:${contaId}`;
}

export function criptografar(texto: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', lerChave(), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const dados = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return [VERSAO, iv.toString('base64'), cipher.getAuthTag().toString('base64'), dados.toString('base64')].join(':');
}

export function descriptografar(valor: string, aad: string): string {
  const partes = String(valor).split(':');
  if (partes.length !== 4 || partes[0] !== VERSAO) {
    throw new Error('Credencial em formato desconhecido');
  }
  const [, ivB64, tagB64, dadosB64] = partes as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', lerChave(), Buffer.from(ivB64, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  // final() lança se a tag não bater: chave errada, AAD errado ou conteúdo adulterado
  return Buffer.concat([decipher.update(Buffer.from(dadosB64, 'base64')), decipher.final()]).toString('utf8');
}
