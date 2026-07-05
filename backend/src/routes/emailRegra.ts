import { Router } from 'express';
import {
  getEmailRegras,
  createEmailRegra,
  updateEmailRegra,
  deleteEmailRegra,
  getWhatsappGrupos,
} from '../controllers/emailRegraController';

const router: Router = Router();

// Grupos do bot (proxy) — antes de /:id para não conflitar
router.get('/grupos', getWhatsappGrupos);

router.get('/', getEmailRegras);
router.post('/', createEmailRegra);
router.put('/:id', updateEmailRegra);
router.delete('/:id', deleteEmailRegra);

export default router;
