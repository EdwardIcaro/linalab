import { Router } from 'express';
import authMiddleware from '../middlewares/authMiddleware';
import { getRelatorioFinanceiroPublico, gerarRelatorioFinanceiro } from '../controllers/relatorioFinanceiroController';

const router: Router = Router();

// Autenticada — aciona o bot pra gerar/regenerar (ex: link expirado)
router.post('/gerar', authMiddleware, gerarRelatorioFinanceiro);

// Pública — token é a própria proteção (link enviado por WhatsApp)
router.get('/:token', getRelatorioFinanceiroPublico);

export default router;
