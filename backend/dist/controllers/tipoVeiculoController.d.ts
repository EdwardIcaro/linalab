import { Request, Response } from 'express';
interface EmpresaRequest extends Request {
    empresaId?: string;
}
/**
 * Criar novo tipo de veículo (ex: "CARRO", "MOTO") ou subtipo (ex: "CARRO/SUV")
 */
export declare const createTipoVeiculo: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Listar todos os tipos e subtipos de veículo da empresa
 */
export declare const getTiposVeiculo: (req: EmpresaRequest, res: Response) => Promise<void>;
/**
 * Buscar um tipo de veículo por ID
 */
export declare const getTipoVeiculoById: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Atualizar um tipo de veículo
 */
export declare const updateTipoVeiculo: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Excluir um tipo de veículo
 */
export declare const deleteTipoVeiculo: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Listar serviços associados a um tipo de veículo
 */
export declare const getServicosByTipoVeiculo: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Listar todos os subtipos (categorias) de um tipo de veículo principal.
 * Ex: /api/tipos-veiculo/subtipos/Carro -> retorna ["Hatch", "Sedan", "SUV"]
 */
export declare const getSubtiposByTipo: (req: EmpresaRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
export {};
//# sourceMappingURL=tipoVeiculoController.d.ts.map