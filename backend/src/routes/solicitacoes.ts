import { Router } from 'express';
import { requirePermission } from '../middlewares/permissionMiddleware';
import {
  listarFila, aceitar, verChecklist, salvarChecklist,
  verConfig, salvarVinculo, alternarModelo,
} from '../controllers/solicitacaoController';

/** Portal (subconta ou dono numa empresa): mesma permissão de quem lança ordem. */
export const solicitacoesPortalRoutes: Router = Router();
solicitacoesPortalRoutes.use(requirePermission('gerenciar_ordens'));
solicitacoesPortalRoutes.get('/', listarFila);
solicitacoesPortalRoutes.post('/:id/aceitar', aceitar);
solicitacoesPortalRoutes.get('/:id/checklist', verChecklist);
solicitacoesPortalRoutes.put('/:id/checklist', salvarChecklist);

/** Hub (só o dono): modelos permanentes e vínculo por empresa. */
export const solicitacoesHubRoutes: Router = Router();
solicitacoesHubRoutes.get('/config', verConfig);
solicitacoesHubRoutes.put('/vinculos/:empresaId', salvarVinculo);
solicitacoesHubRoutes.post('/modelos/:modeloId', alternarModelo);
