import { Router } from 'express';
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

// Rotas de veículos (todas requerem middleware de multi-empresa)
router.post('/', createVeiculo);
router.get('/', getVeiculos);
router.get('/placa/:placa', getVeiculoByPlaca);
router.get('/:id', getVeiculoById);
router.put('/:id', updateVeiculo);
router.patch('/:id/transferir', transferirVeiculo);
router.delete('/:id', deleteVeiculo);

export default router;