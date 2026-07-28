import { Router } from 'express';
import { requirePermission, requirePermissionByMethod } from '../middlewares/permissionMiddleware';
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

// RBAC: ler lavadores libera pra quem cria ordem / vê financeiro; gerenciar exige gerenciar_funcionarios
router.use(requirePermissionByMethod({ read: ['gerenciar_funcionarios', 'gerenciar_ordens', 'ver_financeiro'], write: ['gerenciar_funcionarios'] }));

router.get('/', getLavadores);
router.get('/simple', getLavadoresSimple); // <-- Rota que estava faltando
// Tokens de link público do portal do lavador — restrito à gestão de equipe
router.get('/tokens', requirePermission('gerenciar_funcionarios'), getLavadorTokens);
router.put('/tokens/:id/status', updateLavadorTokenStatus);
router.patch('/tokens/:id/toggle', toggleLavadorToken);
router.delete('/tokens/:id', deleteLavadorToken);
router.post('/', createLavador);
router.put('/:id', updateLavador);
router.delete('/:id', deleteLavador);
router.post('/:id/token', gerarTokenPublico);
router.post('/:id/link-permanente', gerarLinkPermanente);

export default router;
