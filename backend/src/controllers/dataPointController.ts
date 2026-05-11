import { Request, Response } from 'express';
import prisma from '../db';
import { subscriptionService } from '../services/subscriptionService';

interface UserRequest extends Request { usuarioId?: string; }
interface EmpresaRequest extends Request { empresaId?: string; usuarioId?: string; }

// ─── GET /api/dp/planos ───────────────────────────────────────────────────────
// Retorna planos DP + flag de fidelidade (tem Lina Wash ativo)
export const getPlanosDp = async (req: UserRequest, res: Response) => {
  const usuarioId = (req as any).usuarioId as string;

  try {
    const now = new Date();

    // Planos ativos do Data Point
    const planos = await prisma.subscriptionPlan.findMany({
      where: { sistema: 'data-point', ativo: true },
      orderBy: { ordem: 'asc' },
    });

    // Promoções ativas para planos DP
    const promos = await prisma.promotion.findMany({
      where: {
        ativo: true,
        dataInicio: { lte: now },
        dataFim: { gte: now },
        plan: { sistema: 'data-point' },
      },
      include: { plan: { select: { id: true } } },
    });

    const promoByPlan = new Map(promos.map(p => [p.planId, p]));

    // Verifica se usuário tem Lina Wash ativo (fidelidade)
    const subLW = await prisma.subscription.findFirst({
      where: {
        usuarioId,
        status: { in: ['ACTIVE', 'TRIAL', 'LIFETIME'] },
        plan: { sistema: 'lina-wash' },
      },
    });
    const temFidelidade = !!subLW;

    // Verifica se já tem DP ativo
    const subDP = await prisma.subscription.findFirst({
      where: {
        usuarioId,
        status: { in: ['ACTIVE', 'TRIAL', 'LIFETIME'] },
        plan: { sistema: 'data-point' },
      },
      include: { plan: { select: { nome: true } } },
    });

    const planosComPromo = planos.map(p => {
      const promo = promoByPlan.get(p.id);
      let precoFinal = p.preco;
      let desconto: number | null = null;

      if (promo) {
        if (promo.tipo === 'PERCENTUAL') {
          desconto = promo.valor;
          precoFinal = p.preco * (1 - promo.valor / 100);
        } else {
          desconto = promo.valor;
          precoFinal = Math.max(0, p.preco - promo.valor);
        }
      }

      return {
        ...p,
        precoFinal,
        desconto,
        tipoDesconto: promo?.tipo ?? null,
        promoNome: promo?.nome ?? null,
      };
    });

    res.json({
      planos: planosComPromo,
      temFidelidade,
      subDpAtivo: subDP
        ? { planNome: subDP.plan.nome, status: subDP.status }
        : null,
    });
  } catch (error) {
    console.error('[dp] getPlanos:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

// ─── POST /api/dp/contratar ───────────────────────────────────────────────────
// Cria trial do Data Point para o usuário
export const contratarDp = async (req: UserRequest, res: Response) => {
  const usuarioId = (req as any).usuarioId as string;
  const { planId } = req.body;

  if (!planId) return res.status(400).json({ error: 'planId obrigatório' });

  try {
    const plano = await prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plano || plano.sistema !== 'data-point')
      return res.status(400).json({ error: 'Plano inválido' });

    // Verifica se já tem DP ativo
    const existente = await prisma.subscription.findFirst({
      where: {
        usuarioId,
        status: { in: ['ACTIVE', 'TRIAL', 'LIFETIME'] },
        plan: { sistema: 'data-point' },
      },
    });
    if (existente) return res.status(400).json({ error: 'Você já possui um plano Data Point ativo' });

    const sub = await subscriptionService.createSubscription({
      usuarioId,
      planId,
      isTrial: true,
    });

    res.status(201).json({ subscription: sub });
  } catch (error: any) {
    console.error('[dp] contratar:', error);
    res.status(400).json({ error: error.message || 'Erro ao contratar' });
  }
};

// ─── GET /api/dp/onboarding/importaveis ──────────────────────────────────────
// Retorna lavadores e usuários role USER disponíveis para importar no onboarding
export const getImportaveis = async (req: EmpresaRequest, res: Response) => {
  const empresaId = ((req as any).empresaId || req.query.empresaId) as string;
  if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatório' });

  try {
    const [lavadores, subaccounts] = await Promise.all([
      prisma.lavador.findMany({
        where: { empresaId, ativo: true },
        select: { id: true, nome: true, telefone: true },
        orderBy: { nome: 'asc' },
      }),
      prisma.subaccount.findMany({
        where: { empresaId },
        select: { id: true, nome: true, email: true },
        orderBy: { nome: 'asc' },
      }),
    ]);

    // Lavadores que já têm dp_funcionario vinculado
    const vinculados = await prisma.dpFuncionario.findMany({
      where: { empresaId, lavadorId: { not: null } },
      select: { lavadorId: true },
    });
    const idsVinculados = new Set(vinculados.map(v => v.lavadorId));

    res.json({
      lavadores: lavadores.map(l => ({
        ...l,
        jaImportado: idsVinculados.has(l.id),
      })),
      subaccounts,
    });
  } catch (error) {
    console.error('[dp] importaveis:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

// ─── POST /api/dp/onboarding/salvar ──────────────────────────────────────────
// Salva config do onboarding e ativa Data Point para a empresa
export const salvarOnboarding = async (req: EmpresaRequest, res: Response) => {
  const empresaId = ((req as any).empresaId || req.body.empresaId) as string;
  if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatório' });

  const {
    // Passo 0
    modoIntegracao = 'lina-wash', // 'lina-wash' | 'standalone'
    // Passo 1 — empresa & localização
    nomeEmpresa,
    cnpj,
    setor,
    endereco,
    lat,
    lng,
    raioGps = 80,
    nivelGps = 'BASICO', // BASICO | MEDIO | RIGIDO | MAXIMO
    // Passo 2 — configurações de ponto
    metodosVerificacao = ['GPS'],
    jornadaEntrada = '08:00',
    jornadaSaida = '17:00',
    toleranciaMin = 10,
    modoEncerramento = 'AUTOMATICO', // AUTOMATICO | FUNCIONARIO
    modoAutenticacao = 'PIN', // PIN | SEM_PIN
    // Passo 3 — funcionários
    importados = [],
    novosFuncionarios = [],
  } = req.body;

  try {
    await prisma.$transaction(async (tx) => {
      // Ativa ou atualiza o sistema DP na empresa
      await tx.empresaSistema.upsert({
        where: { empresaId_sistema: { empresaId, sistema: 'data-point' } },
        create: {
          id: `dp-${empresaId}`,
          empresaId,
          sistema: 'data-point',
          ativo: true,
          config: JSON.stringify({
            modoIntegracao, nomeEmpresa, cnpj, setor,
            endereco, lat, lng, raioGps, nivelGps,
            metodosVerificacao, jornadaEntrada, jornadaSaida,
            toleranciaMin, modoEncerramento, modoAutenticacao,
          }),
        },
        update: {
          ativo: true,
          config: JSON.stringify({
            modoIntegracao, nomeEmpresa, cnpj, setor,
            endereco, lat, lng, raioGps, nivelGps,
            metodosVerificacao, jornadaEntrada, jornadaSaida,
            toleranciaMin, modoEncerramento, modoAutenticacao,
          }),
        },
      });

      // Importa lavadores
      for (const l of importados) {
        const jaExiste = await tx.dpFuncionario.findFirst({
          where: { empresaId, lavadorId: l.lavadorId },
        });
        if (!jaExiste) {
          await tx.dpFuncionario.create({
            data: {
              empresaId,
              nome: l.nome,
              cargo: l.cargo ?? null,
              telefone: l.telefone ?? null,
              lavadorId: l.lavadorId,
              status: 'ATIVO',
              updatedAt: new Date(),
            },
          });
        }
      }

      // Cria funcionários novos
      for (const f of novosFuncionarios) {
        await tx.dpFuncionario.create({
          data: {
            empresaId,
            nome: f.nome,
            cpf: f.cpf ?? null,
            cargo: f.cargo ?? null,
            salarioBase: f.salarioBase ? parseFloat(f.salarioBase) : null,
            cargaHoraria: f.cargaHoraria ? parseInt(f.cargaHoraria) : null,
            telefone: f.telefone ?? null,
            status: 'ATIVO',
            updatedAt: new Date(),
          },
        });
      }
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('[dp] salvarOnboarding:', error);
    res.status(500).json({ error: 'Erro ao salvar configuração' });
  }
};

// ─── GET /api/dp/status ───────────────────────────────────────────────────────
// Verifica se DP está ativo e configurado para a empresa
export const getStatusDp = async (req: EmpresaRequest, res: Response) => {
  const empresaId = ((req as any).empresaId || req.query.empresaId) as string;
  if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatório' });

  try {
    const sistema = await prisma.empresaSistema.findFirst({
      where: { empresaId, sistema: 'data-point', ativo: true },
    });

    const totalFuncionarios = sistema
      ? await prisma.dpFuncionario.count({
          where: { empresaId, status: 'ATIVO' },
        })
      : 0;

    res.json({
      ativo: !!sistema,
      config: sistema?.config ? JSON.parse(sistema.config as string) : null,
      totalFuncionarios,
    });
  } catch (error) {
    console.error('[dp] status:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};
