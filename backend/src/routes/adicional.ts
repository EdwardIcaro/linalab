import { Router } from 'express';
import { requirePermissionByMethod } from '../middlewares/permissionMiddleware';
import { createAdicional, getAdicionais, getAdicionaisSimple, updateAdicional, deleteAdicional } from '../controllers/adicionalController';

const router: Router = Router();

// RBAC: ler adicionais libera pra quem cria ordem; editar exige config_ver_servicos
router.use(requirePermissionByMethod({ read: ['config_ver_servicos', 'gerenciar_ordens'], write: ['config_ver_servicos'] }));

router.get('/', getAdicionais);
router.get('/simple', getAdicionaisSimple);
router.post('/', createAdicional);
router.put('/:id', updateAdicional);
router.delete('/:id', deleteAdicional);

export default router;