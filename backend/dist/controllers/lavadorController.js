"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gerarTokenPublico = exports.deleteLavador = exports.updateLavador = exports.deleteLavadorToken = exports.toggleLavadorToken = exports.updateLavadorTokenStatus = exports.getLavadorTokens = exports.getLavadoresSimple = exports.getLavadores = exports.createLavador = void 0;
const db_1 = __importDefault(require("../db"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const createLavador = async (req, res) => {
    const { nome, comissao } = req.body;
    const empresaId = req.empresaId;
    if (!nome || comissao === undefined) {
        return res.status(400).json({ error: 'Nome e comissão são obrigatórios.' });
    }
    try {
        const lavador = await db_1.default.lavador.create({
            data: { nome, comissao, empresaId: empresaId },
        });
        res.status(201).json(lavador);
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao criar lavador.' });
    }
};
exports.createLavador = createLavador;
const getLavadores = async (req, res) => {
    try {
        const lavadores = await db_1.default.lavador.findMany({
            where: { empresaId: req.empresaId },
            include: {
                _count: {
                    select: { ordens: true }
                }
            },
            orderBy: { nome: 'asc' },
        });
        res.json({ lavadores });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao buscar lavadores.' });
    }
};
exports.getLavadores = getLavadores;
const getLavadoresSimple = async (req, res) => {
    try {
        const lavadores = await db_1.default.lavador.findMany({
            where: {
                empresaId: req.empresaId,
                ativo: true
            },
            select: {
                id: true,
                nome: true,
            },
            orderBy: { nome: 'asc' },
        });
        res.json({ lavadores });
    }
    catch (error) {
        console.error('Erro ao buscar lavadores (simples):', error);
        res.status(500).json({ error: 'Erro ao buscar lavadores.' });
    }
};
exports.getLavadoresSimple = getLavadoresSimple;
/**
 * Listar tokens de acesso dos lavadores da empresa
 */
const getLavadorTokens = async (req, res) => {
    try {
        const tokens = await db_1.default.lavadorToken.findMany({
            where: {
                lavador: {
                    empresaId: req.empresaId
                }
            },
            include: {
                lavador: {
                    select: {
                        id: true,
                        nome: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        res.json({ tokens });
    }
    catch (error) {
        console.error('Erro ao listar tokens dos lavadores:', error);
        res.status(500).json({ error: 'Erro ao listar tokens dos lavadores.' });
    }
};
exports.getLavadorTokens = getLavadorTokens;
/**
 * Atualizar status de um token
 */
const updateLavadorTokenStatus = async (req, res) => {
    const { id } = req.params;
    const { ativo } = req.body;
    if (typeof ativo !== 'boolean') {
        return res.status(400).json({ error: 'Campo \"ativo\" deve ser booleano.' });
    }
    try {
        const updated = await db_1.default.lavadorToken.updateMany({
            where: {
                id,
                lavador: {
                    empresaId: req.empresaId
                }
            },
            data: { ativo }
        });
        if (updated.count === 0) {
            return res.status(404).json({ error: 'Token nÃ£o encontrado para esta empresa.' });
        }
        res.json({ message: 'Status do token atualizado com sucesso' });
    }
    catch (error) {
        console.error('Erro ao atualizar status do token:', error);
        res.status(500).json({ error: 'Erro ao atualizar status do token.' });
    }
};
exports.updateLavadorTokenStatus = updateLavadorTokenStatus;
/**
 * Alternar status do token (ativo/inativo)
 */
const toggleLavadorToken = async (req, res) => {
    const { id } = req.params;
    try {
        const token = await db_1.default.lavadorToken.findFirst({
            where: {
                id,
                lavador: {
                    empresaId: req.empresaId
                }
            }
        });
        if (!token) {
            return res.status(404).json({ error: 'Token nÃ£o encontrado para esta empresa.' });
        }
        await db_1.default.lavadorToken.update({
            where: { id },
            data: { ativo: !token.ativo }
        });
        res.json({ message: 'Status do token atualizado com sucesso' });
    }
    catch (error) {
        console.error('Erro ao alternar status do token:', error);
        res.status(500).json({ error: 'Erro ao alternar status do token.' });
    }
};
exports.toggleLavadorToken = toggleLavadorToken;
/**
 * Excluir token de acesso
 */
const deleteLavadorToken = async (req, res) => {
    const { id } = req.params;
    try {
        const deleted = await db_1.default.lavadorToken.deleteMany({
            where: {
                id,
                lavador: {
                    empresaId: req.empresaId
                }
            }
        });
        if (deleted.count === 0) {
            return res.status(404).json({ error: 'Token nÃ£o encontrado para esta empresa.' });
        }
        res.json({ message: 'Token excluÃ­do com sucesso' });
    }
    catch (error) {
        console.error('Erro ao excluir token:', error);
        res.status(500).json({ error: 'Erro ao excluir token.' });
    }
};
exports.deleteLavadorToken = deleteLavadorToken;
const updateLavador = async (req, res) => {
    const { id } = req.params;
    const { nome, comissao } = req.body;
    try {
        const lavador = await db_1.default.lavador.update({
            where: { id, empresaId: req.empresaId },
            data: { nome, comissao },
        });
        res.json(lavador);
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar lavador.' });
    }
};
exports.updateLavador = updateLavador;
const deleteLavador = async (req, res) => {
    const { id } = req.params;
    try {
        await db_1.default.lavador.delete({
            where: { id, empresaId: req.empresaId },
        });
        res.status(204).send();
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao deletar lavador.' });
    }
};
exports.deleteLavador = deleteLavador;
/**
 * Gera um token JWT para a página pública do lavador.
 */
const gerarTokenPublico = async (req, res) => {
    const { id } = req.params;
    const empresaId = req.empresaId;
    try {
        const lavador = await db_1.default.lavador.findFirst({
            where: { id, empresaId }
        });
        if (!lavador) {
            return res.status(404).json({ error: 'Lavador não encontrado nesta empresa.' });
        }
        // O token contém o ID do lavador e da empresa para validação na rota pública
        const token = jsonwebtoken_1.default.sign({ lavadorId: lavador.id, empresaId: lavador.empresaId }, process.env.JWT_SECRET || 'seu_segredo_jwt_aqui', { expiresIn: '24h' } // O link público expira em 24 horas
        );
        await db_1.default.lavadorToken.create({
            data: {
                token,
                lavadorId: lavador.id,
                ativo: true
            }
        });
        res.json({ token });
    }
    catch (error) {
        console.error('Erro ao gerar token público para lavador:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.gerarTokenPublico = gerarTokenPublico;
//# sourceMappingURL=lavadorController.js.map