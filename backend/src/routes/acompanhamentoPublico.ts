import { Router } from 'express';
import { getAcompanhamentoPublico } from '../controllers/acompanhamentoController';

// Página pública do acompanhamento do veículo (sem login)
const router = Router();
router.get('/:token', getAcompanhamentoPublico);

export default router;
