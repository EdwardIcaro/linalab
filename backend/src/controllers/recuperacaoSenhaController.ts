import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { botSend } from '../services/botServiceClient';
import { emailService } from '../services/emailService';

const prisma = new PrismaClient();

// Base do FRONT (Vercel) — Railway não serve as páginas estáticas
const frontendUrl = (): string => (process.env.FRONTEND_URL || 'http://localhost').replace(/\/$/, '');

// Função auxiliar: validar formato telefone (11) 99999-8888
const validarTelefone = (telefone: string): boolean => {
  const regex = /^\(\d{2}\)\s9\d{4}-\d{4}$/;
  return regex.test(telefone);
};

// Função auxiliar: remover formatação telefone → apenas dígitos com DDI 55.
// ⚠️ NÃO incluir '+': o JID do WhatsApp é `55DDDNUMERO@s.whatsapp.net` (sem '+').
// Com '+' o Baileys envia para um JID inválido e a mensagem cai no vácuo.
const removerFormatacaoTelefone = (telefone: string): string => {
  return '55' + telefone.replace(/\D/g, '');
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
    // ⚠️ FRONTEND_URL deve apontar para o domínio do FRONT (Vercel), não do backend
    // (Railway não serve arquivos estáticos). A página confirma o token via /api/*.
    const linkConfirmacao = `${process.env.FRONTEND_URL || 'http://localhost'}/admin/confirmar-whatsapp.html?token=${confirmToken}`;

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

    // Buscar usuário (e-mail sem diferenciar maiúsculas/espaços)
    const usuario = await prisma.usuario.findFirst({
      where: { email: { equals: String(email).trim(), mode: 'insensitive' } },
    });

    if (!usuario) {
      // Não revelar que email não existe (segurança)
      console.warn(`[recuperar-senha] e-mail não encontrado: ${String(email).trim()}`);
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

    if (adminConfigs.length === 0) {
      console.warn('[recuperar-senha] nenhum LINA_OWNER com WhatsApp confirmado — tentativa só aparece no painel admin');
    }

    // Notificar admin via WhatsApp — o link abre a página de revisão (exige login de owner)
    const linkRevisar = `${frontendUrl()}/admin/reset-senha.html?id=${tentativa.id}`;
    const horario = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    for (const config of adminConfigs) {
      try {
        const telefoneSemFormatacao = removerFormatacaoTelefone(config.whatsappNotificationPhone!);
        await botSend(telefoneSemFormatacao, `⚠️ Tentativa de reset de senha\n\nUsuário: ${usuario.nome}\nE-mail: ${usuario.email}\nIP: ${ip}\nHorário: ${horario}\n\nAprovar ou rejeitar: ${linkRevisar}\n(expira em 1 hora)`);
      } catch (error) {
        console.error('Erro ao notificar admin:', error);
      }
    }

    // Mesma resposta do e-mail inexistente (não revelar quais e-mails existem)
    res.json({
      status: 'pending_admin_approval',
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

    // Só o link mais recente vale — invalida tokens anteriores do mesmo usuário
    await prisma.recuperacaoSenha.deleteMany({ where: { usuarioId: tentativa.usuarioId } });

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

    const linkReset = `${frontendUrl()}/redefinir-senha?token=${token}`;

    // Usuario não tem telefone cadastrado → o canal direto é o e-mail (SendGrid).
    // O link também volta para o owner (resposta + WhatsApp) pra ele repassar
    // manualmente caso o e-mail não chegue.
    const emailConfigurado = !!process.env.SENDGRID_API_KEY;
    await emailService.sendPasswordResetEmail(tentativa.usuario, linkReset);

    let whatsappOwner = false;
    const adminConfig = await prisma.adminConfig.findUnique({ where: { liniaOwnerId: adminId } });
    if (adminConfig?.phoneConfirmed && adminConfig.whatsappNotificationPhone) {
      try {
        await botSend(
          removerFormatacaoTelefone(adminConfig.whatsappNotificationPhone),
          `✅ Reset aprovado para ${tentativa.usuario.nome} (${tentativa.usuario.email}).\n\nSe o e-mail não chegar, repasse este link (expira em 15 min, uso único):\n${linkReset}`
        );
        whatsappOwner = true;
      } catch (error) {
        console.error('Erro ao enviar link ao owner via WhatsApp:', error);
      }
    }

    res.json({
      approved: true,
      emailEnviado: emailConfigurado,
      whatsappOwner,
      linkReset,
      expiresAt,
      message: emailConfigurado
        ? `Reset aprovado. Link enviado para ${tentativa.usuario.email}.`
        : 'Reset aprovado, mas o e-mail não está configurado (SENDGRID_API_KEY). Repasse o link manualmente.',
    });
  } catch (error) {
    console.error('Erro ao aprovar reset:', error);
    res.status(500).json({ error: 'Erro ao aprovar' });
  }
};

/**
 * GET /api/admin/resetar-senha/tentativas
 * Lista as tentativas recentes (pendentes primeiro) pra página de revisão do owner
 */
export const listarTentativasReset = async (req: Request, res: Response) => {
  try {
    const adminId = (req as any).usuarioId;
    const usuario = await prisma.usuario.findUnique({ where: { id: adminId } });
    if (usuario?.role !== 'LINA_OWNER') {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const tentativas = await prisma.tentativaResetSenha.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { usuario: { select: { nome: true, email: true } } },
    });

    const agora = new Date();
    res.json(tentativas.map(t => ({
      id: t.id,
      usuarioNome: t.usuario.nome,
      usuarioEmail: t.usuario.email,
      ip: t.ip,
      userAgent: t.userAgent,
      // Pendente vencida aparece como "expired" (o banco não atualiza sozinho)
      status: t.status === 'pending_approval' && t.expiresAt < agora ? 'expired' : t.status,
      motivo: t.motivo,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      approvedAt: t.approvedAt,
      rejectedAt: t.rejectedAt,
    })));
  } catch (error) {
    console.error('Erro ao listar tentativas de reset:', error);
    res.status(500).json({ error: 'Erro ao listar tentativas' });
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

    // Hash igual ao cadastro/alterar senha — o login usa bcrypt.compare, então
    // gravar texto puro deixava a senha nova impossível de usar.
    const senhaHash = await bcrypt.hash(novaSenha, 12);
    await prisma.usuario.update({
      where: { id: recuperacao.usuarioId },
      data: { senha: senhaHash },
    });

    // Single-use: apaga este e qualquer outro token pendente do usuário
    await prisma.recuperacaoSenha.deleteMany({
      where: { usuarioId: recuperacao.usuarioId },
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
