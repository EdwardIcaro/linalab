import { Router } from 'express';
import { requirePermission } from '../middlewares/permissionMiddleware';
import { createGorjeta, listGorjetas, deleteGorjeta } from '../controllers/gorjetaController';

const router: Router = Router();

// RBAC: gorjetas — quem cria ordem ou vê financeiro
router.use(requirePermission('ver_financeiro', 'gerenciar_ordens'));

router.post('/', createGorjeta);
router.get('/', listGorjetas);
router.delete('/:id', deleteGorjeta);

export default router;
