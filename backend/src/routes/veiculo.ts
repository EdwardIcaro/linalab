import { Router } from 'express';
import { requirePermission } from '../middlewares/permissionMiddleware';
import {
  createVeiculo,
  getVeiculos,
  getVeiculoById,
  updateVeiculo,
  deleteVeiculo,
  getVeiculoByPlaca,
  transferirVeiculo
} from '../controllers/veiculoController';

const router: Router = Router();

// RBAC: veículos acompanham clientes (também usados na Nova Ordem)
router.use(requirePermission('gerenciar_clientes', 'gerenciar_ordens'));

// Rotas de veículos (todas requerem middleware de multi-empresa)
router.post('/', createVeiculo);
router.get('/', getVeiculos);
router.get('/placa/:placa', getVeiculoByPlaca);
router.get('/:id', getVeiculoById);
router.put('/:id', updateVeiculo);
router.patch('/:id/transferir', transferirVeiculo);
router.delete('/:id', deleteVeiculo);

export default router;