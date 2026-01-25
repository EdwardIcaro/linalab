import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import cron from 'node-cron';

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
import themeRoutes from './routes/themeRoutes';
import roleRoutes from './routes/roles';

import prisma from './db'; // Importa a instância do Prisma

// Importar middleware
import authMiddleware from './middlewares/authMiddleware';
import userAuthMiddleware from './middlewares/userAuthMiddleware';
import adminMiddleware from './middlewares/adminMiddleware';

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
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

// Rota pública para visualização do lavador
app.get('/api/public/lavador/:id/ordens', getOrdensByLavadorPublic);
app.post('/api/public/lavador-data', getLavadorPublicData);

// Middleware de autenticação para rotas protegidas
app.use('/api/admin', adminMiddleware, adminRoutes); // Admin routes (LINA_OWNER only)
app.use('/api/theme', authMiddleware, themeRoutes); // Theme routes (requires empresa scope)
app.use('/api/empresas', userAuthMiddleware, empresaRoutes); // Usa middleware de usuário
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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor Lina X rodando na porta ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log('🕒 Agendador de finalização de ordens ativado para rodar a cada 15 minutos.');
});
