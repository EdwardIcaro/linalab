"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
/**
 * User Authentication Middleware (No Empresa Scope)
 *
 * Used for routes that only need user identity, not empresa context.
 * Example: selecting an empresa, managing user profile, etc.
 *
 * SECURITY: No fallback JWT secret
 */
const userAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Token de autenticação não fornecido ou malformado',
            code: 'MISSING_TOKEN'
        });
    }
    // SECURITY: Require JWT_SECRET to be configured
    if (!process.env.JWT_SECRET) {
        console.error('[SECURITY CRITICAL] JWT_SECRET not configured');
        return res.status(500).json({
            error: 'Erro de configuração do servidor',
            code: 'CONFIG_ERROR'
        });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        if (!decoded.id) {
            return res.status(401).json({
                error: 'Token inválido',
                code: 'INVALID_TOKEN'
            });
        }
        const authReq = req;
        authReq.usuarioId = decoded.id;
        authReq.usuarioNome = decoded.nome;
        next();
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.default.TokenExpiredError) {
            return res.status(401).json({
                error: 'Sessão expirada. Faça login novamente.',
                code: 'TOKEN_EXPIRED'
            });
        }
        return res.status(401).json({
            error: 'Token inválido ou expirado',
            code: 'INVALID_TOKEN'
        });
    }
};
exports.default = userAuthMiddleware;
//# sourceMappingURL=userAuthMiddleware.js.map