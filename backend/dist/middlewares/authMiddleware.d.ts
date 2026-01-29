import { Request, Response, NextFunction } from 'express';
/**
 * Extended Request with authenticated user data
 */
export interface AuthenticatedRequest extends Request {
    usuarioId: string;
    empresaId: string;
    usuarioNome?: string;
    empresaNome?: string;
    subaccountId?: string;
}
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
declare const authMiddleware: (req: Request, res: Response, next: NextFunction) => Promise<void | Response>;
export default authMiddleware;
//# sourceMappingURL=authMiddleware.d.ts.map