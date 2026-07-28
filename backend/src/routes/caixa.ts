import { Router } from 'express';
import { requirePermission } from '../middlewares/permissionMiddleware';
import {
  getStatusCaixa,
  abrirCaixa,
  createFechamento,
  createSaida,
  createSangria,
  getHistorico,
  getResumoDia,
  getValoresEsperados,
  getFechamentoById,
  getGanhosDoMes,
  getDadosComissao,
  fecharComissao,
  getHistoricoComissoes,
  getFechamentoComissaoById,
  updateCaixaRegistro,
  deleteCaixaRegistro,
  deleteAdiantamento,
  migrarPagamentosComissaoAntigos,
} from '../controllers/caixaController';

const router: Router = Router();

// RBAC — a rota /caixa serve 3 domínios com permissões distintas:
//  • Operação do caixa (status/abrir/fechar): quem vê financeiro OU opera ordens (hero do painel)
//  • Comissões da equipe: quem vê financeiro OU gerencia funcionários (página Comissões)
//  • Dados financeiros sensíveis (faturamento, saídas, histórico): apenas ver_financeiro
const caixaOperar   = requirePermission('ver_financeiro', 'gerenciar_ordens');
const comissoesTime = requirePermission('ver_financeiro', 'gerenciar_funcionarios');
const financeiro    = requirePermission('ver_financeiro');

// Operação do caixa
router.get('/status', caixaOperar, getStatusCaixa);
router.post('/abertura', caixaOperar, abrirCaixa);
router.post('/fechamento', caixaOperar, createFechamento);

// Comissões da equipe
router.get('/comissoes', comissoesTime, getDadosComissao);
router.get('/comissoes/historico', comissoesTime, getHistoricoComissoes);
router.get('/comissoes/fechamento/:id', comissoesTime, getFechamentoComissaoById);
router.post('/comissoes/fechar', comissoesTime, fecharComissao);
router.post('/comissoes/migrar-historico', comissoesTime, migrarPagamentosComissaoAntigos);

// Dados financeiros sensíveis
router.get('/resumo-dia', financeiro, getResumoDia);
router.get('/valores-esperados', financeiro, getValoresEsperados);
router.get('/ganhos-mes', financeiro, getGanhosDoMes);
router.get('/historico', financeiro, getHistorico);
router.get('/fechamento/:id', financeiro, getFechamentoById);
router.post('/saida', financeiro, createSaida);
router.post('/sangria', financeiro, createSangria);
router.put('/registros/:id', financeiro, updateCaixaRegistro);
router.delete('/registros/:id', financeiro, deleteCaixaRegistro);
router.delete('/adiantamento/:id', financeiro, deleteAdiantamento);

export default router;