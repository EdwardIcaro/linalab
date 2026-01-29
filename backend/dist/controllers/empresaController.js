"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toggleEmpresaStatus = exports.updateEmpresa = exports.getEmpresaById = exports.getEmpresas = exports.createEmpresa = void 0;
const db_1 = __importDefault(require("../db"));
// Função auxiliar para parsear campos JSON
const parseEmpresaConfig = (empresa) => {
    if (empresa.config && typeof empresa.config === 'string') {
        try {
            empresa.config = JSON.parse(empresa.config);
        }
        catch (e) {
            console.error('Erro ao parsear config JSON:', e);
            empresa.config = {}; // Retorna objeto vazio em caso de erro
        }
    }
    if (empresa.notificationPreferences && typeof empresa.notificationPreferences === 'string') {
        try {
            empresa.notificationPreferences = JSON.parse(empresa.notificationPreferences);
        }
        catch (e) {
            console.error('Erro ao parsear notificationPreferences JSON:', e);
            empresa.notificationPreferences = {}; // Retorna objeto vazio em caso de erro
        }
    }
    if (empresa.paymentMethodsConfig && typeof empresa.paymentMethodsConfig === 'string') {
        try {
            empresa.paymentMethodsConfig = JSON.parse(empresa.paymentMethodsConfig);
        }
        catch (e) {
            console.error('Erro ao parsear paymentMethodsConfig JSON:', e);
            empresa.paymentMethodsConfig = {}; // Retorna objeto vazio em caso de erro
        }
    }
    return empresa;
};
/**
 * Criar nova empresa
 */
const createEmpresa = async (req, res) => {
    try {
        const { nome } = req.body;
        const usuarioId = req.usuarioId; // O ID do usuário virá do middleware
        if (!nome) {
            return res.status(400).json({ error: 'Nome da empresa é obrigatório' });
        }
        if (!usuarioId) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }
        const existingEmpresa = await db_1.default.empresa.findFirst({
            where: { nome, usuarioId },
        });
        if (existingEmpresa) {
            return res.status(400).json({ error: 'Empresa com este nome já existe para este usuário' });
        }
        let empresa = await db_1.default.empresa.create({
            data: {
                nome,
                usuarioId,
                config: JSON.stringify({
                    moeda: 'BRL',
                    timezone: 'America/Sao_Paulo'
                }),
                notificationPreferences: JSON.stringify({
                    ordemCriada: true,
                    ordemEditada: true,
                    ordemDeletada: false,
                    finalizacaoAutomatica: true
                }),
                paymentMethodsConfig: JSON.stringify({
                    DINHEIRO: true,
                    PIX: true,
                    CARTAO: true,
                    DEBITO_FUNCIONARIO: true
                })
            },
            select: {
                id: true,
                nome: true,
                ativo: true,
                config: true,
                notificationPreferences: true,
                paymentMethodsConfig: true,
                createdAt: true,
                updatedAt: true
            }
        });
        const tiposVeiculoData = [
            { nome: 'CARRO', categoria: null, descricao: 'Veículos de passeio em geral', empresaId: empresa.id },
            { nome: 'MOTO', categoria: null, descricao: 'Motocicletas de todos os tipos', empresaId: empresa.id },
            { nome: 'OUTROS', categoria: null, descricao: 'Serviços avulsos e personalizados', empresaId: empresa.id },
            { nome: 'CARRO', categoria: 'HATCH', descricao: 'Carros com traseira curta', empresaId: empresa.id },
            { nome: 'CARRO', categoria: 'SEDAN', descricao: 'Carros com porta-malas saliente', empresaId: empresa.id },
            { nome: 'CARRO', categoria: 'SUV', descricao: 'Utilitários esportivos', empresaId: empresa.id },
            { nome: 'CARRO', categoria: 'PICKUP', descricao: 'Picapes e utilitários com caçamba', empresaId: empresa.id },
        ];
        await db_1.default.tipoVeiculo.createMany({
            data: tiposVeiculoData,
        });
        res.status(201).json({
            message: 'Empresa criada com sucesso',
            empresa: parseEmpresaConfig(empresa)
        });
    }
    catch (error) {
        console.error('Erro ao criar empresa:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.createEmpresa = createEmpresa;
/**
 * Listar todas as empresas do usuário logado
 */
const getEmpresas = async (req, res) => {
    try {
        const usuarioId = req.usuarioId;
        if (!usuarioId) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }
        const empresas = await db_1.default.empresa.findMany({
            where: { usuarioId },
            select: {
                id: true,
                nome: true,
                ativo: true,
                createdAt: true,
                _count: {
                    select: {
                        clientes: true,
                        lavadores: true,
                        ordens: true
                    }
                }
            },
            orderBy: {
                nome: 'asc'
            }
        });
        res.json(empresas);
    }
    catch (error) {
        console.error('Erro ao listar empresas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.getEmpresas = getEmpresas;
/**
 * Buscar empresa por ID
 */
const getEmpresaById = async (req, res) => {
    try {
        const { id } = req.params;
        let empresa = await db_1.default.empresa.findUnique({
            where: { id },
            select: {
                id: true,
                nome: true,
                ativo: true,
                config: true,
                horarioAbertura: true,
                horarioFechamento: true,
                finalizacaoAutomatica: true,
                exigirLavadorParaFinalizar: true,
                paginaInicialPadrao: true,
                notificationPreferences: true,
                paymentMethodsConfig: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                    select: {
                        clientes: true,
                        lavadores: true,
                        servicos: true,
                        ordens: true
                    }
                }
            }
        });
        if (!empresa) {
            return res.status(404).json({ error: 'Empresa não encontrada' });
        }
        res.json(parseEmpresaConfig(empresa));
    }
    catch (error) {
        console.error('Erro ao buscar empresa:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.getEmpresaById = getEmpresaById;
/**
 * Atualizar empresa
 */
const updateEmpresa = async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, config, horarioAbertura, horarioFechamento, finalizacaoAutomatica, exigirLavadorParaFinalizar, paginaInicialPadrao, notificationPreferences, paymentMethodsConfig } = req.body;
        const existingEmpresa = await db_1.default.empresa.findUnique({
            where: { id }
        });
        if (!existingEmpresa) {
            return res.status(404).json({ error: 'Empresa não encontrada' });
        }
        const updateData = {};
        if (nome)
            updateData.nome = nome;
        if (config && typeof config === 'object')
            updateData.config = JSON.stringify(config);
        if (horarioAbertura)
            updateData.horarioAbertura = horarioAbertura;
        if (horarioFechamento)
            updateData.horarioFechamento = horarioFechamento;
        if (finalizacaoAutomatica !== undefined)
            updateData.finalizacaoAutomatica = finalizacaoAutomatica;
        if (exigirLavadorParaFinalizar !== undefined)
            updateData.exigirLavadorParaFinalizar = exigirLavadorParaFinalizar;
        if (paginaInicialPadrao)
            updateData.paginaInicialPadrao = paginaInicialPadrao;
        if (notificationPreferences && typeof notificationPreferences === 'object')
            updateData.notificationPreferences = JSON.stringify(notificationPreferences);
        if (paymentMethodsConfig && typeof paymentMethodsConfig === 'object')
            updateData.paymentMethodsConfig = JSON.stringify(paymentMethodsConfig);
        let empresa = await db_1.default.empresa.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                nome: true,
                ativo: true,
                config: true,
                horarioAbertura: true,
                horarioFechamento: true,
                finalizacaoAutomatica: true,
                exigirLavadorParaFinalizar: true,
                paginaInicialPadrao: true,
                notificationPreferences: true,
                paymentMethodsConfig: true,
                updatedAt: true
            }
        });
        res.json({
            message: 'Empresa atualizada com sucesso',
            empresa: parseEmpresaConfig(empresa)
        });
    }
    catch (error) {
        console.error('Erro ao atualizar empresa:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.updateEmpresa = updateEmpresa;
/**
 * Desativar/ativar empresa
 */
const toggleEmpresaStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const currentEmpresa = await db_1.default.empresa.findUnique({ where: { id } });
        if (!currentEmpresa) {
            return res.status(404).json({ error: 'Empresa não encontrada' });
        }
        const empresa = await db_1.default.empresa.update({
            where: { id },
            data: {
                ativo: !currentEmpresa.ativo
            },
            select: {
                id: true,
                nome: true,
                ativo: true,
                updatedAt: true
            }
        });
        res.json({
            message: `Empresa ${empresa.ativo ? 'ativada' : 'desativada'} com sucesso`,
            empresa
        });
    }
    catch (error) {
        console.error('Erro ao alterar status da empresa:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.toggleEmpresaStatus = toggleEmpresaStatus;
//# sourceMappingURL=empresaController.js.map