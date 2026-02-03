import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import cron from 'node-cron';

import { waitForDatabase } from './waitForDb';
import { getOrdensByLavadorPublic, getLavadorPublicData } from './controllers/publicController';
import { processarFinalizacoesAutomaticas } from './controllers/ordemController';

// Importar rotas
import usuarioRoutes from './routes/usuario';
import empresaRoutes from './routes/empresa';
import clienteRoutes from './routes/cliente';
import veiculoRoutes from './routes/veiculo';
import lavadorRoutes from './routes/lavador';
import servicoRoutes from './routes/servico';
import ordemRoutes from './routes/ordem';
import adicionalRoutes from './routes/adicional';
import caixaRoutes from './routes/caixa';
import fornecedorRoutes from './routes/fornecedor';
import pagamentoRoutes from './routes/pagamento';
import tipoVeiculoRoutes from './routes/tipoVeiculo';
import notificacaoRoutes from './routes/notificacao';
import adminRoutes from './routes/adminRoutes';
import adminSetupRoutes from './routes/admin';
import themeRoutes from './routes/themeRoutes';
import roleRoutes from './routes/roles';
import subscriptionRoutes from './routes/subscription';
import subscriptionAdminRoutes from './routes/subscriptionAdmin';
import promotionRoutes from './routes/promotionRoutes';
import paymentRoutes from './routes/payment';

import prisma from './db'; // Importa a instância do Prisma
import { subscriptionService } from './services/subscriptionService';

// Importar middleware
import authMiddleware from './middlewares/authMiddleware';
import userAuthMiddleware from './middlewares/userAuthMiddleware';
import adminMiddleware from './middlewares/adminMiddleware';
import { requireActiveSubscription } from './middlewares/subscriptionMiddleware';

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS Configuration - Allow frontend domain
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
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
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(null, true); // Allow for now, can restrict later
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Servir arquivos estáticos do frontend
const frontendPath = path.resolve(__dirname, '..', '..', 'DESKTOPV2');
app.use(express.static(frontendPath));

// Redireciona a rota raiz para a página de login
app.get('/', (_req, res) => {
  res.sendFile(path.join(frontendPath, 'login.html'));
});

// Rotas públicas (cadastro e login de usuário)
app.use('/api/usuarios', usuarioRoutes);

// Rotas públicas para visualização
app.get('/api/public/lavador/:id/ordens', getOrdensByLavadorPublic);
app.post('/api/public/lavador-data', getLavadorPublicData);

// Endpoints públicos de subscriptions (para ver planos e promoções antes de fazer login)
app.get('/api/subscriptions/plans', async (_req, _res) => {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { ativo: true },
      orderBy: { ordem: 'asc' }
    });
    _res.json(plans);
  } catch (error) {
    console.error('Erro ao buscar planos:', error);
    _res.status(500).json({ error: 'Erro ao buscar planos' });
  }
});

app.get('/api/promotions/active', async (_req, _res) => {
  try {
    const now = new Date();
    const promotions = await prisma.promotion.findMany({
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
  } catch (error) {
    console.error('Erro ao buscar promoções ativas:', error);
    _res.status(500).json({ error: 'Erro ao buscar promoções' });
  }
});

// Admin setup routes (para inicialização do banco de dados - sem proteção por enquanto)
app.use('/api/admin-setup', adminSetupRoutes); // Setup routes (database initialization)

// Middleware de autenticação para rotas protegidas
app.use('/api/admin', adminMiddleware, adminRoutes); // Admin routes (LINA_OWNER only)
app.use('/api/admin/subscriptions', adminMiddleware, subscriptionAdminRoutes); // Admin subscription routes (LINA_OWNER only)
app.use('/api/admin/subscriptions/promotions', adminMiddleware, promotionRoutes); // Promotion admin routes (LINA_OWNER only)
app.use('/api/theme', authMiddleware, themeRoutes); // Theme routes (requires empresa scope)
app.use('/api/subscriptions', userAuthMiddleware, subscriptionRoutes); // Subscription routes (user authenticated)
app.use('/api/promotions', promotionRoutes); // Public promotion routes (get active only)
app.use('/api/payments', paymentRoutes); // Payment routes (webhooks + user auth endpoints)
app.use('/api/empresas', userAuthMiddleware, requireActiveSubscription, empresaRoutes); // Validates active subscription
app.use('/api/clientes', authMiddleware, clienteRoutes); // Usa middleware de empresa
app.use('/api/veiculos', authMiddleware, veiculoRoutes); // Usa middleware de empresa
app.use('/api/lavadores', authMiddleware, lavadorRoutes); // Usa middleware de empresa
app.use('/api/servicos', authMiddleware, servicoRoutes); // Usa middleware de empresa
app.use('/api/adicionais', authMiddleware, adicionalRoutes); // Usa middleware de empresa
app.use('/api/ordens', authMiddleware, ordemRoutes); // Usa middleware de empresa
app.use('/api/caixa', authMiddleware, caixaRoutes); // Usa middleware de empresa
app.use('/api/fornecedores', authMiddleware, fornecedorRoutes); // Usa middleware de empresa
app.use('/api/pagamentos', authMiddleware, pagamentoRoutes); // Usa middleware de empresa
app.use('/api/tipos-veiculo', authMiddleware, tipoVeiculoRoutes); // Usa middleware de empresa
app.use('/api/notificacoes', authMiddleware, notificacaoRoutes); // Usa middleware de empresa
app.use('/api/roles', authMiddleware, roleRoutes); // Usa middleware de empresa

// Rota de saúde
app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Tratamento de erros
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Algo deu errado!' });
});

// Agendador de tarefas (Cron Job) para finalizar ordens em aberto
cron.schedule('*/15 * * * *', () => {
  console.log(`[${new Date().toISOString()}] Executando verificação para finalização automática de ordens...`);
  processarFinalizacoesAutomaticas();
}, {
  timezone: "America/Sao_Paulo"
});

// Cron job para verificar assinaturas expiradas (a cada 6 horas)
cron.schedule('0 */6 * * *', () => {
  console.log(`[${new Date().toISOString()}] Verificando assinaturas expiradas...`);
  subscriptionService.checkExpiredSubscriptions();
}, {
  timezone: "America/Sao_Paulo"
});

// Cron job para verificar trials próximos de expirar (1x ao dia às 09:00)
cron.schedule('0 9 * * *', () => {
  console.log(`[${new Date().toISOString()}] Verificando trials próximos de expirar...`);
  subscriptionService.checkTrialExpirationWarnings();
}, {
  timezone: "America/Sao_Paulo"
});

// Iniciar servidor com aguardo do banco de dados
async function startServer() {
  try {
    // Aguardar banco de dados estar pronto
    await waitForDatabase();

    // Iniciar servidor
    app.listen(PORT, () => {
      console.log(`🚀 Servidor Lina X rodando na porta ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log('🕒 Agendador de finalização de ordens ativado para rodar a cada 15 minutos.');
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();
