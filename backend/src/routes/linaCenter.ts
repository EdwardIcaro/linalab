import { Router } from 'express';
import {
  requireLcAtivo,
  createLcCliente,
  getLcClientes,
  getLcClienteById,
  updateLcCliente,
  deleteLcCliente,
  createLcFuncionario,
  getLcFuncionarios,
  getLcFuncionariosSimple,
  updateLcFuncionario,
  deleteLcFuncionario,
  resetarPinLcFuncionario,
  regenerarLinkLcFuncionario,
  vincularUsuarioLcFuncionario,
  createLcServico,
  getLcServicos,
  getLcServicosSimple,
  updateLcServico,
  deleteLcServico,
  createLcOrdem,
  getLcOrdens,
  getLcOrdemById,
  updateLcOrdemStatus,
  finalizarLcOrdem,
  cancelLcOrdem,
  getLcDashboardResumo,
  getLcFaturamentoPorMetodo,
  getLcComissoesPorFuncionario,
  getLcFaturamentoUltimos7Dias,
} from '../controllers/lcController';

const router: Router = Router();

// Todas as rotas exigem o sistema 'lina-center' ativo para a empresa (empresa_sistemas)
router.use(requireLcAtivo);

// Clientes
router.post('/clientes', createLcCliente);
router.get('/clientes', getLcClientes);
router.get('/clientes/:id', getLcClienteById);
router.put('/clientes/:id', updateLcCliente);
router.delete('/clientes/:id', deleteLcCliente);

// Funcionários
router.post('/funcionarios', createLcFuncionario);
router.get('/funcionarios', getLcFuncionarios);
router.get('/funcionarios/simple', getLcFuncionariosSimple);
router.put('/funcionarios/:id', updateLcFuncionario);
router.delete('/funcionarios/:id', deleteLcFuncionario);
router.post('/funcionarios/:id/reset-pin', resetarPinLcFuncionario);
router.post('/funcionarios/:id/regenerar-link', regenerarLinkLcFuncionario);
router.post('/funcionarios/:id/vincular-usuario', vincularUsuarioLcFuncionario);

// Serviços
router.post('/servicos', createLcServico);
router.get('/servicos', getLcServicos);
router.get('/servicos/simple', getLcServicosSimple);
router.put('/servicos/:id', updateLcServico);
router.delete('/servicos/:id', deleteLcServico);

// Ordens de serviço
router.post('/ordens', createLcOrdem);
router.get('/ordens', getLcOrdens);
router.get('/ordens/:id', getLcOrdemById);
router.patch('/ordens/:id/status', updateLcOrdemStatus);
router.post('/ordens/:id/finalizar', finalizarLcOrdem);
router.patch('/ordens/:id/cancel', cancelLcOrdem);

// Dashboard / Financeiro
router.get('/dashboard-resumo', getLcDashboardResumo);
router.get('/financeiro/metodos', getLcFaturamentoPorMetodo);
router.get('/financeiro/comissoes-funcionario', getLcComissoesPorFuncionario);
router.get('/financeiro/semana', getLcFaturamentoUltimos7Dias);

export default router;
