import { Router } from 'express';
import {
  listPromotions,
  getActivePromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  togglePromotion,
  incrementPromoUsage
} from '../controllers/promotionController';

const router: Router = Router();

/**
 * Rotas Públicas (Usuários)
 */

// Obter promoções ativas (para exibir no checkout)
router.get('/active', getActivePromotions);

/**
 * Rotas Admin (Protected by adminMiddleware em index.ts)
 */

// Listar todas as promoções
router.get('/', listPromotions);

// Criar nova promoção
router.post('/', createPromotion);

// Atualizar promoção
router.put('/:id', updatePromotion);

// Deletar promoção
router.delete('/:id', deletePromotion);

// Ativar/desativar promoção
router.patch('/:id/toggle', togglePromotion);

// Incrementar contador de usos
router.post('/:id/use', incrementPromoUsage);

export default router;
