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
    const [vinculadosLav, vinculadosSub] = await Promise.all([
      prisma.dpFuncionario.findMany({
        where: { empresaId, lavadorId: { not: null } },
        select: { lavadorId: true },
      }),
      prisma.dpFuncionario.findMany({
        where: { empresaId, usuarioId: { not: null } },
        select: { usuarioId: true },
      }),
    ]);
    const idsVinculadosLav = new Set(vinculadosLav.map(v => v.lavadorId));
    const idsVinculadosSub = new Set(vinculadosSub.map(v => v.usuarioId));

    res.json({
      lavadores: lavadores.map(l => ({
        ...l,
        jaImportado: idsVinculadosLav.has(l.id),
      })),
      subaccounts: subaccounts.map(s => ({
        ...s,
        jaImportado: idsVinculadosSub.has(s.id),
      })),
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

      // Importa lavadores e subaccounts (usuários do sistema)
      for (const l of importados) {
        if (l.lavadorId) {
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
        } else if (l.usuarioId) {
          const jaExiste = await tx.dpFuncionario.findFirst({
            where: { empresaId, usuarioId: l.usuarioId },
          });
          if (!jaExiste) {
            const linkToken = gerarTokenCurto(8);
            await tx.dpFuncionario.create({
              data: {
                empresaId,
                nome: l.nome,
                cargo: l.cargo ?? null,
                telefone: l.telefone ?? null,
                usuarioId: l.usuarioId,
                jornadaEntrada: l.jornadaEntrada ?? null,
                cargaHorariaDia: l.cargaHorariaDia ? parseFloat(l.cargaHorariaDia) : null,
                status: 'ATIVO',
                linkToken,
                updatedAt: new Date(),
              },
            });
          }
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

// ─── GET /api/dp/espelho ──────────────────────────────────────────────────────
// Motor simples: horas trabalhadas vs. contratadas por funcionário por dia.
// Status por dia: PRESENTE | FALTA_PARCIAL | FALTA | FOLGA (fim de semana)
export const getDpEspelho = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatório' });

  try {
    const sistema = await prisma.empresaSistema.findFirst({
      where: { empresaId, sistema: 'data-point', ativo: true },
    });
    if (!sistema) return res.status(403).json({ error: 'Data Point não ativo' });

    const cfg = sistema.config ? JSON.parse(sistema.config as string) : {};
    const toleranciaMin: number = cfg.toleranciaMin ?? 10;
    const cargaHorariaDiaCfg: number = 8;

    // Período: padrão semana atual
    const hoje = getTodayStrBRT();
    const dataFim = (req.query.fim as string) || hoje;
    let dataInicio = (req.query.inicio as string) || '';
    if (!dataInicio) {
      const d = new Date(dataFim + 'T12:00:00');
      d.setDate(d.getDate() - 6);
      dataInicio = d.toISOString().split('T')[0];
    }

    // Gera lista de datas
    const dias: string[] = [];
    const cursor = new Date(dataInicio + 'T12:00:00');
    const fimDate = new Date(dataFim + 'T12:00:00');
    while (cursor <= fimDate) {
      dias.push(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }
    if (dias.length > 31) return res.status(400).json({ error: 'Período máximo: 31 dias' });

    const funcionarios = await prisma.dpFuncionario.findMany({
      where: { empresaId, status: { not: 'DESLIGADO' } },
      select: {
        id: true, nome: true, cargo: true,
        cargaHorariaDia: true, jornadaEntrada: true,
      },
      orderBy: { nome: 'asc' },
    });

    // Busca todas as marcações do período de uma vez
    const { start: periodoStart } = getDateRangeBRT(dataInicio);
    const { end: periodoEnd } = getDateRangeBRT(dataFim);

    const todasMarcacoes = await prisma.dpMarcacao.findMany({
      where: {
        empresaId,
        funcionarioId: { in: funcionarios.map(f => f.id) },
        timestamp: { gte: periodoStart, lte: periodoEnd },
      },
      select: { funcionarioId: true, tipo: true, timestamp: true },
      orderBy: { timestamp: 'asc' },
    });

    const now = new Date();

    const resultado = funcionarios.map(f => {
      const cargaEsperadaMin = (f.cargaHorariaDia ?? cargaHorariaDiaCfg) * 60;
      const marcacoesFuncionario = todasMarcacoes.filter(m => m.funcionarioId === f.id);

      let totalMinutosTrabalhou = 0;
      let diasPresente = 0;
      let diasFalta = 0;
      let diasParcial = 0;
      let diasFolga = 0;

      const diasMap: Record<string, {
        status: string;
        minutosTrabalhou: number;
        marcacoes: number;
        horaEntrada: string | null;
        horaSaida: string | null;
      }> = {};

      for (const dia of dias) {
        const diaSemana = new Date(dia + 'T12:00:00').getDay(); // 0=dom, 6=sab
        const isFimDeSemana = diaSemana === 0 || diaSemana === 6;

        const { start, end } = getDateRangeBRT(dia);
        const marcacoesDia = marcacoesFuncionario.filter(
          m => m.timestamp >= start && m.timestamp <= end,
        );

        const fimCalculo = dia === hoje ? now : end;
        const minutosTrabalhou = calcMinutosTrabalhados(
          marcacoesDia.map(m => ({ tipo: m.tipo, timestamp: m.timestamp })),
          fimCalculo,
        );

        const primeiraEntrada = marcacoesDia.find(m => m.tipo === 'ENTRADA');
        const ultimaSaida = [...marcacoesDia].reverse().find(m => m.tipo === 'SAIDA');

        if (isFimDeSemana && minutosTrabalhou === 0) {
          diasMap[dia] = {
            status: 'FOLGA',
            minutosTrabalhou: 0,
            marcacoes: 0,
            horaEntrada: null,
            horaSaida: null,
          };
          diasFolga++;
          continue;
        }

        let status: string;
        if (minutosTrabalhou === 0) {
          status = 'FALTA';
          diasFalta++;
        } else if (minutosTrabalhou >= cargaEsperadaMin - toleranciaMin) {
          status = 'PRESENTE';
          diasPresente++;
        } else {
          status = 'FALTA_PARCIAL';
          diasParcial++;
        }

        totalMinutosTrabalhou += minutosTrabalhou;

        diasMap[dia] = {
          status,
          minutosTrabalhou,
          marcacoes: marcacoesDia.length,
          horaEntrada: primeiraEntrada ? formatHoraBRT(primeiraEntrada.timestamp) : null,
          horaSaida: ultimaSaida ? formatHoraBRT(ultimaSaida.timestamp) : null,
        };
      }

      const diasUteis = dias.length - diasFolga;
      const minutosEsperadoTotal = cargaEsperadaMin * diasUteis;

      return {
        id: f.id,
        nome: f.nome,
        cargo: f.cargo,
        cargaEsperadaMin,
        dias: diasMap,
        totais: {
          diasPresente,
          diasFalta,
          diasParcial,
          diasFolga,
          minutosTotal: totalMinutosTrabalhou,
          minutosEsperadoTotal,
          saldoMin: totalMinutosTrabalhou - minutosEsperadoTotal,
        },
      };
    });

    res.json({
      periodo: { inicio: dataInicio, fim: dataFim },
      dias,
      config: { toleranciaMin, cargaHorariaDia: cargaHorariaDiaCfg },
      funcionarios: resultado,
    });
  } catch (error) {
    console.error('[dp] espelho:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

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
// Para funcionários vinculados ao Lina Wash (lavadorId preenchido), o portal
// autentica pela tabela lavador — reset deve operar lá.
export const resetarPinDpFuncionario = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  const { id } = req.params as { id: string };

  try {
    const existente = await prisma.dpFuncionario.findFirst({
      where: { id, empresaId },
      select: { id: true, lavadorId: true },
    });
    if (!existente) return res.status(404).json({ error: 'Funcionário não encontrado' });

    if (existente.lavadorId) {
      await prisma.lavador.update({
        where: { id: existente.lavadorId },
        data: { pin: null, pinDefinido: false, sessionVersion: { increment: 1 } },
      });
    } else {
      await prisma.dpFuncionario.update({
        where: { id },
        data: { pin: null, pinDefinido: false, sessionVersion: { increment: 1 } },
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('[dp] resetarPin:', error);
    res.status(500).json({ error: 'Erro ao resetar PIN' });
  }
};

// ─── POST /api/dp/funcionarios/:id/regenerar-link ─────────────────────────────
// Para funcionários vinculados, o portal usa lavador.linkTokenCurto — regenerar
// deve atualizar lá e invalidar a sessão ativa.
export const regenerarLinkDpFuncionario = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  const { id } = req.params as { id: string };

  try {
    const existente = await prisma.dpFuncionario.findFirst({
      where: { id, empresaId },
      select: { id: true, lavadorId: true },
    });
    if (!existente) return res.status(404).json({ error: 'Funcionário não encontrado' });

    const novoToken = gerarTokenCurto(8);

    if (existente.lavadorId) {
      await prisma.lavador.update({
        where: { id: existente.lavadorId },
        data: {
          linkTokenCurto: novoToken,
          pin: null,
          pinDefinido: false,
          sessionVersion: { increment: 1 },
        },
      });
    } else {
      await prisma.dpFuncionario.update({
        where: { id },
        data: {
          linkToken: novoToken,
          pin: null,
          pinDefinido: false,
          sessionVersion: { increment: 1 },
        },
      });
    }

    res.json({ linkToken: novoToken });
  } catch (error) {
    console.error('[dp] regenerarLink:', error);
    res.status(500).json({ error: 'Erro ao regenerar link' });
  }
};

// ─── PATCH /api/dp/config ────────────────────────────────────────────────────
export const atualizarConfigDp = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;

  const {
    nomeEmpresa, cnpj, setor, endereco,
    lat, lng, raioGps, nivelGps,
    jornadaEntrada, jornadaSaida, intervaloMin, toleranciaMin,
    modoEncerramento, modoAutenticacao,
  } = req.body;

  try {
    const sistema = await prisma.empresaSistema.findFirst({
      where: { empresaId, sistema: 'data-point', ativo: true },
    });
    if (!sistema) return res.status(404).json({ error: 'Data Point não ativo para esta empresa' });

    const cfgAtual = sistema.config ? JSON.parse(sistema.config as string) : {};

    const cfgNovo = {
      ...cfgAtual,
      ...(nomeEmpresa    !== undefined && { nomeEmpresa }),
      ...(cnpj           !== undefined && { cnpj }),
      ...(setor          !== undefined && { setor }),
      ...(endereco       !== undefined && { endereco }),
      ...(lat            !== undefined && { lat: lat === '' ? null : parseFloat(lat) }),
      ...(lng            !== undefined && { lng: lng === '' ? null : parseFloat(lng) }),
      ...(raioGps        !== undefined && { raioGps: parseInt(raioGps) }),
      ...(nivelGps       !== undefined && { nivelGps }),
      ...(jornadaEntrada !== undefined && { jornadaEntrada }),
      ...(jornadaSaida   !== undefined && { jornadaSaida }),
      ...(intervaloMin   !== undefined && { intervaloMin: parseInt(intervaloMin) }),
      ...(toleranciaMin  !== undefined && { toleranciaMin: parseInt(toleranciaMin) }),
      ...(modoEncerramento !== undefined && { modoEncerramento }),
      ...(modoAutenticacao !== undefined && { modoAutenticacao }),
    };

    await prisma.empresaSistema.update({
      where: { id: sistema.id },
      data: { config: JSON.stringify(cfgNovo) },
    });

    res.json({ ok: true, config: cfgNovo });
  } catch (error) {
    console.error('[dp] atualizarConfig:', error);
    res.status(500).json({ error: 'Erro ao atualizar configuração' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 7 — AJUSTES E AFASTAMENTOS
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// MARCAÇÕES — CRUD ADMIN
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/dp/marcacoes ───────────────────────────────────────────────────
export const criarMarcacaoManual = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  const { funcionarioId, data, hora, tipo } = req.body;

  if (!funcionarioId || !data || !hora || !tipo)
    return res.status(400).json({ error: 'funcionarioId, data, hora e tipo são obrigatórios' });

  if (!['ENTRADA', 'SAIDA'].includes(tipo))
    return res.status(400).json({ error: 'tipo deve ser ENTRADA ou SAIDA' });

  if (!/^\d{2}:\d{2}$/.test(hora) || !/^\d{4}-\d{2}-\d{2}$/.test(data))
    return res.status(400).json({ error: 'Formato inválido. Use YYYY-MM-DD e HH:MM' });

  try {
    const func = await prisma.dpFuncionario.findFirst({ where: { id: funcionarioId, empresaId } });
    if (!func) return res.status(404).json({ error: 'Funcionário não encontrado' });

    const [h, m] = hora.split(':').map(Number);
    const [y, mo, d] = data.split('-').map(Number);
    const timestamp = new Date(Date.UTC(y, mo - 1, d, h + 3, m, 0)); // BRT = UTC-3

    const marcacao = await prisma.dpMarcacao.create({
      data: { empresaId, funcionarioId, tipo, canal: 'MANUAL', timestamp, ajustado: true },
    });

    res.status(201).json({ marcacao });
  } catch (error) {
    console.error('[dp] criarMarcacaoManual:', error);
    res.status(500).json({ error: 'Erro ao criar marcação' });
  }
};

// ─── PATCH /api/dp/marcacoes/:id ─────────────────────────────────────────────
export const editarMarcacao = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  const { id } = req.params as { id: string };
  const { data, hora, tipo } = req.body;

  try {
    const existente = await prisma.dpMarcacao.findFirst({ where: { id, empresaId } });
    if (!existente) return res.status(404).json({ error: 'Marcação não encontrada' });

    const updateData: any = { ajustado: true };

    if (hora) {
      const dateStr = data || (() => {
        const brt = new Date(existente.timestamp.getTime() - 3 * 3600000);
        return brt.toISOString().split('T')[0];
      })();
      const [h, m] = hora.split(':').map(Number);
      const [y, mo, d] = dateStr.split('-').map(Number);
      updateData.timestamp = new Date(Date.UTC(y, mo - 1, d, h + 3, m, 0));
    }
    if (tipo) updateData.tipo = tipo;

    const marcacao = await prisma.dpMarcacao.update({ where: { id }, data: updateData });
    res.json({ marcacao });
  } catch (error) {
    console.error('[dp] editarMarcacao:', error);
    res.status(500).json({ error: 'Erro ao editar marcação' });
  }
};

// ─── DELETE /api/dp/marcacoes/:id ────────────────────────────────────────────
export const excluirMarcacao = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  const { id } = req.params as { id: string };

  try {
    const existente = await prisma.dpMarcacao.findFirst({ where: { id, empresaId } });
    if (!existente) return res.status(404).json({ error: 'Marcação não encontrada' });

    await prisma.dpMarcacao.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('[dp] excluirMarcacao:', error);
    res.status(500).json({ error: 'Erro ao excluir marcação' });
  }
};

// ─── GET /api/dp/ajustes ──────────────────────────────────────────────────────
export const getDpAjustes = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatório' });

  try {
    const { status } = req.query;
    const where: any = { empresaId };
    if (status && status !== 'TODOS') where.status = status as string;

    const ajustes = await prisma.dpAjuste.findMany({
      where,
      include: {
        funcionario: { select: { id: true, nome: true, cargo: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({ ajustes });
  } catch (error) {
    console.error('[dp] getAjustes:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

// ─── PUT /api/dp/ajustes/:id ──────────────────────────────────────────────────
export const responderAjuste = async (req: EmpresaRequest, res: Response) => {
  const empresaId  = (req as any).empresaId as string;
  const usuarioNome = (req as any).usuarioNome as string;
  const { id } = req.params as { id: string };
  const { status, obsGestor } = req.body;

  if (!['APROVADO', 'REJEITADO'].includes(status))
    return res.status(400).json({ error: 'status deve ser APROVADO ou REJEITADO' });

  try {
    const ajuste = await prisma.dpAjuste.findFirst({ where: { id, empresaId } });
    if (!ajuste) return res.status(404).json({ error: 'Ajuste não encontrado' });
    if (ajuste.status !== 'PENDENTE')
      return res.status(400).json({ error: 'Ajuste já respondido' });

    const updated = await prisma.dpAjuste.update({
      where: { id },
      data: {
        status,
        obsGestor: obsGestor?.trim() || null,
        aprovadoPor: usuarioNome || null,
        aprovadoEm: new Date(),
        updatedAt: new Date(),
      },
    });

    res.json({ ajuste: updated });
  } catch (error) {
    console.error('[dp] responderAjuste:', error);
    res.status(500).json({ error: 'Erro ao responder ajuste' });
  }
};

// ─── GET /api/dp/afastamentos ─────────────────────────────────────────────────
export const getDpAfastamentos = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatório' });

  try {
    const { funcionarioId } = req.query;
    const where: any = { empresaId };
    if (funcionarioId) where.funcionarioId = funcionarioId as string;

    const afastamentos = await prisma.dpAfastamento.findMany({
      where,
      include: {
        funcionario: { select: { id: true, nome: true, cargo: true } },
      },
      orderBy: { dataInicio: 'desc' },
    });

    res.json({ afastamentos });
  } catch (error) {
    console.error('[dp] getAfastamentos:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

// ─── POST /api/dp/afastamentos ────────────────────────────────────────────────
export const criarDpAfastamento = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatório' });

  const { funcionarioId, tipo, dataInicio, dataFim, descricao } = req.body;
  if (!funcionarioId || !tipo || !dataInicio || !dataFim)
    return res.status(400).json({ error: 'funcionarioId, tipo, dataInicio e dataFim são obrigatórios' });

  const tiposValidos = ['FERIAS', 'ATESTADO', 'LICENCA', 'FOLGA_COMP', 'OUTRO'];
  if (!tiposValidos.includes(tipo))
    return res.status(400).json({ error: 'Tipo inválido' });

  try {
    const func = await prisma.dpFuncionario.findFirst({ where: { id: funcionarioId, empresaId } });
    if (!func) return res.status(404).json({ error: 'Funcionário não encontrado' });

    const afastamento = await prisma.dpAfastamento.create({
      data: {
        empresaId,
        funcionarioId,
        tipo,
        dataInicio,
        dataFim,
        descricao: descricao?.trim() || null,
        updatedAt: new Date(),
      },
    });

    res.status(201).json({ afastamento });
  } catch (error) {
    console.error('[dp] criarAfastamento:', error);
    res.status(500).json({ error: 'Erro ao criar afastamento' });
  }
};

// ─── PUT /api/dp/afastamentos/:id ─────────────────────────────────────────────
export const atualizarDpAfastamento = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  const { id } = req.params as { id: string };

  try {
    const existente = await prisma.dpAfastamento.findFirst({ where: { id, empresaId } });
    if (!existente) return res.status(404).json({ error: 'Afastamento não encontrado' });

    const { tipo, dataInicio, dataFim, descricao } = req.body;

    const afastamento = await prisma.dpAfastamento.update({
      where: { id },
      data: {
        ...(tipo && { tipo }),
        ...(dataInicio && { dataInicio }),
        ...(dataFim && { dataFim }),
        ...(descricao !== undefined && { descricao: descricao?.trim() || null }),
        updatedAt: new Date(),
      },
    });

    res.json({ afastamento });
  } catch (error) {
    console.error('[dp] atualizarAfastamento:', error);
    res.status(500).json({ error: 'Erro ao atualizar afastamento' });
  }
};

// ─── DELETE /api/dp/afastamentos/:id ─────────────────────────────────────────
export const excluirDpAfastamento = async (req: EmpresaRequest, res: Response) => {
  const empresaId = (req as any).empresaId as string;
  const { id } = req.params as { id: string };

  try {
    const existente = await prisma.dpAfastamento.findFirst({ where: { id, empresaId } });
    if (!existente) return res.status(404).json({ error: 'Afastamento não encontrado' });

    await prisma.dpAfastamento.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('[dp] excluirAfastamento:', error);
    res.status(500).json({ error: 'Erro ao excluir afastamento' });
  }
};
