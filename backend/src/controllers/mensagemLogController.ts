import { Request, Response } from 'express';
import prisma from '../db';

/**
 * Log de mensagens enviadas pelo bot (número da Lina + números das empresas).
 * Só o LINA_OWNER (rota montada atrás do adminMiddleware). O bot grava; aqui só lê.
 */

const digitos = (s: string | null | undefined) => String(s ?? '').split('@')[0].replace(/\D/g, '');

/** Mesmo número com e sem o 9º dígito (55 DD 9XXXX-XXXX × 55 DD XXXX-XXXX). */
function chavesTelefone(d: string): string[] {
  if (!d) return [];
  const k = [d];
  if (d.length === 13 && d.startsWith('55')) k.push(d.slice(0, 4) + d.slice(5));
  if (d.length === 12 && d.startsWith('55')) k.push(d.slice(0, 4) + '9' + d.slice(4));
  return k;
}

export async function listarMensagens(req: Request, res: Response) {
  try {
    const { canal, empresaId, status, tipo, q, antes } = req.query as Record<string, string | undefined>;
    const limite = Math.min(Math.max(parseInt(String(req.query.limite ?? '50'), 10) || 50, 1), 200);

    const where: any = {};
    if (canal === 'LINA' || canal === 'EMPRESA') where.canal = canal;
    if (empresaId) where.empresaId = empresaId === 'sem' ? null : empresaId;
    if (status) where.status = status;
    if (tipo) where.tipo = tipo;
    if (antes) where.createdAt = { lt: new Date(antes) };
    const termo = String(q ?? '').trim();
    if (termo) {
      const tel = termo.replace(/\D/g, '');
      where.OR = [
        { texto: { contains: termo, mode: 'insensitive' } },
        ...(tel.length >= 4 ? [{ destino: { contains: tel } }] : []),
      ];
    }

    const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [itens, porStatus, tipos, empresas] = await Promise.all([
      (prisma as any).waMensagemLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limite + 1 }),
      (prisma as any).waMensagemLog.groupBy({ by: ['status'], where: { createdAt: { gte: desde24h } }, _count: { _all: true } }),
      (prisma as any).waMensagemLog.groupBy({ by: ['tipo'], _count: { _all: true }, orderBy: { tipo: 'asc' } }),
      prisma.empresa.findMany({ select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
    ]);
    const temMais = itens.length > limite;
    const pagina = itens.slice(0, limite);

    // Nome de quem recebeu: admins de WhatsApp e lavadores com o mesmo número
    const nums = [...new Set(pagina.flatMap((m: any) => chavesTelefone(digitos(m.destino))))] as string[];
    const nomePorNum = new Map<string, string>();
    if (nums.length) {
      const [admins, lavadores] = await Promise.all([
        (prisma.whatsappAdminPhone as any).findMany({ where: { ativo: true }, select: { telefone: true, jid: true, nome: true } }),
        prisma.lavador.findMany({ where: { telefone: { not: null } }, select: { telefone: true, nome: true } }),
      ]);
      for (const l of lavadores) for (const k of chavesTelefone(digitos(l.telefone))) nomePorNum.set(k, l.nome);
      for (const a of admins as any[]) {
        if (!a.nome) continue;
        for (const k of [...chavesTelefone(digitos(a.telefone)), ...chavesTelefone(digitos(a.jid))]) nomePorNum.set(k, a.nome);
      }
    }
    const nomeEmpresa = new Map(empresas.map(e => [e.id, e.nome]));

    const contagem: Record<string, number> = {};
    for (const s of porStatus as any[]) contagem[s.status] = s._count._all;

    return res.json({
      itens: pagina.map((m: any) => {
        const d = digitos(m.destino);
        return {
          ...m,
          grupo: m.destino.endsWith('@g.us'),
          numero: d,
          destinatario: chavesTelefone(d).map(k => nomePorNum.get(k)).find(Boolean) || null,
          empresaNome: m.empresaId ? nomeEmpresa.get(m.empresaId) || null : null,
        };
      }),
      proximo: temMais ? pagina[pagina.length - 1].createdAt : null,
      resumo24h: contagem,
      tipos: (tipos as any[]).map(t => ({ tipo: t.tipo, n: t._count._all })),
      empresas,
    });
  } catch (err) {
    console.error('[MensagemLog] Erro ao listar:', err);
    return res.status(500).json({ error: 'Erro ao carregar o log de mensagens' });
  }
}
