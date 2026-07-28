import { Router } from 'express';
import { requirePermissionByMethod } from '../middlewares/permissionMiddleware';
import {
  createTipoVeiculo,
  getTiposVeiculo,
  getTipoVeiculoById,
  updateTipoVeiculo,
  deleteTipoVeiculo,
  getSubtiposByTipo,
  reordenarTiposVeiculo
} from '../controllers/tipoVeiculoController';

const router: Router = Router();

// RBAC: leitura livre (usada na Nova Ordem); edição exige config_ver_servicos
router.use(requirePermissionByMethod({ read: [], write: ['config_ver_servicos'] }));

// Rotas de tipos de veículo (ex: /api/tipos-veiculo)
router.post('/', createTipoVeiculo);
router.get('/', getTiposVeiculo);
router.put('/reordenar', reordenarTiposVeiculo); // antes de /:id para não colidir
router.get('/:id', getTipoVeiculoById);
router.put('/:id', updateTipoVeiculo);
router.delete('/:id', deleteTipoVeiculo);

// Rota para obter subtipos por categoria (ex: /api/tipos-veiculo/subtipos/Carro)
router.get('/subtipos/:categoria', getSubtiposByTipo);

export default router;