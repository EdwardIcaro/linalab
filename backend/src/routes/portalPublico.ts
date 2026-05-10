import { Router } from 'express';
import { resolverTokenPublico } from '../controllers/portalPublicoController';

const router = Router();

// Rota pública — sem autenticação — resolve token curto do lavador
router.get('/:token', resolverTokenPublico);

export default router;
