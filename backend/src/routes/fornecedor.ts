import { Router } from 'express';
import { requirePermission } from '../middlewares/permissionMiddleware';
import { getFornecedores } from '../controllers/fornecedorController';

const router: Router = Router();

// RBAC: fornecedores fazem parte do financeiro
router.use(requirePermission('ver_financeiro'));

router.get('/', getFornecedores);

export default router;