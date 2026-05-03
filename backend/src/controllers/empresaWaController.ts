import { Request, Response } from 'express';
import prisma from '../db';
import { empresaWaConnect, empresaWaStatus, empresaWaDisconnect } from '../services/empresaWaClient';

const TEMPLATES_PADRAO = [
  { nome: 'Veículo pronto', categoria: 'FINALIZACAO', texto: 'Olá {{nome}}! Seu veículo {{placa}} está pronto para retirada. 🚗✨' },
  { nome: 'Pesquisa de satisfação', categoria: 'POS_VENDA', texto: 'Olá {{nome}}! Como ficou o {{placa}}? Esperamos que tenha gostado do nosso serviço! 😊' },
  { nome: 'Retorno de cliente', categoria: 'PRE_VENDA', texto: 'Olá {{nome}}! Faz {{dias}} dias desde sua última visita. Que tal uma lavagem essa semana? 🚿' },
];

// ── Status da sessão da empresa ───────────────────────────────────────────────
export async function getStatus(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  try {
    const session = await prisma.whatsappEmpresaSession.findUnique({
      where: { empresaId },
      select: { status: true, phoneNumber: true },
    });
    // Se não tem registro no banco, está desconectado
    if (!session) return res.json({ status: 'DESCONECTADO', phoneNumber: null });

    // Consulta status em tempo real no bot
    try {
      const live = await empresaWaStatus(empresaId);
      return res.json({ status: live.status, phoneNumber: session.phoneNumber });
    } catch {
      return res.json({ status: session.status, phoneNumber: session.phoneNumber });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Iniciar conexão — retorna QR ──────────────────────────────────────────────
export async function connect(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  try {
    const result = await empresaWaConnect(empresaId);

    // Na primeira conexão, criar templates padrão se não existirem
    const count = await prisma.mensagemTemplate.count({ where: { empresaId } });
    if (count === 0) {
      await prisma.mensagemTemplate.createMany({
        data: TEMPLATES_PADRAO.map(t => ({ ...t, empresaId })),
      });
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Desconectar ───────────────────────────────────────────────────────────────
export async function disconnect(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  try {
    await empresaWaDisconnect(empresaId);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────
export async function getTemplates(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  try {
    const templates = await prisma.mensagemTemplate.findMany({
      where: { empresaId },
      orderBy: [{ categoria: 'asc' }, { createdAt: 'asc' }],
    });
    return res.json({ templates });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createTemplate(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  const { nome, categoria, texto } = req.body;
  if (!nome || !categoria || !texto) return res.status(400).json({ error: 'nome, categoria e texto são obrigatórios' });
  try {
    const template = await prisma.mensagemTemplate.create({
      data: { empresaId, nome, categoria, texto },
    });
    return res.status(201).json({ template });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateTemplate(req: Request, res: Response) {
  const empresaId  = (req as any).empresaId as string;
  const templateId = req.params['id'] as string;
  const { nome, texto, ativo } = req.body;
  try {
    const existing = await prisma.mensagemTemplate.findFirst({ where: { id: templateId, empresaId } });
    if (!existing) return res.status(404).json({ error: 'Template não encontrado' });
    const updated = await prisma.mensagemTemplate.update({
      where: { id: templateId },
      data:  { ...(nome !== undefined && { nome }), ...(texto !== undefined && { texto }), ...(ativo !== undefined && { ativo }) },
    });
    return res.json({ template: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteTemplate(req: Request, res: Response) {
  const empresaId  = (req as any).empresaId as string;
  const templateId = req.params['id'] as string;
  try {
    const existing = await prisma.mensagemTemplate.findFirst({ where: { id: templateId, empresaId } });
    if (!existing) return res.status(404).json({ error: 'Template não encontrado' });
    await prisma.mensagemTemplate.delete({ where: { id: templateId } });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
