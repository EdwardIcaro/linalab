"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAdicional = exports.updateAdicional = exports.getAdicionaisSimple = exports.getAdicionais = exports.createAdicional = void 0;
const db_1 = __importDefault(require("../db"));
const createAdicional = async (req, res) => {
    const { nome, preco } = req.body;
    const empresaId = req.empresaId;
    if (!nome || preco === undefined) {
        return res.status(400).json({ error: 'Nome e preço são obrigatórios.' });
    }
    try {
        const adicional = await db_1.default.adicional.create({
            data: { nome, preco, empresaId: empresaId },
        });
        res.status(201).json(adicional);
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao criar adicional.' });
    }
};
exports.createAdicional = createAdicional;
const getAdicionais = async (req, res) => {
    try {
        const adicionais = await db_1.default.adicional.findMany({
            where: { empresaId: req.empresaId },
            orderBy: { nome: 'asc' },
        });
        res.json({ adicionais });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao buscar adicionais.' });
    }
};
exports.getAdicionais = getAdicionais;
const getAdicionaisSimple = async (req, res) => {
    try {
        const adicionais = await db_1.default.adicional.findMany({
            where: { empresaId: req.empresaId },
            select: { id: true, nome: true, preco: true },
            orderBy: { nome: 'asc' },
        });
        res.json({ adicionais });
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao buscar adicionais.' });
    }
};
exports.getAdicionaisSimple = getAdicionaisSimple;
const updateAdicional = async (req, res) => {
    const { id } = req.params;
    if (Array.isArray(id)) {
        return res.status(400).json({ error: 'ID inválido' });
    }
    const { nome, preco } = req.body;
    try {
        const adicional = await db_1.default.adicional.update({
            where: { id, empresaId: req.empresaId },
            data: { nome, preco },
        });
        res.json(adicional);
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar adicional.' });
    }
};
exports.updateAdicional = updateAdicional;
const deleteAdicional = async (req, res) => {
    const { id } = req.params;
    if (Array.isArray(id)) {
        return res.status(400).json({ error: 'ID inválido' });
    }
    try {
        await db_1.default.adicional.delete({
            where: { id, empresaId: req.empresaId },
        });
        res.status(204).send();
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao deletar adicional.' });
    }
};
exports.deleteAdicional = deleteAdicional;
//# sourceMappingURL=adicionalController.js.map