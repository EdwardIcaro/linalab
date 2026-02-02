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
const roles_1 = __importDefault(require("./routes/roles"));
const subscription_1 = __importDefault(require("./routes/subscription"));
const subscriptionAdmin_1 = __importDefault(require("./routes/subscriptionAdmin"));
const promotionRoutes_1 = __importDefault(require("./routes/promotionRoutes"));
const payment_1 = __importDefault(require("./routes/payment"));
const db_1 = __importDefault(require("./db")); // Importa a instância do Prisma
const subscriptionService_1 = require("./services/subscriptionService");
// Importar middleware
const authMiddleware_1 = __importDefault(require("./middlewares/authMiddleware"));
const userAuthMiddleware_1 = __importDefault(require("./middlewares/userAuthMiddleware"));
const adminMiddleware_1 = __importDefault(require("./middlewares/adminMiddleware"));
const subscriptionMiddleware_1 = require("./middlewares/subscriptionMiddleware");
// Carregar variáveis de ambiente
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// CORS Configuration - Allow frontend domain
const corsOptions = {
    origin: (origin, callback) => {
        // In development, allow localhost
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:3001'
        ];
        // In production on Railway, allow the public domain
        if (process.env.FRONTEND_URL) {
            allowedOrigins.push(process.env.FRONTEND_URL);
        }
        // Allow requests without origin (mobile apps, Postman, etc)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            console.warn(`CORS blocked origin: ${origin}`);
            callback(null, true); // Allow for now, can restrict later
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
// Middleware
app.use((0, cors_1.default)(corsOptions));
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
// Rotas públicas para visualização
app.get('/api/public/lavador/:id/ordens', publicController_1.getOrdensByLavadorPublic);
app.post('/api/public/lavador-data', publicController_1.getLavadorPublicData);
// Endpoints públicos de subscriptions (para ver planos e promoções antes de fazer login)
app.get('/api/subscriptions/plans', async (_req, _res) => {
    try {
        const plans = await db_1.default.subscriptionPlan.findMany({
            where: { ativo: true },
            orderBy: { ordem: 'asc' }
        });
        _res.json(plans);
    }
    catch (error) {
        console.error('Erro ao buscar planos:', error);
        _res.status(500).json({ error: 'Erro ao buscar planos' });
    }
});
app.get('/api/promotions/active', async (_req, _res) => {
    try {
        const now = new Date();
        const promotions = await db_1.default.promotion.findMany({
            where: {
                ativo: true,
                dataInicio: { lte: now },
                dataFim: { gte: now }
            },
            include: {
                plan: {
                    select: {
                        id: true,
                        nome: true,
                        preco: true
                    }
                }
            },
            orderBy: { valor: 'desc' }
        });
        _res.json(promotions);
    }
    catch (error) {
        console.error('Erro ao buscar promoções ativas:', error);
        _res.status(500).json({ error: 'Erro ao buscar promoções' });
    }
});
// Middleware de autenticação para rotas protegidas
app.use('/api/admin', adminMiddleware_1.default, adminRoutes_1.default); // Admin routes (LINA_OWNER only)
app.use('/api/admin/subscriptions', adminMiddleware_1.default, subscriptionAdmin_1.default); // Admin subscription routes (LINA_OWNER only)
app.use('/api/admin/subscriptions/promotions', adminMiddleware_1.default, promotionRoutes_1.default); // Promotion admin routes (LINA_OWNER only)
app.use('/api/theme', authMiddleware_1.default, themeRoutes_1.default); // Theme routes (requires empresa scope)
app.use('/api/subscriptions', userAuthMiddleware_1.default, subscription_1.default); // Subscription routes (user authenticated)
app.use('/api/promotions', promotionRoutes_1.default); // Public promotion routes (get active only)
app.use('/api/payments', payment_1.default); // Payment routes (webhooks + user auth endpoints)
app.use('/api/empresas', userAuthMiddleware_1.default, subscriptionMiddleware_1.requireActiveSubscription, empresa_1.default); // Validates active subscription
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
app.use('/api/roles', authMiddleware_1.default, roles_1.default); // Usa middleware de empresa
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
// Cron job para verificar assinaturas expiradas (a cada 6 horas)
node_cron_1.default.schedule('0 */6 * * *', () => {
    console.log(`[${new Date().toISOString()}] Verificando assinaturas expiradas...`);
    subscriptionService_1.subscriptionService.checkExpiredSubscriptions();
}, {
    timezone: "America/Sao_Paulo"
});
// Cron job para verificar trials próximos de expirar (1x ao dia às 09:00)
node_cron_1.default.schedule('0 9 * * *', () => {
    console.log(`[${new Date().toISOString()}] Verificando trials próximos de expirar...`);
    subscriptionService_1.subscriptionService.checkTrialExpirationWarnings();
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