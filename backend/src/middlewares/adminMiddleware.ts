import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../db';

/**
 * JWT Token Payload with Role
 */
interface JwtPayload {
  id: string;
  nome: string;
  role?: string;
  empresaId?: string;
  iat: number;
  exp: number;
}

/**
 * Extended Request with admin user data
 */
export interface AdminRequest extends Request {
  usuarioId: string;
  usuarioNome?: string;
  role: string;
}

/**
 * Admin Authentication Middleware
 *
 * SECURITY:
 * - Validates JWT token
 * - Checks if user has LINA_OWNER role
 * - Prevents non-admin users from accessing admin routes
 *
 * Usage: Apply this middleware to all /api/admin/* routes
 */
const adminMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  const authHeader = req.headers.authorization;

  // 1. Validate Authorization header
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Token de autenticação não fornecido',
      code: 'MISSING_TOKEN'
    });
  }

  // 2. Validate JWT_SECRET is configured
  if (!process.env.JWT_SECRET) {
    console.error('[SECURITY CRITICAL] JWT_SECRET not configured');
    return res.status(500).json({
      error: 'Erro de configuração do servidor',
      code: 'CONFIG_ERROR'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 3. Verify and decode JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as JwtPayload;

    if (!decoded.id) {
      return res.status(401).json({
        error: 'Token inválido',
        code: 'INVALID_TOKEN'
      });
    }

    // 4. Fetch user from database to get current role
    const usuario = await prisma.usuario.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
      },
    });

    if (!usuario) {
      return res.status(401).json({
        error: 'Usuário não encontrado',
        code: 'USER_NOT_FOUND'
      });
    }

    // 5. CRITICAL: Check if user has LINA_OWNER role
    if (usuario.role !== 'LINA_OWNER') {
      console.warn(
        `[SECURITY] Access denied: User ${usuario.email} (role: ${usuario.role}) attempted to access admin route`
      );
      return res.status(403).json({
        error: 'Acesso negado: apenas administradores do sistema podem acessar esta área',
        code: 'FORBIDDEN'
      });
    }

    // 6. Attach admin user data to request
    const adminReq = req as AdminRequest;
    adminReq.usuarioId = usuario.id;
    adminReq.usuarioNome = usuario.nome;
    adminReq.role = usuario.role;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        error: 'Sessão expirada. Faça login novamente.',
        code: 'TOKEN_EXPIRED'
      });
    }

    if (error instanceof jwt.JsonWebTokenError) {
      console.warn(`[SECURITY] Invalid JWT: ${error.message}`);
      return res.status(401).json({
        error: 'Token inválido',
        code: 'INVALID_TOKEN'
      });
    }

    console.error('[ADMIN AUTH] Unexpected error:', error);
    return res.status(500).json({
      error: 'Erro interno de autenticação',
      code: 'AUTH_ERROR'
    });
  }
};

export default adminMiddleware;
