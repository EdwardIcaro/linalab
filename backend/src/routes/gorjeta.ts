import { Router } from 'express';
import { createGorjeta, listGorjetas, deleteGorjeta } from '../controllers/gorjetaController';

const router: Router = Router();

router.post('/', createGorjeta);
router.get('/', listGorjetas);
router.delete('/:id', deleteGorjeta);

export default router;
