import { Request, Response } from 'express';
import prisma from '../db';

/**
 * PROMOTION CONTROLLER
 * Endpoints para gerenciar promoções/descontos
 */

/**
 * Listar todas as promoções
 * GET /api/admin/subscriptions/promotions
 */
export const listPromotions = async (req: Request, res: Response) => {
  try {
    const { ativo, search } = req.query;

    const where: any = {};

    if (ativo !== undefined) {
      where.ativo = ativo === 'true';
    }

    const promotions = await prisma.promotion.findMany({
      where,
      include: {
        plan: {
          select: {
            id: true,
            nome: true,
            preco: true
          }
        }
      },
      orderBy: { dataInicio: 'desc' }
    });

    // Filtrar por search (nome ou descricao)
    let filtered = promotions;
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase();
      filtered = promotions.filter(p =>
        p.nome.toLowerCase().includes(searchLower) ||
        (p.descricao?.toLowerCase().includes(searchLower) || false)
      );
    }

    res.json(filtered);
  } catch (error) {
    console.error('Erro ao listar promoções:', error);
    res.status(500).json({ error: 'Erro ao listar promoções' });
  }
};

/**
 * Obter promoções ativas (para exibir no frontend)
 * GET /api/subscriptions/promotions/active
 */
export const getActivePromotions = async (req: Request, res: Response) => {
  try {
    const now = new Date();

    const promotions = await prisma.promotion.findMany({
      where: {
        ativo: true,
        dataInicio: { lte: now },
        dataFim: { gte: now }
      },
      include: {
        plan: {
          select: {
            id: true,
            nome: true,
            preco: true
          }
        }
      },
      orderBy: { valor: 'desc' }
    });

    res.json(promotions);
  } catch (error) {
    console.error('Erro ao buscar promoções ativas:', error);
    res.status(500).json({ error: 'Erro ao buscar promoções ativas' });
  }
};

/**
 * Criar nova promoção
 * POST /api/admin/subscriptions/promotions
 */
export const createPromotion = async (req: Request, res: Response) => {
  try {
    const {
      nome,
      descricao,
      tipo,
      valor,
      planId,
      dataInicio,
      dataFim,
      usosMaximos
    } = req.body;

    if (!nome || valor === undefined || !dataInicio || !dataFim) {
      return res.status(400).json({
        error: 'nome, valor, dataInicio e dataFim são obrigatórios'
      });
    }

    // Validar tipo
    if (!['PERCENTUAL', 'FIXO'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido (PERCENTUAL ou FIXO)' });
    }

    // Validar valor
    if (tipo === 'PERCENTUAL' && (valor < 0 || valor > 100)) {
      return res.status(400).json({ error: 'Percentual deve estar entre 0 e 100' });
    }

    if (tipo === 'FIXO' && valor < 0) {
      return res.status(400).json({ error: 'Valor fixo não pode ser negativo' });
    }

    // Validar datas
    const start = new Date(dataInicio);
    const end = new Date(dataFim);

    if (start >= end) {
      return res.status(400).json({ error: 'Data de início deve ser antes da data de fim' });
    }

    // Validar planId se fornecido
    if (planId) {
      const plan = await prisma.subscriptionPlan.findUnique({
        where: { id: planId }
      });

      if (!plan) {
        return res.status(404).json({ error: 'Plano não encontrado' });
      }
    }

    const promotion = await prisma.promotion.create({
      data: {
        nome,
        descricao,
        tipo,
        valor,
        planId: planId || null,
        dataInicio: start,
        dataFim: end,
        usosMaximos: usosMaximos || null,
        ativo: true
      },
      include: {
        plan: {
          select: {
            id: true,
            nome: true,
            preco: true
          }
        }
      }
    });

    res.status(201).json({
      message: 'Promoção criada com sucesso',
      promotion
    });
  } catch (error) {
    console.error('Erro ao criar promoção:', error);
    res.status(500).json({ error: 'Erro ao criar promoção' });
  }
};

/**
 * Atualizar promoção
 * PUT /api/admin/subscriptions/promotions/:id
 */
export const updatePromotion = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updateData = req.body;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    // Validar tipo se fornecido
    if (updateData.tipo && !['PERCENTUAL', 'FIXO'].includes(updateData.tipo)) {
      return res.status(400).json({ error: 'Tipo inválido (PERCENTUAL ou FIXO)' });
    }

    // Validar valor se fornecido
    if (updateData.valor !== undefined) {
      const promotion = await prisma.promotion.findUnique({
        where: { id }
      });

      if (!promotion) {
        return res.status(404).json({ error: 'Promoção não encontrada' });
      }

      const tipo = updateData.tipo || promotion.tipo;

      if (tipo === 'PERCENTUAL' && (updateData.valor < 0 || updateData.valor > 100)) {
        return res.status(400).json({ error: 'Percentual deve estar entre 0 e 100' });
      }

      if (tipo === 'FIXO' && updateData.valor < 0) {
        return res.status(400).json({ error: 'Valor fixo não pode ser negativo' });
      }
    }

    // Validar datas se fornecidas
    if (updateData.dataInicio || updateData.dataFim) {
      const promotion = await prisma.promotion.findUnique({
        where: { id }
      });

      if (!promotion) {
        return res.status(404).json({ error: 'Promoção não encontrada' });
      }

      const start = updateData.dataInicio ? new Date(updateData.dataInicio) : promotion.dataInicio;
      const end = updateData.dataFim ? new Date(updateData.dataFim) : promotion.dataFim;

      if (start >= end) {
        return res.status(400).json({ error: 'Data de início deve ser antes da data de fim' });
      }

      updateData.dataInicio = start;
      updateData.dataFim = end;
    }

    const promotion = await prisma.promotion.update({
      where: { id },
      data: updateData,
      include: {
        plan: {
          select: {
            id: true,
            nome: true,
            preco: true
          }
        }
      }
    });

    res.json({
      message: 'Promoção atualizada com sucesso',
      promotion
    });
  } catch (error) {
    console.error('Erro ao atualizar promoção:', error);
    res.status(500).json({ error: 'Erro ao atualizar promoção' });
  }
};

/**
 * Deletar promoção
 * DELETE /api/admin/subscriptions/promotions/:id
 */
export const deletePromotion = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    await prisma.promotion.delete({
      where: { id }
    });

    res.json({ message: 'Promoção deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar promoção:', error);
    res.status(500).json({ error: 'Erro ao deletar promoção' });
  }
};

/**
 * Ativar/desativar promoção
 * PATCH /api/admin/subscriptions/promotions/:id/toggle
 */
export const togglePromotion = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    const promotion = await prisma.promotion.findUnique({
      where: { id }
    });

    if (!promotion) {
      return res.status(404).json({ error: 'Promoção não encontrada' });
    }

    const updated = await prisma.promotion.update({
      where: { id },
      data: { ativo: !promotion.ativo },
      include: {
        plan: {
          select: {
            id: true,
            nome: true,
            preco: true
          }
        }
      }
    });

    res.json({
      message: `Promoção ${updated.ativo ? 'ativada' : 'desativada'} com sucesso`,
      promotion: updated
    });
  } catch (error) {
    console.error('Erro ao alternar status da promoção:', error);
    res.status(500).json({ error: 'Erro ao alternar status da promoção' });
  }
};

/**
 * Incrementar contador de usos
 * POST /api/admin/subscriptions/promotions/:id/use
 */
export const incrementPromoUsage = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    const promotion = await prisma.promotion.findUnique({
      where: { id }
    });

    if (!promotion) {
      return res.status(404).json({ error: 'Promoção não encontrada' });
    }

    // Validar limite de usos
    if (promotion.usosMaximos && promotion.usosAtuais >= promotion.usosMaximos) {
      return res.status(400).json({
        error: 'Limite de usos atingido',
        usosAtuais: promotion.usosAtuais,
        usosMaximos: promotion.usosMaximos
      });
    }

    const updated = await prisma.promotion.update({
      where: { id },
      data: {
        usosAtuais: {
          increment: 1
        }
      }
    });

    res.json({
      message: 'Uso de promoção incrementado',
      promotion: updated
    });
  } catch (error) {
    console.error('Erro ao incrementar uso da promoção:', error);
    res.status(500).json({ error: 'Erro ao incrementar uso da promoção' });
  }
};

export default {
  listPromotions,
  getActivePromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  togglePromotion,
  incrementPromoUsage
};
