import sgMail from '@sendgrid/mail';
import { Usuario, SubscriptionPlan, Subscription } from '@prisma/client';

/**
 * EMAIL SERVICE
 * Gerencia envio de emails para usuários do sistema
 */

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  name?: string;
}

class EmailService {
  private readonly FROM_EMAIL = process.env.EMAIL_FROM || 'noreply@linax.com';
  private readonly FROM_NAME = 'LinaX';
  private readonly FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';

  constructor() {
    if (process.env.SENDGRID_API_KEY) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    }
  }

  /**
   * Enviar email genérico
   */
  private async sendEmail(options: EmailOptions): Promise<void> {
    if (!process.env.SENDGRID_API_KEY) {
      console.warn('⚠️  SENDGRID_API_KEY não configurada. Email não será enviado.');
      console.log(`[EMAIL SIMULADO] Para: ${options.to}`);
      console.log(`[EMAIL SIMULADO] Assunto: ${options.subject}`);
      return;
    }

    try {
      await sgMail.send({
        to: options.to,
        from: {
          email: this.FROM_EMAIL,
          name: this.FROM_NAME
        },
        subject: options.subject,
        html: options.html,
        replyTo: 'suporte@linax.com'
      });

      console.log(`✅ Email enviado para ${options.to}`);
    } catch (error: any) {
      console.error(`❌ Erro ao enviar email para ${options.to}:`, error.message);
      // Não lançar erro para não quebrar o fluxo principal
    }
  }

  /**
   * Trial iniciado com sucesso
   */
  async sendTrialStartedEmail(
    usuario: Usuario,
    plan: SubscriptionPlan,
    daysRemaining: number
  ): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; }
          .header { background: linear-gradient(135deg, #00BCD4 0%, #0097A7 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
          .highlight { color: #00BCD4; font-weight: bold; font-size: 24px; }
          .button { display: inline-block; background: #00BCD4; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .features { background: #f0f9ff; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #00BCD4; }
          .feature-item { margin: 10px 0; }
          .feature-item strong { color: #00BCD4; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
          .countdown { font-size: 32px; color: #f59e0b; font-weight: bold; text-align: center; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Bem-vindo ao LinaX!</h1>
            <p>Seu trial de 7 dias começou agora</p>
          </div>

          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <p>Sua assinatura no plano <span class="highlight">${plan.nome}</span> foi ativada com sucesso!</p>

            <div class="countdown">
              ⏰ ${daysRemaining} dias de acesso gratuito
            </div>

            <h2>O que você pode fazer agora:</h2>
            <div class="features">
              <div class="feature-item">✅ <strong>Criar empresas</strong> - Até ${plan.maxEmpresas} empresa(s)</div>
              <div class="feature-item">✅ <strong>Gerenciar clientes</strong> - Adicione seus clientes e veículos</div>
              <div class="feature-item">✅ <strong>Criar ordens de serviço</strong> - Organize seus serviços</div>
              <div class="feature-item">✅ <strong>Acompanhamento financeiro</strong> - Controle suas receitas</div>
              ${plan.maxAddons > 0 ? `<div class="feature-item">✅ <strong>Adicionar funcionalidades extras</strong> - Até ${plan.maxAddons} add-on(s)</div>` : ''}
            </div>

            <p style="text-align: center;">
              <a href="${this.FRONTEND_URL}/assinatura.html" class="button">Ver Minha Assinatura</a>
            </p>

            <h3>❓ Dúvidas?</h3>
            <p>Nosso time de suporte está disponível 24/7 em <strong>suporte@linax.com</strong></p>

            <p style="color: #666; font-style: italic;">
              ⚠️ Seu trial expira em <strong>${daysRemaining} dias</strong>. Você será notificado antes de expirar para evitar interrupção de serviço.
            </p>
          </div>

          <div class="footer">
            <p>© 2026 LinaX - Gestão Inteligente para seu Negócio</p>
            <p>
              <a href="${this.FRONTEND_URL}/assinatura.html" style="color: #00BCD4; text-decoration: none;">Minha Conta</a> •
              <a href="${this.FRONTEND_URL}" style="color: #00BCD4; text-decoration: none;">Home</a> •
              <a href="mailto:suporte@linax.com" style="color: #00BCD4; text-decoration: none;">Suporte</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `🎉 Seu trial de 7 dias começou! Plano ${plan.nome} - LinaX`,
      html
    });
  }

  /**
   * Trial expirando em 3 dias
   */
  async sendTrialExpiring3DaysEmail(usuario: Usuario, plan: SubscriptionPlan): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; }
          .header { background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
          .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 6px; }
          .button { display: inline-block; background: #00BCD4; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⏰ Seu Trial Expira em 3 Dias</h1>
            <p>Não deixe seu serviço ser interrompido</p>
          </div>

          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <p>Seu período de trial de 7 dias no plano <strong>${plan.nome}</strong> está chegando ao fim.</p>

            <div class="alert">
              <strong>⏳ 3 dias restantes</strong><br>
              Seu acesso às funcionalidades premium expirará em breve.
            </div>

            <h2>O que vai acontecer?</h2>
            <p>Quando seu trial expirar, você perderá acesso a:</p>
            <ul>
              <li>Criação de novas empresas</li>
              <li>Gestão de ordens de serviço</li>
              <li>Relatórios e análises</li>
              <li>Suporte prioritário</li>
            </ul>

            <h2>Planos Disponíveis</h2>
            <p>Escolha o melhor plano para seu negócio:</p>
            <ul>
              <li><strong>Basic</strong> - R$ 89/mês - 1 empresa</li>
              <li><strong>Pro</strong> - R$ 169/mês - 2 empresas + Painel Vitrine</li>
              <li><strong>Premium</strong> - R$ 279/mês - 5 empresas + WhatsApp Bot</li>
            </ul>

            <p style="text-align: center;">
              <a href="${this.FRONTEND_URL}/assinatura.html" class="button">Ativar Assinatura Agora</a>
            </p>

            <p style="color: #666;">
              💡 <strong>Dica:</strong> Se você contratar agora, receberá 2 meses de desconto!
            </p>
          </div>

          <div class="footer">
            <p>© 2026 LinaX - Gestão Inteligente para seu Negócio</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `⏰ Seu trial expira em 3 dias! Plano ${plan.nome} - LinaX`,
      html
    });
  }

  /**
   * Trial expirando em 1 dia
   */
  async sendTrialExpiring1DayEmail(usuario: Usuario, plan: SubscriptionPlan): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; }
          .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
          .urgent { background: #fee; border: 2px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 6px; text-align: center; }
          .urgent strong { color: #ef4444; font-size: 18px; }
          .button { display: inline-block; background: #ef4444; color: white; padding: 15px 40px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: bold; font-size: 16px; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚨 ATENÇÃO: Trial Expira AMANHÃ!</h1>
            <p>Agilize agora para não perder seu acesso</p>
          </div>

          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <div class="urgent">
              <strong>ÚLTIMO DIA DE ACESSO GRATUITO!</strong><br>
              Seu trial expira <strong>AMANHÃ</strong>
            </div>

            <p>Você está usando nosso serviço há 6 dias no plano <strong>${plan.nome}</strong>.</p>

            <p><strong>Se você não contratar agora:</strong></p>
            <ul>
              <li>❌ Perderá acesso a todas as funcionalidades</li>
              <li>❌ Seus clientes e ordens ficarão indisponíveis</li>
              <li>❌ Não conseguirá acessar o sistema amanhã</li>
            </ul>

            <h2>Ative sua Assinatura Agora!</h2>
            <p style="text-align: center;">
              <a href="${this.FRONTEND_URL}/assinatura.html" class="button">Contratar Plano Agora</a>
            </p>

            <p style="color: #666; text-align: center;">
              🎁 <strong>Promoção Especial:</strong> 1º mês com 50% de desconto!
            </p>

            <p style="color: #999; font-size: 14px;">
              Dúvidas? Entre em contato com nosso suporte em <strong>suporte@linax.com</strong>
            </p>
          </div>

          <div class="footer">
            <p>© 2026 LinaX - Gestão Inteligente para seu Negócio</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `🚨 URGENTE: Seu trial expira AMANHÃ! - LinaX`,
      html
    });
  }

  /**
   * Trial expirado
   */
  async sendTrialExpiredEmail(usuario: Usuario): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; }
          .header { background: #6b7280; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
          .message { background: #f3f4f6; padding: 20px; margin: 20px 0; border-radius: 6px; }
          .button { display: inline-block; background: #00BCD4; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>❌ Seu Trial Expirou</h1>
            <p>Mas você ainda pode ativar sua assinatura</p>
          </div>

          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <p>Seu período de trial de 7 dias chegou ao fim.</p>

            <div class="message">
              <strong>Seu acesso foi suspenso.</strong><br><br>
              Para continuar usando o LinaX, você precisa ativar uma assinatura paga. Seus dados estão seguros e você poderá acessá-los quando contratar.
            </div>

            <h2>Próximos Passos</h2>
            <ol>
              <li>Visite sua conta no LinaX</li>
              <li>Escolha um plano (Basic, Pro ou Premium)</li>
              <li>Comece a usar imediatamente</li>
            </ol>

            <p style="text-align: center;">
              <a href="${this.FRONTEND_URL}/assinatura.html" class="button">Ativar Assinatura</a>
            </p>

            <h2>Precisa de Ajuda?</h2>
            <p>
              Nossa equipe de suporte está disponível 24/7.<br>
              📧 Email: <strong>suporte@linax.com</strong><br>
              💬 Chat: Disponível no site
            </p>

            <p style="color: #666; font-size: 14px;">
              <strong>Boa notícia:</strong> Você pode ativar sua assinatura a qualquer momento. Seus dados não serão perdidos!
            </p>
          </div>

          <div class="footer">
            <p>© 2026 LinaX - Gestão Inteligente para seu Negócio</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `❌ Seu trial expirou - Ative sua assinatura agora - LinaX`,
      html
    });
  }

  /**
   * Assinatura ativada
   */
  async sendSubscriptionActivatedEmail(usuario: Usuario, plan: SubscriptionPlan): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
          .success { background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 6px; }
          .features { background: #f0fdf4; padding: 20px; border-radius: 6px; margin: 20px 0; }
          .feature { margin: 10px 0; }
          .button { display: inline-block; background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Assinatura Ativada!</h1>
            <p>Bem-vindo ao plano ${plan.nome}</p>
          </div>

          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <div class="success">
              <strong>✅ Sua assinatura no plano ${plan.nome} está ativa!</strong><br>
              Obrigado por escolher o LinaX!
            </div>

            <h2>Você agora tem acesso a:</h2>
            <div class="features">
              <div class="feature">✅ <strong>${plan.maxEmpresas}</strong> empresa(s)</div>
              <div class="feature">✅ Gestão completa de clientes</div>
              <div class="feature">✅ Criação de ordens de serviço</div>
              <div class="feature">✅ Controle financeiro</div>
              <div class="feature">✅ Suporte 24/7</div>
              ${plan.maxAddons > 0 ? `<div class="feature">✅ Até ${plan.maxAddons} add-on(s) disponível(is)</div>` : ''}
            </div>

            <h2>🚀 Comece Agora</h2>
            <p style="text-align: center;">
              <a href="${this.FRONTEND_URL}" class="button">Acessar seu Dashboard</a>
            </p>

            <h2>📋 Informações de Faturamento</h2>
            <ul>
              <li><strong>Plano:</strong> ${plan.nome}</li>
              <li><strong>Valor:</strong> R$ ${(plan.preco / 100).toFixed(2)}/mês</li>
              <li><strong>Renovação:</strong> Automática mensalmente</li>
              <li><strong>Cancelamento:</strong> Sem penalidades - cancele quando quiser</li>
            </ul>

            <p style="color: #666; font-size: 14px;">
              <strong>💡 Dica:</strong> Confira nossas dicas de uso no centro de ajuda para aproveitar ao máximo seu plano!
            </p>
          </div>

          <div class="footer">
            <p>© 2026 LinaX - Gestão Inteligente para seu Negócio</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `✅ Assinatura Ativada! Bem-vindo ao plano ${plan.nome} - LinaX`,
      html
    });
  }

  /**
   * Upgrade de plano
   */
  async sendPlanUpgradedEmail(usuario: Usuario, oldPlan: SubscriptionPlan, newPlan: SubscriptionPlan): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; }
          .header { background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
          .upgrade { background: #f3e8ff; border-left: 4px solid #8b5cf6; padding: 15px; margin: 20px 0; border-radius: 6px; }
          .comparison { background: #f9f9f9; padding: 15px; margin: 20px 0; border-radius: 6px; }
          .button { display: inline-block; background: #8b5cf6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Upgrade Realizado!</h1>
            <p>${oldPlan.nome} → ${newPlan.nome}</p>
          </div>

          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <div class="upgrade">
              <strong>✅ Seu upgrade foi processado com sucesso!</strong><br>
              Você agora está no plano <strong>${newPlan.nome}</strong>
            </div>

            <h2>Novos Benefícios</h2>
            <div class="comparison">
              <p><strong>Antes (${oldPlan.nome}):</strong> ${oldPlan.maxEmpresas} empresa(s)</p>
              <p><strong>Agora (${newPlan.nome}):</strong> ${newPlan.maxEmpresas} empresa(s)</p>
              <hr style="border: none; border-top: 1px solid #ddd; margin: 10px 0;">
              <p><strong>Add-ons disponíveis:</strong> ${newPlan.maxAddons}</p>
            </div>

            <h2>Próximos Passos</h2>
            <p>Aproveite seus novos recursos:</p>
            <ul>
              <li>Crie mais empresas (você pode ter até ${newPlan.maxEmpresas})</li>
              <li>Acesse funcionalidades premium</li>
              <li>Adicione add-ons para expandir funcionalidades</li>
            </ul>

            <p style="text-align: center;">
              <a href="${this.FRONTEND_URL}/assinatura.html" class="button">Ver Minha Assinatura</a>
            </p>

            <p style="color: #666; font-size: 14px;">
              <strong>Dúvidas sobre cobrança?</strong> O valor será ajustado proporcionalmente no seu próximo ciclo de faturamento.
            </p>
          </div>

          <div class="footer">
            <p>© 2026 LinaX - Gestão Inteligente para seu Negócio</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `🎉 Upgrade Realizado! Bem-vindo ao plano ${newPlan.nome} - LinaX`,
      html
    });
  }

  /**
   * Assinatura cancelada
   */
  async sendSubscriptionCanceledEmail(usuario: Usuario, plan: SubscriptionPlan): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; }
          .header { background: #6b7280; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
          .canceled { background: #f3f4f6; border-left: 4px solid #6b7280; padding: 15px; margin: 20px 0; border-radius: 6px; }
          .button { display: inline-block; background: #00BCD4; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Assinatura Cancelada</h1>
            <p>Sentiremos sua falta</p>
          </div>

          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <div class="canceled">
              <strong>Sua assinatura foi cancelada com sucesso.</strong><br>
              Você perderá acesso ao seu painel em <strong>30 dias</strong>.
            </div>

            <h2>O que Vai Acontecer?</h2>
            <ul>
              <li>✅ Seus dados serão preservados por 30 dias</li>
              <li>✅ Você pode reativar a qualquer momento sem perder nada</li>
              <li>❌ Acesso às funcionalidades premium será removido</li>
              <li>❌ Após 30 dias, seus dados serão apagados permanentemente</li>
            </ul>

            <h2>Quer Voltar?</h2>
            <p>Não é o fim! Você pode reativar sua assinatura a qualquer momento e voltar de onde parou.</p>

            <p style="text-align: center;">
              <a href="${this.FRONTEND_URL}/planos.html" class="button">Explorar Planos</a>
            </p>

            <h2>Seu Feedback é Importante</h2>
            <p>
              Adoraríamos saber por que você cancelou. Sua opinião nos ajuda a melhorar!<br>
              📧 Responda este email com seus comentários
            </p>

            <p style="color: #999; font-size: 14px;">
              <strong>Suporte:</strong> Se você estava tendo problemas, nossa equipe pode ajudar! Contate <strong>suporte@linax.com</strong>
            </p>
          </div>

          <div class="footer">
            <p>© 2026 LinaX - Gestão Inteligente para seu Negócio</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `Sua assinatura foi cancelada - LinaX`,
      html
    });
  }

  /**
   * Limite de empresas atingido
   */
  async sendCompanyLimitReachedEmail(usuario: Usuario, plan: SubscriptionPlan): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; }
          .header { background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
          .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 6px; }
          .button { display: inline-block; background: #f59e0b; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⚠️ Limite de Empresas Atingido</h1>
            <p>Você pode criar mais empresas com upgrade</p>
          </div>

          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <div class="alert">
              <strong>Você atingiu o limite de ${plan.maxEmpresas} empresa(s) do seu plano.</strong>
            </div>

            <h2>Opções Disponíveis</h2>

            <h3>1️⃣ Fazer Upgrade</h3>
            <p>Migre para um plano superior com mais empresas:</p>
            <ul>
              <li><strong>Pro:</strong> 2 empresas - R$ 169/mês</li>
              <li><strong>Premium:</strong> 5 empresas - R$ 279/mês</li>
            </ul>

            <h3>2️⃣ Gerenciar Empresas</h3>
            <p>Desative empresas que não está usando para liberar espaço.</p>

            <p style="text-align: center;">
              <a href="${this.FRONTEND_URL}/assinatura.html" class="button">Fazer Upgrade Agora</a>
            </p>

            <p style="color: #666; font-size: 14px;">
              <strong>Dúvidas?</strong> Nosso time está disponível em <strong>suporte@linax.com</strong>
            </p>
          </div>

          <div class="footer">
            <p>© 2026 LinaX - Gestão Inteligente para seu Negócio</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `⚠️ Limite de empresas atingido - Upgrade para continuar - LinaX`,
      html
    });
  }

  /**
   * Pagamento confirmado com sucesso
   */
  async sendPaymentSuccessEmail(
    usuario: Usuario,
    plan: SubscriptionPlan,
    paymentAmount: number,
    paymentMethod: string
  ): Promise<void> {
    const nextBillingDate = new Date();
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    const nextBillingFormatted = nextBillingDate.toLocaleDateString('pt-BR');

    const methodLabel = this.formatPaymentMethod(paymentMethod);
    const amountFormatted = (paymentAmount / 100).toFixed(2);

    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
          .success-box { background: #d1fae5; border-left: 4px solid #10b981; padding: 20px; border-radius: 6px; margin: 20px 0; }
          .success-box strong { color: #059669; font-size: 18px; }
          .details-table { width: 100%; margin: 20px 0; border-collapse: collapse; }
          .details-table tr { border-bottom: 1px solid #eee; }
          .details-table td { padding: 12px; }
          .details-table td:first-child { font-weight: bold; color: #666; width: 150px; }
          .details-table td:last-child { color: #333; }
          .button { display: inline-block; background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Pagamento Confirmado!</h1>
            <p>Sua assinatura foi ativada com sucesso</p>
          </div>

          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <div class="success-box">
              <strong>✅ Seu pagamento foi processado com sucesso!</strong><br>
              Sua assinatura no plano <strong>${plan.nome}</strong> agora está ativa.
            </div>

            <h2 style="color: #059669;">📋 Detalhes do Pagamento</h2>
            <table class="details-table">
              <tr>
                <td>Plano:</td>
                <td><strong>${plan.nome}</strong></td>
              </tr>
              <tr>
                <td>Valor:</td>
                <td><strong>R$ ${amountFormatted}</strong></td>
              </tr>
              <tr>
                <td>Método:</td>
                <td>${methodLabel}</td>
              </tr>
              <tr>
                <td>Próxima cobrança:</td>
                <td>${nextBillingFormatted}</td>
              </tr>
            </table>

            <h2 style="color: #059669;">🎯 Próximos Passos</h2>
            <p>Você pode agora:</p>
            <ul>
              <li>✅ Criar e gerenciar empresas</li>
              <li>✅ Usar todas as funcionalidades do plano</li>
              <li>✅ Acessar relatórios e análises</li>
            </ul>

            <p style="text-align: center; margin-top: 30px;">
              <a href="${this.FRONTEND_URL}/selecionar-empresa.html" class="button">Acessar Dashboard</a>
            </p>

            <p style="margin-top: 20px; color: #666; font-size: 14px;">
              Se tiver dúvidas ou precisar de suporte, responda este email ou acesse nossa central de ajuda.
            </p>

            <div class="footer">
              <p>© 2026 LinaX - Gestão Inteligente para seu Negócio</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `✅ Pagamento Confirmado - ${plan.nome} - LinaX`,
      html
    });
  }

  /**
   * Pagamento falhou
   */
  async sendPaymentFailedEmail(
    usuario: Usuario,
    plan: SubscriptionPlan,
    errorMessage?: string
  ): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px; }
          .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border-radius: 0 0 8px 8px; }
          .error-box { background: #fee2e2; border-left: 4px solid #ef4444; padding: 20px; border-radius: 6px; margin: 20px 0; }
          .error-box strong { color: #dc2626; font-size: 16px; }
          .button { display: inline-block; background: #ef4444; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>❌ Pagamento Não Processado</h1>
            <p>Não conseguimos processar seu pagamento</p>
          </div>

          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <div class="error-box">
              <strong>⚠️ Seu pagamento não foi aprovado.</strong><br>
              ${errorMessage ? `Motivo: ${errorMessage}` : 'Verifique os dados do seu cartão ou tente um outro método de pagamento.'}
            </div>

            <h2 style="color: #dc2626;">💡 O que você pode fazer?</h2>
            <ul>
              <li>🔄 <strong>Tentar novamente:</strong> Clique no botão abaixo para tentar pagar novamente</li>
              <li>💳 <strong>Usar outro cartão:</strong> Você pode usar um cartão de crédito, débito ou PIX</li>
              <li>📞 <strong>Contato:</strong> Se o problema persistir, nosso suporte está aqui para ajudar</li>
            </ul>

            <p style="text-align: center; margin: 30px 0;">
              <a href="${this.FRONTEND_URL}/planos.html" class="button">Tentar Novamente</a>
            </p>

            <p style="margin-top: 20px; color: #666; font-size: 14px;">
              <strong>📧 Precisa de ajuda?</strong><br>
              Responda este email com suas dúvidas ou entre em contato com suporte@linax.com
            </p>

            <div class="footer">
              <p>© 2026 LinaX - Gestão Inteligente para seu Negócio</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `❌ Pagamento Não Processado - LinaX`,
      html
    });
  }

  /**
   * Email: Add-on adicionado à assinatura
   * Notifica que será cobrado na próxima renovação
   */
  async sendAddonAddedEmail(
    usuario: Usuario,
    addonNome: string,
    addonPreco: number,
    nextBillingDate: Date
  ): Promise<void> {
    const nextBillingFormatted = nextBillingDate.toLocaleDateString('pt-BR');
    const precoFormatted = (addonPreco / 100).toFixed(2);

    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white; padding: 30px; text-align: center; border-radius: 8px; }
          .content { background: white; padding: 30px; }
          .addon-info { background: #f0f9ff; border-left: 4px solid #00bcd4;
                        padding: 15px; margin: 20px 0; border-radius: 6px; }
          .addon-info strong { color: #00bcd4; }
          .billing-info { background: #fef3c7; border-left: 4px solid #f59e0b;
                          padding: 15px; margin: 20px 0; border-radius: 6px; }
          .billing-info strong { color: #92400e; }
          .button { background: #667eea; color: white; padding: 12px 30px;
                    text-decoration: none; border-radius: 6px; display: inline-block;
                    margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎁 Add-on Adicionado!</h1>
          </div>
          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <p>Você adicionou um novo add-on à sua assinatura:</p>

            <div class="addon-info">
              <strong>📦 ${addonNome}</strong><br>
              Custo mensal: <strong>R$ ${precoFormatted}</strong>
            </div>

            <div class="billing-info">
              <strong>📅 Próxima Cobrança</strong><br>
              Este add-on será cobrado na sua próxima renovação em <strong>${nextBillingFormatted}</strong>.<br>
              O valor será adicionado à sua fatura mensal.
            </div>

            <p>Você pode remover este add-on a qualquer momento acessando suas configurações de assinatura.</p>

            <p style="text-align: center;">
              <a href="${this.FRONTEND_URL}/assinatura.html" class="button">Ver Minha Assinatura</a>
            </p>

            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #666; font-size: 14px;">
              Se tiver dúvidas, <a href="mailto:suporte@linax.com" style="color: #667eea; text-decoration: none;">contate nosso suporte</a>.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `🎁 Add-on ${addonNome} Adicionado - LinaX`,
      html
    });
  }

  /**
   * Email: Assinatura Renovada
   * Notifica que a assinatura foi renovada com sucesso
   */
  async sendSubscriptionRenewedEmail(
    usuario: Usuario,
    plan: SubscriptionPlan,
    pricing: {
      planPrice: number;
      addonsPrice: number;
      totalPrice: number;
      addons: Array<{ nome: string; preco: number }>;
    },
    nextBillingDate: Date
  ): Promise<void> {
    const nextBillingFormatted = nextBillingDate.toLocaleDateString('pt-BR');
    const planFormatted = (pricing.planPrice / 100).toFixed(2);
    const totalFormatted = (pricing.totalPrice / 100).toFixed(2);

    let addonsHtml = '';
    if (pricing.addonsPrice > 0) {
      const addonsFormatted = (pricing.addonsPrice / 100).toFixed(2);
      addonsHtml = `
        <tr style="border-top: 1px solid #e5e7eb;">
          <td style="padding: 12px 0; text-align: left;">Add-ons</td>
          <td style="padding: 12px 0; text-align: right; color: #f59e0b; font-weight: 600;">+ R$ ${addonsFormatted}</td>
        </tr>
      `;
    }

    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white; padding: 30px; text-align: center; border-radius: 8px; }
          .content { background: white; padding: 30px; }
          .success-badge { background: #d1fae5; border-left: 4px solid #10b981;
                           padding: 15px; margin: 20px 0; border-radius: 6px; }
          .pricing-table { width: 100%; margin: 20px 0; }
          .pricing-table td { padding: 12px 0; }
          .pricing-table .total { font-size: 1.2rem; font-weight: 700; border-top: 2px solid #00bcd4; }
          .button { background: #667eea; color: white; padding: 12px 30px;
                    text-decoration: none; border-radius: 6px; display: inline-block;
                    margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔄 Assinatura Renovada!</h1>
          </div>
          <div class="content">
            <p>Oi <strong>${usuario.nome}</strong>,</p>

            <div class="success-badge">
              <strong>✅ Sua assinatura foi renovada com sucesso!</strong><br>
              Próxima renovação em <strong>${nextBillingFormatted}</strong>
            </div>

            <h3 style="color: #333; margin-top: 30px; margin-bottom: 15px;">💰 Detalhes da Renovação</h3>

            <table class="pricing-table">
              <tr>
                <td style="text-align: left;"><strong>Plano ${plan.nome}</strong></td>
                <td style="text-align: right; font-weight: 600;">R$ ${planFormatted}</td>
              </tr>
              ${addonsHtml}
              <tr class="total">
                <td style="text-align: left;">Total Pago</td>
                <td style="text-align: right; color: #00bcd4;">R$ ${totalFormatted}</td>
              </tr>
            </table>

            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

            <p style="color: #666; font-size: 0.95rem;">
              Obrigado por continuar com a gente! Se tiver dúvidas sobre sua assinatura,
              <a href="mailto:suporte@linax.com" style="color: #667eea; text-decoration: none;">contate nosso suporte</a>.
            </p>

            <p style="text-align: center;">
              <a href="${this.FRONTEND_URL}/assinatura.html" class="button">Ver Minha Assinatura</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: usuario.email,
      subject: `🔄 Assinatura Renovada - Plano ${plan.nome} - LinaX`,
      html
    });
  }

  /**
   * Formatar método de pagamento para exibição
   */
  private formatPaymentMethod(method: string): string {
    const methods: { [key: string]: string } = {
      'credit_card': '💳 Cartão de Crédito',
      'debit_card': '💳 Cartão de Débito',
      'pix': '📱 PIX',
      'bank_transfer': '🏦 Transferência Bancária',
      'boleto': '📄 Boleto'
    };

    return methods[method] || method;
  }
}

// Exportar instância única (singleton)
export const emailService = new EmailService();
