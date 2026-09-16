import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

/**
 * Acesso IMAP às contas de email dos clientes (automação de email).
 *
 * Host fixo no servidor: o cliente nunca escolhe endereço de servidor, então não dá
 * pra apontar o sistema pra uma máquina interna (SSRF). Só Gmail nesta rodada.
 *
 * Nada aqui é persistido: o corpo do email é lido sob demanda e devolvido na hora.
 */

const HOST = 'imap.gmail.com';
const PORT = 993;
const TIMEOUT_MS = 10_000;
const MAX_CORPO = 5_000; // caracteres devolvidos do corpo de um email

export type TipoErroImap = 'CREDENCIAL_INVALIDA' | 'INDISPONIVEL';

/** Erro já classificado — o controller traduz em mensagem pro usuário. */
export class ErroImap extends Error {
  constructor(public tipo: TipoErroImap, public causa?: unknown) {
    super(tipo);
    this.name = 'ErroImap';
  }
}

function novoCliente(email: string, senha: string): ImapFlow {
  return new ImapFlow({
    host: HOST,
    port: PORT,
    secure: true,
    auth: { user: email, pass: senha },
    logger: false,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS * 3,
  });
}

function classificar(err: any): ErroImap {
  // imapflow marca authenticationFailed quando o servidor recusa usuário/senha
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials/i.test(String(err?.message))) {
    return new ErroImap('CREDENCIAL_INVALIDA', err);
  }
  return new ErroImap('INDISPONIVEL', err);
}

/** Abre a conexão, roda o trabalho e fecha sempre. */
async function comConexao<T>(email: string, senha: string, trabalho: (c: ImapFlow) => Promise<T>): Promise<T> {
  let c: ImapFlow | null = null;
  try {
    c = novoCliente(email, senha);
    await c.connect();
    return await trabalho(c);
  } catch (err) {
    throw classificar(err);
  } finally {
    if (c) {
      try { await c.logout(); } catch { /* conexão já caiu */ }
    }
  }
}

/** Login de verdade — usado antes de guardar a senha e no botão "Verificar agora". */
export async function testarLogin(email: string, senha: string): Promise<void> {
  await comConexao(email, senha, async () => undefined);
}

export interface EmailResumo {
  uid: number;
  de: string;
  deNome: string;
  assunto: string;
  data: string | null;
}

/** Últimos emails da INBOX (só cabeçalho: remetente, assunto e data). */
export async function listarRecentes(
  email: string,
  senha: string,
  opts: { dias?: number; max?: number } = {}
): Promise<EmailResumo[]> {
  const dias = opts.dias ?? 7;
  const max = opts.max ?? 20;
  return comConexao(email, senha, async (c) => {
    const lock = await c.getMailboxLock('INBOX', { readOnly: true });
    try {
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
      const uids = (await c.search({ since: desde }, { uid: true })) || [];
      const ultimos = uids.slice(-max);
      const out: EmailResumo[] = [];
      if (ultimos.length) {
        for await (const msg of c.fetch(ultimos, { envelope: true }, { uid: true })) {
          const remetente = msg.envelope?.from?.[0];
          out.push({
            uid: msg.uid,
            de: remetente?.address ?? '',
            deNome: remetente?.name || (remetente?.address ?? '').split('@')[0] || '',
            assunto: msg.envelope?.subject ?? '(sem assunto)',
            data: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
          });
        }
      }
      return out.sort((a, b) => (b.data ?? '').localeCompare(a.data ?? ''));
    } finally {
      lock.release();
    }
  });
}

function htmlParaTexto(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Corpo de UM email, já convertido em texto e truncado. Não marca como lido. */
export async function lerEmail(
  email: string,
  senha: string,
  uid: number
): Promise<{ uid: number; de: string; assunto: string; data: string | null; texto: string }> {
  return comConexao(email, senha, async (c) => {
    const lock = await c.getMailboxLock('INBOX', { readOnly: true });
    try {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) throw new ErroImap('INDISPONIVEL');
      const parsed = await simpleParser(msg.source as Buffer);
      const bruto = parsed.text || (parsed.html ? htmlParaTexto(String(parsed.html)) : '');
      return {
        uid,
        de: parsed.from?.value?.[0]?.address ?? '',
        assunto: parsed.subject ?? '(sem assunto)',
        data: parsed.date ? parsed.date.toISOString() : null,
        texto: bruto.slice(0, MAX_CORPO),
      };
    } finally {
      lock.release();
    }
  });
}
