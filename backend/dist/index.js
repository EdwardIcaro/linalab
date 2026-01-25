"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const node_cron_1 = __importDefault(require("node-cron"));
const publicController_1 = require("./controllers/publicController");
const ordemController_1 = require("./controllers/ordemController");
// Importar rotas
const usuario_1 = __importDefault(require("./routes/usuario"));
const empresa_1 = __importDefault(require("./routes/empresa"));
const cliente_1 = __importDefault(require("./routes/cliente"));
const veiculo_1 = __importDefault(require("./routes/veiculo"));
const lavador_1 = __importDefault(require("./routes/lavador"));
const servico_1 = __importDefault(require("./routes/servico"));
const ordem_1 = __importDefault(require("./routes/ordem"));
const adicional_1 = __importDefault(require("./routes/adicional"));
const caixa_1 = __importDefault(require("./routes/caixa"));
const fornecedor_1 = __importDefault(require("./routes/fornecedor"));
const pagamento_1 = __importDefault(require("./routes/pagamento"));
const tipoVeiculo_1 = __importDefault(require("./routes/tipoVeiculo"));
const notificacao_1 = __importDefault(require("./routes/notificacao"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
const themeRoutes_1 = __importDefault(require("./routes/themeRoutes"));
// Importar middleware
const authMiddleware_1 = __importDefault(require("./middlewares/authMiddleware"));
const userAuthMiddleware_1 = __importDefault(require("./middlewares/userAuthMiddleware"));
const adminMiddleware_1 = __importDefault(require("./middlewares/adminMiddleware"));
// Carregar variáveis de ambiente
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Servir arquivos estáticos do frontend
const frontendPath = path_1.default.resolve(__dirname, '..', '..', 'DESKTOPV2');
app.use(express_1.default.static(frontendPath));
// Redireciona a rota raiz para a página de login
app.get('/', (_req, res) => {
    res.sendFile(path_1.default.join(frontendPath, 'login.html'));
});
// Rotas públicas (cadastro e login de usuário)
app.use('/api/usuarios', usuario_1.default);
// Rota pública para visualização do lavador
app.get('/api/public/lavador/:id/ordens', publicController_1.getOrdensByLavadorPublic);
app.post('/api/public/lavador-data', publicController_1.getLavadorPublicData);
// Middleware de autenticação para rotas protegidas
app.use('/api/admin', adminMiddleware_1.default, adminRoutes_1.default); // Admin routes (LINA_OWNER only)
app.use('/api/theme', authMiddleware_1.default, themeRoutes_1.default); // Theme routes (requires empresa scope)
app.use('/api/empresas', userAuthMiddleware_1.default, empresa_1.default); // Usa middleware de usuário
app.use('/api/clientes', authMiddleware_1.default, cliente_1.default); // Usa middleware de empresa
app.use('/api/veiculos', authMiddleware_1.default, veiculo_1.default); // Usa middleware de empresa
app.use('/api/lavadores', authMiddleware_1.default, lavador_1.default); // Usa middleware de empresa
app.use('/api/servicos', authMiddleware_1.default, servico_1.default); // Usa middleware de empresa
app.use('/api/adicionais', authMiddleware_1.default, adicional_1.default); // Usa middleware de empresa
app.use('/api/ordens', authMiddleware_1.default, ordem_1.default); // Usa middleware de empresa
app.use('/api/caixa', authMiddleware_1.default, caixa_1.default); // Usa middleware de empresa
app.use('/api/fornecedores', authMiddleware_1.default, fornecedor_1.default); // Usa middleware de empresa
app.use('/api/pagamentos', authMiddleware_1.default, pagamento_1.default); // Usa middleware de empresa
app.use('/api/tipos-veiculo', authMiddleware_1.default, tipoVeiculo_1.default); // Usa middleware de empresa
app.use('/api/notificacoes', authMiddleware_1.default, notificacao_1.default); // Usa middleware de empresa
// Rota de saúde
app.get('/health', (_req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});
// Tratamento de erros
app.use((err, _req, res, _next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Algo deu errado!' });
});
// Agendador de tarefas (Cron Job) para finalizar ordens em aberto
node_cron_1.default.schedule('*/15 * * * *', () => {
    console.log(`[${new Date().toISOString()}] Executando verificação para finalização automática de ordens...`);
    (0, ordemController_1.processarFinalizacoesAutomaticas)();
}, {
    timezone: "America/Sao_Paulo"
});
// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor Lina X rodando na porta ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log('🕒 Agendador de finalização de ordens ativado para rodar a cada 15 minutos.');
});
//# sourceMappingURL=index.js.map