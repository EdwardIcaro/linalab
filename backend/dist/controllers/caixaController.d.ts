import { Request, Response } from 'express';
interface EmpresaRequest extends Request {
    empresaId?: string;
}
export declare const getResumoDia: (req: EmpresaRequest, res: Response) => Promise<void>;
export declare const createFechamento: (req: EmpresaRequest, res: Response) => Promise<void>;
export declare const createSaida: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const createSangria: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getHistorico: (req: EmpresaRequest, res: Response) => Promise<void>;
export declare const getFechamentoById: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getGanhosDoMes: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getFechamentoComissaoById: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getHistoricoComissoes: (req: EmpresaRequest, res: Response) => Promise<void>;
export declare const fecharComissao: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const migrarPagamentosComissaoAntigos: (req: EmpresaRequest, res: Response) => Promise<void>;
export declare const updateCaixaRegistro: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const deleteCaixaRegistro: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const getDadosComissao: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export {};
//# sourceMappingURL=caixaController.d.ts.map