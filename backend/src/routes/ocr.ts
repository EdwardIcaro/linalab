import { Router } from 'express';
import { reconhecerPlaca } from '../controllers/ocrController';

const router = Router();

// POST /api/ocr/placa — proxy para Plate Recognizer (protegido por userAuthMiddleware)
router.post('/placa', reconhecerPlaca);

export default router;
