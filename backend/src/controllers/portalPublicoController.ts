import { Request, Response } from 'express';
import prisma from '../db';

// GET /api/p/:token — resolve token curto → dados básicos do lavador para o portal
export const resolverTokenPublico = async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };

  try {
    const lavador = await prisma.lavador.findUnique({
      where: { linkTokenCurto: token },
      select: {
        id: true,
        nome: true,
        pinDefinido: true,
        ativo: true,
        empresa: {
          select: {
            id: true,
            nome: true,
            horarioAbertura: true,
          },
        },
      },
    });

    if (!lavador || !lavador.ativo) {
      return res.status(404).json({ erro: 'link_invalido' });
    }

    res.json({
      lavadorId: lavador.id,
      nome: lavador.nome,
      pinDefinido: lavador.pinDefinido,
      empresa: {
        id: lavador.empresa.id,
        nome: lavador.empresa.nome,
        horarioAbertura: lavador.empresa.horarioAbertura,
      },
    });
  } catch (error) {
    console.error('[portal] Erro ao resolver token:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};
