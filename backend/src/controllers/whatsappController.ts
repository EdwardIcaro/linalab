/**
 * Controller para gerenciar bot WhatsApp
 * Endpoints REST para setup, status e webhooks
 */

import { Request, Response } from 'express';
import prisma from '../db';
import { createInstance, getQRCode, getInstanceStatus, deleteInstance, sendTextMessage, getInstanceInfo } from '../services/evolutionService';
import { handleIncomingMessage } from '../services/whatsappCommandHandler';

// Type para requisição autenticada
interface AuthenticatedRequest extends Request {
  empresaId?: string;
  usuarioId?: string;
}

/**
 * POST /api/whatsapp/setup
 * Cria uma nova instância de WhatsApp
 */
export async function setupWhatsapp(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    // Verificar se já existe instância para esta empresa
    const existente = await prisma.whatsappInstance.findUnique({
      where: { empresaId }
    });

    if (existente && existente.status === 'connected') {
      return res.status(400).json({ error: 'Já existe uma instância conectada para esta empresa' });
    }

    // Gerar nome único para instância
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { nome: true }
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    // Usar timestamp para garantir nome único (Evolution API não permite reutilizar nomes)
    const timestamp = Date.now();
    const instanceName = `lina-${empresaId.substring(0, 8)}-${timestamp}`.toLowerCase();
    const webhookUrl = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/whatsapp/webhook/evolution`;

    // Criar instância na Evolution API
    const evolutionResponse = await createInstance(instanceName, webhookUrl);

    if (!evolutionResponse || evolutionResponse.error) {
      return res.status(500).json({ error: 'Falha ao criar instância na Evolution API' });
    }

    // Salvar ou atualizar no banco
    await prisma.whatsappInstance.upsert({
      where: { empresaId },
      update: {
        instanceName,
        status: 'qr_code',
        updatedAt: new Date()
      },
      create: {
        empresaId,
        instanceName,
        status: 'qr_code'
      }
    });

    // Aguardar um pouco e obter QR code
    await new Promise(resolve => setTimeout(resolve, 1000));

    const qrCode = await getQRCode(instanceName);

    if (qrCode) {
      await prisma.whatsappInstance.update({
        where: { empresaId },
        data: { qrCode }
      });
    }

    return res.json({
      status: 'qr_code',
      qrCode,
      instanceName,
      message: 'Instância criada. Escaneie o QR code com seu WhatsApp.'
    });
  } catch (error) {
    console.error('[WhatsApp Setup] Erro:', error);
    return res.status(500).json({ error: 'Erro ao configurar WhatsApp' });
  }
}

/**
 * GET /api/whatsapp/status
 * Retorna status atual da instância
 */
export async function getWhatsappStatus(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    const instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId }
    });

    if (!instance) {
      return res.json({
        status: 'disconnected',
        message: 'Nenhuma instância configurada'
      });
    }

    // Verificar status atual na Evolution API
    const evolutionStatus = await getInstanceStatus(instance.instanceName);

    let status = instance.status;
    if (evolutionStatus === 'open') {
      status = 'connected';

      // Obter número do proprietário
      const info = await getInstanceInfo(instance.instanceName);
      const ownerPhone = info?.wid?.user || null;

      // Atualizar no banco
      await prisma.whatsappInstance.update({
        where: { empresaId },
        data: {
          status: 'connected',
          ownerPhone,
          qrCode: null
        }
      });

      return res.json({
        status: 'connected',
        ownerPhone,
        message: 'WhatsApp conectado com sucesso'
      });
    } else if (evolutionStatus === 'connecting') {
      status = 'qr_code';
    } else {
      status = 'disconnected';
    }

    return res.json({
      status,
      qrCode: instance.qrCode || null,
      ownerPhone: instance.ownerPhone || null
    });
  } catch (error) {
    console.error('[WhatsApp Status] Erro:', error);
    return res.status(500).json({ error: 'Erro ao obter status' });
  }
}

/**
 * DELETE /api/whatsapp/disconnect
 * Desconecta e remove a instância
 */
export async function disconnectWhatsapp(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    const instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId }
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    // Deletar da Evolution API
    try {
      await deleteInstance(instance.instanceName);
    } catch (error) {
      console.warn('Aviso ao deletar instância da Evolution:', error);
      // Continuar mesmo se Evolution API falhar
    }

    // Deletar do banco
    await prisma.whatsappInstance.delete({
      where: { empresaId }
    });

    return res.json({ message: 'WhatsApp desconectado com sucesso' });
  } catch (error) {
    console.error('[WhatsApp Disconnect] Erro:', error);
    return res.status(500).json({ error: 'Erro ao desconectar' });
  }
}

/**
 * POST /api/whatsapp/webhook/evolution
 * Webhook chamado pela Evolution API para processar mensagens
 * NÃO requer autenticação - validação interna por instanceName
 */
export async function handleEvolutionWebhook(req: Request, res: Response) {
  try {
    const payload = req.body;

    // Validar payload
    if (!payload.event || !payload.instance || !payload.data) {
      return res.status(400).json({ error: 'Payload inválido' });
    }

    // Processar apenas eventos de mensagem recebida
    if (payload.event !== 'messages.upsert') {
      return res.json({ acknowledged: true });
    }

    const { instance: instanceName, data } = payload;

    // Validar dados da mensagem
    if (!data.key || !data.message) {
      return res.json({ acknowledged: true });
    }

    const { remoteJid } = data.key;
    const fromMe = data.key.fromMe === true;

    // Ignorar mensagens enviadas por nós
    if (fromMe) {
      return res.json({ acknowledged: true });
    }

    // Extrair número do remetente
    const from = remoteJid.replace('@s.whatsapp.net', '');
    const senderName = data.pushName || from;
    const message = data.message?.conversation || data.message?.text || '';

    if (!message) {
      return res.json({ acknowledged: true });
    }

    // Encontrar instância e empresa
    const whatsappInstance = await prisma.whatsappInstance.findUnique({
      where: { instanceName }
    });

    if (!whatsappInstance) {
      console.warn(`[WhatsApp Webhook] Instância ${instanceName} não encontrada no banco`);
      return res.json({ acknowledged: true });
    }

    const empresaId = whatsappInstance.empresaId;

    // Registrar mensagem recebida
    await prisma.whatsappMessage.create({
      data: {
        instanceId: whatsappInstance.id,
        direction: 'INCOMING',
        phoneNumber: from,
        senderName,
        message,
        status: 'processed'
      }
    });

    // Processar comando e obter resposta
    let response: string;
    try {
      response = await handleIncomingMessage(
        whatsappInstance.id,
        from,
        senderName,
        message,
        empresaId
      );
    } catch (error) {
      console.error('[WhatsApp Message Handler] Erro:', error);
      response = '❌ Desculpe, ocorreu um erro. Tente novamente.';
    }

    // Enviar resposta
    try {
      await sendTextMessage(instanceName, from, response);

      // Registrar resposta enviada
      await prisma.whatsappMessage.update({
        where: {
          id: (
            await prisma.whatsappMessage.findFirst({
              where: { phoneNumber: from },
              orderBy: { createdAt: 'desc' }
            })
          )!.id
        },
        data: {
          response,
          status: 'processed'
        }
      });
    } catch (error) {
      console.error('[WhatsApp Send] Erro ao enviar resposta:', error);
    }

    return res.json({ acknowledged: true });
  } catch (error) {
    console.error('[WhatsApp Webhook] Erro:', error);
    return res.status(500).json({ error: 'Erro ao processar webhook' });
  }
}
