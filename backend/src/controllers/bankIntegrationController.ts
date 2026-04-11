/**
 * Controller para integração bancária / PIX
 * GET  /api/whatsapp/bank-integration    — retorna config (sem segredos)
 * PATCH /api/whatsapp/bank-integration   — salva/atualiza config
 */

import { Request, Response } from 'express';
import prisma from '../db';

interface AuthenticatedRequest extends Request {
  empresaId?: string;
}

/**
 * GET /api/whatsapp/bank-integration
 */
export async function getBankIntegration(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    if (!empresaId) return res.status(401).json({ error: 'Empresa não identificada' });

    const integration = await prisma.bankIntegration.findUnique({
      where: { empresaId },
      select: {
        id: true,
        ativo: true,
        chavePix: true,
        tipoPix: true,
        banco: true,
        clientId: true,
        // clientSecret NÃO retornado — segurança
        pixExpiracaoMin: true,
        nomeRecebedor: true,
        createdAt: true,
        updatedAt: true,
        // Indica se tem credenciais sem expô-las
        clientSecret: false,
        certCrt: false,
        certKey: false,
      },
    });

    // Adicionar flag indicando se tem credenciais configuradas
    const result = integration
      ? {
          ...integration,
          temCredenciais: false, // Fase 1: sem credenciais bancárias
        }
      : null;

    return res.json({ integration: result });
  } catch (error) {
    console.error('[BankIntegration GET] Erro:', error);
    return res.status(500).json({ error: 'Erro ao buscar integração bancária' });
  }
}

/**
 * PATCH /api/whatsapp/bank-integration
 * Body: { ativo, chavePix, tipoPix, nomeRecebedor, pixExpiracaoMin, banco, clientId, clientSecret }
 */
export async function saveBankIntegration(req: AuthenticatedRequest, res: Response) {
  try {
    const empresaId = req.empresaId;
    if (!empresaId) return res.status(401).json({ error: 'Empresa não identificada' });

    const {
      ativo,
      chavePix,
      tipoPix,
      nomeRecebedor,
      pixExpiracaoMin,
      banco,
      clientId,
      clientSecret,
    } = req.body;

    // Validar tipoPix se fornecido
    const tiposValidos = ['CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'ALEATORIA'];
    if (tipoPix && !tiposValidos.includes(tipoPix)) {
      return res.status(400).json({ error: `tipoPix inválido. Use: ${tiposValidos.join(', ')}` });
    }

    // Validar expiração (1 a 1440 minutos = 24h)
    if (pixExpiracaoMin !== undefined) {
      const min = Number(pixExpiracaoMin);
      if (isNaN(min) || min < 1 || min > 1440) {
        return res.status(400).json({ error: 'pixExpiracaoMin deve ser entre 1 e 1440 minutos' });
      }
    }

    // Montar data para upsert — apenas campos fornecidos
    const data: Record<string, unknown> = {};
    if (ativo !== undefined)          data.ativo = Boolean(ativo);
    if (chavePix !== undefined)       data.chavePix = chavePix;
    if (tipoPix !== undefined)        data.tipoPix = tipoPix;
    if (nomeRecebedor !== undefined)  data.nomeRecebedor = nomeRecebedor;
    if (pixExpiracaoMin !== undefined) data.pixExpiracaoMin = Number(pixExpiracaoMin);
    if (banco !== undefined)          data.banco = banco;
    if (clientId !== undefined)       data.clientId = clientId;
    if (clientSecret !== undefined)   data.clientSecret = clientSecret; // TODO: criptografar

    const integration = await prisma.bankIntegration.upsert({
      where: { empresaId },
      update: { ...data, updatedAt: new Date() },
      create: { empresaId, ...data },
      select: {
        id: true,
        ativo: true,
        chavePix: true,
        tipoPix: true,
        banco: true,
        clientId: true,
        pixExpiracaoMin: true,
        nomeRecebedor: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({ message: 'Integração bancária salva com sucesso', integration });
  } catch (error) {
    console.error('[BankIntegration PATCH] Erro:', error);
    return res.status(500).json({ error: 'Erro ao salvar integração bancária' });
  }
}
