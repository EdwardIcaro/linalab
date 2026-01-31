"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubtiposByTipo = exports.getServicosByTipoVeiculo = exports.deleteTipoVeiculo = exports.updateTipoVeiculo = exports.getTipoVeiculoById = exports.getTiposVeiculo = exports.createTipoVeiculo = void 0;
const db_1 = __importDefault(require("../db"));
/**
 * Criar novo tipo de veículo (ex: "CARRO", "MOTO") ou subtipo (ex: "CARRO/SUV")
 */
const createTipoVeiculo = async (req, res) => {
    try {
        const { nome, categoria, descricao } = req.body;
        if (!nome) {
            return res.status(400).json({ error: 'O nome do tipo de veículo é obrigatório.' });
        }
        const novoTipoVeiculo = await db_1.default.tipoVeiculo.create({
            data: {
                nome,
                categoria,
                descricao,
                empresaId: req.empresaId,
            },
        });
        res.status(201).json(novoTipoVeiculo);
    }
    catch (error) {
        if (error.code === 'P2002') {
            return res.status(409).json({ error: 'Este tipo/subtipo de veículo já existe.' });
        }
        console.error('Erro ao criar tipo de veículo:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.createTipoVeiculo = createTipoVeiculo;
/**
 * Listar todos os tipos e subtipos de veículo da empresa
 */
const getTiposVeiculo = async (req, res) => {
    try {
        const tiposVeiculo = await db_1.default.tipoVeiculo.findMany({
            where: {
                empresaId: req.empresaId,
            },
            orderBy: [
                { nome: 'asc' },
                { categoria: 'asc' },
            ],
        });
        res.json(tiposVeiculo);
    }
    catch (error) {
        console.error('Erro ao listar tipos de veículo:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.getTiposVeiculo = getTiposVeiculo;
/**
 * Buscar um tipo de veículo por ID
 */
const getTipoVeiculoById = async (req, res) => {
    try {
        const { id } = req.params;
        if (Array.isArray(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        const tipoVeiculo = await db_1.default.tipoVeiculo.findFirst({
            where: {
                id,
                empresaId: req.empresaId,
            },
            include: {
                _count: {
                    select: { servicos: true }
                }
            }
        });
        if (!tipoVeiculo) {
            return res.status(404).json({ error: 'Tipo de veículo não encontrado.' });
        }
        res.json(tipoVeiculo);
    }
    catch (error) {
        console.error('Erro ao buscar tipo de veículo:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.getTipoVeiculoById = getTipoVeiculoById;
/**
 * Atualizar um tipo de veículo
 */
const updateTipoVeiculo = async (req, res) => {
    try {
        const { id } = req.params;
        if (Array.isArray(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        const { nome, categoria, descricao, ativo } = req.body;
        const tipoVeiculoAtualizado = await db_1.default.tipoVeiculo.update({
            where: {
                id,
                empresaId: req.empresaId,
            },
            data: {
                nome,
                categoria,
                descricao,
                ativo,
            },
        });
        res.json(tipoVeiculoAtualizado);
    }
    catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Tipo de veículo não encontrado.' });
        }
        console.error('Erro ao atualizar tipo de veículo:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.updateTipoVeiculo = updateTipoVeiculo;
/**
 * Excluir um tipo de veículo
 */
const deleteTipoVeiculo = async (req, res) => {
    try {
        const { id } = req.params;
        if (Array.isArray(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        // Verificar se há serviços associados antes de excluir
        const servicosAssociados = await db_1.default.servico.count({
            where: {
                tiposVeiculo: {
                    some: { id }
                }
            }
        });
        if (servicosAssociados > 0) {
            return res.status(400).json({ error: 'Não é possível excluir. Existem serviços associados a este tipo de veículo.' });
        }
        await db_1.default.tipoVeiculo.delete({
            where: {
                id,
                empresaId: req.empresaId,
            },
        });
        res.status(204).send();
    }
    catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Tipo de veículo não encontrado.' });
        }
        console.error('Erro ao excluir tipo de veículo:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.deleteTipoVeiculo = deleteTipoVeiculo;
/**
 * Listar serviços associados a um tipo de veículo
 */
const getServicosByTipoVeiculo = async (req, res) => {
    try {
        const { id } = req.params;
        if (Array.isArray(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        const servicos = await db_1.default.servico.findMany({
            where: {
                empresaId: req.empresaId,
                tiposVeiculo: {
                    some: {
                        id: id,
                    },
                },
            },
        });
        res.json(servicos);
    }
    catch (error) {
        console.error('Erro ao listar serviços por tipo de veículo:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.getServicosByTipoVeiculo = getServicosByTipoVeiculo;
/**
 * Listar todos os subtipos (categorias) de um tipo de veículo principal.
 * Ex: /api/tipos-veiculo/subtipos/Carro -> retorna ["Hatch", "Sedan", "SUV"]
 */
const getSubtiposByTipo = async (req, res) => {
    try {
        const { categoria: nomeTipo } = req.params;
        if (Array.isArray(nomeTipo)) {
            return res.status(400).json({ error: 'Nome do tipo inválido' });
        }
        const subtipos = await db_1.default.tipoVeiculo.findMany({
            where: {
                empresaId: req.empresaId,
                nome: nomeTipo,
                categoria: {
                    not: null, // Garante que estamos pegando apenas subtipos
                },
            },
            distinct: ['categoria'],
            select: {
                categoria: true,
            },
        });
        res.json(subtipos.map((s) => s.categoria));
    }
    catch (error) {
        console.error(`Erro ao listar subtipos para ${req.params.categoria}:`, error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.getSubtiposByTipo = getSubtiposByTipo;
//# sourceMappingURL=tipoVeiculoController.js.map