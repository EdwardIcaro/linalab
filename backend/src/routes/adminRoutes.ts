import { Router } from 'express';
import {
  getGlobalStats,
  listCompanies,
  getCompanyDetails,
  getRiskAlerts,
  getEngagement,
  toggleCompanyStatus,
  clearCache,
} from '../controllers/adminController';
import {
  salvarTelefoneAdmin,
  obterConfigWhatsapp,
  removerTelefoneAdmin,
  aprovarReset,
  rejeitarReset,
} from '../controllers/recuperacaoSenhaController';

const router: Router = Router();

/**
 * Admin Routes
 * All routes are protected by adminMiddleware in index.ts
 * Only users with LINA_OWNER role can access these endpoints
 */

// Global platform statistics
router.get('/stats', getGlobalStats);

// Company management
router.get('/empresas', listCompanies);
router.get('/empresas/:id/details', getCompanyDetails);
router.patch('/empresas/:id/toggle-status', toggleCompanyStatus);

// Risk and engagement metrics
router.get('/alerts', getRiskAlerts);
router.get('/engagement', getEngagement);

// Cache management
router.delete('/cache', clearCache);

// ========== NOTIFICAÇÕES E RECUPERAÇÃO DE SENHA ==========

// WhatsApp do admin
router.post('/whatsapp-telefone', salvarTelefoneAdmin);
// GET /confirmar-whatsapp-telefone é registrado PÚBLICO em index.ts (link do celular
// não tem JWT); não pode ficar aqui sob adminMiddleware.
router.get('/config/whatsapp', obterConfigWhatsapp);
router.delete('/whatsapp-telefone', removerTelefoneAdmin);

// Aprovação/rejeição de reset de senha
router.post('/resetar-senha/aprovar', aprovarReset);
router.post('/resetar-senha/rejeitar', rejeitarReset);

export default router;
