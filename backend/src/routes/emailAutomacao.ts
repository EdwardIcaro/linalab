/**
 * Automação de Email por empresa — /api/email-automacao/*
 *
 * Montagem no index.ts: authMiddleware + requireFeatureEmpresa('lina_whatsapp').
 * Aqui só a permissão de cargo: owner passa sempre; funcionário precisa de
 * `gerenciar_configuracoes` (a mesma da aba de Configurações).
 */

import { Router } from 'express';
import { requirePermission } from '../middlewares/permissionMiddleware';
import {
  listarContas,
  criarConta,
  trocarSenha,
  verificarConta,
  removerConta,
  listarEmails,
  lerEmail,
  listarRegras,
  criarRegra,
  atualizarRegra,
  removerRegra,
  listarContatos,
  testarEnvio,
} from '../controllers/emailAutomacaoController';

const router: Router = Router();

router.use(requirePermission('gerenciar_configuracoes'));

// Contas de email (até 2 por empresa)
router.get('/contas', listarContas);
router.post('/contas', criarConta);
router.put('/contas/:id/senha', trocarSenha);
router.post('/contas/:id/verificar', verificarConta);
router.delete('/contas/:id', removerConta);

// Caixa de entrada — usada pelo assistente; nada é salvo
router.get('/contas/:id/emails', listarEmails);
router.get('/contas/:id/emails/:uid', lerEmail);

// Contatos que podem receber (telefone mascarado; a regra guarda só o ID)
router.get('/contatos', listarContatos);

// Automações
router.get('/regras', listarRegras);
router.post('/regras', criarRegra);
router.put('/regras/:id', atualizarRegra);
router.delete('/regras/:id', removerRegra);
router.post('/regras/:id/testar-envio', testarEnvio);

export default router;
