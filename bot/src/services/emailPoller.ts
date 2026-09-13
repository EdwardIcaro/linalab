import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import prisma from '../db';
import { sendMessage } from './baileyService';

/**
 * Poller de leitura de email → WhatsApp.
 *
 * A cada ciclo, conecta no Gmail (IMAP), busca os emails que CHEGARAM desde o último ciclo
 * (por UID, não por "não lido") e, para cada regra ativa cadastrada na config (tabela
 * email_regras), verifica remetente + assunto, extrai um valor via regex e envia o template
 * no destino (grupo/números).
 *
 * Por que UID e não "não lidos": a caixa pode ter milhares de emails não lidos (caixa pessoal)
 * — baixar todos a cada 20s travava o bot e, na 1ª ativação, reenviava códigos já expirados.
 * O histórico é ignorado: no 1º ciclo só marca o ponto de partida (código expira em ~10min).
 *
 * Credenciais do Gmail ficam só no .env do bot (fora do banco):
 *   GMAIL_IMAP_USER, GMAIL_IMAP_PASS  (senha de app — exige 2FA na conta Gmail)
 */

const POLL_INTERVAL_MS = 20000; // 20s — código de login expira em ~10min, folga de sobra
const IMAP_HOST = process.env.GMAIL_IMAP_HOST || 'imap.gmail.com';
const IMAP_USER = process.env.GMAIL_IMAP_USER || '';
const IMAP_PASS = process.env.GMAIL_IMAP_PASS || '';

let rodando = false; // trava anti-concorrência entre ciclos

// Ponto de partida na INBOX: maior UID já visto. null = ainda não inicializado.
// Se o uidValidity mudar (Gmail recriou a caixa), os UIDs antigos não valem mais → reinicializa.
let ultimoUid: number | null = null;
let uidValidityAtual: string | null = null;

interface Regra {
  id: string;
  nome: string;
  remetenteContem: string;
  assuntoContem: string | null;
  regexExtracao: string;
  template: string;
  destinoTipo: string;   // 'GRUPO' | 'NUMEROS'
  destinoValor: string;
}

async function getRegrasAtivas(): Promise<Regra[]> {
  const q = () => (prisma as any).emailRegra.findMany({ where: { ativo: true } });
  try {
    return await q();
  } catch (err: any) {
    // P1017 = Neon fechou conexão por idle timeout — reconecta e tenta de novo
    if (err?.code === 'P1017') {
      await prisma.$disconnect();
      await prisma.$connect();
      return await q();
    }
    throw err;
  }
}

// Monta a mensagem: {{valor}} = 1º grupo de captura (ou match inteiro),
// {{valor1}}, {{valor2}}... = grupos de captura subsequentes.
function montarMensagem(template: string, match: RegExpMatchArray): string {
  const principal = match.length > 1 ? (match[1] ?? '') : match[0];
  let msg = template.replace(/\{\{valor\}\}/g, principal);
  for (let i = 1; i < match.length; i++) {
    msg = msg.replace(new RegExp(`\\{\\{valor${i}\\}\\}`, 'g'), match[i] ?? '');
  }
  return msg;
}

async function enviarDestino(regra: Regra, texto: string): Promise<void> {
  if (regra.destinoTipo === 'GRUPO') {
    // JID de grupo (...@g.us) — sendMessage passa direto quando contém '@'
    await sendMessage(regra.destinoValor, texto);
  } else {
    const numeros = regra.destinoValor.split(',').map(n => n.trim()).filter(Boolean);
    for (const numero of numeros) {
      try {
        await sendMessage(numero, texto);
      } catch (e) {
        console.error(`[EmailPoller] Falha ao enviar para ${numero}:`, e);
      }
    }
  }
}

async function processarCiclo(): Promise<void> {
  if (rodando) return;
  rodando = true;

  let client: ImapFlow | null = null;
  try {
    const regras = await getRegrasAtivas();
    if (!regras.length) return;

    client = new ImapFlow({
      host: IMAP_HOST,
      port: 993,
      secure: true,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
      logger: false,
    });
    await client.connect();

    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailbox = client.mailbox as { uidNext: number; uidValidity: bigint } | false;
      if (!mailbox) return;

      const uidValidity = String(mailbox.uidValidity);
      if (ultimoUid === null || uidValidity !== uidValidityAtual) {
        // 1º ciclo: começa do fim da caixa — histórico ignorado de propósito
        ultimoUid = mailbox.uidNext - 1;
        uidValidityAtual = uidValidity;
        console.log(`[EmailPoller] Ponto de partida definido (UID ${ultimoUid}) — só emails novos serão processados.`);
        return;
      }

      // IMAP devolve a última mensagem em "N:*" mesmo se N > maior UID → filtra de novo
      const desde = ultimoUid;
      const uids = ((await client.search({ uid: `${desde + 1}:*` }, { uid: true })) || [])
        .filter(uid => uid > desde);
      if (!uids.length) return;

      for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
        // Avança antes de processar: se o envio falhar, não reenvia em loop (código expira rápido)
        ultimoUid = Math.max(ultimoUid ?? 0, msg.uid);
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          const from    = (parsed.from?.text || '').toLowerCase();
          const subject = (parsed.subject || '');
          const corpo   = parsed.text || (parsed.html ? String(parsed.html) : '');

          let casou = false;
          for (const regra of regras) {
            if (!from.includes(regra.remetenteContem.toLowerCase())) continue;
            if (regra.assuntoContem && !subject.toLowerCase().includes(regra.assuntoContem.toLowerCase())) continue;

            let match: RegExpMatchArray | null = null;
            try {
              match = corpo.match(new RegExp(regra.regexExtracao));
            } catch (e) {
              console.error(`[EmailPoller] Regex inválida na regra "${regra.nome}":`, e);
              continue;
            }
            if (!match) continue;

            const texto = montarMensagem(regra.template, match);
            await enviarDestino(regra, texto);
            console.log(`[EmailPoller] Regra "${regra.nome}" disparada (de: ${from.slice(0, 40)})`);
            casou = true;
          }

          // Marca como lido só o que alguma regra usou (o resto da caixa fica intocado)
          if (casou) {
            await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
          }
        } catch (e) {
          console.error(`[EmailPoller] Erro ao processar email UID ${msg.uid}:`, e instanceof Error ? e.message : e);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('[EmailPoller] Erro no ciclo:', err instanceof Error ? err.message : err);
  } finally {
    if (client) {
      try { await client.logout(); } catch { /* ignora */ }
    }
    rodando = false;
  }
}

export function startEmailPoller(): void {
  if (!IMAP_USER || !IMAP_PASS) {
    console.log('[EmailPoller] Desativado (GMAIL_IMAP_USER/GMAIL_IMAP_PASS não configurados no .env).');
    return;
  }
  console.log(`[EmailPoller] Ativo — verificando ${IMAP_USER} a cada ${POLL_INTERVAL_MS / 1000}s.`);
  setInterval(() => { processarCiclo().catch(() => {}); }, POLL_INTERVAL_MS);
}
