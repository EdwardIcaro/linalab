import { Router } from 'express';
import { getHub } from '../controllers/hubController';
import {
  getSubaccountsComAcessos,
  getRolesDaEmpresa,
  concederAcesso,
  revogarAcesso,
} from '../controllers/subaccountAcessoController';

const router: Router = Router();

router.get('/', getHub);

// Gestão de acesso multi-empresa de subaccounts (OWNER)
router.get('/subaccounts-todos', getSubaccountsComAcessos);
router.get('/empresas/:empresaId/roles', getRolesDaEmpresa);
router.post('/subaccounts/:subaccountId/acessos', concederAcesso);
router.delete('/subaccounts/:subaccountId/acessos/:empresaId', revogarAcesso);

export default router;
