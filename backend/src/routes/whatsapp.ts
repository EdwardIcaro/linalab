/**
 * Rotas para gerenciar bot WhatsApp com Baileys
 * Padrão: /api/whatsapp/*
 */

import { Router } from 'express';
import {
  setupWhatsapp,
  getWhatsappStatus,
  disconnectWhatsapp
} from '../controllers/whatsappController';

const router = Router();

// Rotas protegidas (com authMiddleware no index.ts)
router.post('/setup', setupWhatsapp);
router.get('/status', getWhatsappStatus);
router.delete('/disconnect', disconnectWhatsapp);

export default router;
