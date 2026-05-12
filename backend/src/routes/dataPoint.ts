import { Router } from 'express';
import {
  getPlanosDp,
  contratarDp,
  getImportaveis,
  salvarOnboarding,
  getStatusDp,
  getDashboardDp,
  getDpFuncionarios,
  criarDpFuncionario,
  atualizarDpFuncionario,
  resetarPinDpFuncionario,
  regenerarLinkDpFuncionario,
} from '../controllers/dataPointController';
import authMiddleware from '../middlewares/authMiddleware';

const router: Router = Router();

// userAuthMiddleware (global em index.ts) — sem empresa scoped
router.get('/planos',     getPlanosDp);
router.post('/contratar', contratarDp);

// authMiddleware por rota — empresa scoped (extrai empresaId do JWT)
router.get('/status',                  authMiddleware, getStatusDp);
router.get('/dashboard',               authMiddleware, getDashboardDp);
router.get('/onboarding/importaveis',  authMiddleware, getImportaveis);
router.post('/onboarding/salvar',      authMiddleware, salvarOnboarding);

// Funcionários CRUD
router.get('/funcionarios',                         authMiddleware, getDpFuncionarios);
router.post('/funcionarios',                        authMiddleware, criarDpFuncionario);
router.put('/funcionarios/:id',                     authMiddleware, atualizarDpFuncionario);
router.post('/funcionarios/:id/reset-pin',          authMiddleware, resetarPinDpFuncionario);
router.post('/funcionarios/:id/regenerar-link',     authMiddleware, regenerarLinkDpFuncionario);

export default router;
