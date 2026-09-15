/**
 * Controller WhatsApp — Bot Lina (socket único global, Phase 1)
 * Setup exclusivo do LINA_OWNER. Admins de empresa só gerenciam pareamento.
 */

import { Request, Response } from 'express';
import prisma from '../db';
import {
  botInitialize,
  botGetStatus,
  botDisconnect,
  botGeneratePairingCode,
} from '../services/botServiceClient';
import { getDefaultPrefs } from '../services/whatsappNotificationService';

interface AuthenticatedRequest extends Request {
  empresaId?: string;
  usuarioId?: string;
  userRole?:  string;
  role?:      string; // set by adminMiddleware
}

const GLOBAL_INSTANCE_NAME = 'lina-global';

// ──────────────────────────────────────────────────────────────
// POST /api/whatsapp/setup   (apenas LINA_OWNER)
// Inicia o socket global e cria/garante a instância no banco
// ──────────────────────────────────────────────────────────────
export async function setupWhatsapp(req: AuthenticatedRequest, res: Response) {
  try {
    if (req.userRole !== 'LINA_OWNER' && req.role !== 'LINA_OWNER') {
      return res.status(403).json({ error: 'Apenas o administrador Lina pode configurar o bot global' });
    }

    const current = await botGetStatus();
    if (current.status === 'connected') {
      return res.status(400).json({ error: 'Bot Lina já está conectado' });
    }
    if (current.status === 'reconnecting') {
      return res.status(409).json({ status: 'reconnecting', message: 'Reconexão automática em andamento. Aguarde.' });
    }

    await (prisma.whatsappInstance as any).upsert({
      where:  { instanceName: GLOBAL_INSTANCE_NAME },
      update: { status: 'qr_code', updatedAt: new Date() },
      create: { instanceName: GLOBAL_INSTANCE_NAME, status: 'qr_code' },
    });

    const result = await botInitialize();
    return res.json({ status: result.status, qrCode: result.qrCode, message: 'Bot Lina iniciado. Escaneie o QR code.' });
  } catch (err) {
    console.error('[WhatsApp Setup] Erro:', err);
    return res.status(500).json({ error: 'Erro ao configurar bot' });
  }
}

// ──────────────────────────────────────────────────────────────
// GET /api/whatsapp/status
// Lê status direto do banco — o bot mantém a tabela atualizada.
// Evita dependência de rede com o ngrok para exibição de status.
// ──────────────────────────────────────────────────────────────
export async function getWhatsappStatus(req: AuthenticatedRequest, res: Response) {
  try {
    const inst = await prisma.whatsappInstance.findFirst({ where: { instanceName: GLOBAL_INSTANCE_NAME } });

    if (!inst) return res.json({ status: 'disconnected', message: 'Bot Lina não configurado' });

    const status = inst.status as string;

    if (status === 'connected') {
      return res.json({ status: 'connected', ownerPhone: inst.ownerPhone, message: 'Bot Lina conectado' });
    }
    if (status === 'reconnecting') {
      return res.json({ status: 'reconnecting', message: 'Reconectando automaticamente...' });
    }
    if (status === 'qr_code') {
      const updatedAt   = (inst as any).updatedAt as Date | null;
      const qrExpiresIn = updatedAt ? Math.max(0, 60 - Math.floor((Date.now() - updatedAt.getTime()) / 1000)) : null;
      return res.json({ status: 'qr_code', qrCode: inst.qrCode, qrExpiresIn, message: 'Aguardando escaneamento do QR' });
    }

    return res.json({ status: 'disconnected', message: 'Bot Lina desconectado' });
  } catch (err) {
    console.error('[WhatsApp] Erro ao obter status:', err);
    return res.status(500).json({ error: 'Erro ao obter status' });
  }
}

// ──────────────────────────────────────────────────────────────
// DELETE /api/whatsapp/disconnect   (apenas LINA_OWNER)
// ──────────────────────────────────────────────────────────────
export async function disconnectWhatsapp(req: AuthenticatedRequest, res: Response) {
  try {
    if (req.userRole !== 'LINA_OWNER' && req.role !== 'LINA_OWNER') {
      return res.status(403).json({ error: 'Apenas o administrador Lina pode desconectar o bot global' });
    }
    await botDisconnect();
    return res.json({ message: 'Bot Lina desconectado com sucesso' });
  } catch (err) {
    console.error('[WhatsApp] Erro ao desconectar:', err);
    return res.status(500).json({ error: 'Erro ao desconectar' });
  }
}

// ──────────────────────────────────────────────────────────────
// POST /api/whatsapp/pairing-code
// Admin de empresa gera código de 4 dígitos para se vincular ao bot
// ──────────────────────────────────────────────────────────────
export async function generatePairingCode(req: AuthenticatedRequest, res: Response) {
  try {
    const usuarioId = req.usuarioId;
    const empresaId = req.empresaId;

    if (!usuarioId || !empresaId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { nome } = req.body as { nome?: string };

    const code = await botGeneratePairingCode(usuarioId, empresaId, nome);
    console.log(`[WhatsApp Pairing] Código gerado para usuário ${usuarioId}: ${code}`);

    return res.json({ code, expiresInSeconds: 300 });
  } catch (err) {
    console.error('[WhatsApp] Erro ao gerar código:', err);
    return res.status(500).json({ error: 'Erro ao gerar código' });
  }
}

// ──────────────────────────────────────────────────────────────
// GET /api/whatsapp/notif-prefs
// ──────────────────────────────────────────────────────────────
export async function getNotifPrefs(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    if (!empresaId) return res.status(401).json({ error: 'Empresa não identificada' });

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { notificationPreferences: true },
    });

    let np = (empresa?.notificationPreferences as any) ?? {};
    if (typeof np === 'string') {
      try { np = JSON.parse(np); } catch { np = {}; }
    }
    const raw = np?.whatsapp ?? {};
    const merged = { ...getDefaultPrefs(), ...raw };
    return res.json({ data: merged });
  } catch (err) {
    console.error('[WhatsApp] Erro ao buscar preferências:', err);
    return res.status(500).json({ error: 'Erro ao buscar preferências' });
  }
}

// ──────────────────────────────────────────────────────────────
// PATCH /api/whatsapp/notif-prefs
// ──────────────────────────────────────────────────────────────
export async function updateNotifPrefs(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    if (!empresaId) return res.status(401).json({ error: 'Empresa não identificada' });

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { notificationPreferences: true },
    });

    let current = (empresa?.notificationPreferences as any) ?? {};
    if (typeof current === 'string') {
      try { current = JSON.parse(current); } catch { current = {}; }
    }
    const updated = { ...current, whatsapp: { ...(current.whatsapp ?? {}), ...req.body } };

    await prisma.empresa.update({
      where: { id: empresaId },
      data: { notificationPreferences: updated },
    });

    return res.json({ message: 'Preferências salvas' });
  } catch (err) {
    console.error('[WhatsApp] Erro ao salvar preferências:', err);
    return res.status(500).json({ error: 'Erro ao salvar preferências' });
  }
}
