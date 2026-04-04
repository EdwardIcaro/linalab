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
import {
  listLavadorPhones,
  updateLavadorPhone,
  deleteLavadorPhone
} from '../controllers/whatsappPhoneController';

const router = Router();

// Rotas do bot (setup, status, disconnect)
router.post('/setup', setupWhatsapp);
router.get('/status', getWhatsappStatus);
router.delete('/disconnect', disconnectWhatsapp);

// Rotas de gerenciamento de números de WhatsApp
router.get('/phones', listLavadorPhones);
router.patch('/phones/:lavadorId', updateLavadorPhone);
router.delete('/phones/:lavadorId', deleteLavadorPhone);

export default router;
