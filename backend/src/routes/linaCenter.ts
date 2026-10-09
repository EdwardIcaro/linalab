import { Router } from 'express';
import {
  requireLcAtivo,
  ativarLinaCenter,
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
  getLcComissoesFuncionario,
  getLcOrdemChecklist,
  fecharLcComissao,
  getLcFaturamentoUltimos7Dias,
} from '../controllers/lcController';
import { requirePermission, requirePermissionByMethod } from '../middlewares/permissionMiddleware';

const router: Router = Router();

// Ativação — precisa vir ANTES do gate abaixo (é o próprio passo que liga o sistema).
// Só quem configura a empresa liga o sistema (dono sempre passa).
router.post('/ativar', requirePermission('gerenciar_configuracoes'), ativarLinaCenter);

// Todas as demais rotas exigem o sistema 'lina-center' ativo para a empresa (empresa_sistemas)
router.use(requireLcAtivo);

// Clientes
const podeClientes = requirePermission('gerenciar_clientes', 'gerenciar_ordens');
router.post('/clientes', podeClientes, createLcCliente);
router.get('/clientes', podeClientes, getLcClientes);
router.get('/clientes/:id', podeClientes, getLcClienteById);
router.put('/clientes/:id', podeClientes, updateLcCliente);
router.delete('/clientes/:id', podeClientes, deleteLcCliente);

// Funcionários
const podeFuncionarios = requirePermissionByMethod({ read: ['gerenciar_funcionarios', 'gerenciar_ordens', 'ver_financeiro'], write: ['gerenciar_funcionarios'] });
router.post('/funcionarios', podeFuncionarios, createLcFuncionario);
router.get('/funcionarios', podeFuncionarios, getLcFuncionarios);
router.get('/funcionarios/simple', podeFuncionarios, getLcFuncionariosSimple);
router.put('/funcionarios/:id', podeFuncionarios, updateLcFuncionario);
router.delete('/funcionarios/:id', podeFuncionarios, deleteLcFuncionario);
router.post('/funcionarios/:id/reset-pin', podeFuncionarios, resetarPinLcFuncionario);
router.post('/funcionarios/:id/regenerar-link', podeFuncionarios, regenerarLinkLcFuncionario);
router.post('/funcionarios/:id/vincular-usuario', podeFuncionarios, vincularUsuarioLcFuncionario);

// Serviços
const podeServicos = requirePermissionByMethod({ read: ['config_ver_servicos', 'gerenciar_ordens'], write: ['config_ver_servicos'] });
router.post('/servicos', podeServicos, createLcServico);
router.get('/servicos', podeServicos, getLcServicos);
router.get('/servicos/simple', podeServicos, getLcServicosSimple);
router.put('/servicos/:id', podeServicos, updateLcServico);
router.delete('/servicos/:id', podeServicos, deleteLcServico);

// Ordens de serviço
const podeOrdens = requirePermissionByMethod({ read: ['gerenciar_ordens', 'ver_dashboard'], write: ['gerenciar_ordens'] });
router.post('/ordens', podeOrdens, createLcOrdem);
router.get('/ordens', podeOrdens, getLcOrdens);
router.get('/ordens/:id', podeOrdens, getLcOrdemById);
router.get('/ordens/:id/checklist', podeOrdens, getLcOrdemChecklist);
router.patch('/ordens/:id/status', podeOrdens, updateLcOrdemStatus);
router.post('/ordens/:id/finalizar', podeOrdens, finalizarLcOrdem);
router.patch('/ordens/:id/cancel', podeOrdens, cancelLcOrdem);

// Dashboard / Financeiro
const podeDashboard = requirePermission('ver_dashboard', 'ver_financeiro');
const podeComissoes = requirePermission('ver_financeiro', 'gerenciar_funcionarios', 'ver_dashboard');
router.get('/dashboard-resumo', podeDashboard, getLcDashboardResumo);
router.get('/financeiro/metodos', requirePermission('ver_financeiro'), getLcFaturamentoPorMetodo);
router.get('/financeiro/comissoes-funcionario', podeComissoes, getLcComissoesPorFuncionario);

// Pagamento de comissão (fechamento) — espelha o fechamento do Lina Wash
router.get('/comissoes/:funcionarioId', requirePermission('ver_financeiro', 'gerenciar_funcionarios'), getLcComissoesFuncionario);
router.post('/comissoes/fechar', requirePermission('ver_financeiro', 'gerenciar_funcionarios'), fecharLcComissao);
router.get('/financeiro/semana', podeDashboard, getLcFaturamentoUltimos7Dias);

export default router;
