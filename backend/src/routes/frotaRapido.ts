import { Router } from 'express';
import { quem, entrar, sessaoFrota, pendentes, confirmarRapido, devolverRapido } from '../controllers/frotaRapidoController';

// Acesso rápido da confirmação de frota: link pessoal + senha → sessão de 12 h só para estas rotas
const router = Router();
router.get('/quem', quem);
router.post('/entrar', entrar);
router.get('/pendentes', sessaoFrota as any, pendentes as any);
router.post('/confirmar', sessaoFrota as any, confirmarRapido as any);
router.post('/:id/devolver', sessaoFrota as any, devolverRapido as any);

export default router;
