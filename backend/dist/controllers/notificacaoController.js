"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.marcarTodasComoLidas = exports.marcarComoLida = exports.getNotificacoes = void 0;
const db_1 = __importDefault(require("../db"));
/**
 * Busca as notificações da empresa logada, com paginação.
 */
const getNotificacoes = async (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    try {
        const [notificacoes, total] = await db_1.default.$transaction([
            db_1.default.notificacao.findMany({
                where: { empresaId: req.empresaId },
                orderBy: { createdAt: 'desc' },
                take: Number(limit),
                skip: skip,
            }),
            db_1.default.notificacao.count({
                where: { empresaId: req.empresaId },
            }),
        ]);
        const unreadCount = await db_1.default.notificacao.count({
            where: { empresaId: req.empresaId, lida: false },
        });
        res.json({
            notificacoes,
            unreadCount,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil(total / Number(limit)),
            },
        });
    }
    catch (error) {
        console.error('Erro ao buscar notificações:', error);
        res.status(500).json({ error: 'Erro interno ao buscar notificações.' });
    }
};
exports.getNotificacoes = getNotificacoes;
/**
 * Marca uma notificação específica como lida.
 */
const marcarComoLida = async (req, res) => {
    const { id } = req.params;
    if (Array.isArray(id)) {
        return res.status(400).json({ error: 'ID inválido' });
    }
    try {
        const notificacao = await db_1.default.notificacao.findFirst({
            where: { id, empresaId: req.empresaId },
        });
        if (!notificacao) {
            return res.status(404).json({ error: 'Notificação não encontrada.' });
        }
        const updatedNotificacao = await db_1.default.notificacao.update({
            where: { id },
            data: { lida: true },
        });
        res.json(updatedNotificacao);
    }
    catch (error) {
        console.error('Erro ao marcar notificação como lida:', error);
        res.status(500).json({ error: 'Erro interno ao marcar notificação como lida.' });
    }
};
exports.marcarComoLida = marcarComoLida;
/**
 * Marca todas as notificações não lidas de uma empresa como lidas.
 */
const marcarTodasComoLidas = async (req, res) => {
    try {
        await db_1.default.notificacao.updateMany({
            where: { empresaId: req.empresaId, lida: false },
            data: { lida: true },
        });
        res.status(200).json({ message: 'Todas as notificações foram marcadas como lidas.' });
    }
    catch (error) {
        console.error('Erro ao marcar todas as notificações como lidas:', error);
        res.status(500).json({ error: 'Erro interno ao marcar todas as notificações como lidas.' });
    }
};
exports.marcarTodasComoLidas = marcarTodasComoLidas;
//# sourceMappingURL=notificacaoController.js.map