import { Router } from 'express';
import {
  getPlanosDp,
  contratarDp,
  getImportaveis,
  salvarOnboarding,
  getStatusDp,
  getDashboardDp,
  getEquipeFuncionarioDp,
  getDpEspelho,
  getDpFuncionarios,
  criarDpFuncionario,
  vincularLavadorDp,
  atualizarDpFuncionario,
  resetarPinDpFuncionario,
  regenerarLinkDpFuncionario,
  gerarFaceTokenDpFuncionario,
  removerFaceDpFuncionario,
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
  getDpTotens,
  criarDpTotem,
  atualizarDpTotem,
  regenerarDpTotem,
} from '../controllers/dataPointController';
import authMiddleware from '../middlewares/authMiddleware';
import { requirePermission } from '../middlewares/permissionMiddleware';

const router: Router = Router();

// userAuthMiddleware (global em index.ts) — sem empresa scoped
router.get('/planos',     getPlanosDp);
router.post('/contratar', contratarDp);

// authMiddleware por rota — empresa scoped (extrai empresaId do JWT)
router.get('/status',                  authMiddleware, getStatusDp);
router.get('/dashboard',               authMiddleware, getDashboardDp);
router.get('/equipe-funcionario',      authMiddleware, requirePermission('ver_data_point_equipe'), getEquipeFuncionarioDp);
router.get('/espelho',                 authMiddleware, getDpEspelho);
router.get('/onboarding/importaveis',  authMiddleware, getImportaveis);
router.post('/onboarding/salvar',      authMiddleware, salvarOnboarding);

// Config da empresa
router.patch('/config', authMiddleware, atualizarConfigDp);

// Funcionários CRUD
router.get('/funcionarios',                         authMiddleware, getDpFuncionarios);
router.post('/funcionarios',                        authMiddleware, criarDpFuncionario);
router.post('/funcionarios/vincular-lavador',       authMiddleware, vincularLavadorDp);
router.put('/funcionarios/:id',                     authMiddleware, atualizarDpFuncionario);
router.post('/funcionarios/:id/reset-pin',          authMiddleware, resetarPinDpFuncionario);
router.post('/funcionarios/:id/regenerar-link',     authMiddleware, regenerarLinkDpFuncionario);
router.post('/funcionarios/:id/face-token',         authMiddleware, gerarFaceTokenDpFuncionario);
router.delete('/funcionarios/:id/face',             authMiddleware, removerFaceDpFuncionario);

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

// Totens (aparelhos de reconhecimento facial 1:N)
router.get('/totens',                authMiddleware, getDpTotens);
router.post('/totens',               authMiddleware, criarDpTotem);
router.patch('/totens/:id',          authMiddleware, atualizarDpTotem);
router.post('/totens/:id/regenerar', authMiddleware, regenerarDpTotem);

export default router;
