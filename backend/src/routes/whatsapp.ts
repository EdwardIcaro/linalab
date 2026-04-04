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
  deleteLavadorPhone,
  getWhatsappConfig,
  updateWhatsappConfig
} from '../controllers/whatsappPhoneController';
import {
  listAdminPhones,
  createAdminPhone,
  deleteAdminPhone,
  updateAdminPhone
} from '../controllers/whatsappAdminPhoneController';

const router = Router();

// Rotas do bot (setup, status, disconnect)
router.post('/setup', setupWhatsapp);
router.get('/status', getWhatsappStatus);
router.delete('/disconnect', disconnectWhatsapp);

// Rotas de gerenciamento de números de WhatsApp
router.get('/phones', listLavadorPhones);
router.patch('/phones/:lavadorId', updateLavadorPhone);
router.delete('/phones/:lavadorId', deleteLavadorPhone);

// Rotas de configuração
router.get('/config', getWhatsappConfig);
router.patch('/config', updateWhatsappConfig);

// Rotas de números de admin
router.get('/admin-phones', listAdminPhones);
router.post('/admin-phones', createAdminPhone);
router.delete('/admin-phones/:adminPhoneId', deleteAdminPhone);
router.patch('/admin-phones/:adminPhoneId', updateAdminPhone);

export default router;
