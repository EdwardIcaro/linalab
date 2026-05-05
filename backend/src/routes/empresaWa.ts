import { Router } from 'express';
import authMiddleware from '../middlewares/authMiddleware';
import { getStatus, connect, disconnect, send, enviarTemplate, getTemplates, createTemplate, updateTemplate, deleteTemplate } from '../controllers/empresaWaController';

const router: Router = Router();

router.use(authMiddleware);

router.get   ('/status',           getStatus);
router.post  ('/connect',          connect);
router.post  ('/disconnect',       disconnect);
router.post  ('/send',             send);
router.post  ('/enviar',           enviarTemplate);
router.get   ('/templates',        getTemplates);
router.post  ('/templates',        createTemplate);
router.put   ('/templates/:id',    updateTemplate);
router.delete('/templates/:id',    deleteTemplate);

export default router;
