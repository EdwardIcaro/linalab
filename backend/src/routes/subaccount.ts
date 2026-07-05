import { Router } from 'express';
import { getMinhasEmpresas, switchEmpresa } from '../controllers/subaccountAcessoController';

const router: Router = Router();

// Auth: userAuthMiddleware (aplicado no index.ts) → req.usuarioId = id do subaccount
router.get('/me/empresas', getMinhasEmpresas);
router.post('/switch-empresa', switchEmpresa);

export default router;
