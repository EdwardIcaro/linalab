import { Router } from 'express';
import authMiddleware from '../middlewares/authMiddleware';
import {
  createOrdem,
  getOrdens,
  getOrdemById,
  updateOrdem,
  cancelOrdem,
  getOrdensStats,
  deleteOrdem,
  finalizarOrdem
} from '../controllers/ordemController';

const router: Router = Router();

// Rotas de ordens de serviço (todas requerem middleware de multi-empresa)
router.post('/', authMiddleware, createOrdem);
router.get('/', authMiddleware, getOrdens);
router.get('/stats', authMiddleware, getOrdensStats);
router.get('/:id', authMiddleware, getOrdemById);
router.put('/:id', authMiddleware, updateOrdem);
router.post('/:id/finalizar', authMiddleware, finalizarOrdem);
router.patch('/:id/cancel', authMiddleware, cancelOrdem);
router.delete('/:id', authMiddleware, deleteOrdem);

export default router;
