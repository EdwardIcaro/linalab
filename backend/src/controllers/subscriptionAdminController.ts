import { Request, Response } from 'express';
import { subscriptionService } from '../services/subscriptionService';
import prisma from '../db';

/**
 * SUBSCRIPTION ADMIN CONTROLLER
 * Endpoints para gerenciamento de assinaturas pelo LINA_OWNER
 */

/**
 * Listar todas as assinaturas
 * GET /api/admin/subscriptions/subscriptions
 */
export const listAllSubscriptions = async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    const subscriptions = await prisma.subscription.findMany({
      where,
      include: {
        usuario: {
          select: {
            id: true,
            nome: true,
            email: true
          }
        },
        plan: true,
        addons: {
          where: { ativo: true },
          include: { addon: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Filtro por search (nome ou email)
    let filtered = subscriptions;
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase();
      filtered = subscriptions.filter(sub =>
        sub.usuario.nome.toLowerCase().includes(searchLower) ||
        sub.usuario.email.toLowerCase().includes(searchLower)
      );
    }

    res.json(filtered);
  } catch (error) {
    console.error('Erro ao listar assinaturas:', error);
    res.status(500).json({ error: 'Erro ao listar assinaturas' });
  }
};

/**
 * Obter detalhes de uma assinatura
 * GET /api/admin/subscriptions/subscriptions/:id
 */
export const getSubscriptionDetails = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { id },
      include: {
        usuario: {
          select: {
            id: true,
            nome: true,
            email: true,
            role: true,
            empresas: {
              select: {
                id: true,
                nome: true,
                ativo: true,
                createdAt: true
              }
            }
          }
        },
        plan: true,
        addons: {
          include: { addon: true }
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!subscription) {
      return res.status(404).json({ error: 'Assinatura não encontrada' });
    }

    res.json(subscription);
  } catch (error) {
    console.error('Erro ao buscar assinatura:', error);
    res.status(500).json({ error: 'Erro ao buscar assinatura' });
  }
};

/**
 * Ativar assinatura vitalícia manualmente
 * POST /api/admin/subscriptions/subscriptions/lifetime
 */
export const grantLifetimeSubscription = async (req: Request, res: Response) => {
  try {
    const { usuarioId, planId } = req.body;

    if (!usuarioId || !planId) {
      return res.status(400).json({
        error: 'usuarioId e planId são obrigatórios'
      });
    }

    // Verificar se usuário já tem assinatura ativa
    const existing = await subscriptionService.getActiveSubscription(usuarioId);

    if (existing) {
      // Cancelar a existente
      await subscriptionService.cancelSubscription(existing.id);
    }

    const subscription = await subscriptionService.createSubscription({
      usuarioId,
      planId,
      isLifetime: true
    });

    res.status(201).json({
      message: 'Assinatura vitalícia concedida com sucesso',
      subscription
    });
  } catch (error: any) {
    console.error('Erro ao conceder assinatura vitalícia:', error);
    res.status(400).json({
      error: error.message || 'Erro ao conceder assinatura vitalícia'
    });
  }
};

/**
 * Atualizar status de assinatura manualmente
 * PATCH /api/admin/subscriptions/subscriptions/:id/status
 */
export const updateSubscriptionStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    if (!status) {
      return res.status(400).json({ error: 'status é obrigatório' });
    }

    const validStatuses = [
      'ACTIVE',
      'TRIAL',
      'PAST_DUE',
      'CANCELED',
      'EXPIRED',
      'SUSPENDED',
      'LIFETIME'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Status inválido',
        validStatuses
      });
    }

    const subscription = await prisma.subscription.update({
      where: { id },
      data: { status },
      include: {
        usuario: {
          select: { nome: true, email: true }
        },
        plan: true
      }
    });

    res.json({
      message: 'Status atualizado com sucesso',
      subscription
    });
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
};

/**
 * Estender data de expiração
 * POST /api/admin/subscriptions/subscriptions/:id/extend
 */
export const extendSubscription = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { days } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    if (!days || days <= 0) {
      return res.status(400).json({
        error: 'days deve ser um número positivo'
      });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { id }
    });

    if (!subscription) {
      return res.status(404).json({ error: 'Assinatura não encontrada' });
    }

    const currentEnd = subscription.nextBillingDate || new Date();
    const newEnd = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000);

    const updated = await prisma.subscription.update({
      where: { id },
      data: { nextBillingDate: newEnd }
    });

    res.json({
      message: `Assinatura estendida por ${days} dias`,
      subscription: updated
    });
  } catch (error) {
    console.error('Erro ao estender assinatura:', error);
    res.status(500).json({ error: 'Erro ao estender assinatura' });
  }
};

/**
 * Listar todos os planos
 * GET /api/admin/subscriptions/plans
 */
export const listPlans = async (req: Request, res: Response) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: { ordem: 'asc' },
      include: {
        _count: {
          select: { subscriptions: true }
        }
      }
    });

    res.json(plans);
  } catch (error) {
    console.error('Erro ao listar planos:', error);
    res.status(500).json({ error: 'Erro ao listar planos' });
  }
};

/**
 * Criar novo plano
 * POST /api/admin/subscriptions/plans
 */
export const createPlan = async (req: Request, res: Response) => {
  try {
    const {
      nome,
      descricao,
      preco,
      intervalo,
      maxEmpresas,
      maxUsuarios,
      features,
      maxAddons,
      ordem,
      trialDays
    } = req.body;

    if (!nome || preco === undefined || !maxEmpresas) {
      return res.status(400).json({
        error: 'nome, preco e maxEmpresas são obrigatórios'
      });
    }

    const plan = await prisma.subscriptionPlan.create({
      data: {
        nome,
        descricao,
        preco,
        intervalo: intervalo || 'MONTHLY',
        maxEmpresas,
        maxUsuarios,
        features: features || [],
        maxAddons: maxAddons || 0,
        ordem: ordem || 0,
        trialDays: trialDays || 0
      }
    });

    res.status(201).json({
      message: 'Plano criado com sucesso',
      plan
    });
  } catch (error) {
    console.error('Erro ao criar plano:', error);
    res.status(500).json({ error: 'Erro ao criar plano' });
  }
};

/**
 * Atualizar plano
 * PUT /api/admin/subscriptions/plans/:id
 */
export const updatePlan = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updateData = req.body;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    const plan = await prisma.subscriptionPlan.update({
      where: { id },
      data: updateData
    });

    res.json({
      message: 'Plano atualizado com sucesso',
      plan
    });
  } catch (error) {
    console.error('Erro ao atualizar plano:', error);
    res.status(500).json({ error: 'Erro ao atualizar plano' });
  }
};

/**
 * Ativar/desativar plano
 * PATCH /api/admin/subscriptions/plans/:id/toggle
 */
export const togglePlanStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id }
    });

    if (!plan) {
      return res.status(404).json({ error: 'Plano não encontrado' });
    }

    const updated = await prisma.subscriptionPlan.update({
      where: { id },
      data: { ativo: !plan.ativo }
    });

    res.json({
      message: `Plano ${updated.ativo ? 'ativado' : 'desativado'} com sucesso`,
      plan: updated
    });
  } catch (error) {
    console.error('Erro ao alterar status do plano:', error);
    res.status(500).json({ error: 'Erro ao alterar status do plano' });
  }
};

/**
 * Listar todos os add-ons
 * GET /api/admin/subscriptions/addons
 */
export const listAddons = async (req: Request, res: Response) => {
  try {
    const addons = await prisma.addon.findMany({
      orderBy: { nome: 'asc' },
      include: {
        _count: {
          select: { subscriptions: true }
        }
      }
    });

    res.json(addons);
  } catch (error) {
    console.error('Erro ao listar add-ons:', error);
    res.status(500).json({ error: 'Erro ao listar add-ons' });
  }
};

/**
 * Criar novo add-on
 * POST /api/admin/subscriptions/addons
 */
export const createAddon = async (req: Request, res: Response) => {
  try {
    const { nome, descricao, preco, featureKey } = req.body;

    if (!nome || preco === undefined || !featureKey) {
      return res.status(400).json({
        error: 'nome, preco e featureKey são obrigatórios'
      });
    }

    const addon = await prisma.addon.create({
      data: { nome, descricao, preco, featureKey }
    });

    res.status(201).json({
      message: 'Add-on criado com sucesso',
      addon
    });
  } catch (error) {
    console.error('Erro ao criar add-on:', error);
    res.status(500).json({ error: 'Erro ao criar add-on' });
  }
};

/**
 * Atualizar add-on
 * PUT /api/admin/subscriptions/addons/:id
 */
export const updateAddon = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updateData = req.body;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    const addon = await prisma.addon.update({
      where: { id },
      data: updateData
    });

    res.json({
      message: 'Add-on atualizado com sucesso',
      addon
    });
  } catch (error) {
    console.error('Erro ao atualizar add-on:', error);
    res.status(500).json({ error: 'Erro ao atualizar add-on' });
  }
};

/**
 * Deletar add-on
 * DELETE /api/admin/subscriptions/addons/:id
 */
export const deleteAddon = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    const addon = await prisma.addon.findUnique({
      where: { id }
    });

    if (!addon) {
      return res.status(404).json({ error: 'Add-on não encontrado' });
    }

    // Verificar se há assinaturas usando este add-on
    const subscriptionsWithAddon = await prisma.subscriptionAddon.count({
      where: {
        addonId: id,
        ativo: true
      }
    });

    if (subscriptionsWithAddon > 0) {
      return res.status(400).json({
        error: `Não é possível deletar. Este add-on está ativo em ${subscriptionsWithAddon} assinatura(s)`
      });
    }

    await prisma.addon.delete({
      where: { id }
    });

    res.json({
      message: 'Add-on deletado com sucesso',
      addon
    });
  } catch (error) {
    console.error('Erro ao deletar add-on:', error);
    res.status(500).json({ error: 'Erro ao deletar add-on' });
  }
};

/**
 * Toggle add-on active status
 * PATCH /api/admin/subscriptions/addons/:id/toggle
 */
export const toggleAddonStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { ativo } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'id é obrigatório' });
    }

    const addon = await prisma.addon.findUnique({
      where: { id }
    });

    if (!addon) {
      return res.status(404).json({ error: 'Add-on não encontrado' });
    }

    const updated = await prisma.addon.update({
      where: { id },
      data: { ativo: ativo !== undefined ? ativo : !addon.ativo }
    });

    res.json({
      message: `Add-on ${updated.ativo ? 'ativado' : 'desativado'} com sucesso`,
      addon: updated
    });
  } catch (error) {
    console.error('Erro ao alternar status do add-on:', error);
    res.status(500).json({ error: 'Erro ao alternar status do add-on' });
  }
};

/**
 * Listar todos os usuários para atribuição de assinaturas
 * GET /api/admin/subscriptions/usuarios
 */
export const listUsuarios = async (req: Request, res: Response) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        createdAt: true,
        subscriptions: {
          select: {
            id: true,
            status: true,
            plan: {
              select: {
                id: true,
                nome: true
              }
            }
          },
          take: 1,
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(usuarios);
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
};

/**
 * Criar nova assinatura para um usuário
 * POST /api/admin/subscriptions/create-assignment
 * Body: { usuarioId, planId, tipo: 'LIFETIME' | 'MONTHS', meses?: number }
 */
export const createSubscriptionAssignment = async (req: Request, res: Response) => {
  try {
    const { usuarioId, planId, tipo, meses } = req.body;

    if (!usuarioId || !planId || !tipo) {
      return res.status(400).json({
        error: 'usuarioId, planId e tipo são obrigatórios'
      });
    }

    if (tipo === 'MONTHS' && (!meses || meses <= 0)) {
      return res.status(400).json({
        error: 'Para tipo MONTHS, meses deve ser um número positivo'
      });
    }

    // Verificar se usuário já tem assinatura ativa
    const existing = await subscriptionService.getActiveSubscription(usuarioId);

    if (existing) {
      // Cancelar a existente
      await subscriptionService.cancelSubscription(existing.id);
    }

    let subscriptionData: any = {
      usuarioId,
      planId
    };

    if (tipo === 'LIFETIME') {
      subscriptionData.isLifetime = true;
    } else if (tipo === 'MONTHS') {
      subscriptionData.months = meses;
    }

    const subscription = await subscriptionService.createSubscription(subscriptionData);

    res.status(201).json({
      message: 'Assinatura atribuída com sucesso',
      subscription
    });
  } catch (error: any) {
    console.error('Erro ao atribuir assinatura:', error);
    res.status(400).json({
      error: error.message || 'Erro ao atribuir assinatura'
    });
  }
};

/**
 * Obter estatísticas de assinaturas
 * GET /api/admin/subscriptions/stats
 */
export const getSubscriptionStats = async (req: Request, res: Response) => {
  try {
    const totalSubscriptions = await prisma.subscription.count();

    const byStatus = await prisma.subscription.groupBy({
      by: ['status'],
      _count: true
    });

    const byPlan = await prisma.subscription.groupBy({
      by: ['planId'],
      _count: true
    });

    const plans = await prisma.subscriptionPlan.findMany({
      select: { id: true, nome: true }
    });

    const planStats = byPlan.map(stat => {
      const plan = plans.find(p => p.id === stat.planId);
      return {
        planId: stat.planId,
        planName: plan?.nome || 'Desconhecido',
        count: stat._count
      };
    });

    // MRR (Monthly Recurring Revenue)
    const activeSubscriptions = await prisma.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'TRIAL', 'LIFETIME'] }
      },
      select: { preco: true }
    });

    const mrr = activeSubscriptions.reduce((sum, sub) => sum + sub.preco, 0) / 100;

    res.json({
      total: totalSubscriptions,
      byStatus,
      byPlan: planStats,
      mrr: mrr.toFixed(2)
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
};

export default {
  listAllSubscriptions,
  getSubscriptionDetails,
  grantLifetimeSubscription,
  updateSubscriptionStatus,
  extendSubscription,
  listPlans,
  createPlan,
  updatePlan,
  togglePlanStatus,
  listAddons,
  createAddon,
  updateAddon,
  deleteAddon,
  toggleAddonStatus,
  getSubscriptionStats,
  listUsuarios,
  createSubscriptionAssignment
};
