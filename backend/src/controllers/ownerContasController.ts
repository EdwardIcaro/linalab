import { Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { clearAuthCache } from '../middlewares/authMiddleware';

/**
 * PAINEL OWNER — CONTAS
 * Tudo aqui passa pelo adminMiddleware (LINA_OWNER). Autorizado pelo dono do
 * sistema em 07/10/2026: trocar senha direto, gerar link de reset e entrar como
 * a conta. Cada ação sensível vai para o log com o prefixo [owner-audit].
 */

// Sistemas que vivem em empresa_sistemas. Lina Wash é implícito: toda empresa
// sem Lina Center ativo conta como Lina Wash (mesma regra do subscriptionService).
const SISTEMAS_OPCIONAIS = ['data-point', 'lina-center', 'lina-forge'];

const frontendUrl = (): string => (process.env.FRONTEND_URL || 'http://localhost').replace(/\/$/, '');

const auditar = (req: Request, acao: string, alvo: string, extra?: Record<string, unknown>) => {
  console.log('[owner-audit]', JSON.stringify({
    quando: new Date().toISOString(),
    owner: (req as any).usuarioId,
    acao,
    alvo,
    ...extra,
  }));
};

const sistemasDaEmpresa = (sistemasAtivos: { sistema: string; ativo: boolean }[]): string[] => {
  const ativos = sistemasAtivos.filter(s => s.ativo).map(s => s.sistema);
  return ativos.includes('lina-center') ? ativos : ['lina-wash', ...ativos];
};

// Uma assinatura "corrente" por sistema: a mais recente de cada um
const assinaturaPorSistema = <T extends { plan: { sistema: string }; createdAt: Date }>(subs: T[]): T[] => {
  const mapa = new Map<string, T>();
  for (const s of [...subs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    if (!mapa.has(s.plan.sistema)) mapa.set(s.plan.sistema, s);
  }
  return [...mapa.values()];
};

const vencimento = (s: { status: string; trialEndDate: Date | null; nextBillingDate: Date | null; endDate: Date | null }) =>
  s.status === 'TRIAL' ? s.trialEndDate : (s.nextBillingDate || s.endDate);

const incluirConta = {
  empresas: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true, nome: true, ativo: true, createdAt: true,
      sistemasAtivos: { select: { sistema: true, ativo: true } },
      _count: { select: { subaccounts: true } },
    },
  },
  subscriptions: {
    select: {
      id: true, status: true, preco: true, createdAt: true, startDate: true,
      trialEndDate: true, nextBillingDate: true, endDate: true, canceledAt: true,
      plan: { select: { id: true, nome: true, sistema: true } },
    },
  },
};

type ContaComRelacoes = Awaited<ReturnType<typeof buscarConta>>;
const buscarConta = (id: string) => prisma.usuario.findUnique({ where: { id }, include: incluirConta });

const formatarConta = (u: NonNullable<ContaComRelacoes>) => ({
  id: u.id,
  nome: u.nome,
  email: u.email,
  role: u.role,
  criadoEm: u.createdAt,
  empresas: u.empresas.map(e => ({
    id: e.id,
    nome: e.nome,
    ativa: e.ativo,
    criadaEm: e.createdAt,
    sistemas: sistemasDaEmpresa(e.sistemasAtivos),
    subcontas: e._count.subaccounts,
  })),
  assinaturas: assinaturaPorSistema(u.subscriptions).map(s => ({
    id: s.id,
    sistema: s.plan.sistema,
    plano: s.plan.nome,
    planoId: s.plan.id,
    status: s.status,
    preco: s.preco,
    vence: vencimento(s),
    inicio: s.startDate,
    canceladaEm: s.canceledAt,
  })),
});

/**
 * GET /api/admin/contas
 * Todas as contas de dono (exceto LINA_OWNER), com empresas e assinatura por sistema
 */
export const listarContas = async (_req: Request, res: Response) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { role: { not: 'LINA_OWNER' } },
      orderBy: { createdAt: 'desc' },
      include: incluirConta,
    });
    res.json(usuarios.map(formatarConta));
  } catch (error) {
    console.error('Erro ao listar contas:', error);
    res.status(500).json({ error: 'Erro ao listar contas' });
  }
};

/**
 * GET /api/admin/contas/:id
 * Conta + linha do tempo montada com o que o banco já registra
 */
export const detalharConta = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const usuario = await buscarConta(id);
    if (!usuario) return res.status(404).json({ error: 'Conta não encontrada' });

    const resets = await prisma.tentativaResetSenha.findMany({
      where: { usuarioId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { status: true, createdAt: true },
    });

    const eventos: { quando: Date; texto: string }[] = [
      { quando: usuario.createdAt, texto: 'Conta criada' },
      ...usuario.empresas.map(e => ({ quando: e.createdAt, texto: `Empresa "${e.nome}" criada` })),
      ...usuario.subscriptions.map(s => ({ quando: s.createdAt, texto: `Assinatura ${s.plan.nome} (${s.status === 'TRIAL' ? 'trial' : s.status.toLowerCase()})` })),
      ...usuario.subscriptions.filter(s => s.canceledAt).map(s => ({ quando: s.canceledAt as Date, texto: `Assinatura ${s.plan.nome} cancelada` })),
      ...resets.map(r => ({ quando: r.createdAt, texto: `Pediu nova senha (${r.status === 'approved' ? 'aprovado' : r.status === 'rejected' ? 'rejeitado' : 'pendente'})` })),
    ].sort((a, b) => b.quando.getTime() - a.quando.getTime());

    res.json({ ...formatarConta(usuario), eventos });
  } catch (error) {
    console.error('Erro ao detalhar conta:', error);
    res.status(500).json({ error: 'Erro ao carregar conta' });
  }
};

/**
 * PATCH /api/admin/usuarios/:id
 * Owner altera login, e-mail e/ou senha de qualquer conta, sem confirmação
 */
export const atualizarCredenciais = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { nome, email, novaSenha } = req.body || {};
    const data: { nome?: string; email?: string; senha?: string } = {};

    if (nome !== undefined) {
      if (!String(nome).trim()) return res.status(400).json({ error: 'O nome de usuário não pode ficar vazio' });
      data.nome = String(nome).trim();
    }
    if (email !== undefined) {
      if (!/^\S+@\S+\.\S+$/.test(String(email).trim())) return res.status(400).json({ error: 'E-mail inválido' });
      data.email = String(email).trim();
    }
    if (novaSenha) {
      if (String(novaSenha).length < 6) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 6 caracteres' });
      // Mesmo hash do cadastro — o login usa bcrypt.compare
      data.senha = await bcrypt.hash(String(novaSenha), 12);
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nada para atualizar' });

    const alvo = await prisma.usuario.findUnique({ where: { id }, select: { role: true } });
    if (!alvo) return res.status(404).json({ error: 'Conta não encontrada' });
    if (alvo.role === 'LINA_OWNER' && id !== (req as any).usuarioId) {
      return res.status(403).json({ error: 'Não é possível alterar outra conta LINA_OWNER por aqui' });
    }

    const usuario = await prisma.usuario.update({ where: { id }, data, select: { id: true, nome: true, email: true } });

    // Senha nova → links de redefinição pendentes deixam de valer
    if (data.senha) await prisma.recuperacaoSenha.deleteMany({ where: { usuarioId: id } });

    auditar(req, data.senha ? 'trocar_senha' : 'editar_acesso', id, { campos: Object.keys(data) });
    res.json({ message: data.senha ? 'Senha trocada' : 'Dados de acesso salvos', usuario });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const campo = String(error?.meta?.target || '').includes('email') ? 'e-mail' : 'nome de usuário';
      return res.status(409).json({ error: `Já existe outra conta com esse ${campo}` });
    }
    console.error('Erro ao atualizar credenciais:', error);
    res.status(500).json({ error: 'Erro ao atualizar credenciais' });
  }
};

/**
 * POST /api/admin/usuarios/:id/link-reset
 * Gera na hora um link de redefinição (15 min, uso único) para o owner repassar
 */
export const gerarLinkReset = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const usuario = await prisma.usuario.findUnique({ where: { id }, select: { id: true } });
    if (!usuario) return res.status(404).json({ error: 'Conta não encontrada' });

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.$transaction([
      prisma.recuperacaoSenha.deleteMany({ where: { usuarioId: id } }),
      prisma.recuperacaoSenha.create({ data: { usuarioId: id, token, expiresAt } }),
    ]);

    auditar(req, 'gerar_link_reset', id);
    res.json({ link: `${frontendUrl()}/redefinir-senha?token=${token}`, expiresAt });
  } catch (error) {
    console.error('Erro ao gerar link de reset:', error);
    res.status(500).json({ error: 'Erro ao gerar link' });
  }
};

/**
 * POST /api/admin/impersonate/:id
 * Token base da conta (igual ao do login), curto e marcado com quem entrou
 */
export const impersonarConta = async (req: Request, res: Response) => {
  try {
    if (!process.env.JWT_SECRET) return res.status(500).json({ error: 'Erro de configuração do servidor' });

    const id = req.params.id as string;
    const usuario = await prisma.usuario.findUnique({
      where: { id },
      select: { id: true, nome: true, role: true, empresas: { select: { id: true } } },
    });
    if (!usuario) return res.status(404).json({ error: 'Conta não encontrada' });
    if (usuario.role === 'LINA_OWNER') return res.status(400).json({ error: 'Não dá para entrar como outra conta LINA_OWNER' });

    const token = jwt.sign(
      { id: usuario.id, nome: usuario.nome, role: usuario.role, impersonadoPor: (req as any).usuarioId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    auditar(req, 'entrar_como', id);
    res.json({
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        // Mesma regra do login.html: dono com empresa vira OWNER no front
        role: usuario.empresas.length > 0 ? 'OWNER' : usuario.role,
        temEmpresas: usuario.empresas.length > 0,
      },
    });
  } catch (error) {
    console.error('Erro ao entrar como conta:', error);
    res.status(500).json({ error: 'Erro ao entrar como a conta' });
  }
};

/**
 * PATCH /api/admin/empresas/:id
 * Renomeia qualquer empresa
 */
export const renomearEmpresa = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const nome = String(req.body?.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'O nome da empresa é obrigatório' });

    const empresa = await prisma.empresa.update({ where: { id }, data: { nome }, select: { id: true, nome: true } });
    clearAuthCache(id);
    auditar(req, 'renomear_empresa', id, { nome });
    res.json({ message: 'Nome da empresa salvo', empresa });
  } catch (error: any) {
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Empresa não encontrada' });
    console.error('Erro ao renomear empresa:', error);
    res.status(500).json({ error: 'Erro ao renomear empresa' });
  }
};

/**
 * PUT /api/admin/empresas/:id/sistemas/:sistema   body: { ativo: boolean }
 * Libera ou bloqueia um sistema opcional para a empresa
 */
export const definirSistemaEmpresa = async (req: Request, res: Response) => {
  try {
    const empresaId = req.params.id as string;
    const sistema = req.params.sistema as string;
    const ativo = req.body?.ativo === true;

    if (!SISTEMAS_OPCIONAIS.includes(sistema)) {
      return res.status(400).json({ error: `Sistema inválido. Use: ${SISTEMAS_OPCIONAIS.join(', ')}` });
    }
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true } });
    if (!empresa) return res.status(404).json({ error: 'Empresa não encontrada' });

    await prisma.empresaSistema.upsert({
      where: { empresaId_sistema: { empresaId, sistema } },
      update: { ativo },
      create: { empresaId, sistema, ativo },
    });
    clearAuthCache(empresaId);
    auditar(req, ativo ? 'liberar_sistema' : 'bloquear_sistema', empresaId, { sistema });
    res.json({ message: ativo ? 'Sistema liberado' : 'Sistema bloqueado' });
  } catch (error) {
    console.error('Erro ao alterar sistema da empresa:', error);
    res.status(500).json({ error: 'Erro ao alterar sistema' });
  }
};

/**
 * POST /api/admin/contas/assinaturas/:id/estender   body: { dias }
 * Estende o campo certo de vencimento (trial → trialEndDate; demais →
 * nextBillingDate) a partir de hoje ou do vencimento atual, o que for maior.
 * Expirada/em atraso volta a ficar ativa.
 */
export const estenderAssinatura = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const dias = Number(req.body?.dias);
    if (!Number.isInteger(dias) || dias <= 0 || dias > 3650) {
      return res.status(400).json({ error: 'Informe um número de dias entre 1 e 3650' });
    }

    const sub = await prisma.subscription.findUnique({ where: { id } });
    if (!sub) return res.status(404).json({ error: 'Assinatura não encontrada' });
    if (sub.status === 'LIFETIME') return res.status(400).json({ error: 'Assinatura vitalícia não vence' });

    const agora = new Date();
    const atual = sub.status === 'TRIAL' ? sub.trialEndDate : sub.nextBillingDate;
    const base = atual && atual > agora ? atual : agora;
    const novoFim = new Date(base.getTime() + dias * 24 * 60 * 60 * 1000);

    const data = sub.status === 'TRIAL'
      ? { trialEndDate: novoFim }
      : {
          nextBillingDate: novoFim,
          ...(['EXPIRED', 'PAST_DUE', 'SUSPENDED', 'CANCELED'].includes(sub.status) && { status: 'ACTIVE' as const, canceledAt: null }),
        };

    await prisma.subscription.update({ where: { id }, data });
    auditar(req, 'estender_assinatura', id, { dias, novoFim: novoFim.toISOString() });
    res.json({ message: `Assinatura estendida até ${novoFim.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, vence: novoFim });
  } catch (error) {
    console.error('Erro ao estender assinatura:', error);
    res.status(500).json({ error: 'Erro ao estender assinatura' });
  }
};
