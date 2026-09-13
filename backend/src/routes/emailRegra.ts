import { Router } from 'express';
import {
  getEmailRegras,
  createEmailRegra,
  updateEmailRegra,
  deleteEmailRegra,
  getWhatsappGrupos,
} from '../controllers/emailRegraController';
import adminMiddleware from '../middlewares/adminMiddleware';

const router: Router = Router();

// Config GLOBAL (sem empresaId) — só o dono do sistema (LINA_OWNER) pode ver/editar.
// Sem isso, qualquer cliente logado do SaaS listava/alterava as regras e os grupos do bot.
router.use(adminMiddleware);

// Grupos do bot (proxy) — antes de /:id para não conflitar
router.get('/grupos', getWhatsappGrupos);

router.get('/', getEmailRegras);
router.post('/', createEmailRegra);
router.put('/:id', updateEmailRegra);
router.delete('/:id', deleteEmailRegra);

export default router;
