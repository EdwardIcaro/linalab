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
    return res.status(500).json({ error: 'Erro ao configurar bot', details: String(err) });
  }
}

// ──────────────────────────────────────────────────────────────
// GET /api/whatsapp/status
// ──────────────────────────────────────────────────────────────
export async function getWhatsappStatus(req: AuthenticatedRequest, res: Response) {
  try {
    const bot = await botGetStatus();

    if (bot.status === 'connected') {
      const inst = await prisma.whatsappInstance.findFirst({ where: { instanceName: GLOBAL_INSTANCE_NAME } });
      return res.json({ status: 'connected', ownerPhone: inst?.ownerPhone, message: 'Bot Lina conectado' });
    }
    if (bot.status === 'reconnecting') {
      return res.json({ status: 'reconnecting', message: 'Reconectando automaticamente...' });
    }
    if (bot.status === 'qr_code') {
      return res.json({ status: 'qr_code', qrCode: bot.qrCode, qrExpiresIn: bot.qrExpiresIn, message: 'Aguardando escaneamento do QR' });
    }

    return res.json({ status: 'disconnected', message: 'Bot Lina desconectado' });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao obter status', details: String(err) });
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
    return res.status(500).json({ error: 'Erro ao desconectar', details: String(err) });
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
    return res.status(500).json({ error: 'Erro ao gerar código', details: String(err) });
  }
}
