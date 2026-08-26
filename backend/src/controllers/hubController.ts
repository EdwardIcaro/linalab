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

    // Busca assinaturas ativas do usuário — uma por sistema (Lina Wash e Lina Center têm assinaturas independentes)
    const [subscriptionWash, subscriptionLc] = await Promise.all([
      prisma.subscription.findFirst({
        where: {
          usuarioId,
          status: { in: ['ACTIVE', 'TRIAL', 'LIFETIME'] },
          plan: { sistema: 'lina-wash' }
        },
        include: { plan: { select: { nome: true, maxEmpresas: true, sistema: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.subscription.findFirst({
        where: {
          usuarioId,
          status: { in: ['ACTIVE', 'TRIAL', 'LIFETIME'] },
          plan: { sistema: 'lina-center' }
        },
        include: { plan: { select: { nome: true, maxEmpresas: true, sistema: true } } },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    // Calcula status e dias restantes de trial
    const getStatusEmpresa = (subscription: typeof subscriptionWash) => {
      if (!subscription) return { label: 'Expirado', tipo: 'expiro', trialDias: null };
      if (subscription.status === 'LIFETIME') return { label: 'Vitalício', tipo: 'ativo', trialDias: null };
      if (subscription.isCurrentlyTrial && subscription.trialEndDate) {
        const dias = Math.max(0, Math.ceil((subscription.trialEndDate.getTime() - Date.now()) / 86400000));
        return { label: `Trial · ${dias} dias`, tipo: 'trial', trialDias: dias };
      }
      return { label: 'Ativo', tipo: 'ativo', trialDias: null };
    };

    const statusInfoWash = getStatusEmpresa(subscriptionWash);
    const statusInfoLc = getStatusEmpresa(subscriptionLc);

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
        statusLabel: statusInfoWash.label,
        statusTipo: statusInfoWash.tipo,
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
          statusLabel: statusInfoWash.label,
          statusTipo: statusInfoWash.tipo,
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
          statusLabel: statusInfoLc.label,
          statusTipo: statusInfoLc.tipo,
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
        plano: subscriptionWash
          ? { nome: subscriptionWash.plan.nome, maxEmpresas: subscriptionWash.plan.maxEmpresas }
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
        plano: subscriptionLc
          ? { nome: subscriptionLc.plan.nome, maxEmpresas: subscriptionLc.plan.maxEmpresas }
          : null,
        empresas: empresasLinaCenter
      }] : [])
    ];

    // Sistemas com assinatura ativa mas sem nenhuma empresa criada ainda — normalmente
    // acontece quando o owner atribui uma assinatura direto pra uma conta que já usa
    // outro sistema (ex: já tem Lina Wash e ganhou acesso ao Lina Center). O usuário
    // precisa "aceitar" criando a empresa daquele sistema.
    const pendentes: { chave: string; nome: string; icone: string; cor: string; plano: string }[] = [];
    if (subscriptionWash && empresasLinaWash.length === 0) {
      pendentes.push({ chave: 'lina-wash', nome: 'Lina Wash', icone: '🚗', cor: 'wash', plano: subscriptionWash.plan.nome });
    }
    if (subscriptionLc && empresasLinaCenter.length === 0) {
      pendentes.push({ chave: 'lina-center', nome: 'Lina Center', icone: '🔧', cor: 'lc', plano: subscriptionLc.plan.nome });
    }

    // Stats globais
    const totalOrdens = ordensHoje.reduce((sum, o) => sum + o._count.id, 0) + lcOrdensHojeTotal;

    return res.json({
      usuario: { nome: usuario.nome },
      sistemas,
      pendentes,
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
