import prisma from '../db';

/**
 * Log central do que o bot ENVIA (número da Lina e números das empresas), com recibo
 * de entrega/leitura vindo do WhatsApp. As conversas por comando continuam em
 * `whatsapp_messages` (entrada + resposta); aqui ficam os avisos.
 *
 * Nunca derruba um envio: falha ao gravar o log só vai pro console.
 */

export type Canal = 'LINA' | 'EMPRESA';

export interface MetaEnvio {
  empresaId?: string | null;
  tipo?: string | null;
}

const RETENCAO_DIAS = 90;

// Códigos de acesso (automação de e-mail) não ficam guardados: 4 a 6 dígitos soltos
const mascararCodigos = (texto: string) => texto.replace(/(^|[^\dA-Za-z])(\d{4,6})(?![\dA-Za-z])/g, (_m, a, n) => a + '•'.repeat(n.length));

export async function registrarEnvio(d: {
  canal: Canal;
  meta?: MetaEnvio;
  destino: string;
  texto: string;
  midia?: boolean;
  waMessageId?: string | null;
  erro?: unknown;
}): Promise<void> {
  try {
    const tipo = (d.meta?.tipo || 'AVISO').slice(0, 60);
    const texto = tipo === 'EMAIL_AUTOMACAO' ? mascararCodigos(d.texto) : d.texto;
    await (prisma as any).waMensagemLog.create({
      data: {
        canal: d.canal,
        empresaId: d.meta?.empresaId || null,
        tipo,
        destino: d.destino.slice(0, 120),
        texto: texto.slice(0, 4000),
        midia: !!d.midia,
        status: d.erro ? 'ERRO' : 'ENVIADO',
        erro: d.erro ? String((d.erro as any)?.message ?? d.erro).slice(0, 300) : null,
        waMessageId: d.waMessageId || null,
      },
    });
  } catch (err: any) {
    console.error('[MensagemLog] Erro ao gravar envio:', err?.message ?? err);
  }
}

// proto.WebMessageInfo.Status: 3 = DELIVERY_ACK, 4 = READ, 5 = PLAYED
const ENTREGUE = 3;
const LIDO = 4;

/**
 * Recibo do WhatsApp (`messages.update`). O recibo pode chegar antes do log ser gravado
 * (o envio responde depois do ack do servidor), então tenta de novo uma vez.
 * Leitura só chega quando o destinatário deixa a confirmação de leitura ligada.
 */
export async function registrarRecibo(waMessageId: string, status: number, tentativa = 0): Promise<void> {
  if (!waMessageId || status < ENTREGUE) return;
  const agora = new Date();
  try {
    const where = { waMessageId, status: { not: 'ERRO' } };
    let n = 0;
    if (status >= LIDO) {
      const r = await (prisma as any).waMensagemLog.updateMany({ where: { ...where, lidoEm: null }, data: { status: 'LIDO', lidoEm: agora } });
      await (prisma as any).waMensagemLog.updateMany({ where: { waMessageId, entregueEm: null }, data: { entregueEm: agora } });
      n = r.count;
    } else {
      const r = await (prisma as any).waMensagemLog.updateMany({
        where: { ...where, status: 'ENVIADO' },
        data: { status: 'ENTREGUE', entregueEm: agora },
      });
      n = r.count;
    }
    if (n === 0 && tentativa === 0) {
      const existe = await (prisma as any).waMensagemLog.count({ where: { waMessageId } });
      if (!existe) setTimeout(() => { registrarRecibo(waMessageId, status, 1); }, 5000);
    }
  } catch (err: any) {
    console.error('[MensagemLog] Erro ao gravar recibo:', err?.message ?? err);
  }
}

/** Liga o recibo num socket do Baileys (Lina ou empresa). Só mensagens enviadas por nós. */
export function ouvirRecibos(sock: any): void {
  sock.ev.on('messages.update', (updates: any[]) => {
    for (const u of updates || []) {
      const st = u?.update?.status;
      if (u?.key?.fromMe && u.key.id && typeof st === 'number') registrarRecibo(u.key.id, st);
    }
  });
  // Grupos confirmam por participante: a primeira entrega/leitura já marca a mensagem
  sock.ev.on('message-receipt.update', (updates: any[]) => {
    for (const u of updates || []) {
      if (!u?.key?.fromMe || !u.key.id) continue;
      const r = u.receipt || {};
      if (r.readTimestamp || r.playedTimestamp) registrarRecibo(u.key.id, LIDO);
      else if (r.receiptTimestamp) registrarRecibo(u.key.id, ENTREGUE);
    }
  });
}

export async function limparLogAntigo(): Promise<void> {
  try {
    const limite = new Date(Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000);
    const { count } = await (prisma as any).waMensagemLog.deleteMany({ where: { createdAt: { lt: limite } } });
    if (count > 0) console.log(`[MensagemLog] ${count} mensagens com mais de ${RETENCAO_DIAS} dias removidas`);
  } catch (err: any) {
    console.error('[MensagemLog] Erro na limpeza:', err?.message ?? err);
  }
}
