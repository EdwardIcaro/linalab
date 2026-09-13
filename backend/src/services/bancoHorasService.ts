import prisma from '../db';
import { getTodayStrBRT, getDateRangeBRT, dateToStrBRT, addDiasStrBRT } from '../utils/dateUtils';
import {
  resolveFeriadoDia,
  resolveAfastamentoDia,
  isDiaFechado,
  resolverCargaHorariaDia,
  calcMinutosTrabalhados,
} from '../utils/dpPontoUtils';

interface ResultadoFechamento {
  horasEsperadas: number;
  horasTrabalhadas: number;
  horasFeriadoTrabalhado: number;
  saldoPeriodo: number;
}

// Motor de cálculo puro — mesma classificação de dia do getDpEspelho (fechado > feriado > afastamento
// tem prioridade especial: afastamento sempre vence, mesmo em dia que também seria FOLGA/FERIADO,
// porque a regra de peso ×2 da seção 7 da spec nunca se aplica a ausência pessoal).
export function calcularFechamentoPeriodo(params: {
  dias: string[]; // YYYY-MM-DD, período completo já fechado (sem "hoje em andamento")
  marcacoesPorDia: Map<string, { tipo: string; timestamp: Date }[]>;
  diasFuncionamento: number[];
  feriados: { data: string; nome: string; recorrente: boolean }[];
  funcionarioId: string;
  afastamentos: { funcionarioId: string; tipo: string; dataInicio: string; dataFim: string }[];
  cargaHorariaDiaMin: number; // já resolvida (individual ?? cargo ?? 8h) em minutos
}): ResultadoFechamento {
  const { dias, marcacoesPorDia, diasFuncionamento, feriados, funcionarioId, afastamentos, cargaHorariaDiaMin } = params;

  let horasEsperadasMin = 0;
  let horasTrabalhadasMin = 0;
  let horasFeriadoTrabalhadoMin = 0;

  for (const dia of dias) {
    const diaSemana = new Date(dia + 'T12:00:00').getDay();
    const marcacoesDia = marcacoesPorDia.get(dia) || [];
    const fimDia = getDateRangeBRT(dia).end;
    const minutosTrabalhou = calcMinutosTrabalhados(marcacoesDia, fimDia);

    const tipoAfastamento = resolveAfastamentoDia(funcionarioId, dia, afastamentos);
    if (tipoAfastamento) {
      // Ausência pessoal: não soma esperado, conta trabalhado a peso normal (nunca dobra)
      if (minutosTrabalhou > 0) horasTrabalhadasMin += minutosTrabalhou;
      continue;
    }

    const fechado = isDiaFechado(diaSemana, diasFuncionamento);
    const nomeFeriado = resolveFeriadoDia(dia, feriados);
    if (fechado || nomeFeriado) {
      // Dia sem expediente da empresa: não soma esperado; se trabalhou, conta em dobro (CLT — seção 7)
      if (minutosTrabalhou > 0) {
        horasTrabalhadasMin += minutosTrabalhou * 2;
        horasFeriadoTrabalhadoMin += minutosTrabalhou * 2;
      }
      continue;
    }

    horasEsperadasMin += cargaHorariaDiaMin;
    horasTrabalhadasMin += minutosTrabalhou;
  }

  const horasEsperadas = horasEsperadasMin / 60;
  const horasTrabalhadas = horasTrabalhadasMin / 60;

  return {
    horasEsperadas,
    horasTrabalhadas,
    horasFeriadoTrabalhado: horasFeriadoTrabalhadoMin / 60,
    saldoPeriodo: horasTrabalhadas - horasEsperadas,
  };
}

// ─── Cron diário — fecha o ciclo de 30 dias de cada funcionário quando ele vence ──────────────
export async function fecharBancoHorasDiario(): Promise<void> {
  const hojeStr = getTodayStrBRT();

  const empresasAtivas = await prisma.empresaSistema.findMany({
    where: { sistema: 'data-point', ativo: true },
    select: { empresaId: true, config: true },
  });
  if (empresasAtivas.length === 0) return;

  // Opt-in explícito por empresa — sem isso, o cron rodaria pra todo mundo que já tem Data Point
  // ativo, criando fechamentos "surpresa" pra quem nunca pediu essa feature nem validou a leitura
  // da CLT (seção 7 da spec) com o contador. Default desligado.
  const configPorEmpresa = new Map(
    empresasAtivas
      .map(e => [e.empresaId, e.config ? JSON.parse(e.config as string) : {}] as const)
      .filter(([, cfg]) => cfg.bancoHorasAtivo === true),
  );
  if (configPorEmpresa.size === 0) return;

  const funcionarios = await prisma.dpFuncionario.findMany({
    where: { empresaId: { in: [...configPorEmpresa.keys()] }, status: 'ATIVO' },
    select: {
      id: true, empresaId: true, dataAdmissao: true, createdAt: true,
      cargaHorariaDia: true, saldoBancoHorasAtual: true,
      cargoRef: { select: { cargaHorariaDia: true } },
    },
  });

  for (const func of funcionarios) {
    try {
      const ultimoFechamento = await prisma.dpFechamentoBanco.findFirst({
        where: { funcionarioId: func.id },
        orderBy: { periodoFim: 'desc' },
        select: { periodoFim: true },
      });

      const baseStr = dateToStrBRT(ultimoFechamento?.periodoFim ?? func.dataAdmissao ?? func.createdAt);
      const proximoFechamentoStr = addDiasStrBRT(baseStr, 30);
      if (hojeStr < proximoFechamentoStr) continue; // ciclo ainda não venceu

      const dias: string[] = [];
      let cursorStr = baseStr;
      while (cursorStr < proximoFechamentoStr) {
        dias.push(cursorStr);
        cursorStr = addDiasStrBRT(cursorStr, 1);
      }
      if (dias.length === 0) continue;

      const [marcacoes, feriados, afastamentos] = await Promise.all([
        prisma.dpMarcacao.findMany({
          where: {
            funcionarioId: func.id,
            timestamp: { gte: getDateRangeBRT(dias[0]).start, lte: getDateRangeBRT(dias[dias.length - 1]).end },
          },
          select: { tipo: true, timestamp: true },
          orderBy: { timestamp: 'asc' },
        }),
        prisma.dpFeriado.findMany({
          where: { empresaId: func.empresaId },
          select: { data: true, nome: true, recorrente: true },
        }),
        prisma.dpAfastamento.findMany({
          where: { funcionarioId: func.id },
          select: { funcionarioId: true, tipo: true, dataInicio: true, dataFim: true },
        }),
      ]);

      const marcacoesPorDia = new Map<string, { tipo: string; timestamp: Date }[]>();
      for (const m of marcacoes) {
        const diaStr = dateToStrBRT(m.timestamp);
        if (!marcacoesPorDia.has(diaStr)) marcacoesPorDia.set(diaStr, []);
        marcacoesPorDia.get(diaStr)!.push(m);
      }

      const cfg = configPorEmpresa.get(func.empresaId) || {};
      const diasFuncionamento: number[] = cfg.diasFuncionamento ?? [1, 2, 3, 4, 5];
      const cargaHorariaDiaMin = resolverCargaHorariaDia(func.cargaHorariaDia, func.cargoRef?.cargaHorariaDia) * 60;

      const resultado = calcularFechamentoPeriodo({
        dias, marcacoesPorDia, diasFuncionamento, feriados,
        funcionarioId: func.id, afastamentos, cargaHorariaDiaMin,
      });

      const periodoInicio = getDateRangeBRT(baseStr).start;
      const periodoFim = getDateRangeBRT(proximoFechamentoStr).start; // início do próximo ciclo (limite exclusivo)
      const saldoAcumulado = func.saldoBancoHorasAtual + resultado.saldoPeriodo;

      await prisma.$transaction(async (tx) => {
        await tx.dpFechamentoBanco.create({
          data: {
            empresaId: func.empresaId,
            funcionarioId: func.id,
            periodoInicio,
            periodoFim,
            horasEsperadas: resultado.horasEsperadas,
            horasTrabalhadas: resultado.horasTrabalhadas,
            horasFeriadoTrabalhado: resultado.horasFeriadoTrabalhado,
            saldoPeriodo: resultado.saldoPeriodo,
            saldoAcumulado,
          },
        });
        await tx.dpFuncionario.update({
          where: { id: func.id },
          data: { saldoBancoHorasAtual: saldoAcumulado },
        });
      });

      console.log(`[banco-horas] ${func.id}: período ${baseStr}→${proximoFechamentoStr}, saldo do período ${resultado.saldoPeriodo.toFixed(2)}h, acumulado ${saldoAcumulado.toFixed(2)}h`);
    } catch (error) {
      console.error(`[banco-horas] Erro ao fechar ciclo do funcionário ${func.id}:`, error);
    }
  }
}
