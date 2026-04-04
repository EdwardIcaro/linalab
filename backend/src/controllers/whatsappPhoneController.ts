/**
 * Controller para gerenciar números de WhatsApp dos lavadores
 */

import { Request, Response } from 'express';
import prisma from '../db';

interface AuthenticatedRequest extends Request {
  empresaId?: string;
  usuarioId?: string;
}

/**
 * GET /api/whatsapp/phones
 * Listar todos os lavadores com seus números WhatsApp + configurações
 */
export async function listLavadorPhones(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    const lavadores = await prisma.lavador.findMany({
      where: { empresaId },
      select: {
        id: true,
        nome: true,
        telefone: true,
        comissao: true,
        ativo: true,
      },
      orderBy: { nome: 'asc' },
    });

    // Tentar carregar config, mas não falhar se o campo não existir
    let blockUnknown = true;
    try {
      const empresa = await prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { whatsappBlockUnknown: true },
      });
      if (empresa?.whatsappBlockUnknown !== undefined && empresa?.whatsappBlockUnknown !== null) {
        blockUnknown = empresa.whatsappBlockUnknown;
      }
    } catch (configError) {
      console.warn('[WhatsApp Phones] Erro ao carregar config (campo pode não existir):', configError);
      // Continuar com valor padrão
    }

    return res.json({
      data: lavadores,
      config: {
        blockUnknown,
      },
    });
  } catch (error) {
    console.error('[WhatsApp Phones] Erro ao listar:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[WhatsApp Phones] Detalhes:', errorMsg);
    return res.status(500).json({ error: 'Erro ao listar lavadores', details: errorMsg });
  }
}

/**
 * PATCH /api/whatsapp/phones/:lavadorId
 * Adicionar ou atualizar número de WhatsApp de um lavador
 */
export async function updateLavadorPhone(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    const lavadorId = req.params.lavadorId as string;
    const { telefone } = req.body;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    if (!telefone || typeof telefone !== 'string' || telefone.trim().length < 10) {
      return res.status(400).json({ error: 'Número de WhatsApp inválido' });
    }

    // Verificar se lavador existe e pertence à empresa
    const lavador = await prisma.lavador.findUnique({
      where: { id: lavadorId },
    });

    if (!lavador || lavador.empresaId !== empresaId) {
      return res.status(404).json({ error: 'Lavador não encontrado' });
    }

    // Atualizar telefone
    const updated = await prisma.lavador.update({
      where: { id: lavadorId },
      data: { telefone: telefone.trim() },
      select: { id: true, nome: true, telefone: true },
    });

    console.log(`[WhatsApp Phones] Telefone atualizado para ${updated.nome}: ${updated.telefone}`);
    return res.json({ data: updated, message: 'Número de WhatsApp atualizado com sucesso' });
  } catch (error) {
    console.error('[WhatsApp Phones] Erro ao atualizar:', error);
    return res.status(500).json({ error: 'Erro ao atualizar número' });
  }
}

/**
 * DELETE /api/whatsapp/phones/:lavadorId
 * Remover número de WhatsApp de um lavador
 */
export async function deleteLavadorPhone(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    const lavadorId = req.params.lavadorId as string;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    // Verificar se lavador existe e pertence à empresa
    const lavador = await prisma.lavador.findUnique({
      where: { id: lavadorId },
    });

    if (!lavador || lavador.empresaId !== empresaId) {
      return res.status(404).json({ error: 'Lavador não encontrado' });
    }

    // Remover telefone (set null)
    const updated = await prisma.lavador.update({
      where: { id: lavadorId },
      data: { telefone: null },
      select: { id: true, nome: true, telefone: true },
    });

    console.log(`[WhatsApp Phones] Telefone removido para ${updated.nome}`);
    return res.json({ data: updated, message: 'Número de WhatsApp removido' });
  } catch (error) {
    console.error('[WhatsApp Phones] Erro ao deletar:', error);
    return res.status(500).json({ error: 'Erro ao remover número' });
  }
}

/**
 * GET /api/whatsapp/config
 * Obter configuração de bloqueio de números desconhecidos
 */
export async function getWhatsappConfig(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    try {
      const empresa = await prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { whatsappBlockUnknown: true },
      });

      return res.json({
        data: {
          blockUnknown: empresa?.whatsappBlockUnknown ?? true,
        },
      });
    } catch (queryError) {
      // Se o campo não existir, retornar valor padrão
      const errorMsg = String(queryError);
      if (errorMsg.includes('whatsapp_block_unknown') || errorMsg.includes('Unknown column')) {
        console.warn('[WhatsApp Config] Campo não existe ainda, retornando padrão');
        return res.json({
          data: {
            blockUnknown: true,
          },
        });
      }
      throw queryError;
    }
  } catch (error) {
    console.error('[WhatsApp Config] Erro ao obter config:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Erro ao obter configuração', details: errorMsg });
  }
}

/**
 * PATCH /api/whatsapp/config
 * Atualizar configuração de bloqueio de números desconhecidos
 */
export async function updateWhatsappConfig(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    const { blockUnknown } = req.body;

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa não identificada' });
    }

    if (typeof blockUnknown !== 'boolean') {
      return res.status(400).json({ error: 'blockUnknown deve ser true ou false' });
    }

    try {
      const updated = await prisma.empresa.update({
        where: { id: empresaId },
        data: { whatsappBlockUnknown: blockUnknown },
        select: { whatsappBlockUnknown: true },
      });

      console.log(
        `[WhatsApp Config] Config atualizada para empresa ${empresaId}: blockUnknown=${updated.whatsappBlockUnknown}`
      );
      return res.json({
        data: { blockUnknown: updated.whatsappBlockUnknown },
        message: 'Configuração atualizada com sucesso',
      });
    } catch (queryError) {
      // Se o campo não existir, ignorar erro e retornar sucesso
      const errorMsg = String(queryError);
      if (errorMsg.includes('whatsapp_block_unknown') || errorMsg.includes('Unknown column')) {
        console.warn('[WhatsApp Config] Campo não existe ainda, ignorando update');
        return res.json({
          data: { blockUnknown },
          message: 'Campo será criado na próxima migração',
        });
      }
      throw queryError;
    }
  } catch (error) {
    console.error('[WhatsApp Config] Erro ao atualizar config:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: 'Erro ao atualizar configuração', details: errorMsg });
  }
}
