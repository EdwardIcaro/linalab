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

export interface MensagemNova {
  uid: number;
  de: string;
  assunto: string;
  texto: string;
}

/**
 * Emails que chegaram DEPOIS do último UID visto.
 *
 * Por UID e não por "não lido": a caixa do cliente pode ter milhares de mensagens
 * não lidas, e marcar como lido mexeria na caixa dele. Quando `ultimoUid` é null
 * (1ª vez) ou o `uidValidity` mudou, devolve só o ponto de partida, sem histórico.
 */
export async function buscarNovos(
  email: string,
  senha: string,
  estado: { ultimoUid: number | null; uidValidity: string | null }
): Promise<{ uidValidity: string; ultimoUid: number; mensagens: MensagemNova[] }> {
  return comConexao(email, senha, async (c) => {
    const lock = await c.getMailboxLock('INBOX', { readOnly: true });
    try {
      const caixa = c.mailbox as { uidNext: number; uidValidity: bigint } | false;
      if (!caixa) throw new ErroImap('INDISPONIVEL');

      const uidValidity = String(caixa.uidValidity);
      const inicio = caixa.uidNext - 1;

      // 1ª leitura ou caixa recriada no servidor: só marca de onde começar
      if (estado.ultimoUid === null || estado.uidValidity !== uidValidity) {
        return { uidValidity, ultimoUid: inicio, mensagens: [] };
      }

      const desde = estado.ultimoUid;
      // "N:*" devolve a última mensagem mesmo quando N > maior UID → filtra de novo
      const uids = ((await c.search({ uid: `${desde + 1}:*` }, { uid: true })) || []).filter(u => u > desde);
      if (!uids.length) return { uidValidity, ultimoUid: desde, mensagens: [] };

      const mensagens: MensagemNova[] = [];
      let maior = desde;
      for await (const msg of c.fetch(uids, { source: true }, { uid: true })) {
        maior = Math.max(maior, msg.uid);
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          const bruto = parsed.text || (parsed.html ? htmlParaTexto(String(parsed.html)) : '');
          mensagens.push({
            uid: msg.uid,
            de: parsed.from?.value?.[0]?.address ?? '',
            assunto: parsed.subject ?? '',
            texto: bruto.slice(0, MAX_CORPO),
          });
        } catch {
          // Um email ilegível não pode travar o ciclo inteiro
        }
      }
      return { uidValidity, ultimoUid: maior, mensagens };
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
