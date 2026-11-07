import { Router } from 'express';
import { requirePermission } from '../middlewares/permissionMiddleware';
import {
  createVeiculo,
  getVeiculos,
  getVeiculoById,
  updateVeiculo,
  deleteVeiculo,
  getVeiculoByPlaca,
  transferirVeiculo,
  getModelosVeiculos
} from '../controllers/veiculoController';
import { historicoDaPlaca, corrigirModeloNaRede, frotaDaRede } from '../controllers/veiculoRedeController';

const router: Router = Router();

// RBAC: veículos acompanham clientes (também usados na Nova Ordem)
router.use(requirePermission('gerenciar_clientes', 'gerenciar_ordens'));

// Rotas de veículos (todas requerem middleware de multi-empresa)
router.post('/', createVeiculo);
router.get('/', getVeiculos);
router.get('/modelos', getModelosVeiculos);
// Modelo compartilhado entre as empresas da rede (histórico, correção, frota Localiza)
router.get('/rede/historico/:placa', historicoDaPlaca);
router.post('/rede/modelo/:placa', corrigirModeloNaRede);
router.get('/rede/frota/:clienteId', frotaDaRede);
router.get('/placa/:placa', getVeiculoByPlaca);
router.get('/:id', getVeiculoById);
router.put('/:id', updateVeiculo);
router.patch('/:id/transferir', transferirVeiculo);
router.delete('/:id', deleteVeiculo);

export default router;