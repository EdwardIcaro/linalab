import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import prisma from '../db';

const router: Router = Router();
const execAsync = promisify(exec);

/**
 * Admin Routes - APENAS PARA SETUP INICIAL
 * 🔒 CUIDADO: Em produção, proteja este endpoint!
 */

/**
 * POST /api/admin/setup-database
 * Roda `prisma db push` para criar tabelas
 *
 * ⚠️ USE APENAS UMA VEZ NO INÍCIO!
 */
router.post('/setup-database', async (req: Request, res: Response) => {
  try {
    console.log('🔄 Iniciando setup do banco de dados...');

    // Executar prisma db push
    const { stdout, stderr } = await execAsync('npx prisma db push --accept-data-loss', {
      cwd: process.cwd(),
      env: process.env
    });

    console.log('✅ Setup do banco concluído!');
    console.log('Output:', stdout);

    res.json({
      success: true,
      message: 'Banco de dados foi configurado com sucesso!',
      output: stdout
    });
  } catch (error: any) {
    console.error('❌ Erro ao fazer setup:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao configurar banco de dados',
      error: error.message
    });
  }
});

/**
 * GET /api/admin/health
 * Verifica se as tabelas existem
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const prisma = require('../db').default;

    // Tentar uma query simples em cada tabela importante
    await prisma.usuario.count();
    await prisma.empresa.count();
    await prisma.subscription.count();

    res.json({
      success: true,
      message: 'Todas as tabelas existem e estão acessíveis',
      timestamp: new Date()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Erro ao verificar tabelas',
      error: error.message,
      timestamp: new Date()
    });
  }
});

/**
 * GET /api/admin-setup/debug
 * Mostra configuração do servidor e variáveis críticas
 */
router.get('/debug', async (req: Request, res: Response) => {
  try {
    const checks = {
      JWT_SECRET_CONFIGURED: !!process.env.JWT_SECRET,
      JWT_SECRET_LENGTH: process.env.JWT_SECRET?.length || 0,
      DATABASE_URL_CONFIGURED: !!process.env.DATABASE_URL,
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      FRONTEND_URL: process.env.FRONTEND_URL,
      MERCADO_PAGO_CONFIGURED: !!process.env.MERCADO_PAGO_ACCESS_TOKEN,
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      checks,
      message: 'JWT_SECRET is ' + (checks.JWT_SECRET_CONFIGURED ? 'CONFIGURED ✅' : 'MISSING ❌')
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin-setup/init-database
 * Inicializa o banco: cria tabelas + executa seed
 * ORDEM IMPORTANTE: 1) prisma db push  2) prisma db seed
 */
router.post('/init-database', async (req: Request, res: Response) => {
  try {
    console.log('📊 Iniciando inicialização completa do banco...\n');

    // PASSO 1: Criar tabelas
    console.log('1️⃣  Criando tabelas com Prisma...');
    const pushResult = await execAsync('npx prisma db push --accept-data-loss --skip-generate', {
      cwd: process.cwd(),
      env: process.env,
      timeout: 120000
    });
    console.log('✅ Tabelas criadas!');

    // PASSO 2: Executar seed
    console.log('\n2️⃣  Executando seed para popular dados...');
    const seedResult = await execAsync('npx prisma db seed', {
      cwd: process.cwd(),
      env: process.env,
      timeout: 120000
    });
    console.log('✅ Seed executado com sucesso!');

    res.json({
      success: true,
      message: '✅ Banco de dados inicializado com sucesso! Tabelas criadas + dados populados.',
      steps: [
        { step: 'Create Tables', status: 'SUCCESS' },
        { step: 'Seed Database', status: 'SUCCESS' }
      ],
      output: pushResult.stdout + '\n' + seedResult.stdout
    });
  } catch (error: any) {
    console.error('❌ Erro ao inicializar banco:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao inicializar banco de dados',
      error: error.message,
      stderr: error.stderr || ''
    });
  }
});

/**
 * POST /api/admin-setup/seed
 * Executa apenas o seed (use após criar tabelas com /init-database)
 */
router.post('/seed', async (req: Request, res: Response) => {
  try {
    console.log('🌱 Iniciando execução do seed...');

    // Executar seed via Prisma
    const { stdout, stderr } = await execAsync('npx prisma db seed', {
      cwd: process.cwd(),
      env: process.env,
      timeout: 120000 // 2 minutos de timeout
    });

    console.log('✅ Seed executado com sucesso!');
    console.log('Output:', stdout);

    res.json({
      success: true,
      message: 'Seed executado com sucesso! Planos e dados iniciais foram criados.',
      output: stdout
    });
  } catch (error: any) {
    console.error('❌ Erro ao executar seed:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao executar seed',
      error: error.message,
      stderr: error.stderr || ''
    });
  }
});

/**
 * POST /api/admin-setup/create-free-plan
 * Cria o plano FREE se não existir (alternativa rápida do seed)
 */
router.post('/create-free-plan', async (req: Request, res: Response) => {
  try {
    // Verificar se já existe plano FREE
    const existingFreePlan = await prisma.subscriptionPlan.findFirst({
      where: {
        nome: 'FREE',
        ativo: true
      }
    });

    if (existingFreePlan) {
      return res.json({
        success: true,
        message: 'Plano FREE já existe',
        plan: existingFreePlan
      });
    }

    // Criar plano FREE
    const freePlan = await prisma.subscriptionPlan.create({
      data: {
        nome: 'FREE',
        descricao: 'Plano gratuito permanente',
        preco: 0,
        trialDays: 0,
        maxEmpresas: 1,
        maxUsuarios: null,
        maxAddons: 0,
        intervalo: 'MONTHLY',
        ativo: true,
        ordem: 0,
        features: ['gestao_basica', 'clientes', 'ordens']
      }
    });

    res.json({
      success: true,
      message: 'Plano FREE criado com sucesso',
      plan: freePlan
    });
  } catch (error: any) {
    console.error('Erro ao criar plano FREE:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao criar plano FREE',
      error: error.message
    });
  }
});

export default router;
