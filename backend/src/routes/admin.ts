import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const router = Router();
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
 * POST /api/admin-setup/create-free-plan
 * Cria o plano FREE se não existir
 */
router.post('/create-free-plan', async (req: Request, res: Response) => {
  try {
    const prisma = require('../db').default;

    // Verificar se já existe plano FREE
    const existingFreePlan = await prisma.subscriptionPlan.findFirst({
      where: {
        preco: 0,
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
        descricao: 'Plano gratuito com 7 dias de trial',
        preco: 0,
        trialDays: 7,
        maxEmpresas: 1,
        maxUsuarios: 1,
        maxClientes: 50,
        maxVeiculos: 20,
        maxServicos: 10,
        ativo: true,
        ordem: 1,
        features: ['basic_orders', 'basic_clients', 'basic_vehicles']
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
