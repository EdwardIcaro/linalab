import { Router } from 'express';
import {
  getPlanosDp,
  contratarDp,
  getImportaveis,
  salvarOnboarding,
  getStatusDp,
} from '../controllers/dataPointController';

const router: Router = Router();

// userAuthMiddleware — rotas de usuário (sem empresa scoped)
router.get('/planos',    getPlanosDp);
router.post('/contratar', contratarDp);

// authMiddleware — rotas com empresa scoped
router.get('/status',                  getStatusDp);
router.get('/onboarding/importaveis',  getImportaveis);
router.post('/onboarding/salvar',      salvarOnboarding);

export default router;
