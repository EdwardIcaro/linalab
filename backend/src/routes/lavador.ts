import { Router } from 'express';
import {
    createLavador,
    getLavadores,
    updateLavador,
    deleteLavador,
    gerarTokenPublico,
    gerarLinkPermanente,
    getLavadoresSimple,
    getLavadorTokens,
    updateLavadorTokenStatus,
    toggleLavadorToken,
    deleteLavadorToken
} from '../controllers/lavadorController';

const router: Router = Router();

router.get('/', getLavadores);
router.get('/simple', getLavadoresSimple); // <-- Rota que estava faltando
router.get('/tokens', getLavadorTokens);
router.put('/tokens/:id/status', updateLavadorTokenStatus);
router.patch('/tokens/:id/toggle', toggleLavadorToken);
router.delete('/tokens/:id', deleteLavadorToken);
router.post('/', createLavador);
router.put('/:id', updateLavador);
router.delete('/:id', deleteLavador);
router.post('/:id/token', gerarTokenPublico);
router.post('/:id/link-permanente', gerarLinkPermanente);

export default router;
