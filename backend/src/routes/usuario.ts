import { Router } from 'express';
import { createUsuario, authenticateUsuario, generateScopedToken, getMeuPerfil, changePassword } from '../controllers/usuarioController';
import { recuperarSenha, resetarSenha, validarTokenReset } from '../controllers/recuperacaoSenhaController';
import userAuthMiddleware from '../middlewares/userAuthMiddleware';

const router: Router = Router();

// Rota para criar um novo usuário
router.post('/', createUsuario);

// Rota para autenticar (login) um usuário
router.post('/auth', authenticateUsuario);

// Rota para gerar um novo token com o escopo de uma empresa
router.post('/scope-token', userAuthMiddleware, generateScopedToken);

// Perfil do usuário logado
router.get('/me', userAuthMiddleware, getMeuPerfil);

// Alterar senha
router.post('/change-password', userAuthMiddleware, changePassword);

// Recuperação de senha - user solicita
router.post('/recuperar-senha', recuperarSenha);

// Validar token de reset (frontend)
router.get('/validar-token-reset', validarTokenReset);

// Resetar senha - user confirma com token
router.post('/resetar-senha', resetarSenha);

export default router;