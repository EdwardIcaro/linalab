import { Request, Response } from 'express';
interface EmpresaRequest extends Request {
    empresaId?: string;
}
/**
 * Criar nova ordem de serviço
 * Agora, esta função também pode criar um cliente e/ou veículo se eles não existirem.
 */
export declare const createOrdem: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Listar ordens de serviço da empresa
 */
export declare const getOrdens: (req: EmpresaRequest, res: Response) => Promise<void>;
/**
 * Buscar ordem de serviço por ID
 */
export declare const getOrdemById: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Atualizar ordem de serviço
 */
export declare const updateOrdem: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Cancelar ordem de serviço
 */
export declare const cancelOrdem: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Obter estatísticas de ordens de serviço
 */
export declare const getOrdensStats: (req: EmpresaRequest, res: Response) => Promise<void>;
/**
 * Deletar ordem de serviço permanentemente
 */
export declare const deleteOrdem: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Finalizar ordem de serviço manualmente
 * Processa pagamento, atualiza status e calcula comissão
 */
export declare const finalizarOrdem: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Itera sobre as empresas para finalizar ordens do dia conforme o horário de fechamento.
 * Esta função é chamada pelo cron job a cada 15 minutos.
 */
export declare const processarFinalizacoesAutomaticas: () => Promise<void>;
export {};
//# sourceMappingURL=ordemController.d.ts.map