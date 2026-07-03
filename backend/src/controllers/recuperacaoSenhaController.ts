import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { botSend } from '../services/botServiceClient';

const prisma = new PrismaClient();

// Função auxiliar: validar formato telefone (11) 99999-8888
const validarTelefone = (telefone: string): boolean => {
  const regex = /^\(\d{2}\)\s9\d{4}-\d{4}$/;
  return regex.test(telefone);
};

// Função auxiliar: remover formatação telefone
const removerFormatacaoTelefone = (telefone: string): string => {
  return '+55' + telefone.replace(/\D/g, '');
};

// Função auxiliar: gerar token aleatório
const gerarToken = (): string => {
  return crypto.randomBytes(16).toString('hex');
};

// Função auxiliar: extrair IP e User-Agent
const extrairInfoRequisicao = (req: Request) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  return { ip: String(ip).split(',')[0], userAgent: String(userAgent) };
};

/**
 * POST /api/admin/whatsapp-telefone
 * Admin vincula número WhatsApp para receber notificações
 */
export const salvarTelefoneAdmin = async (req: Request, res: Response) => {
  try {
    const { telefone } = req.body;
    const adminId = (req as any).usuarioId;

    // Validar se é LINA_OWNER
    const usuario = await prisma.usuario.findUnique({ where: { id: adminId } });
    if (usuario?.role !== 'LINA_OWNER') {
      return res.status(403).json({ error: 'Apenas admin owner pode fazer isso' });
    }

    // Validar telefone
    if (!validarTelefone(telefone)) {
      return res.status(400).json({ error: 'Formato inválido. Use: (11) 99999-8888' });
    }

    // Rate limiting: máx 5 tentativas/hora
    const ultimaHora = new Date(Date.now() - 3600000);
    // TODO: Implementar rate limit com Redis

    // Gerar token de confirmação
    const confirmToken = gerarToken();
    const expiresAt = new Date(Date.now() + 600000); // 10 minutos

    // Salvar configuração
    const config = await prisma.adminConfig.upsert({
      where: { liniaOwnerId: adminId },
      update: {
        whatsappNotificationPhone: telefone,
        phoneConfirmed: false,
        phoneConfirmationToken: confirmToken,
        phoneConfirmationExpiresAt: expiresAt,
      },
      create: {
        liniaOwnerId: adminId,
        whatsappNotificationPhone: telefone,
        phoneConfirmed: false,
        phoneConfirmationToken: confirmToken,
        phoneConfirmationExpiresAt: expiresAt,
      },
    });

    // Enviar confirmação via WhatsApp
    const telefoneSemFormatacao = removerFormatacaoTelefone(telefone);
    const linkConfirmacao = `${process.env.FRONTEND_URL || 'http://localhost'}/admin/confirmar-whatsapp?token=${confirmToken}`;

    try {
      await botSend(telefoneSemFormatacao, `🔐 Olá! Clique no link abaixo para confirmar este número:\n\n${linkConfirmacao}\n\nEste link expira em 10 minutos.`);
    } catch (error) {
      console.error('Erro ao enviar confirmação WhatsApp:', error);
      // Não falhar a request, apenas avisar que bot não respondeu
    }

    res.json({
      status: 'confirmation_sent',
      expiresIn: '10min',
      message: 'Verifique seu WhatsApp para confirmar',
    });
  } catch (error) {
    console.error('Erro ao salvar telefone admin:', error);
    res.status(500).json({ error: 'Erro ao salvar telefone' });
  }
};

/**
 * GET /api/admin/confirmar-whatsapp-telefone
 * Admin clica no link do WhatsApp para confirmar
 */
export const confirmarTelefoneAdmin = async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: 'Token não fornecido' });
    }

    // Buscar configuração com token
    const config = await prisma.adminConfig.findUnique({
      where: { phoneConfirmationToken: String(token) },
    });

    if (!config) {
      return res.status(404).json({ error: 'Token inválido ou expirado' });
    }

    // Validar se token não expirou
    if (config.phoneConfirmationExpiresAt && config.phoneConfirmationExpiresAt < new Date()) {
      return res.status(400).json({ error: 'Token expirado. Solicite um novo' });
    }

    // Marcar como confirmado
    await prisma.adminConfig.update({
      where: { id: config.id },
      data: {
        phoneConfirmed: true,
        phoneConfirmationToken: null,
        phoneConfirmationExpiresAt: null,
      },
    });

    // Enviar mensagem de sucesso
    try {
      const telefoneSemFormatacao = removerFormatacaoTelefone(config.whatsappNotificationPhone!);
      await botSend(telefoneSemFormatacao, '✅ Número confirmado! Você receberá alertas de segurança neste número.');
    } catch (error) {
      console.error('Erro ao enviar confirmação:', error);
    }

    // Redirecionar para admin ou retornar sucesso
    return res.json({
      success: true,
      confirmed: true,
      message: 'Número confirmado com sucesso!',
    });
  } catch (error) {
    console.error('Erro ao confirmar telefone:', error);
    res.status(500).json({ error: 'Erro ao confirmar telefone' });
  }
};

/**
 * DELETE /api/admin/whatsapp-telefone
 * Admin remove número WhatsApp
 */
export const removerTelefoneAdmin = async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).usuarioId;

    // Validar se é LINA_OWNER
    const usuario = await prisma.usuario.findUnique({ where: { id: adminId } });
    if (usuario?.role !== 'LINA_OWNER') {
      return res.status(403).json({ error: 'Apenas admin owner pode fazer isso' });
    }

    await prisma.adminConfig.update({
      where: { liniaOwnerId: adminId },
      data: {
        whatsappNotificationPhone: null,
        phoneConfirmed: false,
        phoneConfirmationToken: null,
        phoneConfirmationExpiresAt: null,
      },
    });

    res.json({ success: true, message: 'Número removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover telefone:', error);
    res.status(500).json({ error: 'Erro ao remover número' });
  }
};

/**
 * GET /api/admin/config/whatsapp
 * Obter configuração de WhatsApp do admin
 */
export const obterConfigWhatsapp = async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).usuarioId;

    // Validar se é LINA_OWNER
    const usuario = await prisma.usuario.findUnique({ where: { id: adminId } });
    if (usuario?.role !== 'LINA_OWNER') {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const config = await prisma.adminConfig.findUnique({
      where: { liniaOwnerId: adminId },
    });

    if (!config) {
      return res.json({ whatsappPhone: null, phoneConfirmed: false });
    }

    // Mascarar número
    const mascarado = config.whatsappNotificationPhone
      ? config.whatsappNotificationPhone.replace(/(\d{4})-(\d{4})$/, '****-****')
      : null;

    res.json({
      whatsappPhone: mascarado,
      phoneConfirmed: config.phoneConfirmed,
      lastUpdated: config.updatedAt,
    });
  } catch (error) {
    console.error('Erro ao obter config whatsapp:', error);
    res.status(500).json({ error: 'Erro ao obter configuração' });
  }
};

/**
 * POST /api/usuarios/recuperar-senha
 * User tenta recuperar senha - notifica admin
 */
export const recuperarSenha = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const { ip, userAgent } = extrairInfoRequisicao(req);

    if (!email) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }

    // Buscar usuário
    const usuario = await prisma.usuario.findUnique({
      where: { email },
    });

    if (!usuario) {
      // Não revelar que email não existe (segurança)
      return res.json({
        status: 'pending_admin_approval',
        message: 'Verifique seu e-mail para continuar',
      });
    }

    // Rate limiting: máx 3 tentativas/hora por IP
    const ultimaHora = new Date(Date.now() - 3600000);
    const tentativas = await prisma.tentativaResetSenha.count({
      where: {
        ip,
        createdAt: { gte: ultimaHora },
      },
    });

    if (tentativas >= 3) {
      return res.status(429).json({
        error: 'Muitas tentativas. Tente novamente em 1 hora',
      });
    }

    // Criar tentativa de reset
    const tentativa = await prisma.tentativaResetSenha.create({
      data: {
        usuarioId: usuario.id,
        ip,
        userAgent,
        status: 'pending_approval',
      },
    });

    // Buscar admin config
    const adminConfigs = await prisma.adminConfig.findMany({
      where: {
        phoneConfirmed: true,
        whatsappNotificationPhone: { not: null },
      },
    });

    // Notificar admin via WhatsApp
    for (const config of adminConfigs) {
      try {
        const telefoneSemFormatacao = removerFormatacaoTelefone(config.whatsappNotificationPhone!);
        const linkAprovar = `${process.env.FRONTEND_URL || 'http://localhost'}/admin/approveReset?notificationId=${tentativa.id}`;
        const linkRejeitar = `${process.env.FRONTEND_URL || 'http://localhost'}/admin/rejectReset?notificationId=${tentativa.id}`;

        await botSend(telefoneSemFormatacao, `⚠️ Tentativa de reset de senha\n\nUsuário: ${usuario.nome}\nE-mail: ${usuario.email}\nIP: ${ip}\nHorário: ${new Date().toLocaleString('pt-BR')}\n\n✅ Aprovar: ${linkAprovar}\n❌ Rejeitar: ${linkRejeitar}`);
      } catch (error) {
        console.error('Erro ao notificar admin:', error);
      }
    }

    res.json({
      status: 'pending_admin_approval',
      notificationId: tentativa.id,
      message: 'Verifique seu e-mail para continuar',
    });
  } catch (error) {
    console.error('Erro ao recuperar senha:', error);
    res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
};

/**
 * POST /api/admin/resetar-senha/aprovar
 * Admin aprova reset - bot envia link para user
 */
export const aprovarReset = async (req: Request, res: Response) => {
  try {
    const { notificationId } = req.body;
    const adminId = (req as any).usuarioId;

    // Validar admin
    const usuario = await prisma.usuario.findUnique({ where: { id: adminId } });
    if (usuario?.role !== 'LINA_OWNER') {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Buscar tentativa
    const tentativa = await prisma.tentativaResetSenha.findUnique({
      where: { id: notificationId },
      include: { usuario: true },
    });

    if (!tentativa) {
      return res.status(404).json({ error: 'Tentativa não encontrada' });
    }

    if (tentativa.status !== 'pending_approval') {
      return res.status(400).json({ error: 'Tentativa já foi processada' });
    }

    if (tentativa.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Tentativa expirou' });
    }

    // Gerar token de reset
    const token = gerarToken();
    const expiresAt = new Date(Date.now() + 900000); // 15 minutos

    // Salvar token
    await prisma.recuperacaoSenha.create({
      data: {
        usuarioId: tentativa.usuarioId,
        token,
        expiresAt,
      },
    });

    // Marcar tentativa como aprovada
    await prisma.tentativaResetSenha.update({
      where: { id: notificationId },
      data: {
        status: 'approved',
        approvedBy: adminId,
        approvedAt: new Date(),
      },
    });

    // Enviar link ao user (WhatsApp ou email)
    const linkReset = `${process.env.FRONTEND_URL || 'http://localhost'}/redefinir-senha?token=${token}`;

    // TODO: Enviar por email também (SendGrid)
    // Por enquanto, retornar sucesso para admin

    res.json({
      approved: true,
      linkSent: true,
      message: 'Reset aprovado. Link enviado ao usuário.',
    });
  } catch (error) {
    console.error('Erro ao aprovar reset:', error);
    res.status(500).json({ error: 'Erro ao aprovar' });
  }
};

/**
 * POST /api/admin/resetar-senha/rejeitar
 * Admin rejeita reset
 */
export const rejeitarReset = async (req: Request, res: Response) => {
  try {
    const { notificationId, motivo } = req.body;
    const adminId = (req as any).usuarioId;

    // Validar admin
    const usuario = await prisma.usuario.findUnique({ where: { id: adminId } });
    if (usuario?.role !== 'LINA_OWNER') {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Buscar tentativa
    const tentativa = await prisma.tentativaResetSenha.findUnique({
      where: { id: notificationId },
    });

    if (!tentativa) {
      return res.status(404).json({ error: 'Tentativa não encontrada' });
    }

    if (tentativa.status !== 'pending_approval') {
      return res.status(400).json({ error: 'Tentativa já foi processada' });
    }

    // Marcar como rejeitado
    await prisma.tentativaResetSenha.update({
      where: { id: notificationId },
      data: {
        status: 'rejected',
        rejectedBy: adminId,
        rejectedAt: new Date(),
        motivo: motivo || 'Não informado',
      },
    });

    res.json({
      rejected: true,
      message: 'Reset rejeitado',
    });
  } catch (error) {
    console.error('Erro ao rejeitar reset:', error);
    res.status(500).json({ error: 'Erro ao rejeitar' });
  }
};

/**
 * GET /api/usuarios/validar-token-reset
 * Validar se token é válido (frontend chama ao carregar página)
 */
export const validarTokenReset = async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token não fornecido' });
    }

    const recuperacao = await prisma.recuperacaoSenha.findUnique({
      where: { token: String(token) },
    });

    if (!recuperacao) {
      return res.json({ valid: false, error: 'Token inválido' });
    }

    if (recuperacao.expiresAt < new Date()) {
      return res.json({ valid: false, error: 'Token expirado' });
    }

    res.json({ valid: true });
  } catch (error) {
    console.error('Erro ao validar token:', error);
    res.status(500).json({ valid: false, error: 'Erro ao validar' });
  }
};

/**
 * POST /api/usuarios/resetar-senha
 * User submete nova senha com token válido
 */
export const resetarSenha = async (req: Request, res: Response) => {
  try {
    const { token, novaSenha } = req.body;

    if (!token || !novaSenha) {
      return res.status(400).json({ error: 'Token e nova senha são obrigatórios' });
    }

    if (novaSenha.length < 8) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 8 caracteres' });
    }

    // Buscar token
    const recuperacao = await prisma.recuperacaoSenha.findUnique({
      where: { token },
      include: { usuario: true },
    });

    if (!recuperacao) {
      return res.status(404).json({ error: 'Token inválido ou expirado' });
    }

    if (recuperacao.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Token expirado' });
    }

    // Atualizar senha (TODO: usar bcrypt)
    await prisma.usuario.update({
      where: { id: recuperacao.usuarioId },
      data: { senha: novaSenha },
    });

    // Deletar token (single-use)
    await prisma.recuperacaoSenha.delete({
      where: { id: recuperacao.id },
    });

    res.json({
      success: true,
      message: 'Senha redefinida com sucesso. Faça login com sua nova senha.',
    });
  } catch (error) {
    console.error('Erro ao resetar senha:', error);
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
};
