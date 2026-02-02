import prisma from '../db';
import { emailService } from './emailService';

/**
 * SUBSCRIPTION SERVICE
 * Lógica de negócio centralizada para assinaturas
 */

interface CreateSubscriptionParams {
  usuarioId: string;
  planId: string;
  isTrial?: boolean;
  isLifetime?: boolean;
}

interface FeatureAccess {
  hasAccess: boolean;
  reason?: string;
  planName?: string;
}

export class SubscriptionService {

  /**
   * Calcular a próxima data de cobrança (exatamente 1 mês depois)
   * Trata corretamente meses com dias diferentes (31, 30, 28, 29)
   * Exemplo: 31/01/2026 + 1 mês = 28/02/2026 (último dia de fevereiro)
   */
  private calculateNextBillingDate(fromDate: Date): Date {
    const nextDate = new Date(fromDate);
    const currentDay = nextDate.getDate();

    // Adicionar 1 mês
    nextDate.setMonth(nextDate.getMonth() + 1);

    // Se o dia ficou diferente (porque o próximo mês tem menos dias),
    // voltar para o último dia do mês anterior
    if (nextDate.getDate() !== currentDay) {
      nextDate.setDate(0); // Último dia do mês anterior
    }

    return nextDate;
  }

  /**
   * Verifica se usuário pode criar mais empresas
   */
  async canCreateMoreCompanies(usuarioId: string): Promise<{
    allowed: boolean;
    limit: number;
    current: number;
    reason?: string;
  }> {
    const subscription = await this.getActiveSubscription(usuarioId);

    if (!subscription) {
      return {
        allowed: false,
        limit: 0,
        current: 0,
        reason: 'Nenhuma assinatura ativa. Assine um plano para criar empresas.'
      };
    }

    const empresasCount = await prisma.empresa.count({
      where: { usuarioId, ativo: true }
    });

    const limit = subscription.plan.maxEmpresas;
    const allowed = empresasCount < limit;

    return {
      allowed,
      limit,
      current: empresasCount,
      reason: allowed ? undefined : `Limite de ${limit} empresa(s) atingido. Faça upgrade do plano.`
    };
  }

  /**
   * Verifica se usuário tem acesso a uma feature
   */
  async hasFeatureAccess(
    usuarioId: string,
    featureKey: string
  ): Promise<FeatureAccess> {
    const subscription = await this.getActiveSubscription(usuarioId);

    if (!subscription) {
      return {
        hasAccess: false,
        reason: 'Nenhuma assinatura ativa'
      };
    }

    // Verificar features do plano base
    const planFeatures = subscription.plan.features as string[];
    if (planFeatures.includes(featureKey)) {
      return {
        hasAccess: true,
        planName: subscription.plan.nome
      };
    }

    // Verificar add-ons ativos
    const hasAddon = await prisma.subscriptionAddon.findFirst({
      where: {
        subscriptionId: subscription.id,
        ativo: true,
        addon: {
          featureKey: featureKey,
          ativo: true
        }
      }
    });

    if (hasAddon) {
      return { hasAccess: true };
    }

    return {
      hasAccess: false,
      reason: `Feature não incluída no plano ${subscription.plan.nome}`
    };
  }

  /**
   * Obter assinatura ativa do usuário
   */
  async getActiveSubscription(usuarioId: string) {
    return await prisma.subscription.findFirst({
      where: {
        usuarioId,
        status: {
          in: ['ACTIVE', 'TRIAL', 'LIFETIME']
        }
      },
      include: {
        plan: true,
        addons: {
          where: { ativo: true },
          include: { addon: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  /**
   * Criar nova assinatura
   */
  async createSubscription(params: CreateSubscriptionParams) {
    const { usuarioId, planId, isTrial, isLifetime } = params;

    // Validar se já tem assinatura ativa ou pendente
    const existingSubscription = await prisma.subscription.findFirst({
      where: {
        usuarioId,
        status: {
          in: ['ACTIVE', 'TRIAL', 'LIFETIME', 'PENDING']
        }
      }
    });

    if (existingSubscription) {
      throw new Error('Usuário já possui uma assinatura ativa ou pagamento pendente');
    }

    // Validar trial
    if (isTrial) {
      const hasUsedTrial = await prisma.subscription.findFirst({
        where: { usuarioId, isTrialUsed: true }
      });

      if (hasUsedTrial) {
        throw new Error('Trial já foi utilizado anteriormente');
      }
    }

    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: planId }
    });

    if (!plan || !plan.ativo) {
      throw new Error('Plano não encontrado ou inativo');
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId }
    });

    if (!usuario) {
      throw new Error('Usuário não encontrado');
    }

    const now = new Date();
    const trialEndDate = isTrial && plan.trialDays > 0
      ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
      : null;

    // Verificar se é plano pago (não é trial, não é lifetime, e tem preço > 0)
    const requiresPayment = !isTrial && !isLifetime && plan.preco > 0;

    const subscription = await prisma.subscription.create({
      data: {
        usuarioId,
        planId,
        status: requiresPayment ? 'PENDING' : (isLifetime ? 'LIFETIME' : (isTrial ? 'TRIAL' : 'ACTIVE')),
        isTrialUsed: isTrial || false,
        isCurrentlyTrial: isTrial || false,
        trialStartDate: isTrial ? now : null,
        trialEndDate,
        startDate: now,
        endDate: isLifetime ? null : (isTrial ? trialEndDate : null),
        nextBillingDate: isTrial ? trialEndDate : this.calculateNextBillingDate(now),
        preco: isTrial ? 0 : plan.preco
      },
      include: {
        plan: true
      }
    });

    // Criar registro de pagamento se for plano pago
    if (requiresPayment) {
      await prisma.subscriptionPayment.create({
        data: {
          subscriptionId: subscription.id,
          valor: plan.preco,
          status: 'PENDING',
          currency: 'BRL'
        }
      });

      console.log(`[Subscription] Subscription criada com status PENDING: ${subscription.id}, aguardando pagamento`);
      // Não enviar email ainda - será enviado após pagamento confirmado
      return subscription;
    }

    // Para trial/lifetime, enviar email de ativação
    try {
      if (isTrial) {
        await emailService.sendTrialStartedEmail(usuario, plan, plan.trialDays);
      } else if (isLifetime) {
        await emailService.sendSubscriptionActivatedEmail(usuario, plan);
      } else {
        await emailService.sendSubscriptionActivatedEmail(usuario, plan);
      }
    } catch (error) {
      console.error('[Email] Erro ao enviar email de criação de assinatura:', error);
      // Não interromper fluxo se email falhar
    }

    return subscription;
  }

  /**
   * Cancelar assinatura
   */
  async cancelSubscription(subscriptionId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        usuario: true
      }
    });

    if (!subscription) {
      throw new Error('Assinatura não encontrada');
    }

    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'CANCELED',
        canceledAt: new Date()
      }
    });

    // Enviar email de cancelamento
    try {
      await emailService.sendSubscriptionCanceledEmail(subscription.usuario, subscription.plan);
    } catch (error) {
      console.error('[Email] Erro ao enviar email de cancelamento:', error);
      // Não interromper fluxo se email falhar
    }

    return updated;
  }

  /**
   * Fazer upgrade de plano
   */
  async upgradePlan(subscriptionId: string, newPlanId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        usuario: true
      }
    });

    if (!subscription) {
      throw new Error('Assinatura não encontrada');
    }

    const newPlan = await prisma.subscriptionPlan.findUnique({
      where: { id: newPlanId }
    });

    if (!newPlan || !newPlan.ativo) {
      throw new Error('Plano não encontrado');
    }

    if (newPlan.preco <= subscription.plan.preco) {
      throw new Error('Use downgrade para planos mais baratos');
    }

    const oldPlan = subscription.plan;

    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        planId: newPlanId,
        preco: newPlan.preco,
        isCurrentlyTrial: false, // Remove trial ao fazer upgrade
        updatedAt: new Date()
      },
      include: { plan: true }
    });

    // Enviar email de upgrade
    try {
      await emailService.sendPlanUpgradedEmail(subscription.usuario, oldPlan, newPlan);
    } catch (error) {
      console.error('[Email] Erro ao enviar email de upgrade:', error);
      // Não interromper fluxo se email falhar
    }

    return updated;
  }

  /**
   * Fazer downgrade de plano
   */
  async downgradePlan(subscriptionId: string, newPlanId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        usuario: {
          include: {
            empresas: {
              where: { ativo: true }
            }
          }
        }
      }
    });

    if (!subscription) {
      throw new Error('Assinatura não encontrada');
    }

    const newPlan = await prisma.subscriptionPlan.findUnique({
      where: { id: newPlanId }
    });

    if (!newPlan) {
      throw new Error('Plano não encontrado');
    }

    // Validar se o número de empresas é compatível com o novo plano
    const activeEmpresas = subscription.usuario.empresas.length;
    if (activeEmpresas > newPlan.maxEmpresas) {
      throw new Error(
        `Você possui ${activeEmpresas} empresa(s) ativa(s). ` +
        `O plano ${newPlan.nome} permite no máximo ${newPlan.maxEmpresas}. ` +
        `Desative ${activeEmpresas - newPlan.maxEmpresas} empresa(s) antes de fazer o downgrade.`
      );
    }

    return await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        planId: newPlanId,
        preco: newPlan.preco
      },
      include: { plan: true }
    });
  }

  /**
   * Verificar assinaturas expiradas e enviar notificações (para cron job)
   */
  async checkExpiredSubscriptions() {
    const now = new Date();

    // Encontrar trials expirados
    const expiredTrials = await prisma.subscription.findMany({
      where: {
        status: 'TRIAL',
        trialEndDate: { lte: now }
      },
      include: {
        usuario: true,
        plan: true
      }
    });

    for (const sub of expiredTrials) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'EXPIRED',
          isCurrentlyTrial: false
        }
      });

      // Enviar email de trial expirado
      try {
        await emailService.sendTrialExpiredEmail(sub.usuario);
      } catch (error) {
        console.error('[Email] Erro ao enviar email de trial expirado:', error);
      }

      console.log(`[Subscription] Trial expirado para subscription ${sub.id}`);
    }

    // Encontrar assinaturas vencidas (nextBillingDate passou)
    const expiredSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        nextBillingDate: { lte: now }
      }
    });

    for (const sub of expiredSubscriptions) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'PAST_DUE' }
      });

      console.log(`[Subscription] Assinatura vencida ${sub.id}`);
    }
  }

  /**
   * Verificar trials próximos de expirar e enviar notificações de aviso
   * Executar via cron job 1x por dia
   */
  async checkTrialExpirationWarnings() {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const oneDayFromNow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    // Verificar trials que expiram em 3 dias
    const trialsExpiring3Days = await prisma.subscription.findMany({
      where: {
        status: 'TRIAL',
        isCurrentlyTrial: true,
        trialEndDate: {
          lte: threeDaysFromNow,
          gt: new Date(threeDaysFromNow.getTime() - 12 * 60 * 60 * 1000) // última 12 horas
        }
      },
      include: {
        usuario: true,
        plan: true
      }
    });

    for (const sub of trialsExpiring3Days) {
      try {
        await emailService.sendTrialExpiring3DaysEmail(sub.usuario, sub.plan);
      } catch (error) {
        console.error('[Email] Erro ao enviar email de trial expirando em 3 dias:', error);
      }
    }

    // Verificar trials que expiram em 1 dia
    const trialsExpiring1Day = await prisma.subscription.findMany({
      where: {
        status: 'TRIAL',
        isCurrentlyTrial: true,
        trialEndDate: {
          lte: oneDayFromNow,
          gt: new Date(oneDayFromNow.getTime() - 12 * 60 * 60 * 1000) // última 12 horas
        }
      },
      include: {
        usuario: true,
        plan: true
      }
    });

    for (const sub of trialsExpiring1Day) {
      try {
        await emailService.sendTrialExpiring1DayEmail(sub.usuario, sub.plan);
      } catch (error) {
        console.error('[Email] Erro ao enviar email de trial expirando em 1 dia:', error);
      }
    }

    console.log(`[Subscription] Verificação de trial expiração concluída. ${trialsExpiring3Days.length} avisos em 3 dias, ${trialsExpiring1Day.length} avisos em 1 dia.`);
  }

  /**
   * Adicionar add-on a uma assinatura
   */
  async addAddon(subscriptionId: string, addonId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        addons: { where: { ativo: true } }
      }
    });

    if (!subscription) {
      throw new Error('Assinatura não encontrada');
    }

    // Verificar limite de add-ons
    if (subscription.addons.length >= subscription.plan.maxAddons) {
      throw new Error(
        `Limite de ${subscription.plan.maxAddons} add-on(s) atingido para o plano ${subscription.plan.nome}`
      );
    }

    const addon = await prisma.addon.findUnique({
      where: { id: addonId }
    });

    if (!addon || !addon.ativo) {
      throw new Error('Add-on não encontrado');
    }

    return await prisma.subscriptionAddon.create({
      data: {
        subscriptionId,
        addonId,
        ativo: true
      },
      include: { addon: true }
    });
  }

  /**
   * Remover add-on
   */
  async removeAddon(subscriptionId: string, addonId: string) {
    const subscriptionAddon = await prisma.subscriptionAddon.findFirst({
      where: {
        subscriptionId,
        addonId,
        ativo: true
      }
    });

    if (!subscriptionAddon) {
      throw new Error('Add-on não encontrado na assinatura');
    }

    return await prisma.subscriptionAddon.update({
      where: { id: subscriptionAddon.id },
      data: {
        ativo: false,
        removedAt: new Date()
      }
    });
  }

  /**
   * Calcular preço total da assinatura (plano + add-ons ativos)
   */
  async calculateTotalPrice(subscriptionId: string): Promise<{
    planPrice: number;
    addonsPrice: number;
    totalPrice: number;
    addons: Array<{ nome: string; preco: number }>;
  }> {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        addons: {
          where: { ativo: true },
          include: { addon: true }
        }
      }
    });

    if (!subscription) {
      throw new Error('Assinatura não encontrada');
    }

    const planPrice = subscription.plan.preco;
    const addonsPrice = subscription.addons.reduce((sum, item) => sum + item.addon.preco, 0);
    const totalPrice = planPrice + addonsPrice;

    return {
      planPrice,
      addonsPrice,
      totalPrice,
      addons: subscription.addons.map(item => ({
        nome: item.addon.nome,
        preco: item.addon.preco
      }))
    };
  }

  /**
   * Enviar notificação de limite de empresa atingido
   */
  async sendCompanyLimitEmail(usuarioId: string) {
    try {
      const usuario = await prisma.usuario.findUnique({
        where: { id: usuarioId }
      });

      const subscription = await this.getActiveSubscription(usuarioId);

      if (usuario && subscription) {
        await emailService.sendCompanyLimitReachedEmail(usuario, subscription.plan);
      }
    } catch (error) {
      console.error('[Email] Erro ao enviar email de limite de empresa:', error);
      // Não interromper fluxo se email falhar
    }
  }

  /**
   * Ativar subscription após pagamento confirmado
   */
  async activateSubscriptionAfterPayment(
    subscriptionId: string,
    mercadoPagoPaymentId: string
  ) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, usuario: true }
    });

    if (!subscription) {
      throw new Error('Subscription não encontrada');
    }

    // Se já está ativa, não fazer nada
    if (subscription.status === 'ACTIVE' || subscription.status === 'LIFETIME') {
      console.log(`[Subscription] Subscription ${subscriptionId} já está ativa`);
      return subscription;
    }

    const now = new Date();
    const nextBilling = this.calculateNextBillingDate(now);

    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'ACTIVE',
        startDate: now,
        nextBillingDate: nextBilling,
        mercadoPagoSubscriptionId: mercadoPagoPaymentId
      },
      include: { plan: true, usuario: true }
    });

    // Enviar email de ativação
    try {
      await emailService.sendSubscriptionActivatedEmail(updated.usuario, updated.plan);
    } catch (error) {
      console.error('[Email] Erro ao enviar email de ativação de assinatura:', error);
      // Não interromper fluxo se email falhar
    }

    console.log(`[Subscription] Subscription ativada: ${subscriptionId}`);

    return updated;
  }

  /**
   * Marcar subscription como falha de pagamento
   */
  async handleFailedPayment(
    subscriptionId: string,
    errorMessage?: string
  ) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { usuario: true, plan: true }
    });

    if (!subscription) {
      throw new Error('Subscription não encontrada');
    }

    // Atualizar status para PAYMENT_FAILED
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'PAYMENT_FAILED' }
    });

    // Enviar email de falha
    try {
      await emailService.sendPaymentFailedEmail(subscription.usuario, subscription.plan, errorMessage);
    } catch (error) {
      console.error('[Email] Erro ao enviar email de pagamento falho:', error);
    }

    console.log(`[Subscription] Pagamento falhou: ${subscriptionId} - ${errorMessage}`);
  }

  /**
   * Renovar subscription após pagamento de renovação confirmado
   */
  async renewSubscriptionAfterPayment(
    subscriptionId: string,
    mercadoPagoPaymentId: string
  ) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, usuario: true, addons: { where: { ativo: true } } }
    });

    if (!subscription) {
      throw new Error('Subscription não encontrada');
    }

    const now = new Date();
    const nextBilling = this.calculateNextBillingDate(now);

    // Atualizar data de próxima cobrança
    const renewed = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        nextBillingDate: nextBilling,
        mercadoPagoSubscriptionId: mercadoPagoPaymentId
      },
      include: { plan: true, usuario: true, addons: { where: { ativo: true }, include: { addon: true } } }
    });

    // Calcular pricing para email
    const pricing = await this.calculateTotalPrice(subscriptionId);

    // Enviar email de renovação
    try {
      if (renewed.nextBillingDate) {
        await emailService.sendSubscriptionRenewedEmail(
          renewed.usuario,
          renewed.plan,
          pricing,
          renewed.nextBillingDate
        );
      }
    } catch (error) {
      console.error('[Email] Erro ao enviar email de renovação:', error);
      // Não interromper fluxo se email falhar
    }

    console.log(`[Subscription] Subscription renovada: ${subscriptionId}, próxima cobrança: ${nextBilling.toISOString()}`);

    return renewed;
  }

  /**
   * Criar assinatura FREE automaticamente no signup
   * Plano FREE é permanente (sem trial, sem cobrança)
   */
  async createFreeSubscriptionForNewUser(usuarioId: string) {
    // Buscar plano FREE (preco = 0, ativo = true)
    const freePlan = await prisma.subscriptionPlan.findFirst({
      where: {
        preco: 0,
        ativo: true
      },
      orderBy: {
        ordem: 'asc'
      }
    });

    if (!freePlan) {
      throw new Error('Plano FREE não encontrado');
    }

    // Verificar se já tem assinatura
    const existing = await prisma.subscription.findFirst({
      where: { usuarioId }
    });

    if (existing) {
      console.warn(`[Subscription] Usuário ${usuarioId} já possui assinatura`);
      return existing;
    }

    // Criar assinatura FREE (sem trial, permanente)
    const subscription = await this.createSubscription({
      usuarioId,
      planId: freePlan.id,
      isTrial: false,
      isLifetime: false
    });

    console.log(`[Subscription] FREE plan criado para usuário ${usuarioId}`);
    return subscription;
  }
}

export const subscriptionService = new SubscriptionService();
