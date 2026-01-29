import { Request, Response } from 'express';
import prisma from '../db';

/**
 * ADMIN CONTROLLER
 * Only accessible to users with LINA_OWNER role
 */

/**
 * Get Global Platform Statistics
 * Returns total companies, users, revenue across the entire platform
 */
export const getGlobalStats = async (req: Request, res: Response) => {
  try {
    // Total companies (active and inactive)
    const totalEmpresas = await prisma.empresa.count();
    const empresasAtivas = await prisma.empresa.count({ where: { ativo: true } });

    // Total users
    const totalUsuarios = await prisma.usuario.count();

    // Total revenue across all companies
    const ordensFinalizadas = await prisma.ordemServico.aggregate({
      where: { status: 'FINALIZADO' },
      _sum: { valorTotal: true },
      _count: true,
    });

    // Calculate pending revenue (PENDENTE + EM_ANDAMENTO + AGUARDANDO_PAGAMENTO)
    const ordensPendentes = await prisma.ordemServico.aggregate({
      where: { status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] } },
      _sum: { valorTotal: true },
      _count: true,
    });

    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const ordensRecentes = await prisma.ordemServico.count({
      where: { createdAt: { gte: sevenDaysAgo } },
    });

    res.json({
      totalEmpresas,
      empresasAtivas,
      totalUsuarios,
      faturamentoTotal: ordensFinalizadas._sum.valorTotal || 0,
      ordensFinalizadas: ordensFinalizadas._count,
      valorPendente: ordensPendentes._sum.valorTotal || 0,
      ordensPendentes: ordensPendentes._count,
      ordensRecentes,
    });
  } catch (error) {
    console.error('Error fetching global stats:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas globais' });
  }
};

/**
 * List All Companies with Owner Information
 * Used for the company monitoring table
 */
export const listCompanies = async (req: Request, res: Response) => {
  try {
    const empresas = await prisma.empresa.findMany({
      include: {
        usuario: {
          select: {
            id: true,
            nome: true,
            email: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            clientes: true,
            lavadores: true,
            ordens: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get revenue for each company
    const empresasWithRevenue = await Promise.all(
      empresas.map(async (empresa) => {
        const revenue = await prisma.ordemServico.aggregate({
          where: {
            empresaId: empresa.id,
            status: 'FINALIZADO',
          },
          _sum: { valorTotal: true },
        });

        return {
          ...empresa,
          faturamento: revenue._sum.valorTotal || 0,
        };
      })
    );

    res.json(empresasWithRevenue);
  } catch (error) {
    console.error('Error listing companies:', error);
    res.status(500).json({ error: 'Erro ao listar empresas' });
  }
};

/**
 * Get Detailed Company Information
 * Used for company details modal/page
 */
export const getCompanyDetails = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id },
      include: {
        usuario: {
          select: {
            id: true,
            nome: true,
            email: true,
            role: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            clientes: true,
            lavadores: true,
            ordens: true,
            servicos: true,
            adicionais: true,
          },
        },
      },
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    // Get financial summary
    const financialSummary = await prisma.ordemServico.aggregate({
      where: { empresaId: id },
      _sum: { valorTotal: true },
      _count: true,
    });

    const ordensFinalizadas = await prisma.ordemServico.count({
      where: { empresaId: id, status: 'FINALIZADO' },
    });

    // Get recent orders
    const recentOrders = await prisma.ordemServico.findMany({
      where: { empresaId: id },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        cliente: { select: { nome: true } },
        veiculo: { select: { placa: true, modelo: true } },
      },
    });

    res.json({
      ...empresa,
      financialSummary: {
        totalReceita: financialSummary._sum.valorTotal || 0,
        totalOrdens: financialSummary._count,
        ordensFinalizadas,
      },
      recentOrders,
    });
  } catch (error) {
    console.error('Error fetching company details:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes da empresa' });
  }
};

/**
 * Get Risk Alerts
 * Returns companies with potential issues (mock implementation for now)
 */
export const getRiskAlerts = async (req: Request, res: Response) => {
  try {
    // TODO: Implement real risk analysis logic
    // For now, return companies with low activity

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const empresas = await prisma.empresa.findMany({
      where: { ativo: true },
      include: {
        _count: {
          select: {
            ordens: {
              where: { createdAt: { gte: thirtyDaysAgo } },
            },
          },
        },
      },
    });

    // Identify companies with low activity (< 5 orders in 30 days)
    const alerts = empresas
      .filter((empresa) => empresa._count.ordens < 5)
      .map((empresa) => ({
        empresaId: empresa.id,
        empresaNome: empresa.nome,
        type: 'low_activity',
        severity: 'medium',
        message: `Baixa atividade: ${empresa._count.ordens} ordens nos últimos 30 dias`,
        ordensRecentes: empresa._count.ordens,
      }));

    res.json(alerts);
  } catch (error) {
    console.error('Error fetching risk alerts:', error);
    res.status(500).json({ error: 'Erro ao buscar alertas de risco' });
  }
};

/**
 * Get Engagement Metrics
 * Returns platform engagement statistics (mock implementation for now)
 */
export const getEngagement = async (req: Request, res: Response) => {
  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Count orders created today
    const ordensHoje = await prisma.ordemServico.count({
      where: {
        createdAt: { gte: today },
      },
    });

    // Count orders created yesterday
    const ordensOntem = await prisma.ordemServico.count({
      where: {
        createdAt: { gte: yesterday, lt: today },
      },
    });

    // Count active companies (with orders in last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const empresasAtivas = await prisma.empresa.findMany({
      where: {
        ativo: true,
        ordens: {
          some: {
            createdAt: { gte: sevenDaysAgo },
          },
        },
      },
    });

    res.json({
      ordensHoje,
      ordensOntem,
      empresasAtivasSemana: empresasAtivas.length,
      dailyActiveUsers: empresasAtivas.length, // Simplified metric
      weeklyActiveUsers: empresasAtivas.length,
    });
  } catch (error) {
    console.error('Error fetching engagement metrics:', error);
    res.status(500).json({ error: 'Erro ao buscar métricas de engajamento' });
  }
};

/**
 * Toggle Company Active Status
 * Allows admin to activate/deactivate companies
 */
export const toggleCompanyStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const empresa = await prisma.empresa.findUnique({
      where: { id },
      select: { ativo: true },
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    const updatedEmpresa = await prisma.empresa.update({
      where: { id },
      data: { ativo: !empresa.ativo },
      include: {
        usuario: {
          select: {
            nome: true,
            email: true,
          },
        },
      },
    });

    res.json({
      message: `Empresa ${updatedEmpresa.ativo ? 'ativada' : 'desativada'} com sucesso`,
      empresa: updatedEmpresa,
    });
  } catch (error) {
    console.error('Error toggling company status:', error);
    res.status(500).json({ error: 'Erro ao alterar status da empresa' });
  }
};
