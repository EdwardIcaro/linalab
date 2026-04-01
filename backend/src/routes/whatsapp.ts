/**
 * Rotas para gerenciar bot WhatsApp
 * Padrão: /api/whatsapp/*
 */

import { Router, Request, Response } from 'express';
import {
  setupWhatsapp,
  getWhatsappStatus,
  disconnectWhatsapp,
  handleEvolutionWebhook
} from '../controllers/whatsappController';

const router = Router();

// Rotas protegidas (com authMiddleware no index.ts)
router.post('/setup', setupWhatsapp);
router.get('/status', getWhatsappStatus);
router.delete('/disconnect', disconnectWhatsapp);

export default router;

// Rota pública para webhook (exportada separadamente)
export const webhookRouter = Router();

webhookRouter.post('/evolution', handleEvolutionWebhook);
