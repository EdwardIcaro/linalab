import { Router } from 'express';
import { getAcompanhamentoPublico, getFotoPublica } from '../controllers/acompanhamentoController';

// Página pública do acompanhamento do veículo (sem login)
const router = Router();
router.get('/:token', getAcompanhamentoPublico);
router.get('/:token/foto/:fotoId', getFotoPublica);

export default router;
