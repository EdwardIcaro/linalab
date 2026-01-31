import { Request, Response } from 'express';
import { subscriptionService } from '../services/subscriptionService';
import { emailService } from '../services/emailService';
import { mercadoPagoService } from '../services/mercadoPagoService';
import prisma from '../db';

interface AuthRequest extends Request {
  usuarioId?: string;
}

/**
 * SUBSCRIPTION CONTROLLER
 * Endpoints para gerenciamento de assinaturas pelos usuários
 */

/**
 * Obter planos disponíveis
 * GET /api/subscriptions/plans
 */
export const getAvailablePlans = async (req: Request, res: Response) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { ativo: true },
      orderBy: { ordem: 'asc' }
    });

    res.json(plans);
  } catch (error) {
    console.error('Erro ao buscar planos:', error);
    res.status(500).json({ error: 'Erro ao buscar planos disponíveis' });
  }
};

/**
 * Obter assinatura atual do usuário
 * GET /api/subscriptions/my-subscription
 */
export const getMySubscription = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;

    const subscription = await subscriptionService.getActiveSubscription(usuarioId);

    if (!subscription) {
      return res.json({
        hasSubscription: false,
        message: 'Nenhuma assinatura ativa'
      });
    }

    // Calcular dias restantes do trial
    let daysRemaining = null;
    if (subscription.isCurrentlyTrial && subscription.trialEndDate) {
      const now = new Date();
      const diff = subscription.trialEndDate.getTime() - now.getTime();
      daysRemaining = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    res.json({
      hasSubscription: true,
      subscription: {
        ...subscription,
        daysRemaining
      }
    });
  } catch (error) {
    console.error('Erro ao buscar assinatura:', error);
    res.status(500).json({ error: 'Erro ao buscar assinatura' });
  }
};

/**
 * Obter breakdown de preços (plano + add-ons + total)
 * GET /api/subscriptions/pricing-breakdown
 */
export const getPricingBreakdown = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;

    const subscription = await subscriptionService.getActiveSubscription(usuarioId);

    if (!subscription) {
      return res.json({
        hasSubscription: false,
        message: 'Nenhuma assinatura ativa'
      });
    }

    const pricing = await subscriptionService.calculateTotalPrice(subscription.id);

    res.json({
      hasSubscription: true,
      pricing,
      nextBillingDate: subscription.nextBillingDate
    });
  } catch (error) {
    console.error('Erro ao buscar breakdown de preços:', error);
    res.status(500).json({ error: 'Erro ao buscar breakdown de preços' });
  }
};

/**
 * Criar nova assinatura (trial ou paga)
 * POST /api/subscriptions/subscribe
 */
export const createSubscription = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;
    const { planId, isTrial } = req.body;

    if (!planId) {
      return res.status(400).json({ error: 'planId é obrigatório' });
    }

    const subscription = await subscriptionService.createSubscription({
      usuarioId,
      planId,
      isTrial: isTrial || false
    });

    res.status(201).json({
      message: isTrial ? 'Trial iniciado com sucesso' : 'Assinatura criada com sucesso',
      subscription
    });
  } catch (error: any) {
    console.error('Erro ao criar assinatura:', error);
    res.status(400).json({
      error: error.message || 'Erro ao criar assinatura'
    });
  }
};

/**
 * Cancelar assinatura
 * POST /api/subscriptions/cancel
 */
export const cancelMySubscription = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;

    const subscription = await subscriptionService.getActiveSubscription(usuarioId);

    if (!subscription) {
      return res.status(404).json({ error: 'Nenhuma assinatura ativa encontrada' });
    }

    await subscriptionService.cancelSubscription(subscription.id);

    res.json({ message: 'Assinatura cancelada com sucesso' });
  } catch (error) {
    console.error('Erro ao cancelar assinatura:', error);
    res.status(500).json({ error: 'Erro ao cancelar assinatura' });
  }
};

/**
 * Fazer upgrade de plano
 * POST /api/subscriptions/upgrade
 */
export const upgradePlan = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;
    const { newPlanId } = req.body;

    if (!newPlanId) {
      return res.status(400).json({ error: 'newPlanId é obrigatório' });
    }

    const subscription = await subscriptionService.getActiveSubscription(usuarioId);

    if (!subscription) {
      return res.status(404).json({ error: 'Nenhuma assinatura ativa encontrada' });
    }

    const updated = await subscriptionService.upgradePlan(subscription.id, newPlanId);

    res.json({
      message: 'Upgrade realizado com sucesso',
      subscription: updated
    });
  } catch (error: any) {
    console.error('Erro ao fazer upgrade:', error);
    res.status(400).json({
      error: error.message || 'Erro ao fazer upgrade'
    });
  }
};

/**
 * Fazer downgrade de plano
 * POST /api/subscriptions/downgrade
 */
export const downgradePlan = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;
    const { newPlanId } = req.body;

    if (!newPlanId) {
      return res.status(400).json({ error: 'newPlanId é obrigatório' });
    }

    const subscription = await subscriptionService.getActiveSubscription(usuarioId);

    if (!subscription) {
      return res.status(404).json({ error: 'Nenhuma assinatura ativa encontrada' });
    }

    const updated = await subscriptionService.downgradePlan(subscription.id, newPlanId);

    res.json({
      message: 'Downgrade realizado com sucesso',
      subscription: updated
    });
  } catch (error: any) {
    console.error('Erro ao fazer downgrade:', error);
    res.status(400).json({
      error: error.message || 'Erro ao fazer downgrade'
    });
  }
};

/**
 * Obter add-ons disponíveis
 * GET /api/subscriptions/addons
 */
export const getAvailableAddons = async (req: Request, res: Response) => {
  try {
    const addons = await prisma.addon.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' }
    });

    res.json(addons);
  } catch (error) {
    console.error('Erro ao buscar add-ons:', error);
    res.status(500).json({ error: 'Erro ao buscar add-ons' });
  }
};

/**
 * Adicionar add-on à assinatura
 * POST /api/subscriptions/addons
 */
export const addAddon = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;
    const { addonId } = req.body;

    if (!addonId) {
      return res.status(400).json({ error: 'addonId é obrigatório' });
    }

    const subscription = await subscriptionService.getActiveSubscription(usuarioId);

    if (!subscription) {
      return res.status(404).json({ error: 'Nenhuma assinatura ativa encontrada' });
    }

    const subscriptionAddon = await subscriptionService.addAddon(
      subscription.id,
      addonId
    );

    // Buscar dados do addon e usuário para enviar email
    const addon = await prisma.addon.findUnique({
      where: { id: addonId }
    });

    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId }
    });

    const updatedSubscription = await subscriptionService.getActiveSubscription(usuarioId);

    // Enviar email de notificação
    if (addon && usuario && updatedSubscription?.nextBillingDate) {
      try {
        await emailService.sendAddonAddedEmail(
          usuario,
          addon.nome,
          addon.preco,
          updatedSubscription.nextBillingDate
        );
      } catch (emailError) {
        console.error('Erro ao enviar email de add-on adicionado:', emailError);
        // Não interromper fluxo se email falhar
      }
    }

    res.status(201).json({
      message: 'Add-on adicionado com sucesso. Será cobrado na próxima renovação.',
      addon: subscriptionAddon
    });
  } catch (error: any) {
    console.error('Erro ao adicionar add-on:', error);
    res.status(400).json({
      error: error.message || 'Erro ao adicionar add-on'
    });
  }
};

/**
 * Remover add-on da assinatura
 * DELETE /api/subscriptions/addons/:addonId
 */
export const removeAddon = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;
    const addonId = req.params.addonId as string;

    if (!addonId) {
      return res.status(400).json({ error: 'addonId é obrigatório' });
    }

    const subscription = await subscriptionService.getActiveSubscription(usuarioId);

    if (!subscription) {
      return res.status(404).json({ error: 'Nenhuma assinatura ativa encontrada' });
    }

    await subscriptionService.removeAddon(subscription.id, addonId);

    res.json({ message: 'Add-on removido com sucesso' });
  } catch (error: any) {
    console.error('Erro ao remover add-on:', error);
    res.status(400).json({
      error: error.message || 'Erro ao remover add-on'
    });
  }
};

/**
 * Renovar assinatura (criar preferência de pagamento para renovação)
 * POST /api/subscriptions/renew
 */
export const renewSubscription = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;

    const subscription = await subscriptionService.getActiveSubscription(usuarioId);

    if (!subscription) {
      return res.status(404).json({ error: 'Nenhuma assinatura ativa encontrada' });
    }

    // Calcular preço total (plano + add-ons)
    const pricing = await subscriptionService.calculateTotalPrice(subscription.id);

    // Buscar dados do usuário
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId }
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Criar preferência de renovação no Mercado Pago
    const preference = await mercadoPagoService.createRenewalPreference({
      usuarioId,
      subscriptionId: subscription.id,
      planId: subscription.planId,
      planName: subscription.plan.nome,
      planPrice: subscription.plan.preco,
      addonsPrice: pricing.addonsPrice,
      totalPrice: pricing.totalPrice,
      userEmail: usuario.email,
      userName: usuario.nome,
      addons: pricing.addons
    });

    console.log(`[Payment] Preferência de renovação criada: ${preference.preferenceId} para subscription ${subscription.id}`);

    res.status(200).json({
      preferenceId: preference.preferenceId,
      initPoint: preference.initPoint,
      publicKey: process.env.MERCADO_PAGO_PUBLIC_KEY,
      pricing
    });
  } catch (error: any) {
    console.error('[Payment] Erro ao renovar assinatura:', error);
    res.status(400).json({
      error: error.message || 'Erro ao renovar assinatura'
    });
  }
};

/**
 * Obter histórico de pagamentos
 * GET /api/subscriptions/payment-history
 */
export const getPaymentHistory = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;

    const subscription = await subscriptionService.getActiveSubscription(usuarioId);

    if (!subscription) {
      return res.json({ payments: [] });
    }

    const payments = await prisma.subscriptionPayment.findMany({
      where: { subscriptionId: subscription.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({ payments });
  } catch (error) {
    console.error('Erro ao buscar histórico:', error);
    res.status(500).json({ error: 'Erro ao buscar histórico de pagamentos' });
  }
};

export default {
  getAvailablePlans,
  getMySubscription,
  getPricingBreakdown,
  createSubscription,
  cancelMySubscription,
  upgradePlan,
  downgradePlan,
  getAvailableAddons,
  addAddon,
  removeAddon,
  renewSubscription,
  getPaymentHistory
};
