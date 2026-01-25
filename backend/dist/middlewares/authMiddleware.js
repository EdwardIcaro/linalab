"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("../db"));
/**
 * SECURE Authentication Middleware
 *
 * SECURITY FEATURES:
 * 1. Extracts empresaId from signed JWT token (not from untrusted headers)
 * 2. Validates token signature and expiration
 * 3. Verifies user still owns/belongs to the empresa in database
 * 4. Requires JWT_SECRET to be configured (no fallback)
 *
 * This middleware prevents:
 * - Horizontal Privilege Escalation (accessing other companies' data)
 * - Token tampering (empresaId is signed)
 * - Stale permissions (re-validates on each request)
 */
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    // 1. Validate Authorization header exists
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Token de autenticação não fornecido ou malformado',
            code: 'MISSING_TOKEN'
        });
    }
    // 2. Validate JWT_SECRET is configured (SECURITY: no fallback!)
    if (!process.env.JWT_SECRET) {
        console.error('[SECURITY CRITICAL] JWT_SECRET not configured');
        return res.status(500).json({
            error: 'Erro de configuração do servidor',
            code: 'CONFIG_ERROR'
        });
    }
    const token = authHeader.split(' ')[1];
    try {
        // 3. Verify and decode JWT token
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        // 4. Validate required claims exist in token
        if (!decoded.id || !decoded.empresaId) {
            console.warn(`[SECURITY] Token missing required claims: id=${!!decoded.id}, empresaId=${!!decoded.empresaId}`);
            return res.status(401).json({
                error: 'Token inválido: selecione uma empresa para continuar',
                code: 'INVALID_SCOPE'
            });
        }
        // 5. CRITICAL: Verify user still owns/belongs to this empresa
        // This prevents access if:
        // - User was removed from empresa
        // - Empresa was deleted/deactivated
        // - Token was issued for an empresa the user no longer owns
        const empresa = await db_1.default.empresa.findFirst({
            where: {
                id: decoded.empresaId,
                usuarioId: decoded.id, // Must be owner
                ativo: true, // Must be active
            },
            select: {
                id: true,
                nome: true,
            }
        });
        if (!empresa) {
            console.warn(`[SECURITY] Access denied: User ${decoded.id} tried to access empresa ${decoded.empresaId} - not owner or inactive`);
            return res.status(403).json({
                error: 'Acesso negado: você não tem permissão para acessar esta empresa',
                code: 'ACCESS_DENIED'
            });
        }
        // 6. Attach verified data to request
        const authenticatedReq = req;
        authenticatedReq.usuarioId = decoded.id;
        authenticatedReq.empresaId = empresa.id; // Use DB value, not token (extra safety)
        authenticatedReq.usuarioNome = decoded.nome;
        authenticatedReq.empresaNome = empresa.nome;
        next();
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.default.TokenExpiredError) {
            return res.status(401).json({
                error: 'Sessão expirada. Faça login novamente.',
                code: 'TOKEN_EXPIRED'
            });
        }
        if (error instanceof jsonwebtoken_1.default.JsonWebTokenError) {
            console.warn(`[SECURITY] Invalid JWT: ${error.message}`);
            return res.status(401).json({
                error: 'Token inválido',
                code: 'INVALID_TOKEN'
            });
        }
        console.error('[AUTH] Unexpected error:', error);
        return res.status(500).json({
            error: 'Erro interno de autenticação',
            code: 'AUTH_ERROR'
        });
    }
};
exports.default = authMiddleware;
//# sourceMappingURL=authMiddleware.js.map