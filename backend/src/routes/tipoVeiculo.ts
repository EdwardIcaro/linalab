import { Router } from 'express';
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