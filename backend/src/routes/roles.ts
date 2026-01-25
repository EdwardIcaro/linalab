import { Router } from 'express';
import {
  getRolesAndUsers,
  upsertRole,
  deleteRole,
  createSubaccount,
  updateSubaccount,
  deleteSubaccount
} from '../controllers/rolesController';

const router: Router = Router();

// Roles
router.get('/', getRolesAndUsers);
router.post('/', upsertRole);
router.delete('/:id', deleteRole);

// Subaccounts
router.post('/subaccount', createSubaccount);
router.patch('/subaccount/:id', updateSubaccount);
router.delete('/subaccount/:id', deleteSubaccount);

export default router;
