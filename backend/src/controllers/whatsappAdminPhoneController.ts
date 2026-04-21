/**
 * Controller para gerenciar números de WhatsApp dos admins
 */

import { Request, Response } from 'express';
import prisma from '../db';
import { resolvePhoneToJid, sendMessageAndCaptureJid } from '../services/baileyService';
import { generateCode, getCodeEntry, cancelCode } from '../services/pairingCodeStore';

interface AuthenticatedRequest extends Request {
  empresaId?: string;
  usuarioId?: string;
}

/**
 * GET /api/whatsapp/admin-phones
 * Listar todos os números de admin
 */
export async function listAdminPhones(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    // Buscar a instância WhatsApp da empresa
    const instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId },
    });

    if (!instance) {
      return res.json({ data: [], message: 'Nenhuma instância de WhatsApp configurada' });
    }

    const adminPhones = await prisma.whatsappAdminPhone.findMany({
      where: { instanceId: instance.id },
      select: {
        id: true,
        telefone: true,
        nome: true,
        ativo: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return res.json({ data: adminPhones });
  } catch (error) {
    console.error('[WhatsApp Admin Phones] Erro ao listar:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Erro ao listar números de admin', details: errorMsg });
  }
}

/**
 * POST /api/whatsapp/admin-phones
 * Adicionar novo número de admin
 */
export async function createAdminPhone(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    const { telefone, nome } = req.body;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    if (!telefone || typeof telefone !== 'string' || telefone.trim().length < 10) {
      return res.status(400).json({ error: 'Número de WhatsApp inválido' });
    }

    // Buscar ou criar instância WhatsApp
    let instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId },
    });

    if (!instance) {
      instance = await prisma.whatsappInstance.create({
        data: {
          empresaId,
          instanceName: `instance-${empresaId}`,
        },
      });
    }

    // Tentar resolver JID real (necessário para @lid do novo protocolo WhatsApp)
    const resolvedJid = await resolvePhoneToJid(telefone);

    // Criar número de admin
    const adminPhone = await prisma.whatsappAdminPhone.create({
      data: {
        instanceId: instance.id,
        telefone: telefone.trim(),
        jid: resolvedJid || null,
        nome: nome?.trim() || null,
        ativo: true,
      },
      select: {
        id: true,
        telefone: true,
        nome: true,
        ativo: true,
      },
    });

    console.log(`[WhatsApp Admin] Número de admin adicionado: ${adminPhone.telefone}`);

    // Enviar mensagem de boas-vindas e capturar JID real (@lid ou @s.whatsapp.net)
    // Isso resolve o problema do @lid — ao enviar, o Baileys retorna o JID real usado
    const nomeAdmin = adminPhone.nome ? ` ${adminPhone.nome}` : '';
    const actualJid = await sendMessageAndCaptureJid(
      telefone,
      `✅ Olá${nomeAdmin}! Você foi adicionado como administrador do bot *LinaX*.\n\nEnvie *ajuda* para ver os comandos disponíveis.`
    );

    // Se o JID capturado for @lid (diferente do resolvido), atualizar no banco
    if (actualJid && actualJid !== resolvedJid) {
      await prisma.whatsappAdminPhone.update({
        where: { id: adminPhone.id },
        data: { jid: actualJid },
      });
      console.log(`[WhatsApp Admin] JID atualizado para ${adminPhone.telefone}: ${actualJid}`);
    }

    return res.json({
      data: adminPhone,
      message: 'Número de admin adicionado com sucesso',
    });
  } catch (error) {
    console.error('[WhatsApp Admin Phones] Erro ao criar:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    // Erro de unicidade
    if (errorMsg.includes('Unique constraint') || errorMsg.includes('unique')) {
      return res.status(400).json({ error: 'Este número de telefone já foi adicionado' });
    }
    return res.status(500).json({ error: 'Erro ao adicionar número', details: errorMsg });
  }
}

/**
 * DELETE /api/whatsapp/admin-phones/:adminPhoneId
 * Remover número de admin
 */
export async function deleteAdminPhone(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    const adminPhoneId = req.params.adminPhoneId as string;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    // Verificar se pertence à empresa
    const instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId },
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const adminPhone = await prisma.whatsappAdminPhone.findUnique({
      where: { id: adminPhoneId },
    });

    if (!adminPhone || adminPhone.instanceId !== instance.id) {
      return res.status(404).json({ error: 'Número de admin não encontrado' });
    }

    await prisma.whatsappAdminPhone.delete({
      where: { id: adminPhoneId },
    });

    console.log(`[WhatsApp Admin] Número de admin removido: ${adminPhone.telefone}`);
    return res.json({ message: 'Número de admin removido com sucesso' });
  } catch (error) {
    console.error('[WhatsApp Admin Phones] Erro ao deletar:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Erro ao remover número', details: errorMsg });
  }
}

/**
 * PATCH /api/whatsapp/admin-phones/:adminPhoneId
 * Atualizar número ou nome de admin
 */
export async function updateAdminPhone(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    const adminPhoneId = req.params.adminPhoneId as string;
    const { telefone, nome, ativo } = req.body;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    // Verificar se pertence à empresa
    const instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId },
    });

    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const adminPhone = await prisma.whatsappAdminPhone.findUnique({
      where: { id: adminPhoneId },
    });

    if (!adminPhone || adminPhone.instanceId !== instance.id) {
      return res.status(404).json({ error: 'Número de admin não encontrado' });
    }

    // Atualizar
    const updated = await prisma.whatsappAdminPhone.update({
      where: { id: adminPhoneId },
      data: {
        ...(telefone && { telefone: telefone.trim() }),
        ...(nome !== undefined && { nome: nome ? nome.trim() : null }),
        ...(ativo !== undefined && { ativo }),
      },
      select: {
        id: true,
        telefone: true,
        nome: true,
        ativo: true,
      },
    });

    console.log(`[WhatsApp Admin] Número de admin atualizado: ${updated.telefone}`);
    return res.json({
      data: updated,
      message: 'Número de admin atualizado com sucesso',
    });
  } catch (error) {
    console.error('[WhatsApp Admin Phones] Erro ao atualizar:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Erro ao atualizar número', details: errorMsg });
  }
}

/**
 * POST /api/whatsapp/admin-phones/pair
 * Ativa modo de pareamento: próxima pessoa a mandar msg é adicionada como admin
 */
export async function startPairing(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    const { nome } = req.body;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    const instance = await prisma.whatsappInstance.findUnique({ where: { empresaId } });
    if (!instance) {
      return res.status(404).json({ error: 'Instância WhatsApp não encontrada. Conecte o WhatsApp primeiro.' });
    }

    if (instance.status !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp não está conectado. Conecte primeiro para usar o pareamento.' });
    }

    await prisma.whatsappInstance.update({
      where: { empresaId },
      data: { pairingMode: true, pairingNome: nome?.trim() || null },
    });

    console.log(`[WhatsApp Admin] Modo de pareamento ativado para ${empresaId}, nome: ${nome || 'não definido'}`);
    return res.json({ message: 'Modo de pareamento ativado. Peça ao admin para enviar uma mensagem.' });
  } catch (error) {
    console.error('[WhatsApp Admin Phones] Erro ao iniciar pareamento:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Erro ao iniciar pareamento', details: errorMsg });
  }
}

/**
 * DELETE /api/whatsapp/admin-phones/pair
 * Cancela o modo de pareamento
 */
export async function cancelPairing(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    const instance = await prisma.whatsappInstance.findUnique({ where: { empresaId } });
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    await prisma.whatsappInstance.update({
      where: { empresaId },
      data: { pairingMode: false, pairingNome: null },
    });

    return res.json({ message: 'Pareamento cancelado' });
  } catch (error) {
    console.error('[WhatsApp Admin Phones] Erro ao cancelar pareamento:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Erro ao cancelar pareamento', details: errorMsg });
  }
}

/**
 * POST /api/whatsapp/admin-phones/pair-code
 * Gera um código de 4 dígitos para o admin digitar no WhatsApp
 */
export async function gerarCodigoPareamento(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    const { nome } = req.body;

    if (!empresaId) return res.status(401).json({ error: 'Empresa não identificada' });

    const instance = await prisma.whatsappInstance.findUnique({ where: { empresaId } });
    if (!instance) {
      return res.status(404).json({ error: 'Instância WhatsApp não encontrada. Conecte o WhatsApp primeiro.' });
    }
    if (instance.status !== 'connected') {
      return res.status(400).json({ error: 'WhatsApp não está conectado. Conecte primeiro para usar o código.' });
    }

    const code = generateCode(req.usuarioId!, empresaId, nome?.trim() || undefined);
    console.log(`[WhatsApp Admin] Código de pareamento gerado para ${empresaId}: ${code}`);

    return res.json({ data: { code, expiresIn: 300 } });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Erro ao gerar código', details: errorMsg });
  }
}

/**
 * GET /api/whatsapp/admin-phones/pair-code
 * Retorna status do código gerado (ativo, expirado, usado)
 */
export async function statusCodigoPareamento(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    if (!empresaId) return res.status(401).json({ error: 'Empresa não identificada' });

    const entry = getCodeEntry(empresaId);
    if (!entry) {
      return res.json({ data: { active: false, claimed: false } });
    }

    return res.json({
      data: {
        active: true,
        claimed: entry.claimed,
        code: entry.code,
        expiresAt: new Date(entry.expiresAt),
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Erro ao obter status do código', details: errorMsg });
  }
}

/**
 * DELETE /api/whatsapp/admin-phones/pair-code
 * Cancela o código ativo
 */
export async function cancelarCodigoPareamento(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    if (!empresaId) return res.status(401).json({ error: 'Empresa não identificada' });
    cancelCode(empresaId);
    return res.json({ message: 'Código cancelado' });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Erro ao cancelar código', details: errorMsg });
  }
}

/**
 * GET /api/whatsapp/admin-phones/pair
 * Retorna status do modo de pareamento
 */
export async function getPairingStatus(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    const instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId },
      select: { pairingMode: true, pairingNome: true },
    });

    return res.json({
      data: {
        pairingMode: instance?.pairingMode ?? false,
        pairingNome: instance?.pairingNome ?? null,
      },
    });
  } catch (error) {
    console.error('[WhatsApp Admin Phones] Erro ao obter status pareamento:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Erro ao obter status', details: errorMsg });
  }
}
