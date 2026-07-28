import { Router } from 'express';
import { requirePermission } from '../middlewares/permissionMiddleware';
import {
  createCliente,
  getClientes,
  getClienteById,
  updateCliente,
  deleteCliente,
  getClienteByPlaca
} from '../controllers/clienteController';

const router: Router = Router();

// RBAC: clientes são lidos/criados também no fluxo de Nova Ordem
router.use(requirePermission('gerenciar_clientes', 'gerenciar_ordens'));

// Rotas de clientes (todas requerem middleware de multi-empresa)
router.post('/', createCliente);
router.get('/', getClientes);
router.put('/:id', updateCliente);
router.delete('/:id', deleteCliente);
router.get('/veiculo/placa/:placa', getClienteByPlaca); // Rota corrigida
router.get('/:id', getClienteById);

export default router;
