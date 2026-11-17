import { Router } from 'express';
import { requirePermission } from '../middlewares/permissionMiddleware';
import {
  listarFila, aceitar, remover, verChecklist, salvarChecklist, enviarChecklist, verResponsaveis, salvarResponsavelCtrl,
  verConfig, salvarVinculo, alternarModelo,
} from '../controllers/solicitacaoController';

/** Portal (subconta ou dono numa empresa): mesma permissão de quem lança ordem. */
export const solicitacoesPortalRoutes: Router = Router();
solicitacoesPortalRoutes.use(requirePermission('gerenciar_ordens'));
solicitacoesPortalRoutes.get('/', listarFila);
solicitacoesPortalRoutes.get('/responsaveis', verResponsaveis);
solicitacoesPortalRoutes.put('/responsaveis', salvarResponsavelCtrl);
solicitacoesPortalRoutes.post('/:id/aceitar', aceitar);
solicitacoesPortalRoutes.post('/:id/remover', remover);
solicitacoesPortalRoutes.get('/:id/checklist', verChecklist);
solicitacoesPortalRoutes.put('/:id/checklist', salvarChecklist);
solicitacoesPortalRoutes.post('/:id/checklist/enviar', enviarChecklist);

/** Hub (só o dono): modelos permanentes e vínculo por empresa. */
export const solicitacoesHubRoutes: Router = Router();
solicitacoesHubRoutes.get('/config', verConfig);
solicitacoesHubRoutes.put('/vinculos/:empresaId', salvarVinculo);
solicitacoesHubRoutes.post('/modelos/:modeloId', alternarModelo);
