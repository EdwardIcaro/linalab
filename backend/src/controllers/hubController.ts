import { Request, Response } from 'express';
import prisma from '../db';
import { getTodayRangeBRT } from '../utils/dateUtils';

export const getHub = async (req: Request, res: Response) => {
  const usuarioId = (req as any).usuarioId;

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true, nome: true }
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Busca empresas + sistemas ativos
    const empresas = await prisma.empresa.findMany({
      where: { usuarioId },
      select: {
        id: true,
        nome: true,
        sistemasAtivos: {
          where: { ativo: true },
          select: { sistema: true }
        }
      }
    });

    // Busca assinatura ativa do usuário
    const subscription = await prisma.subscription.findFirst({
      where: {
        usuarioId,
        status: { in: ['ACTIVE', 'TRIAL', 'LIFETIME'] }
      },
      include: { plan: { select: { nome: true, maxEmpresas: true, sistema: true } } },
      orderBy: { createdAt: 'desc' }
    });

    const subscriptionSistema = subscription?.plan.sistema ?? 'lina-wash';

    // Calcula status e dias restantes de trial
    const getStatusEmpresa = () => {
      if (!subscription) return { label: 'Expirado', tipo: 'expiro', trialDias: null };
      if (subscription.status === 'LIFETIME') return { label: 'Vitalício', tipo: 'ativo', trialDias: null };
      if (subscription.isCurrentlyTrial && subscription.trialEndDate) {
        const dias = Math.max(0, Math.ceil((subscription.trialEndDate.getTime() - Date.now()) / 86400000));
        return { label: `Trial · ${dias} dias`, tipo: 'trial', trialDias: dias };
      }
      return { label: 'Ativo', tipo: 'ativo', trialDias: null };
    };

    const statusInfo = getStatusEmpresa();

    // Conta ordens de hoje (todos os status exceto CANCELADO) por empresa
    const { start, end } = getTodayRangeBRT();

    const ordensHoje = await prisma.ordemServico.groupBy({
      by: ['empresaId'],
      where: {
        empresaId: { in: empresas.map(e => e.id) },
        status: { not: 'CANCELADO' },
        createdAt: { gte: start, lte: end }
      },
      _count: { id: true }
    });

    const ordensPorEmpresa = new Map(ordensHoje.map(o => [o.empresaId, o._count.id]));

    type EmpresaCard = {
      id: string; nome: string; statusLabel: string;
      statusTipo: string; stat: string; integradoCom: string | null;
    };

    // Empresas do Lina Center têm sistema próprio (não são empresas de Lina Wash)
    const idsComLinaCenter = empresas
      .filter(e => e.sistemasAtivos.some((s: { sistema: string }) => s.sistema === 'lina-center'))
      .map(e => e.id);

    // Monta seção Lina Wash (todas as empresas do usuário, exceto as do Lina Center)
    const empresasLinaWash: EmpresaCard[] = empresas
      .filter(e => !idsComLinaCenter.includes(e.id))
      .map(e => ({
        id: e.id,
        nome: e.nome,
        statusLabel: statusInfo.label,
        statusTipo: statusInfo.tipo,
        stat: `${ordensPorEmpresa.get(e.id) ?? 0} ordens hoje`,
        integradoCom: null
      }));

    // Monta seção Data Point (empresas com sistema 'data-point' ativo)
    const idsComDataPoint = empresas
      .filter(e => e.sistemasAtivos.some((s: { sistema: string }) => s.sistema === 'data-point'))
      .map(e => e.id);

    let empresasDataPoint: EmpresaCard[] = [];
    if (idsComDataPoint.length > 0) {
      const dpFuncionarios = await prisma.dpFuncionario.groupBy({
        by: ['empresaId'],
        where: { empresaId: { in: idsComDataPoint }, status: 'ATIVO' },
        _count: { id: true }
      });
      const funcPorEmpresa = new Map(dpFuncionarios.map((d: { empresaId: string; _count: { id: number } }) => [d.empresaId, d._count.id]));

      empresasDataPoint = empresas
        .filter(e => idsComDataPoint.includes(e.id))
        .map(e => ({
          id: e.id,
          nome: e.nome,
          statusLabel: statusInfo.label,
          statusTipo: statusInfo.tipo,
          stat: `${funcPorEmpresa.get(e.id) ?? 0} funcionários`,
          integradoCom: 'lina-wash'
        }));
    }

    // Monta seção Lina Center (empresas com sistema 'lina-center' ativo)
    let empresasLinaCenter: EmpresaCard[] = [];
    let lcOrdensHojeTotal = 0;
    if (idsComLinaCenter.length > 0) {
      const lcOrdensHoje = await prisma.lcOrdemServico.groupBy({
        by: ['empresaId'],
        where: {
          empresaId: { in: idsComLinaCenter },
          status: { not: 'CANCELADO' },
          createdAt: { gte: start, lte: end }
        },
        _count: { id: true }
      });
      const lcOrdensPorEmpresa = new Map(lcOrdensHoje.map(o => [o.empresaId, o._count.id]));
      lcOrdensHojeTotal = lcOrdensHoje.reduce((sum, o) => sum + o._count.id, 0);

      empresasLinaCenter = empresas
        .filter(e => idsComLinaCenter.includes(e.id))
        .map(e => ({
          id: e.id,
          nome: e.nome,
          statusLabel: statusInfo.label,
          statusTipo: statusInfo.tipo,
          stat: `${lcOrdensPorEmpresa.get(e.id) ?? 0} ordens hoje`,
          integradoCom: null
        }));
    }

    // Monta lista de sistemas
    const sistemas = [
      ...(empresasLinaWash.length > 0 ? [{
        chave: 'lina-wash',
        nome: 'Lina Wash',
        icone: '🚗',
        cor: 'wash',
        plano: subscription && subscriptionSistema === 'lina-wash'
          ? { nome: subscription.plan.nome, maxEmpresas: subscription.plan.maxEmpresas }
          : null,
        empresas: empresasLinaWash
      }] : []),
      ...(empresasDataPoint.length > 0 ? [{
        chave: 'data-point',
        nome: 'Data Point',
        icone: '⏰',
        cor: 'dp',
        plano: null,
        empresas: empresasDataPoint
      }] : []),
      ...(empresasLinaCenter.length > 0 ? [{
        chave: 'lina-center',
        nome: 'Lina Center',
        icone: '🔧',
        cor: 'lc',
        plano: subscription && subscriptionSistema === 'lina-center'
          ? { nome: subscription.plan.nome, maxEmpresas: subscription.plan.maxEmpresas }
          : null,
        empresas: empresasLinaCenter
      }] : [])
    ];

    // Stats globais
    const totalOrdens = ordensHoje.reduce((sum, o) => sum + o._count.id, 0) + lcOrdensHojeTotal;

    return res.json({
      usuario: { nome: usuario.nome },
      sistemas,
      stats: {
        totalSistemas: sistemas.length,
        totalEmpresas: empresas.length,
        ordenasHoje: totalOrdens
      }
    });
  } catch (error) {
    console.error('Erro ao buscar hub:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
};
