import { Request, Response } from 'express';
import prisma from '../db';

const DURACAO_LABEL: Record<string, string> = {
  DIAS_7: '7 dias',
  MES_1: '1 mês',
  MESES_6: '6 meses',
  VITALICIO: 'Vitalício',
};

/**
 * Resolve um link de cadastro pro formulário de signup mostrar o convite
 * (sistema + plano + duração) antes da pessoa preencher os dados.
 * GET /api/usuarios/signup-link/:token — pública, sem autenticação
 */
export const resolverSignupLink = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    if (Array.isArray(token)) {
      return res.status(400).json({ error: 'Token inválido' });
    }
    const link = await prisma.signupLink.findUnique({
      where: { token },
      include: { plan: { select: { nome: true, sistema: true } } },
    });

    if (!link || !link.ativo || link.usadoPorId) {
      return res.status(404).json({ error: 'Link de cadastro inválido ou já utilizado' });
    }

    res.json({
      sistema: link.plan.sistema,
      planoNome: link.plan.nome,
      duracaoTipo: link.duracaoTipo,
      duracaoLabel: DURACAO_LABEL[link.duracaoTipo] || link.duracaoTipo,
    });
  } catch (error) {
    console.error('Erro ao resolver link de cadastro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};
