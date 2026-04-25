import { Request, Response } from 'express';
import prisma from '../db';
import { botGeneratePin, botGetPin, botCancelPin } from '../services/botServiceClient';

interface AuthReq extends Request {
  empresaId?: string;
}

const db = prisma as any;
const VALID_ROLES = ['LAVADOR', 'CAIXA', 'FINANCEIRO'];

// GET /api/whatsapp/bot-users
export async function listBotUsers(req: AuthReq, res: Response) {
  try {
    const users = await db.whatsappBotUser.findMany({
      where: { empresaId: req.empresaId },
      include: { lavador: { select: { id: true, nome: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return res.json(users);
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao listar usuários do bot', details: String(e) });
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
