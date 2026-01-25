import { Request, Response } from 'express';
/**
 * Criar novo usuário
 */
export declare const createUsuario: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Gera um novo token com o escopo de uma empresa específica
 * SECURITY: Validates that the user actually owns/belongs to the empresa before issuing token
 */
export declare const generateScopedToken: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Autenticar usuário (login)
 * Returns a base token (no empresa scope) + list of user's empresas
 */
export declare const authenticateUsuario: (req: Request, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=usuarioController.d.ts.map