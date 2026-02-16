import { Router } from 'express';
import {
  createPagamento,
  getPagamentosByOrdem,
  updatePagamentoStatus,
  deletePagamento,
  getPaymentStats,
  quitarPendencia,
  quitarPendenciaSimples
} from '../controllers/pagamentoController';

const router: Router = Router();

/**
 * Criar novo pagamento
 * POST /api/pagamentos
 */
router.post('/', createPagamento);

/**
 * Quitar pendência - Novo formato (recomendado)
 * POST /api/pagamentos/quitar-pendencia
 * Body: { ordemId, pagamentoId, metodo }
 */
router.post('/quitar-pendencia', quitarPendenciaSimples);

/**
 * Listar pagamentos de uma ordem
 * GET /api/pagamentos/ordem/:ordemId
 */
router.get('/ordem/:ordemId', getPagamentosByOrdem);

/**
 * Atualizar status de um pagamento
 * PUT /api/pagamentos/:id/status
 */
router.put('/:id/status', updatePagamentoStatus);

/**
 * Excluir um pagamento
 * DELETE /api/pagamentos/:id
 */
router.delete('/:id', deletePagamento);

/**
 * Obter estatísticas de pagamento
 * GET /api/pagamentos/stats
 */
router.get('/stats', getPaymentStats);

export default router;
