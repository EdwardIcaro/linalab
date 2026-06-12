import { Request, Response } from 'express';
import prisma from '../db';
import { botGeneratePin, botGetPin, botCancelPin } from '../services/botServiceClient';

interface AuthReq extends Request {
  empresaId?: string;
  subaccountId?: string;
}

const db = prisma as any;
const VALID_ROLES = ['LAVADOR', 'CAIXA', 'FINANCEIRO'];

// GET /api/whatsapp/bot-users
// Retorna lista unificada: usuários do bot já conectados + lavadores/funcionários
// que podem se conectar (a partir dos cadastros existentes).
export async function listBotUsers(req: AuthReq, res: Response) {
  try {
    const empresaId = req.empresaId!;
    const [botUsers, lavadores, subaccounts] = await Promise.all([
      db.whatsappBotUser.findMany({
        where: { empresaId },
        include: {
          lavador: { select: { id: true, nome: true } },
          subaccount: { select: { id: true, nome: true, roleInt: { select: { nome: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.lavador.findMany({
        where: { empresaId, ativo: true },
        select: { id: true, nome: true },
      }),
      prisma.subaccount.findMany({
        where: { empresaId },
        select: { id: true, nome: true, roleInt: { select: { nome: true } } },
      }),
    ]);

    const byLavadorId = new Map<string, any>(botUsers.filter((u: any) => u.lavadorId).map((u: any) => [u.lavadorId, u]));
    const bySubaccountId = new Map<string, any>(botUsers.filter((u: any) => u.subaccountId).map((u: any) => [u.subaccountId, u]));
    const usedBotUserIds = new Set<string>();

    const result: any[] = [];

    for (const lav of lavadores) {
      const bu = byLavadorId.get(lav.id);
      if (bu) usedBotUserIds.add(bu.id);
      result.push({
        id: bu?.id ?? null,
        origem: 'lavador',
        refId: lav.id,
        nome: lav.nome,
        roleLabel: 'Lavador',
        jid: bu?.jid ?? null,
        telefone: bu?.telefone ?? null,
        ativo: bu?.ativo ?? true,
      });
    }

    for (const sub of subaccounts) {
      const bu = bySubaccountId.get(sub.id);
      if (bu) usedBotUserIds.add(bu.id);
      result.push({
        id: bu?.id ?? null,
        origem: 'subaccount',
        refId: sub.id,
        nome: sub.nome,
        roleLabel: sub.roleInt?.nome ?? 'Funcionário',
        jid: bu?.jid ?? null,
        telefone: bu?.telefone ?? null,
        ativo: bu?.ativo ?? true,
      });
    }

    // Registros existentes que não correspondem a um lavador ativo nem a um
    // subaccount atual (ex: lavador desativado, role legado) — mantém visível
    // para permitir desvincular/gerenciar.
    for (const bu of botUsers) {
      if (usedBotUserIds.has(bu.id)) continue;
      result.push({
        id: bu.id,
        origem: bu.subaccountId ? 'subaccount' : 'lavador',
        refId: bu.lavadorId ?? bu.subaccountId ?? bu.id,
        nome: bu.nome,
        roleLabel: bu.subaccount?.roleInt?.nome ?? (bu.lavador ? 'Lavador' : bu.role),
        jid: bu.jid,
        telefone: bu.telefone,
        ativo: bu.ativo,
      });
    }

    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao listar usuários do bot', details: String(e) });
  }
}

// POST /api/whatsapp/bot-users/connect — gera PIN para um lavador/funcionário
// existente, criando o registro WhatsappBotUser correspondente se necessário.
export async function connectBotUser(req: AuthReq, res: Response) {
  const { origem, refId } = req.body as { origem?: 'lavador' | 'subaccount'; refId?: string };
  if (!origem || !refId) return res.status(400).json({ error: 'Dados inválidos' });

  try {
    if (origem === 'lavador') {
      const lavador = await prisma.lavador.findFirst({ where: { id: refId, empresaId: req.empresaId } });
      if (!lavador) return res.status(404).json({ error: 'Lavador não encontrado' });

      let botUser = await db.whatsappBotUser.findFirst({ where: { empresaId: req.empresaId, lavadorId: refId } });
      if (!botUser) {
        botUser = await db.whatsappBotUser.create({
          data: { empresaId: req.empresaId!, nome: lavador.nome, role: 'LAVADOR', lavadorId: refId, ativo: true },
        });
      }

      const code = await botGeneratePin(botUser.id, req.empresaId!, 'LAVADOR', lavador.nome, lavador.id);
      return res.json({ code, expiresInSeconds: 300 });
    }

    if (origem === 'subaccount') {
      const subaccount = await prisma.subaccount.findFirst({ where: { id: refId, empresaId: req.empresaId } });
      if (!subaccount) return res.status(404).json({ error: 'Funcionário não encontrado' });

      let botUser = await db.whatsappBotUser.findFirst({ where: { empresaId: req.empresaId, subaccountId: refId } });
      if (!botUser) {
        botUser = await db.whatsappBotUser.create({
          data: { empresaId: req.empresaId!, nome: subaccount.nome, role: 'FUNCIONARIO', subaccountId: refId, ativo: true },
        });
      }

      const code = await botGeneratePin(botUser.id, req.empresaId!, 'FUNCIONARIO', subaccount.nome, null);
      return res.json({ code, expiresInSeconds: 300 });
    }

    return res.status(400).json({ error: 'Origem inválida' });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao gerar PIN', details: String(e) });
  }
}

// POST /api/whatsapp/bot-users/:id/desvincular — admin desvincula um usuário já conectado
export async function desvincularBotUser(req: AuthReq, res: Response) {
  const id = req.params['id'] as string;
  try {
    const existing = await db.whatsappBotUser.findFirst({ where: { id, empresaId: req.empresaId } });
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado' });

    await botCancelPin(id).catch(() => {});
    await db.whatsappBotUser.update({ where: { id }, data: { jid: null, telefone: null } });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao desvincular', details: String(e) });
  }
}

// POST /api/whatsapp/bot-users
export async function createBotUser(req: AuthReq, res: Response) {
  const { nome, role, lavadorId } = req.body as { nome: string; role: string; lavadorId?: string };
  if (!nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Role inválida' });

  try {
    const user = await db.whatsappBotUser.create({
      data: {
        empresaId: req.empresaId!,
        nome: nome.trim(),
        role,
        lavadorId: lavadorId || null,
        ativo: true,
      },
    });
    return res.status(201).json(user);
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao criar usuário', details: String(e) });
  }
}

// PATCH /api/whatsapp/bot-users/:id
export async function updateBotUser(req: AuthReq, res: Response) {
  const id = req.params['id'] as string;
  const { nome, role, lavadorId, ativo } = req.body as any;

  if (role !== undefined && !VALID_ROLES.includes(role))
    return res.status(400).json({ error: 'Role inválida' });

  try {
    const existing = await db.whatsappBotUser.findFirst({
      where: { id, empresaId: req.empresaId },
    });
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado' });

    const updated = await db.whatsappBotUser.update({
      where: { id },
      data: {
        ...(nome !== undefined && { nome: nome.trim() }),
        ...(role !== undefined && { role }),
        ...(lavadorId !== undefined && { lavadorId: lavadorId || null }),
        ...(ativo !== undefined && { ativo }),
        ...(role !== undefined && role !== existing.role && { jid: null, telefone: null }),
      },
      include: { lavador: { select: { id: true, nome: true } } },
    });
    return res.json(updated);
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao atualizar usuário', details: String(e) });
  }
}

// DELETE /api/whatsapp/bot-users/:id
export async function deleteBotUser(req: AuthReq, res: Response) {
  const id = req.params['id'] as string;
  try {
    const existing = await db.whatsappBotUser.findFirst({
      where: { id, empresaId: req.empresaId },
    });
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado' });
    await botCancelPin(id).catch(() => {}); // limpa PIN ativo no bot se houver
    await db.whatsappBotUser.delete({ where: { id } });
    return res.json({ message: 'Usuário removido' });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao remover usuário', details: String(e) });
  }
}

// POST /api/whatsapp/bot-users/:id/pin
export async function generatePin(req: AuthReq, res: Response) {
  const id = req.params['id'] as string;
  try {
    const user = await db.whatsappBotUser.findFirst({
      where: { id, empresaId: req.empresaId },
    });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const code = await botGeneratePin(id, req.empresaId!, user.role as string, user.nome as string, user.lavadorId as string | null);
    return res.json({ code, expiresInSeconds: 300 });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao gerar PIN', details: String(e) });
  }
}

// GET /api/whatsapp/bot-users/:id/pin
export async function getPinStatus(req: AuthReq, res: Response) {
  const id = req.params['id'] as string;
  const entry = await botGetPin(id);
  return res.json(entry);
}

// POST /api/whatsapp/me/wpp/pin — self-service para Subaccounts (funcionários do painel)
export async function generateMyPin(req: AuthReq, res: Response) {
  if (!req.subaccountId) {
    return res.status(403).json({ error: 'Apenas funcionários (subaccounts) podem usar este recurso' });
  }

  try {
    const subaccount = await prisma.subaccount.findFirst({
      where: { id: req.subaccountId, empresaId: req.empresaId },
    });
    if (!subaccount) return res.status(404).json({ error: 'Usuário não encontrado' });

    let botUser = await db.whatsappBotUser.findFirst({
      where: { empresaId: req.empresaId, subaccountId: req.subaccountId },
    });

    if (!botUser) {
      botUser = await db.whatsappBotUser.create({
        data: {
          empresaId: req.empresaId!,
          nome: subaccount.nome,
          role: 'FUNCIONARIO',
          subaccountId: req.subaccountId,
          ativo: true,
        },
      });
    }

    const code = await botGeneratePin(botUser.id, req.empresaId!, 'FUNCIONARIO', subaccount.nome, null);

    // Número do bot (instância global, empresaId = null) — usado para montar o link wa.me
    const botInst = await prisma.whatsappInstance.findFirst({
      where: { empresaId: null },
      select: { ownerPhone: true },
    });
    const botNumero = botInst?.ownerPhone?.replace(/\D/g, '') ?? null;

    return res.json({ code, expiresInSeconds: 300, botNumero });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao gerar PIN', details: String(e) });
  }
}

// GET /api/whatsapp/me/wpp/status
export async function getMyWppStatus(req: AuthReq, res: Response) {
  if (!req.subaccountId) {
    return res.status(403).json({ error: 'Apenas funcionários (subaccounts) podem usar este recurso' });
  }

  const botUser = await db.whatsappBotUser.findFirst({
    where: { empresaId: req.empresaId, subaccountId: req.subaccountId },
  });
  if (!botUser) return res.json({ conectado: false });

  return res.json({ conectado: !!botUser.jid, telefone: botUser.telefone });
}

// POST /api/whatsapp/me/wpp/desvincular
export async function desvincularMyWpp(req: AuthReq, res: Response) {
  if (!req.subaccountId) {
    return res.status(403).json({ error: 'Apenas funcionários (subaccounts) podem usar este recurso' });
  }

  const botUser = await db.whatsappBotUser.findFirst({
    where: { empresaId: req.empresaId, subaccountId: req.subaccountId },
  });
  if (!botUser) return res.status(404).json({ error: 'Não encontrado' });

  await botCancelPin(botUser.id).catch(() => {});
  await db.whatsappBotUser.update({
    where: { id: botUser.id },
    data: { jid: null, telefone: null, ativo: true },
  });
  return res.json({ ok: true });
}
