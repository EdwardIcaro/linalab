import { Router } from 'express';
import { createUsuario, authenticateUsuario, generateScopedToken, getMeuPerfil, changePassword } from '../controllers/usuarioController';
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

export default router;