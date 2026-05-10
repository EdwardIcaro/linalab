import { Router } from 'express';
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

router.get('/status', getStatusCaixa);
router.post('/abertura', abrirCaixa);
router.get('/resumo-dia', getResumoDia);
router.get('/valores-esperados', getValoresEsperados);
router.get('/ganhos-mes', getGanhosDoMes);
router.get('/historico', getHistorico);
router.get('/comissoes', getDadosComissao);
router.get('/comissoes/historico', getHistoricoComissoes);
router.get('/comissoes/fechamento/:id', getFechamentoComissaoById);
router.get('/fechamento/:id', getFechamentoById);
router.post('/fechamento', createFechamento);
router.post('/saida', createSaida);
router.post('/sangria', createSangria);
router.post('/comissoes/fechar', fecharComissao);
router.put('/registros/:id', updateCaixaRegistro);
router.delete('/registros/:id', deleteCaixaRegistro);
router.delete('/adiantamento/:id', deleteAdiantamento);
router.post('/comissoes/migrar-historico', migrarPagamentosComissaoAntigos); // Rota para a migração

export default router;