"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateUsuario = exports.generateScopedToken = exports.createUsuario = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = __importDefault(require("../db"));
/**
 * Criar novo usuário
 */
const createUsuario = async (req, res) => {
    try {
        const { nome, email, senha } = req.body;
        if (!nome || !email || !senha) {
            return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
        }
        const existingUsuario = await db_1.default.usuario.findFirst({
            where: { OR: [{ nome }, { email }] },
        });
        if (existingUsuario) {
            return res.status(400).json({ error: 'Usuário ou e-mail já cadastrado' });
        }
        const hashedSenha = await bcrypt_1.default.hash(senha, 12);
        const usuario = await db_1.default.usuario.create({
            data: { nome, email, senha: hashedSenha },
            select: { id: true, nome: true, email: true, createdAt: true },
        });
        res.status(201).json({ message: 'Usuário criado com sucesso', usuario });
    }
    catch (error) {
        console.error('Erro ao criar usuário:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.createUsuario = createUsuario;
/**
 * Gera um novo token com o escopo de uma empresa específica
 * SECURITY: Validates that the user actually owns/belongs to the empresa before issuing token
 */
const generateScopedToken = async (req, res) => {
    const usuarioId = req.usuarioId;
    const { empresaId } = req.body;
    if (!empresaId) {
        return res.status(400).json({ error: 'empresaId é obrigatório' });
    }
    // SECURITY: Validate JWT_SECRET is configured
    if (!process.env.JWT_SECRET) {
        console.error('CRITICAL: JWT_SECRET not configured');
        return res.status(500).json({ error: 'Erro de configuração do servidor' });
    }
    try {
        const usuario = await db_1.default.usuario.findUnique({ where: { id: usuarioId } });
        if (!usuario) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        // SECURITY FIX: Verify the user actually owns this empresa
        // This prevents horizontal privilege escalation
        const empresa = await db_1.default.empresa.findFirst({
            where: {
                id: empresaId,
                usuarioId: usuarioId, // User must be the owner
            },
        });
        if (!empresa) {
            console.warn(`[SECURITY] User ${usuarioId} attempted to access empresa ${empresaId} without permission`);
            return res.status(403).json({ error: 'Acesso negado: você não tem permissão para acessar esta empresa' });
        }
        // Generate token with empresaId embedded in claims (signed, tamper-proof)
        const token = jsonwebtoken_1.default.sign({
            id: usuario.id,
            nome: usuario.nome,
            empresaId: empresa.id, // Embed in JWT - cannot be tampered
            empresaNome: empresa.nome, // Include empresa name for convenience
        }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({
            token,
            empresa: {
                id: empresa.id,
                nome: empresa.nome,
            }
        });
    }
    catch (error) {
        console.error('Erro ao gerar token com escopo:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.generateScopedToken = generateScopedToken;
/**
 * Autenticar usuário (login)
 * Returns a base token (no empresa scope) + list of user's empresas
 */
const authenticateUsuario = async (req, res) => {
    try {
        const { nome: identifier, senha } = req.body;
        if (!identifier || !senha) {
            return res.status(400).json({ error: 'Nome de usuário e senha são obrigatórios' });
        }
        // SECURITY: Validate JWT_SECRET is configured
        if (!process.env.JWT_SECRET) {
            console.error('CRITICAL: JWT_SECRET not configured');
            return res.status(500).json({ error: 'Erro de configuração do servidor' });
        }
        // Procura o usuário tanto pelo nome quanto pelo e-mail
        const usuario = await db_1.default.usuario.findFirst({
            where: { OR: [{ nome: identifier }, { email: identifier }] },
        });
        if (!usuario) {
            // Fallback: subaccount login
            const subaccount = await db_1.default.subaccount.findFirst({
                where: { OR: [{ nome: identifier }, { email: identifier }] },
                include: {
                    roleInt: {
                        include: {
                            permissoes: true
                        }
                    }
                }
            });
            if (!subaccount) {
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }
            const isSenhaValida = await bcrypt_1.default.compare(senha, subaccount.senha);
            if (!isSenhaValida) {
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }
            const token = jsonwebtoken_1.default.sign({
                id: subaccount.id,
                subaccountId: subaccount.id,
                nome: subaccount.nome,
                empresaId: subaccount.empresaId
            }, process.env.JWT_SECRET, { expiresIn: '24h' });
            return res.json({
                message: 'Autenticação realizada com sucesso',
                usuario: {
                    id: subaccount.id,
                    nome: subaccount.nome,
                    email: subaccount.email,
                    role: 'USER',
                    empresaId: subaccount.empresaId,
                    permissoes: subaccount.roleInt?.permissoes?.map(p => p.name) || []
                },
                token
            });
        }
        const isSenhaValida = await bcrypt_1.default.compare(senha, usuario.senha);
        if (!isSenhaValida) {
            // Use generic message to prevent user enumeration
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }
        // Retorna dados do usuário e suas empresas associadas
        const empresas = await db_1.default.empresa.findMany({
            where: { usuarioId: usuario.id },
            select: { id: true, nome: true },
        });
        const { senha: _, ...usuarioData } = usuario;
        // Generate base token (no empresa scope yet)
        // User must call generateScopedToken after selecting an empresa
        const token = jsonwebtoken_1.default.sign({ id: usuario.id, nome: usuario.nome, role: usuario.role }, process.env.JWT_SECRET, { expiresIn: '1h' } // Short-lived until empresa is selected
        );
        res.json({
            message: 'Autenticação realizada com sucesso',
            usuario: {
                ...usuarioData,
                role: usuario.role, // ← CRITICAL: Return role for frontend routing
                empresas,
            },
            token,
        });
    }
    catch (error) {
        console.error('Erro na autenticação:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.authenticateUsuario = authenticateUsuario;
//# sourceMappingURL=usuarioController.js.map