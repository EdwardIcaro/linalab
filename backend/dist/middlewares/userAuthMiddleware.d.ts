import { Request, Response, NextFunction } from 'express';
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
declare const userAuthMiddleware: (req: Request, res: Response, next: NextFunction) => void | Response;
export default userAuthMiddleware;
//# sourceMappingURL=userAuthMiddleware.d.ts.map