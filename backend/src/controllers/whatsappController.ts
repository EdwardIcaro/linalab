/**
 * Controller para gerenciar bot WhatsApp com Baileys
 * Endpoints REST para setup, status e disconnect
 */

import { Request, Response } from 'express';
import prisma from '../db';
import {
  initBaileys,
  getQRCode,
  getStatus,
  disconnect as disconnectBaileys,
} from '../services/baileyService';

// Type para requisição autenticada
interface AuthenticatedRequest extends Request {
  empresaId?: string;
  usuarioId?: string;
}

/**
 * POST /api/whatsapp/setup
 * Inicia conexão Baileys e gera QR code
 */
export async function setupWhatsapp(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    console.log('[WhatsApp Setup] Iniciando setup para empresa:', empresaId);

    if (!empresaId) {
      console.error('[WhatsApp Setup] Empresa não identificada');
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    // Verificar se já existe instância ativa
    const existente = await prisma.whatsappInstance.findUnique({
      where: { empresaId },
    });

    if (existente && existente.status === 'connected') {
      // Checar se a conexão Baileys em memória ainda está ativa.
      // Após reinício do servidor, o banco pode ter 'connected' mas o socket foi perdido.
      const statusAtual = getStatus(empresaId);
      if (statusAtual === 'connected') {
        console.warn('[WhatsApp Setup] Instância já conectada para empresa:', empresaId);
        return res.status(400).json({
          error: 'Já existe uma instância conectada para esta empresa',
        });
      }
      // Banco desatualizado — socket perdido (reinício do servidor). Corrigir e reconectar.
      console.log('[WhatsApp Setup] DB diz connected mas Baileys está desconectado. Atualizando estado...');
      await prisma.whatsappInstance.update({
        where: { empresaId },
        data: { status: 'disconnected' },
      });
    }

    // Verificar se empresa existe
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { nome: true },
    });

    if (!empresa) {
      console.error('[WhatsApp Setup] Empresa não encontrada:', empresaId);
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    console.log('[WhatsApp Setup] Empresa:', empresa.nome);

    // Gerar nome único para instância (apenas para referência)
    const timestamp = Date.now();
    const instanceName = `lina-${empresaId.substring(0, 8)}-${timestamp}`.toLowerCase();

    // Criar/atualizar registro no banco
    await prisma.whatsappInstance.upsert({
      where: { empresaId },
      update: {
        instanceName,
        status: 'qr_code',
        updatedAt: new Date(),
      },
      create: {
        empresaId,
        instanceName,
        status: 'qr_code',
      },
    });

    console.log('[WhatsApp Setup] Registro criado no banco');

    // Iniciar socket Baileys
    console.log('[WhatsApp Setup] Iniciando Baileys...');
    await initBaileys(empresaId);

    // Aguardar QR code ser gerado (com timeout)
    let qrCode: string | null = null;
    let attempts = 0;
    const maxAttempts = 30; // 30 * 1000ms = 30 segundos (Railway pode demorar)

    while (!qrCode && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      qrCode = await getQRCode(empresaId);
      attempts++;
      if (attempts % 5 === 0) {
        console.log(`[WhatsApp Setup] Aguardando QR... tentativa ${attempts}/${maxAttempts}`);
      }
    }

    console.log(
      '[WhatsApp Setup] QR obtido após',
      attempts,
      'tentativas:',
      !!qrCode
    );

    return res.json({
      status: 'qr_code',
      qrCode,
      instanceName,
      message: 'Baileys iniciado. Escaneie o QR code com seu WhatsApp.',
    });
  } catch (error) {
    console.error('[WhatsApp Setup] Erro fatal:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      error: 'Erro ao configurar WhatsApp',
      details: errorMessage,
    });
  }
}

/**
 * GET /api/whatsapp/status
 * Retorna status atual da instância (conectado | qr_code | desconectado)
 */
export async function getWhatsappStatus(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const empresaId = req.empresaId;

    console.log('[WhatsApp Status] empresaId:', empresaId);

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    const instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId },
    });

    if (!instance) {
      console.log('[WhatsApp Status] Nenhuma instância');
      return res.json({
        status: 'disconnected',
        message: 'Nenhuma instância configurada',
      });
    }

    // Obter status do Baileys (em memória)
    const status = getStatus(empresaId);
    console.log('[WhatsApp Status] Status Baileys:', status);

    // Se conectado
    if (status === 'connected') {
      return res.json({
        status: 'connected',
        ownerPhone: instance.ownerPhone,
        message: 'WhatsApp conectado com sucesso',
      });
    }

    // Se aguardando QR code
    if (status === 'qr_code') {
      const qrCode = await getQRCode(empresaId);
      return res.json({
        status: 'qr_code',
        qrCode,
        message: 'Aguardando escaneamento do QR code',
      });
    }

    // Se desconectado
    return res.json({
      status: 'disconnected',
      qrCode: null,
      message: 'WhatsApp desconectado',
    });
  } catch (error) {
    console.error('[WhatsApp Status] Erro:', error);
    return res.status(500).json({ error: 'Erro ao obter status' });
  }
}

/**
 * DELETE /api/whatsapp/disconnect
 * Desconecta WhatsApp e limpa estado
 */
export async function disconnectWhatsapp(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const empresaId = req.empresaId;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    const instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId },
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    // Desconectar Baileys (sempre limpa o estado em memória)
    try {
      await disconnectBaileys(empresaId);
    } catch (error) {
      console.warn('[WhatsApp Disconnect] Erro ao desconectar Baileys:', error);
      // Garantir limpeza no banco mesmo se o service falhou
      await prisma.whatsappInstance.update({
        where: { empresaId },
        data: { status: 'disconnected', authState: null, qrCode: null },
      }).catch(() => {});
    }

    return res.json({ message: 'WhatsApp desconectado com sucesso' });
  } catch (error) {
    console.error('[WhatsApp Disconnect] Erro:', error);
    return res.status(500).json({ error: 'Erro ao desconectar' });
  }
}
