import { Request, Response } from 'express';
import prisma from '../db';

export async function createGorjeta(req: Request, res: Response): Promise<Response> {
  try {
    const empresaId  = (req as any).empresaId as string;
    const usuarioNome = (req as any).usuarioNome as string;
    const { lavadorId, valor, observacao } = req.body;

    if (!lavadorId || !valor || parseFloat(valor) <= 0) {
      return res.status(400).json({ error: 'lavadorId e valor são obrigatórios.' });
    }

    const lavador = await prisma.lavador.findFirst({ where: { id: lavadorId as string, empresaId } });
    if (!lavador) return res.status(404).json({ error: 'Lavador não encontrado.' });

    const gorjeta = await (prisma.gorjeta as any).create({
      data: {
        empresaId,
        lavadorId: lavadorId as string,
        valor: parseFloat(valor),
        observacao: observacao?.trim() || null,
        lancadoPor: usuarioNome || null,
      },
      include: { lavador: { select: { nome: true } } },
    });

    return res.status(201).json(gorjeta);
  } catch (e) {
    console.error('[Gorjeta] createGorjeta:', e);
    return res.status(500).json({ error: 'Erro ao criar gorjeta.' });
  }
}

export async function listGorjetas(req: Request, res: Response): Promise<Response> {
  try {
    const empresaId = (req as any).empresaId as string;
    const { lavadorId, inicio, fim } = req.query;

    const where: any = { empresaId };
    if (lavadorId) where.lavadorId = lavadorId as string;
    if (inicio || fim) {
      where.criadoEm = {};
      if (inicio) where.criadoEm.gte = new Date(inicio as string);
      if (fim) {
        const d = new Date(fim as string);
        d.setHours(23, 59, 59, 999);
        where.criadoEm.lte = d;
      }
    }

    const gorjetas = await (prisma.gorjeta as any).findMany({
      where,
      include: { lavador: { select: { id: true, nome: true } } },
      orderBy: { criadoEm: 'desc' },
    });

    return res.json({ gorjetas });
  } catch (e) {
    console.error('[Gorjeta] listGorjetas:', e);
    return res.status(500).json({ error: 'Erro ao listar gorjetas.' });
  }
}

export async function deleteGorjeta(req: Request, res: Response): Promise<Response> {
  try {
    const empresaId = (req as any).empresaId as string;
    const { id } = req.params;

    const gorjeta = await (prisma.gorjeta as any).findFirst({ where: { id: id as string, empresaId } });
    if (!gorjeta) return res.status(404).json({ error: 'Gorjeta não encontrada.' });

    await (prisma.gorjeta as any).delete({ where: { id: id as string } });
    return res.json({ success: true });
  } catch (e) {
    console.error('[Gorjeta] deleteGorjeta:', e);
    return res.status(500).json({ error: 'Erro ao excluir gorjeta.' });
  }
}
