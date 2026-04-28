/**
 * Rotas para gerenciar bot WhatsApp com Baileys
 * Padrão: /api/whatsapp/*
 */

import { Router } from 'express';
import {
  setupWhatsapp,
  getWhatsappStatus,
  disconnectWhatsapp,
  getNotifPrefs,
  updateNotifPrefs,
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
  updateAdminPhone,
  startPairing,
  cancelPairing,
  getPairingStatus,
  gerarCodigoPareamento,
  statusCodigoPareamento,
  cancelarCodigoPareamento,
} from '../controllers/whatsappAdminPhoneController';
import {
  getBankIntegration,
  saveBankIntegration,
} from '../controllers/bankIntegrationController';
import {
  listBotUsers,
  createBotUser,
  updateBotUser,
  deleteBotUser,
  generatePin,
  getPinStatus,
} from '../controllers/whatsappBotUserController';

const router: Router = Router();

// Rotas do bot (setup, status, disconnect)
router.post('/setup', setupWhatsapp);
router.get('/status', getWhatsappStatus);
router.delete('/disconnect', disconnectWhatsapp);

// Preferências de notificação
router.get('/notif-prefs', getNotifPrefs);
router.patch('/notif-prefs', updateNotifPrefs);

// Rotas de gerenciamento de números de WhatsApp
router.get('/phones', listLavadorPhones);
router.patch('/phones/:lavadorId', updateLavadorPhone);
router.delete('/phones/:lavadorId', deleteLavadorPhone);

// Rotas de configuração
router.get('/config', getWhatsappConfig);
router.patch('/config', updateWhatsappConfig);

// Integração bancária / PIX
router.get('/bank-integration', getBankIntegration);
router.patch('/bank-integration', saveBankIntegration);

// Rotas de números de admin
router.get('/admin-phones', listAdminPhones);
router.post('/admin-phones', createAdminPhone);

// Pareamento de admin — ANTES das rotas com :adminPhoneId para evitar conflito
router.get('/admin-phones/pair', getPairingStatus);
router.post('/admin-phones/pair', startPairing);
router.delete('/admin-phones/pair', cancelPairing);

// Pareamento por código de 4 dígitos
router.post('/admin-phones/pair-code', gerarCodigoPareamento);
router.get('/admin-phones/pair-code', statusCodigoPareamento);
router.delete('/admin-phones/pair-code', cancelarCodigoPareamento);

// Rotas com parâmetro (devem vir depois das rotas específicas)
router.delete('/admin-phones/:adminPhoneId', deleteAdminPhone);
router.patch('/admin-phones/:adminPhoneId', updateAdminPhone);

// Usuários do bot (LAVADOR / CAIXA / FINANCEIRO)
router.get('/bot-users',             listBotUsers);
router.post('/bot-users',            createBotUser);
router.patch('/bot-users/:id',       updateBotUser);
router.delete('/bot-users/:id',      deleteBotUser);
router.post('/bot-users/:id/pin',    generatePin);
router.get('/bot-users/:id/pin',     getPinStatus);

export default router;
