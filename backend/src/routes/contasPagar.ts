import { Router } from 'express';
import {
  listarContasPagar, resumoContasPagar, criarContaPagar, editarContaPagar,
  excluirContaPagar, pagarContaPagar, excluirFrequente,
} from '../controllers/contasPagarController';
import { requirePermission } from '../middlewares/permissionMiddleware';

const router: Router = Router();

// Contas a pagar é financeiro: dono sempre passa; subconta precisa de ver_financeiro
router.use(requirePermission('ver_financeiro'));

router.get('/', listarContasPagar);
router.get('/resumo', resumoContasPagar);
router.post('/', criarContaPagar);
router.delete('/frequentes/:id', excluirFrequente);
router.put('/:id', editarContaPagar);
router.delete('/:id', excluirContaPagar);
router.post('/:id/pagar', pagarContaPagar);

export default router;
