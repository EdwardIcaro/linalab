import prisma from '../db';

/**
 * Fila de envio da automação de email.
 *
 * O backend resolve os destinatários e enfileira; o bot (PC local) consome e envia
 * pelo número da Lina. Os destinos ficam guardados na regra como ID de contato —
 * o telefone só é resolvido aqui, na hora do envio, sempre dentro da empresa dona.
 */

export interface DestinoRegra {
  tipo: string; // 'ADMIN' | 'BOT_USER'
  id: string;
}

/** IDs de contato → destino de entrega (JID quando pareado, senão telefone). */
export async function resolverDestinos(empresaId: string, destinos: DestinoRegra[]): Promise<string[]> {
  if (!Array.isArray(destinos) || destinos.length === 0) return [];

  const idsAdmin = destinos.filter(d => d.tipo === 'ADMIN').map(d => d.id);
  const idsBot = destinos.filter(d => d.tipo === 'BOT_USER').map(d => d.id);
  const idsDest = destinos.filter(d => d.tipo === 'DESTINATARIO').map(d => d.id);

  const [admins, botUsers, destinatarios] = await Promise.all([
    idsAdmin.length
      ? prisma.whatsappAdminPhone.findMany({ where: { id: { in: idsAdmin }, empresaId, ativo: true }, select: { telefone: true, jid: true } })
      : [],
    idsBot.length
      ? prisma.whatsappBotUser.findMany({ where: { id: { in: idsBot }, empresaId, ativo: true }, select: { telefone: true, jid: true } })
      : [],
    idsDest.length
      ? prisma.emailDestinatario.findMany({ where: { id: { in: idsDest }, empresaId, ativo: true }, select: { telefone: true, jid: true } })
      : [],
  ]);

  const alvos = [...admins, ...botUsers, ...destinatarios]
    .map(c => (c.jid ? c.jid : String(c.telefone ?? '').replace(/\D/g, '')))
    .filter(Boolean);

  return [...new Set(alvos)];
}

/** Cria uma linha por destinatário. O bot marca como ENVIADO e zera o texto depois. */
export async function enfileirarEnvios(empresaId: string, alvos: string[], texto: string): Promise<number> {
  if (!alvos.length) return 0;
  const { count } = await prisma.whatsappEnvio.createMany({
    data: alvos.map(destino => ({ empresaId, origem: 'EMAIL_AUTOMACAO', destino, texto })),
  });
  return count;
}
