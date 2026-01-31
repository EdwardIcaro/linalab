import { Request, Response } from 'express';
interface EmpresaRequest extends Request {
    empresaId?: string;
}
export declare const createAdicional: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getAdicionais: (req: EmpresaRequest, res: Response) => Promise<void>;
export declare const getAdicionaisSimple: (req: EmpresaRequest, res: Response) => Promise<void>;
export declare const updateAdicional: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const deleteAdicional: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export {};
//# sourceMappingURL=adicionalController.d.ts.map