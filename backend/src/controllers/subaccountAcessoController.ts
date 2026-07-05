import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { clearAuthCache } from '../middlewares/authMiddleware';

/**
 * Multi-empresa para Subaccounts.
 *
 * - Subaccount (funcionário): lista suas empresas e troca de contexto (novo JWT).
 * - OWNER (via hub): concede/revoga acesso de um subaccount a outras empresas suas.
 *
 * A empresa/role PRIMÁRIA fica em Subaccount.empresaId/roleId. Os acessos ADICIONAIS
 * ficam em subaccount_empresa_acessos (cada um com seu próprio role/empresa).
 */

// ─── Subaccount logado ────────────────────────────────────────────────────────

/**
 * GET /api/subaccount/me/empresas
 * Lista as empresas que o subaccount logado pode acessar (primária + adicionais).
 */
export const getMinhasEmpresas = async (req: Request, res: Response) => {
  const subaccountId = (req as any).usuarioId as string;

  try {
    const sub = await prisma.subaccount.findUnique({
      where: { id: subaccountId },
      include: {
        empresa: { select: { id: true, nome: true, ativo: true } },
        roleInt: { select: { id: true, nome: true, permissoes: { select: { name: true } } } },
        empresaAcessos: {
          include: {
            empresa: { select: { id: true, nome: true, ativo: true } },
            role: { select: { id: true, nome: true, permissoes: { select: { name: true } } } },
          },
        },
      },
    });

    if (!sub) return res.status(404).json({ error: 'Funcionário não encontrado' });

    const lista: Array<{ id: string; nome: string; isPrimary: boolean; role: { id: string; nome: string; permissoes: string[] } }> = [];

    if (sub.empresa?.ativo) {
      lista.push({
        id: sub.empresa.id,
        nome: sub.empresa.nome,
        isPrimary: true,
        role: { id: sub.roleInt.id, nome: sub.roleInt.nome, permissoes: sub.roleInt.permissoes.map(p => p.name) },
      });
    }
    for (const a of sub.empresaAcessos) {
      if (a.empresa?.ativo) {
        lista.push({
          id: a.empresa.id,
          nome: a.empresa.nome,
          isPrimary: false,
          role: { id: a.role.id, nome: a.role.nome, permissoes: a.role.permissoes.map(p => p.name) },
        });
      }
    }

    lista.sort((x, y) => x.nome.localeCompare(y.nome));
    return res.json(lista);
  } catch (error) {
    console.error('[SubaccountAcesso] getMinhasEmpresas:', error);
    return res.status(500).json({ error: 'Erro ao listar empresas' });
  }
};

/**
 * POST /api/subaccount/switch-empresa  { empresaId }
 * Emite um novo JWT com o escopo da empresa escolhida e devolve as permissões
 * do role naquele contexto (o role varia por empresa).
 */
export const switchEmpresa = async (req: Request, res: Response) => {
  const subaccountId = (req as any).usuarioId as string;
  const { empresaId } = req.body;

  if (!empresaId) return res.status(400).json({ error: 'empresaId é obrigatório' });
  if (!process.env.JWT_SECRET) {
    console.error('[SubaccountAcesso] JWT_SECRET não configurado');
    return res.status(500).json({ error: 'Erro de configuração do servidor' });
  }

  try {
    const sub = await prisma.subaccount.findUnique({
      where: { id: subaccountId },
      include: { roleInt: { include: { permissoes: true } } },
    });
    if (!sub) return res.status(404).json({ error: 'Funcionário não encontrado' });

    // Resolve o role do contexto: primária ou acesso adicional
    let roleCtx: { id: string; nome: string; permissoes: { name: string }[] } | null = null;
    if (sub.empresaId === empresaId) {
      roleCtx = sub.roleInt;
    } else {
      const acesso = await prisma.subaccountEmpresaAcesso.findUnique({
        where: { subaccountId_empresaId: { subaccountId, empresaId } },
        include: { role: { include: { permissoes: true } } },
      });
      if (acesso) roleCtx = acesso.role;
    }

    if (!roleCtx) return res.status(403).json({ error: 'Você não tem acesso a esta empresa' });

    const empresa = await prisma.empresa.findFirst({
      where: { id: empresaId, ativo: true },
      select: { id: true, nome: true },
    });
    if (!empresa) return res.status(403).json({ error: 'Empresa indisponível' });

    const token = jwt.sign(
      { id: sub.id, subaccountId: sub.id, nome: sub.nome, empresaId: empresa.id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' },
    );

    return res.json({
      token,
      empresa,
      role: { id: roleCtx.id, nome: roleCtx.nome, permissoes: roleCtx.permissoes.map(p => p.name) },
    });
  } catch (error) {
    console.error('[SubaccountAcesso] switchEmpresa:', error);
    return res.status(500).json({ error: 'Erro ao trocar de empresa' });
  }
};

// ─── OWNER (hub) ──────────────────────────────────────────────────────────────

/**
 * GET /api/hub/subaccounts-todos
 * Lista todos os subaccounts das empresas do OWNER, com seus acessos atuais,
 * e a lista de empresas do OWNER (para montar os badges de conceder/revogar).
 */
export const getSubaccountsComAcessos = async (req: Request, res: Response) => {
  const usuarioId = (req as any).usuarioId as string;

  try {
    const empresas = await prisma.empresa.findMany({
      where: { usuarioId },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
    const empresaIds = empresas.map(e => e.id);
    if (empresaIds.length === 0) return res.json({ empresas: [], subaccounts: [] });

    // Subaccounts cuja empresa PRIMÁRIA pertence ao OWNER
    const subaccounts = await prisma.subaccount.findMany({
      where: { empresaId: { in: empresaIds } },
      select: {
        id: true, nome: true, email: true, empresaId: true, roleId: true,
        roleInt: { select: { id: true, nome: true } },
        empresaAcessos: {
          select: { empresaId: true, roleId: true, role: { select: { id: true, nome: true } } },
        },
      },
      orderBy: { nome: 'asc' },
    });

    const result = subaccounts.map(s => ({
      id: s.id,
      nome: s.nome,
      email: s.email,
      empresaPrimariaId: s.empresaId,
      acessos: [
        { empresaId: s.empresaId, isPrimary: true, roleId: s.roleId, roleNome: s.roleInt?.nome ?? null },
        ...s.empresaAcessos.map(a => ({ empresaId: a.empresaId, isPrimary: false, roleId: a.roleId, roleNome: a.role?.nome ?? null })),
      ],
    }));

    return res.json({ empresas, subaccounts: result });
  } catch (error) {
    console.error('[SubaccountAcesso] getSubaccountsComAcessos:', error);
    return res.status(500).json({ error: 'Erro ao listar funcionários' });
  }
};

/**
 * GET /api/hub/empresas/:empresaId/roles
 * Lista os cargos (roles) de uma empresa do OWNER — para escolher a função ao conceder acesso.
 */
export const getRolesDaEmpresa = async (req: Request, res: Response) => {
  const usuarioId = (req as any).usuarioId as string;
  const empresaId = req.params.empresaId as string;

  try {
    const empresa = await prisma.empresa.findFirst({ where: { id: empresaId, usuarioId }, select: { id: true } });
    if (!empresa) return res.status(403).json({ error: 'Empresa não pertence a você' });

    const roles = await prisma.role.findMany({
      where: { empresaId },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
    return res.json(roles);
  } catch (error) {
    console.error('[SubaccountAcesso] getRolesDaEmpresa:', error);
    return res.status(500).json({ error: 'Erro ao listar cargos' });
  }
};

/**
 * POST /api/hub/subaccounts/:subaccountId/acessos  { empresaId, roleId }
 * OWNER concede a um subaccount acesso a outra empresa sua, com um role dessa empresa.
 */
export const concederAcesso = async (req: Request, res: Response) => {
  const usuarioId = (req as any).usuarioId as string;
  const subaccountId = req.params.subaccountId as string;
  const { empresaId, roleId } = req.body;

  if (!empresaId || !roleId) return res.status(400).json({ error: 'empresaId e roleId são obrigatórios' });

  try {
    // Empresa alvo pertence ao OWNER?
    const empresa = await prisma.empresa.findFirst({ where: { id: empresaId, usuarioId }, select: { id: true } });
    if (!empresa) return res.status(403).json({ error: 'Empresa não pertence a você' });

    // Subaccount pertence a uma empresa do OWNER?
    const sub = await prisma.subaccount.findUnique({
      where: { id: subaccountId },
      include: { empresa: { select: { usuarioId: true } } },
    });
    if (!sub || sub.empresa.usuarioId !== usuarioId) {
      return res.status(403).json({ error: 'Funcionário não pertence a você' });
    }

    if (sub.empresaId === empresaId) {
      return res.status(400).json({ error: 'Esta já é a empresa principal do funcionário' });
    }

    // Role pertence à empresa alvo?
    const role = await prisma.role.findFirst({ where: { id: roleId, empresaId }, select: { id: true } });
    if (!role) return res.status(400).json({ error: 'Função inválida para esta empresa' });

    const acesso = await prisma.subaccountEmpresaAcesso.create({
      data: { subaccountId, empresaId, roleId },
    });

    clearAuthCache(empresaId);
    return res.status(201).json(acesso);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'Funcionário já tem acesso a esta empresa' });
    }
    console.error('[SubaccountAcesso] concederAcesso:', error);
    return res.status(500).json({ error: 'Erro ao conceder acesso' });
  }
};

/**
 * DELETE /api/hub/subaccounts/:subaccountId/acessos/:empresaId
 * OWNER revoga o acesso adicional de um subaccount a uma empresa (nunca a primária).
 */
export const revogarAcesso = async (req: Request, res: Response) => {
  const usuarioId = (req as any).usuarioId as string;
  const subaccountId = req.params.subaccountId as string;
  const empresaId = req.params.empresaId as string;

  try {
    const empresa = await prisma.empresa.findFirst({ where: { id: empresaId, usuarioId }, select: { id: true } });
    if (!empresa) return res.status(403).json({ error: 'Empresa não pertence a você' });

    const sub = await prisma.subaccount.findUnique({ where: { id: subaccountId }, select: { empresaId: true } });
    if (!sub) return res.status(404).json({ error: 'Funcionário não encontrado' });

    if (sub.empresaId === empresaId) {
      return res.status(400).json({ error: 'Não é possível remover a empresa principal do funcionário' });
    }

    await prisma.subaccountEmpresaAcesso.deleteMany({ where: { subaccountId, empresaId } });
    clearAuthCache(empresaId);
    return res.json({ success: true });
  } catch (error) {
    console.error('[SubaccountAcesso] revogarAcesso:', error);
    return res.status(500).json({ error: 'Erro ao revogar acesso' });
  }
};
