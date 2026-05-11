import { Router } from 'express';
import {
  getPlanosDp,
  contratarDp,
  getImportaveis,
  salvarOnboarding,
  getStatusDp,
  getDashboardDp,
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

export default router;
