import { Router } from 'express';
import authMiddleware from '../middlewares/authMiddleware';
import { requirePermission, requirePermissionByMethod } from '../middlewares/permissionMiddleware';
import {
  createOrdem,
  getOrdens,
  getOrdemById,
  updateOrdem,
  cancelOrdem,
  getOrdensStats,
  getDashboardResumo,
  deleteOrdem,
  finalizarOrdem,
  gerarPixQr
} from '../controllers/ordemController';

const router: Router = Router();

// RBAC: ler ordens libera também pro painel (ver_dashboard); criar/editar exige gerenciar_ordens
router.use(requirePermissionByMethod({ read: ['gerenciar_ordens', 'ver_dashboard'], write: ['gerenciar_ordens'] }));

// Rotas de ordens de serviço (todas requerem middleware de multi-empresa)
router.post('/', authMiddleware, createOrdem);
router.get('/', authMiddleware, getOrdens);
router.get('/stats', authMiddleware, getOrdensStats);
router.get('/dashboard-resumo', authMiddleware, getDashboardResumo);
router.get('/:id', authMiddleware, getOrdemById);
router.put('/:id', authMiddleware, updateOrdem);
router.post('/:id/finalizar', authMiddleware, finalizarOrdem);
router.post('/:id/pix', authMiddleware, gerarPixQr);
router.patch('/:id/cancel', authMiddleware, cancelOrdem);
// Excluir ordem = ação destrutiva opt-in: além de gerenciar_ordens (router), exige excluir_ordens
router.delete('/:id', authMiddleware, requirePermission('excluir_ordens'), deleteOrdem);

export default router;
