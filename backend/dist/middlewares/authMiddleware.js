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
        // 4b. Subaccount token validation
        if (decoded.subaccountId) {
            const subaccount = await db_1.default.subaccount.findFirst({
                where: {
                    id: decoded.subaccountId,
                    empresaId: decoded.empresaId
                },
                include: {
                    empresa: {
                        select: {
                            id: true,
                            nome: true,
                            ativo: true
                        }
                    }
                }
            });
            if (!subaccount || !subaccount.empresa?.ativo) {
                return res.status(403).json({
                    error: 'Acesso negado: você não tem permissão para acessar esta empresa',
                    code: 'ACCESS_DENIED'
                });
            }
            const authenticatedReq = req;
            authenticatedReq.usuarioId = subaccount.id;
            authenticatedReq.subaccountId = subaccount.id;
            authenticatedReq.empresaId = subaccount.empresa.id;
            authenticatedReq.usuarioNome = subaccount.nome;
            authenticatedReq.empresaNome = subaccount.empresa.nome;
            next();
            return;
        }
        // 4b. Subaccount token validation
        if (decoded.subaccountId) {
            const subaccount = await db_1.default.subaccount.findFirst({
                where: {
                    id: decoded.subaccountId,
                    empresaId: decoded.empresaId
                },
                include: {
                    empresa: {
                        select: {
                            id: true,
                            nome: true,
                            ativo: true
                        }
                    }
                }
            });
            if (!subaccount || !subaccount.empresa?.ativo) {
                return res.status(403).json({
                    error: 'Acesso negado: você não tem permissão para acessar esta empresa',
                    code: 'ACCESS_DENIED'
                });
            }
            const authenticatedReq = req;
            authenticatedReq.usuarioId = subaccount.id;
            authenticatedReq.subaccountId = subaccount.id;
            authenticatedReq.empresaId = subaccount.empresa.id;
            authenticatedReq.usuarioNome = subaccount.nome;
            authenticatedReq.empresaNome = subaccount.empresa.nome;
            next();
            return;
        }
        // 5. CRITICAL: TENANT ISOLATION - Verify user owns/belongs to this empresa
        // This prevents VERTICAL PRIVILEGE ESCALATION attacks where:
        // - User A tries to access Company B's data
        // - User was removed from empresa after token was issued
        // - Empresa was deleted/deactivated
        // - Token was forged/tampered with (prevented by JWT signature)
        //
        // SECURITY NOTE: This query validates THREE critical conditions:
        // 1. Empresa exists (id match)
        // 2. User is the owner (usuarioId match)
        // 3. Empresa is active (ativo = true)
        const empresa = await db_1.default.empresa.findFirst({
            where: {
                id: decoded.empresaId,
                usuarioId: decoded.id, // CRITICAL: Must be owner of this empresa
                ativo: true, // CRITICAL: Must be active
            },
            select: {
                id: true,
                nome: true,
                usuarioId: true, // Include for double-verification
            }
        });
        if (!empresa) {
            console.warn(`[SECURITY VIOLATION] Tenant isolation breach attempt: ` +
                `User ${decoded.id} (${decoded.nome}) attempted to access empresa ${decoded.empresaId} - ` +
                `Reason: Not owner or empresa inactive/deleted`);
            return res.status(403).json({
                error: 'Acesso negado: você não tem permissão para acessar esta empresa',
                code: 'ACCESS_DENIED'
            });
        }
        // 6. DOUBLE VERIFICATION: Ensure usuarioId from DB matches token
        // This is paranoid checking but adds an extra security layer
        if (empresa.usuarioId !== decoded.id) {
            console.error(`[SECURITY CRITICAL] Database inconsistency detected: ` +
                `empresa.usuarioId (${empresa.usuarioId}) != token.id (${decoded.id})`);
            return res.status(403).json({
                error: 'Erro de validação de segurança',
                code: 'SECURITY_ERROR'
            });
        }
        // 7. Attach verified data to request
        // IMPORTANT: Use empresa.id from database, NOT decoded.empresaId from token
        // This ensures we're using the validated, authoritative source
        const authenticatedReq = req;
        authenticatedReq.usuarioId = decoded.id;
        authenticatedReq.empresaId = empresa.id; // CRITICAL: Use DB value, not token
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