import { Request, Response } from 'express';
import prisma from '../db';

interface EmpresaRequest extends Request {
  empresaId?: string;
}

/**
 * Busca as notificações da empresa logada, com paginação.
 */
export const getNotificacoes = async (req: EmpresaRequest, res: Response) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  try {
    const [notificacoes, total] = await prisma.$transaction([
      prisma.notificacao.findMany({
        where: { empresaId: req.empresaId },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: skip,
      }),
      prisma.notificacao.count({
        where: { empresaId: req.empresaId },
      }),
    ]);

    const unreadCount = await prisma.notificacao.count({
      where: { empresaId: req.empresaId, lida: false },
    });

    res.json({
      notificacoes,
      unreadCount,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Erro ao buscar notificações:', error);
    res.status(500).json({ error: 'Erro interno ao buscar notificações.' });
  }
};

/**
 * Marca uma notificação específica como lida.
 */
export const marcarComoLida = async (req: EmpresaRequest, res: Response) => {
  const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

  try {
    const notificacao = await prisma.notificacao.findFirst({
      where: { id, empresaId: req.empresaId },
    });

    if (!notificacao) {
      return res.status(404).json({ error: 'Notificação não encontrada.' });
    }

    const updatedNotificacao = await prisma.notificacao.update({
      where: { id },
      data: { lida: true },
    });

    res.json(updatedNotificacao);
  } catch (error) {
    console.error('Erro ao marcar notificação como lida:', error);
    res.status(500).json({ error: 'Erro interno ao marcar notificação como lida.' });
  }
};

/**
 * Marca todas as notificações não lidas de uma empresa como lidas.
 */
export const marcarTodasComoLidas = async (req: EmpresaRequest, res: Response) => {
  try {
    await prisma.notificacao.updateMany({
      where: { empresaId: req.empresaId, lida: false },
      data: { lida: true },
    });

    res.status(200).json({ message: 'Todas as notificações foram marcadas como lidas.' });
  } catch (error) {
    console.error('Erro ao marcar todas as notificações como lidas:', error);
    res.status(500).json({ error: 'Erro interno ao marcar todas as notificações como lidas.' });
  }
};
