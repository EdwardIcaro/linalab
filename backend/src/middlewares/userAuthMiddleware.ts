import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Extended Request with user authentication data (no empresa scope)
 */
export interface UserAuthRequest extends Request {
  usuarioId: string;
  usuarioNome?: string;
}

/**
 * User Authentication Middleware (No Empresa Scope)
 *
 * Used for routes that only need user identity, not empresa context.
 * Example: selecting an empresa, managing user profile, etc.
 *
 * SECURITY: No fallback JWT secret
 */
const userAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void | Response => {
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as { id: string; nome: string };

    if (!decoded.id) {
      return res.status(401).json({
        error: 'Token inválido',
        code: 'INVALID_TOKEN'
      });
    }

    const authReq = req as UserAuthRequest;
    authReq.usuarioId = decoded.id;
    authReq.usuarioNome = decoded.nome;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
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

export default userAuthMiddleware;