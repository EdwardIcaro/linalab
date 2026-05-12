import { Request, Response } from 'express';
import prisma from '../db';
import { subscriptionService } from '../services/subscriptionService';
import { getTodayRangeBRT, getTodayStrBRT, getDateRangeBRT } from '../utils/dateUtils';
import { gerarTokenCurto } from '../utils/tokenUtils';

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
    intervaloMin = 60,   // pausa/almoço em minutos
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
            intervaloMin, toleranciaMin, modoEncerramento, modoAutenticacao,
          }),
        },
        update: {
          ativo: true,
          config: JSON.stringify({
            modoIntegracao, nomeEmpresa, cnpj, setor,
            endereco, lat, lng, raioGps, nivelGps,
            metodosVerificacao, jornadaEntrada, jornadaSaida,
            intervaloMin, toleranciaMin, modoEncerramento, modoAutenticacao,
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
              jornadaEntrada: l.jornadaEntrada ?? null,
              cargaHorariaDia: l.cargaHorariaDia ? parseFloat(l.cargaHorariaDia) : null,
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
            telefone: f.telefone ?? null,
            jornadaEntrada: f.jornadaEntrada ?? null,
            cargaHorariaDia: f.cargaHorariaDia ? parseFloat(f.cargaHorariaDia) : null,
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

// ─── Helpers internos ─────────────────────────────────────────────────────────
function horaParaMin(horaStr: string): number {
  const [h, m] = (horaStr || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatHoraBRT(d: Date): string {
  return new Date(d).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

function calcMinutosTrabalhados(
  marcacoes: Array<{ tipo: string; timestamp: Date }>,
  now: Date,
): number {
  let total = 0;
  let i = 0;
  while (i < marcacoes.length) {
    if (marcacoes[i].tipo === 'ENTRADA') {
      let j = i + 1;
      while (j < marcacoes.length && marcacoes[j].tipo !== 'SAIDA') j++;
      if (j < marcacoes.length) {
        total += Math.round((marcacoes[j].timestamp.getTime() - marcacoes[i].timestamp.getTime()) / 60000);
        i = j + 1;
      } else {
        total += Math.round((now.getTime() - marcacoes[i].timestamp.getTime()) / 60000);
        i++;
      }
    } else {
      i++;
    }
  }
  return total;
}

// ─── GET /api/dp/dashboard ────────────────────────────────────────────────────
export const getDashboardDp = async (req: EmpresaRequest, res: Response) => {
  const empresaId = ((req as any).empresaId || req.query.empresaId) as string;
  if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatório' });

  try {
    const [sistema, empresa] = await Promise.all([
      prisma.empresaSistema.findFirst({ where: { empresaId, sistema: 'data-point', ativo: true } }),
      prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true } }),
    ]);
    if (!sistema) return res.status(403).json({ error: 'Data Point não ativo para esta empresa' });

    const cfg = sistema.config ? JSON.parse(sistema.config as string) : {};
    const jornadaEntradaCfg: string = cfg.jornadaEntrada || '08:00';
    const jornadaSaidaCfg: string  = cfg.jornadaSaida  || '17:00';
    const intervaloMin: number     = cfg.intervaloMin  || 60;
    const cargaHorariaDiaCfg       = 8; // padrão 8h quando não definido por funcionário

    const now = new Date();
    const { start: diaStart, end: diaEnd } = getTodayRangeBRT();

    // Semana atual (últimos 7 dias em BRT)
    const todayStr = getTodayStrBRT();
    const semanaStart = new Date(diaStart.getTime() - 6 * 86400000);

    // Funcionários ativos com marcações de hoje e da semana
    const funcionarios = await prisma.dpFuncionario.findMany({
      where: { empresaId, status: 'ATIVO' },
      include: {
        marcacoes: {
          where: { timestamp: { gte: semanaStart, lte: diaEnd } },
          orderBy: { timestamp: 'asc' },
        },
      },
      orderBy: { nome: 'asc' },
    });

    // Nowtime em minutos BRT (para comparar com horários de jornada)
    const nowBrtMs = now.getTime() - 3 * 3600000;
    const nowBrtMin = Math.floor((nowBrtMs % 86400000) / 60000);
    const jornadaSaidaMin = horaParaMin(jornadaSaidaCfg);

    const funcProcessados = funcionarios.map(f => {
      const marcacoesHoje = f.marcacoes.filter(
        m => m.timestamp >= diaStart && m.timestamp <= diaEnd,
      );
      const marcacoesSemana = f.marcacoes;

      // Carga horária efetiva (override individual ou padrão da empresa)
      const cargaEsperadaMin = (f.cargaHorariaDia ?? cargaHorariaDiaCfg) * 60;

      // Minutos trabalhados hoje
      const minutosHoje = calcMinutosTrabalhados(marcacoesHoje, now);

      // Minutos trabalhados na semana (agrupa por dia)
      const diasSemana = new Set(marcacoesSemana.map(m => {
        const d = new Date(m.timestamp.getTime() - 3 * 3600000);
        return d.toISOString().split('T')[0];
      }));
      let minutosSemana = 0;
      for (const dia of diasSemana) {
        const { start, end } = getDateRangeBRT(dia);
        const marcsDia = marcacoesSemana.filter(m => m.timestamp >= start && m.timestamp <= end);
        const nowDia = dia === todayStr ? now : end;
        minutosSemana += calcMinutosTrabalhados(marcsDia, nowDia);
      }

      // Estado
      let estado: 'AUSENTE' | 'DENTRO' | 'FORA_TEMP' | 'ENCERROU' = 'AUSENTE';
      if (marcacoesHoje.length > 0) {
        const ultima = marcacoesHoje[marcacoesHoje.length - 1];
        if (ultima.tipo === 'ENTRADA') {
          estado = 'DENTRO';
        } else {
          // Última é SAIDA — encerrou ou pausa?
          if (minutosHoje >= cargaEsperadaMin - 30 || nowBrtMin >= jornadaSaidaMin) {
            estado = 'ENCERROU';
          } else {
            estado = 'FORA_TEMP';
          }
        }
      }

      const minutosExtra = Math.max(0, minutosHoje - cargaEsperadaMin);
      const gpsSuspeito = marcacoesHoje.some(m => m.gpsPrecisaoSuspeita);

      return {
        id: f.id,
        nome: f.nome,
        cargo: f.cargo,
        cargaEsperadaMin,
        estado,
        minutosHoje,
        minutosExtra,
        minutosSemana,
        gpsSuspeito,
        marcacoesHoje: marcacoesHoje.map(m => ({
          id: m.id,
          tipo: m.tipo,
          timestamp: m.timestamp,
          horaFormatada: formatHoraBRT(m.timestamp),
          gpsPrecisaoSuspeita: m.gpsPrecisaoSuspeita,
          gpsNegado: m.gpsNegado,
          canal: m.canal,
        })),
      };
    });

    // Resumo
    const resumo = {
      total:    funcProcessados.length,
      dentro:   funcProcessados.filter(f => f.estado === 'DENTRO').length,
      foratemp: funcProcessados.filter(f => f.estado === 'FORA_TEMP').length,
      encerrou: funcProcessados.filter(f => f.estado === 'ENCERROU').length,
      ausente:  funcProcessados.filter(f => f.estado === 'AUSENTE').length,
      presentes: funcProcessados.filter(f => f.estado !== 'AUSENTE').length,
    };

    // Alertas
    const alertas: Array<{
      tipo: string; funcionarioId: string; funcionarioNome: string;
      descricao: string; horaFormatada: string | null;
    }> = [];
    for (const f of funcProcessados) {
      const suspeita = f.marcacoesHoje.find(m => m.gpsPrecisaoSuspeita);
      if (suspeita) {
        alertas.push({
          tipo: 'GPS_SUSPEITO',
          funcionarioId: f.id,
          funcionarioNome: f.nome,
          descricao: `GPS com precisão suspeita às ${suspeita.horaFormatada}. Ponto salvo com flag.`,
          horaFormatada: suspeita.horaFormatada,
        });
      }
      if (f.minutosExtra > 0) {
        const ultima = f.marcacoesHoje[f.marcacoesHoje.length - 1];
        alertas.push({
          tipo: 'HORA_EXTRA',
          funcionarioId: f.id,
          funcionarioNome: f.nome,
          descricao: `${formatMinutos(f.minutosExtra)} além da jornada contratada.`,
          horaFormatada: ultima?.horaFormatada ?? null,
        });
      }
    }

    res.json({
      empresaNome: empresa?.nome ?? '',
      dataHoje: todayStr,
      config: { jornadaEntrada: jornadaEntradaCfg, jornadaSaida: jornadaSaidaCfg, intervaloMin },
      resumo,
      funcionarios: funcProcessados,
      alertas,
    });
  } catch (error) {
    console.error('[dp] dashboard:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

function formatMinutos(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

// ─── GET /api/dp/funcionarios ─────────────────────────────────────────────────
export const getDpFuncionarios = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatório' });

  try {
    const { status } = req.query;
    const where: any = { empresaId };
    if (status && status !== 'TODOS') where.status = status as string;

    const funcionarios = await prisma.dpFuncionario.findMany({
      where,
      select: {
        id: true, nome: true, cpf: true, cargo: true,
        salarioBase: true, cargaHoraria: true, telefone: true,
        status: true, lavadorId: true, jornadaEntrada: true,
        cargaHorariaDia: true, pinDefinido: true, linkToken: true,
        createdAt: true,
      },
      orderBy: { nome: 'asc' },
    });

    // Busca linkTokenCurto dos lavadores vinculados
    const lavadorIds = funcionarios
      .map(f => f.lavadorId)
      .filter((id): id is string => !!id);

    const linksPorLavador = new Map<string, string | null>();
    if (lavadorIds.length > 0) {
      const lavadores = await prisma.lavador.findMany({
        where: { id: { in: lavadorIds } },
        select: { id: true, linkTokenCurto: true },
      });
      lavadores.forEach(l => linksPorLavador.set(l.id, l.linkTokenCurto));
    }

    const result = funcionarios.map(f => ({
      ...f,
      portalToken: f.lavadorId
        ? (linksPorLavador.get(f.lavadorId) ?? null)
        : f.linkToken,
      portalSuportado: !!f.lavadorId,
    }));

    res.json({ funcionarios: result });
  } catch (error) {
    console.error('[dp] getFuncionarios:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

// ─── POST /api/dp/funcionarios ────────────────────────────────────────────────
export const criarDpFuncionario = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatório' });

  const { nome, cpf, cargo, salarioBase, cargaHoraria, telefone, jornadaEntrada, cargaHorariaDia } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });

  try {
    const linkToken = gerarTokenCurto(8);

    const funcionario = await prisma.dpFuncionario.create({
      data: {
        empresaId,
        nome: nome.trim(),
        cpf: cpf?.trim() || null,
        cargo: cargo?.trim() || null,
        salarioBase: salarioBase !== undefined && salarioBase !== '' ? parseFloat(salarioBase) : null,
        cargaHoraria: cargaHoraria !== undefined && cargaHoraria !== '' ? parseInt(cargaHoraria) : null,
        telefone: telefone?.trim() || null,
        jornadaEntrada: jornadaEntrada?.trim() || null,
        cargaHorariaDia: cargaHorariaDia !== undefined && cargaHorariaDia !== '' ? parseFloat(cargaHorariaDia) : null,
        status: 'ATIVO',
        linkToken,
        updatedAt: new Date(),
      },
    });

    res.status(201).json({ funcionario });
  } catch (error) {
    console.error('[dp] criarFuncionario:', error);
    res.status(500).json({ error: 'Erro ao criar funcionário' });
  }
};

// ─── PUT /api/dp/funcionarios/:id ─────────────────────────────────────────────
export const atualizarDpFuncionario = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  const { id } = req.params as { id: string };

  try {
    const existente = await prisma.dpFuncionario.findFirst({ where: { id, empresaId } });
    if (!existente) return res.status(404).json({ error: 'Funcionário não encontrado' });

    const { nome, cpf, cargo, salarioBase, cargaHoraria, telefone, jornadaEntrada, cargaHorariaDia, status } = req.body;

    const statusValidos = ['ATIVO', 'AFASTADO', 'FERIAS', 'DESLIGADO'];
    if (status !== undefined && !statusValidos.includes(status))
      return res.status(400).json({ error: 'Status inválido' });

    const funcionario = await prisma.dpFuncionario.update({
      where: { id },
      data: {
        ...(nome !== undefined && { nome: nome.trim() }),
        ...(cpf !== undefined && { cpf: cpf?.trim() || null }),
        ...(cargo !== undefined && { cargo: cargo?.trim() || null }),
        ...(salarioBase !== undefined && { salarioBase: salarioBase !== '' ? parseFloat(salarioBase) : null }),
        ...(cargaHoraria !== undefined && { cargaHoraria: cargaHoraria !== '' ? parseInt(cargaHoraria) : null }),
        ...(telefone !== undefined && { telefone: telefone?.trim() || null }),
        ...(jornadaEntrada !== undefined && { jornadaEntrada: jornadaEntrada?.trim() || null }),
        ...(cargaHorariaDia !== undefined && { cargaHorariaDia: cargaHorariaDia !== '' ? parseFloat(cargaHorariaDia) : null }),
        ...(status !== undefined && { status }),
        updatedAt: new Date(),
      },
    });

    res.json({ funcionario });
  } catch (error) {
    console.error('[dp] atualizarFuncionario:', error);
    res.status(500).json({ error: 'Erro ao atualizar funcionário' });
  }
};

// ─── POST /api/dp/funcionarios/:id/reset-pin ──────────────────────────────────
export const resetarPinDpFuncionario = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  const { id } = req.params as { id: string };

  try {
    const existente = await prisma.dpFuncionario.findFirst({ where: { id, empresaId } });
    if (!existente) return res.status(404).json({ error: 'Funcionário não encontrado' });

    await prisma.dpFuncionario.update({
      where: { id },
      data: { pin: null, pinDefinido: false, sessionVersion: { increment: 1 } },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('[dp] resetarPin:', error);
    res.status(500).json({ error: 'Erro ao resetar PIN' });
  }
};

// ─── POST /api/dp/funcionarios/:id/regenerar-link ─────────────────────────────
export const regenerarLinkDpFuncionario = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  const { id } = req.params as { id: string };

  try {
    const existente = await prisma.dpFuncionario.findFirst({ where: { id, empresaId } });
    if (!existente) return res.status(404).json({ error: 'Funcionário não encontrado' });

    const linkToken = gerarTokenCurto(8);
    await prisma.dpFuncionario.update({
      where: { id },
      data: { linkToken, pin: null, pinDefinido: false, sessionVersion: { increment: 1 } },
    });

    res.json({ linkToken });
  } catch (error) {
    console.error('[dp] regenerarLink:', error);
    res.status(500).json({ error: 'Erro ao regenerar link' });
  }
};
