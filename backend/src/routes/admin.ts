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

export default router;
