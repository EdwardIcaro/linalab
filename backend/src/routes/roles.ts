import { Router } from 'express';
import { requirePermission } from '../middlewares/permissionMiddleware';
import {
  getRolesAndUsers,
  upsertRole,
  deleteRole,
  updateRoleBotFeatures,
  createSubaccount,
  updateSubaccount,
  deleteSubaccount
} from '../controllers/rolesController';

const router: Router = Router();

// RBAC: gestão de cargos/funcionários
router.use(requirePermission('config_ver_usuarios', 'gerenciar_funcionarios'));

// Roles
router.get('/', getRolesAndUsers);
router.post('/', upsertRole);
router.patch('/:id/bot-features', updateRoleBotFeatures);
router.delete('/:id', deleteRole);

// Subaccounts
router.post('/subaccount', createSubaccount);
router.patch('/subaccount/:id', updateSubaccount);
router.delete('/subaccount/:id', deleteSubaccount);

export default router;
