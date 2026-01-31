import { Request, Response } from 'express';
import prisma from '../db';
import { mercadoPagoService } from '../services/mercadoPagoService';
import { subscriptionService } from '../services/subscriptionService';
import { emailService } from '../services/emailService';

interface AuthRequest extends Request {
  usuarioId?: string;
}

/**
 * PAYMENT CONTROLLER
 * Endpoints para integração com Mercado Pago
 */

/**
 * POST /api/payments/create-preference
 * Criar preferência de pagamento (checkout)
 */
export const createPaymentPreference = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ error: 'planId é obrigatório' });
    }

    // Buscar plano
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: planId }
    });

    if (!plan || !plan.ativo) {
      return res.status(400).json({ error: 'Plano inválido ou inativo' });
    }

    // Verificar se requer pagamento
    if (!plan.preco || plan.preco === 0) {
      return res.status(400).json({ error: 'Plano não requer pagamento' });
    }

    // Verificar se já tem assinatura ativa
    const existingActiveSubscription = await prisma.subscription.findFirst({
      where: {
        usuarioId,
        status: {
          in: ['ACTIVE', 'TRIAL', 'LIFETIME']
        }
      }
    });

    if (existingActiveSubscription) {
      return res.status(400).json({
        error: 'Você já possui uma assinatura ativa. Cancele-a antes de contratar um novo plano.'
      });
    }

    // Buscar dados do usuário
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId }
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Limpar assinaturas PENDING antigas (sem pagamento completado)
    const oldPendingSubscriptions = await prisma.subscription.findMany({
      where: {
        usuarioId,
        status: 'PENDING',
        payments: {
          none: {
            status: 'PAID'
          }
        }
      }
    });

    // Deletar assinaturas PENDING sem pagamento confirmado
    for (const oldSub of oldPendingSubscriptions) {
      await prisma.subscription.delete({
        where: { id: oldSub.id }
      });
      console.log(`[Payment] Subscription PENDING removida (sem pagamento): ${oldSub.id}`);
    }

    // PASSO 1: Criar a subscription PRIMEIRO (para ter o ID)
    const subscription = await subscriptionService.createSubscription({
      usuarioId,
      planId,
      isTrial: false,
      isLifetime: false
    });

    // PASSO 2: Criar preferência de pagamento COM o subscriptionId para vincular
    const preference = await mercadoPagoService.createSubscriptionPreference({
      usuarioId,
      planId: plan.id,
      planName: plan.nome,
      planPrice: plan.preco,
      userEmail: usuario.email,
      userName: usuario.nome,
      subscriptionId: subscription.id // IMPORTANTE: vincular subscription via external_reference
    });

    console.log(`[Payment] Preferência criada: ${preference.preferenceId} para subscription ${subscription.id}`);

    res.status(200).json({
      preferenceId: preference.preferenceId,
      initPoint: preference.initPoint,
      publicKey: process.env.MERCADO_PAGO_PUBLIC_KEY
    });
  } catch (error: any) {
    console.error('[Payment] Erro ao criar preferência:', error);
    res.status(400).json({
      error: error.message || 'Erro ao criar checkout de pagamento'
    });
  }
};

/**
 * POST /api/payments/webhook
 * Receber notificações do Mercado Pago
 */
export const handleWebhook = async (req: any, res: Response) => {
  // Responder 200 OK IMEDIATAMENTE (sem await)
  res.status(200).json({ status: 'received' });

  // Processar webhook de forma assincronizada (fire and forget)
  (async () => {
    try {
      // DEBUG: Log do webhook recebido
      console.log('[Webhook] Notificação recebida:', {
        type: req.body.type,
        action: req.body.action,
        paymentId: req.body.data?.id,
        timestamp: new Date().toISOString()
      });

      // Processar notificação
      const paymentNotification = await mercadoPagoService.processPaymentNotification(req.body);

      if (paymentNotification.type !== 'payment') {
        // Ignorar notificações que não são de pagamento
        return;
      }

      const { paymentId, status, paymentMethod, amount, metadata } = paymentNotification;

      // DEBUG: Log detalhado
      console.log('[Webhook] Payment notification completo:', {
        paymentId,
        status,
        externalReference: paymentNotification.externalReference,
        metadata,
        metadataKeys: metadata ? Object.keys(metadata) : []
      });

      // Tentar encontrar a subscription pelo external_reference
      // (external_reference é a forma que vinculamos o subscriptionId ao pagamento)
      let subscription: any = null;
      const externalReference = paymentNotification.externalReference;

      if (externalReference) {
        console.log(`[Webhook] Buscando subscription pelo external_reference: ${externalReference}`);
        subscription = await prisma.subscription.findUnique({
          where: { id: externalReference },
          include: { usuario: true, plan: true }
        });
      }

      if (!subscription) {
        console.warn(`[Webhook] Subscription não encontrada - external_reference:`, {
          externalReference,
          paymentId,
          allPaymentNotification: paymentNotification
        });
        return;
      }

      // Buscar ou criar payment record
      let payment = await prisma.subscriptionPayment.findFirst({
        where: {
          subscriptionId: subscription.id,
          status: { in: ['PENDING', 'PROCESSING'] }
        }
      });

      if (!payment) {
        console.warn(`[Webhook] Payment record não encontrado para subscription: ${subscription.id}`);
        // Criar um novo payment record se não existir
        payment = await prisma.subscriptionPayment.create({
          data: {
            subscriptionId: subscription.id,
            valor: amount || subscription.plan.preco,
            status: 'PENDING',
            currency: 'BRL'
          }
        });
      }

      // Verificar se já foi processado (idempotência)
      if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING') {
        console.log(`[Webhook] Pagamento já processado: ${paymentId}`);
        return;
      }

      // Processar por status
      if (status === 'PAID') {
        // Pagamento aprovado
        await prisma.subscriptionPayment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            mercadoPagoPaymentId: paymentId,
            metodo: paymentMethod,
            paidAt: new Date()
          }
        });

        // Verificar se é renovação ou ativação
        if (subscription.status === 'ACTIVE') {
          // Renovação de assinatura já ativa
          await subscriptionService.renewSubscriptionAfterPayment(
            subscription.id,
            paymentId
          );
          console.log(`[Webhook] Pagamento aprovado: ${paymentId}, subscription renovada`);
        } else {
          // Ativação de nova assinatura
          await subscriptionService.activateSubscriptionAfterPayment(
            subscription.id,
            paymentId
          );
          console.log(`[Webhook] Pagamento aprovado: ${paymentId}, subscription ativada`);
        }
      } else if (status === 'PROCESSING') {
        // Pagamento em processamento (PIX, etc)
        await prisma.subscriptionPayment.update({
          where: { id: payment.id },
          data: {
            status: 'PROCESSING',
            mercadoPagoPaymentId: paymentId,
            metodo: paymentMethod
          }
        });

        console.log(`[Webhook] Pagamento em processamento: ${paymentId}`);
      } else if (status === 'FAILED') {
        // Pagamento rejeitado
        await prisma.subscriptionPayment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            mercadoPagoPaymentId: paymentId,
            failedAt: new Date(),
            errorMessage: paymentNotification.statusDetail
          }
        });

        // Marcar subscription como falha
        await subscriptionService.handleFailedPayment(
          subscription.id,
          paymentNotification.statusDetail
        );

        console.log(`[Webhook] Pagamento rejeitado: ${paymentId}`);
      }
    } catch (error: any) {
      console.error('[Webhook] Erro ao processar notificação:', error.message);
    }
  })();
};

/**
 * GET /api/payments/status/:paymentId
 * Verificar status de um pagamento
 */
export const getPaymentStatus = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;
    const { paymentId } = req.params;

    if (!paymentId) {
      return res.status(400).json({ error: 'paymentId é obrigatório' });
    }

    // Buscar pagamento
    const payment = await prisma.subscriptionPayment.findFirst({
      where: {
        mercadoPagoPaymentId: paymentId as string,
        subscription: {
          usuarioId: usuarioId
        }
      },
      include: {
        subscription: {
          include: { plan: true }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Pagamento não encontrado' });
    }

    // Retornar status
    res.status(200).json({
      status: payment.status,
      paymentId: payment.id,
      valor: payment.valor,
      metodo: payment.metodo,
      subscription: {
        id: payment.subscription.id,
        status: payment.subscription.status,
        plan: {
          nome: payment.subscription.plan.nome,
          preco: payment.subscription.plan.preco
        }
      },
      paidAt: payment.paidAt,
      failedAt: payment.failedAt,
      errorMessage: payment.errorMessage
    });
  } catch (error: any) {
    console.error('[Payment] Erro ao consultar status:', error);
    res.status(400).json({
      error: error.message || 'Erro ao consultar status do pagamento'
    });
  }
};

/**
 * POST /api/payments/retry-payment
 * Retentar pagamento falhado
 */
export const retryPayment = async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.usuarioId!;
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ error: 'subscriptionId é obrigatório' });
    }

    // Buscar subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        usuarioId,
        status: 'PAYMENT_FAILED'
      },
      include: { plan: true }
    });

    if (!subscription) {
      return res.status(404).json({ error: 'Assinatura não encontrada ou não está em falha de pagamento' });
    }

    // Buscar usuário
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId }
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Criar nova preferência COM subscriptionId para vincular pagamento
    const preference = await mercadoPagoService.createSubscriptionPreference({
      usuarioId,
      planId: subscription.planId,
      planName: subscription.plan.nome,
      planPrice: subscription.plan.preco,
      userEmail: usuario.email,
      userName: usuario.nome,
      subscriptionId: subscriptionId // IMPORTANTE: vincular subscription
    });

    // Atualizar subscription para PENDING
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'PENDING' }
    });

    // Criar novo registro de pagamento
    await prisma.subscriptionPayment.create({
      data: {
        subscriptionId,
        valor: subscription.plan.preco,
        status: 'PENDING',
        currency: 'BRL'
      }
    });

    res.status(200).json({
      preferenceId: preference.preferenceId,
      initPoint: preference.initPoint,
      publicKey: process.env.MERCADO_PAGO_PUBLIC_KEY
    });
  } catch (error: any) {
    console.error('[Payment] Erro ao retentar pagamento:', error);
    res.status(400).json({
      error: error.message || 'Erro ao retentar pagamento'
    });
  }
};
