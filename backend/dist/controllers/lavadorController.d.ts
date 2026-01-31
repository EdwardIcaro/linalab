import { Request, Response } from 'express';
interface EmpresaRequest extends Request {
    empresaId?: string;
}
export declare const createLavador: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getLavadores: (req: EmpresaRequest, res: Response) => Promise<void>;
export declare const getLavadoresSimple: (req: EmpresaRequest, res: Response) => Promise<void>;
/**
 * Listar tokens de acesso dos lavadores da empresa
 */
export declare const getLavadorTokens: (req: EmpresaRequest, res: Response) => Promise<void>;
/**
 * Atualizar status de um token
 */
export declare const updateLavadorTokenStatus: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Alternar status do token (ativo/inativo)
 */
export declare const toggleLavadorToken: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Excluir token de acesso
 */
export declare const deleteLavadorToken: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const updateLavador: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const deleteLavador: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Gera um token JWT para a página pública do lavador.
 */
export declare const gerarTokenPublico: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export {};
//# sourceMappingURL=lavadorController.d.ts.map