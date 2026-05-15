import { Router } from 'express';
import {
  getPlanosDp,
  contratarDp,
  getImportaveis,
  salvarOnboarding,
  getStatusDp,
  getDashboardDp,
  getDpEspelho,
  getDpFuncionarios,
  criarDpFuncionario,
  atualizarDpFuncionario,
  resetarPinDpFuncionario,
  regenerarLinkDpFuncionario,
  atualizarConfigDp,
  getMarcacoesDia,
  criarMarcacaoManual,
  editarMarcacao,
  excluirMarcacao,
  getDpAjustes,
  responderAjuste,
  getDpAfastamentos,
  criarDpAfastamento,
  atualizarDpAfastamento,
  excluirDpAfastamento,
} from '../controllers/dataPointController';
import authMiddleware from '../middlewares/authMiddleware';

const router: Router = Router();

// userAuthMiddleware (global em index.ts) — sem empresa scoped
router.get('/planos',     getPlanosDp);
router.post('/contratar', contratarDp);

// authMiddleware por rota — empresa scoped (extrai empresaId do JWT)
router.get('/status',                  authMiddleware, getStatusDp);
router.get('/dashboard',               authMiddleware, getDashboardDp);
router.get('/espelho',                 authMiddleware, getDpEspelho);
router.get('/onboarding/importaveis',  authMiddleware, getImportaveis);
router.post('/onboarding/salvar',      authMiddleware, salvarOnboarding);

// Config da empresa
router.patch('/config', authMiddleware, atualizarConfigDp);

// Funcionários CRUD
router.get('/funcionarios',                         authMiddleware, getDpFuncionarios);
router.post('/funcionarios',                        authMiddleware, criarDpFuncionario);
router.put('/funcionarios/:id',                     authMiddleware, atualizarDpFuncionario);
router.post('/funcionarios/:id/reset-pin',          authMiddleware, resetarPinDpFuncionario);
router.post('/funcionarios/:id/regenerar-link',     authMiddleware, regenerarLinkDpFuncionario);

// Marcações (CRUD admin)
router.get('/marcacoes',           authMiddleware, getMarcacoesDia);
router.post('/marcacoes',          authMiddleware, criarMarcacaoManual);
router.patch('/marcacoes/:id',     authMiddleware, editarMarcacao);
router.delete('/marcacoes/:id',    authMiddleware, excluirMarcacao);

// Ajustes
router.get('/ajustes',         authMiddleware, getDpAjustes);
router.put('/ajustes/:id',     authMiddleware, responderAjuste);

// Afastamentos
router.get('/afastamentos',         authMiddleware, getDpAfastamentos);
router.post('/afastamentos',        authMiddleware, criarDpAfastamento);
router.put('/afastamentos/:id',     authMiddleware, atualizarDpAfastamento);
router.delete('/afastamentos/:id',  authMiddleware, excluirDpAfastamento);

export default router;
