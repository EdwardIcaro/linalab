/**
 * Saldo de banco de horas: o que já fechou e o ciclo que está correndo.
 *
 * O fechamento só acontece de 30 em 30 dias, mas ninguém quer descobrir no dia 30 que
 * estava devendo 12 horas. O ciclo em andamento é recalculado ao vivo, com os mesmos
 * critérios do fechamento definitivo — a única diferença é que ele para no dia de hoje.
 *
 * Faltas aparecem à parte, nunca no saldo: banco de horas compensa jornada
 * extraordinária, e falta injustificada é desconto em folha (art. 59 da CLT).
 */

import prisma from '../db';
import { getTodayStrBRT, getDateRangeBRT, dateToStrBRT, addDiasStrBRT } from '../utils/dateUtils';
import { resolverCargaHorariaDia, cargaDaJornada } from '../utils/dpPontoUtils';
import { calcularFechamentoPeriodo } from './bancoHorasService';
import { situacaoDoBanco, prazoDeCompensacao } from './dpBancoMovimentoService';
import { EstadoBanco } from '../utils/bancoHorasFifo';

export interface CicloEmAndamento {
  inicio: string;
  fim: string;
  /** Dias que desviaram da jornada e formaram o saldo do período. */
  detalhe?: { dia: string; esperado: number; trabalhado: number; saldo: number; motivo: string }[];
  diasDecorridos: number;
  diasTotais: number;
  horasEsperadas: number;
  horasTrabalhadas: number;
  saldoParcial: number;
  diasFalta: number;
}

export interface SaldoFuncionario {
  funcionarioId: string;
  nome: string;
  cargo: string | null;
  saldoAcumulado: number;
  /** Situação do prazo de compensação: o que venceu e o que está para vencer. */
  prazo: EstadoBanco | null;
  ciclo: CicloEmAndamento | null;
  fechamentos: {
    periodoInicio: Date;
    periodoFim: Date;
    horasEsperadas: number;
    horasTrabalhadas: number;
    saldoPeriodo: number;
    saldoAcumulado: number;
    diasFalta: number;
    fechadoEm: Date;
  }[];
}

interface Cfg {
  jornadaEntrada?: string;
  jornadaSaida?: string;
  intervaloMin?: number;
  diasFuncionamento?: number[];
  pontoValidoDesde?: string | null;
  bancoHorasAtivo?: boolean;
  bancoHorasPrazoMeses?: number;
}

/** Saldo de um funcionário: acumulado, ciclo corrente e histórico. */
export async function saldoDoFuncionario(
  empresaId: string,
  funcionarioId: string,
  cfg: Cfg,
  comHistorico = true,
): Promise<SaldoFuncionario | null> {
  const func = await prisma.dpFuncionario.findFirst({
    where: { id: funcionarioId, empresaId },
    select: {
      id: true, nome: true, cargo: true, cargaHorariaDia: true,
      dataAdmissao: true, createdAt: true, saldoBancoHorasAtual: true,
      cargoRef: { select: { cargaHorariaDia: true } },
    },
  });
  if (!func) return null;

  const [ultimoFechamento, fechamentos] = await Promise.all([
    prisma.dpFechamentoBanco.findFirst({
      where: { funcionarioId },
      orderBy: { periodoFim: 'desc' },
      select: { periodoFim: true },
    }),
    comHistorico
      ? prisma.dpFechamentoBanco.findMany({
          where: { funcionarioId },
          orderBy: { periodoFim: 'desc' },
          take: 12,
          select: {
            periodoInicio: true, periodoFim: true, horasEsperadas: true, horasTrabalhadas: true,
            saldoPeriodo: true, saldoAcumulado: true, diasFalta: true, fechadoEm: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const hoje = getTodayStrBRT();
  let inicio = dateToStrBRT(ultimoFechamento?.periodoFim ?? func.dataAdmissao ?? func.createdAt);
  if (cfg.pontoValidoDesde && inicio < cfg.pontoValidoDesde) inicio = cfg.pontoValidoDesde;
  const fim = addDiasStrBRT(inicio, 30);

  const ciclo = inicio <= hoje ? await montarCicloParcial(empresaId, func, cfg, inicio, fim, hoje) : null;

  const prazo = await situacaoDoBanco(funcionarioId, prazoDeCompensacao(cfg));

  return {
    funcionarioId: func.id,
    nome: func.nome,
    cargo: func.cargo,
    saldoAcumulado: func.saldoBancoHorasAtual,
    prazo,
    ciclo,
    fechamentos,
  };
}

async function montarCicloParcial(
  empresaId: string,
  func: { id: string; cargaHorariaDia: number | null; cargoRef: { cargaHorariaDia: number } | null },
  cfg: Cfg,
  inicio: string,
  fim: string,
  hoje: string,
): Promise<CicloEmAndamento> {
  // Dias já vividos do ciclo. O de hoje fica de fora: ainda está em curso e contá-lo
  // faria o saldo piorar de manhã e melhorar à tarde, todo dia.
  const dias: string[] = [];
  let cursor = inicio;
  while (cursor < fim && cursor < hoje) {
    dias.push(cursor);
    cursor = addDiasStrBRT(cursor, 1);
  }

  const diasTotais = (() => {
    let n = 0, c = inicio;
    while (c < fim) { n++; c = addDiasStrBRT(c, 1); }
    return n;
  })();

  if (dias.length === 0) {
    return {
      inicio, fim, diasDecorridos: 0, diasTotais,
      horasEsperadas: 0, horasTrabalhadas: 0, saldoParcial: 0, diasFalta: 0,
    };
  }

  const [marcacoes, feriados, afastamentos] = await Promise.all([
    prisma.dpMarcacao.findMany({
      where: {
        funcionarioId: func.id,
        excluidaEm: null,
        timestamp: {
          gte: getDateRangeBRT(dias[0]).start,
          lte: getDateRangeBRT(addDiasStrBRT(dias[dias.length - 1], 1)).end,
        },
      },
      select: { tipo: true, timestamp: true },
      orderBy: { timestamp: 'asc' },
    }),
    prisma.dpFeriado.findMany({
      where: { empresaId },
      select: { data: true, nome: true, recorrente: true, expediente: true },
    }),
    prisma.dpAfastamento.findMany({
      where: { funcionarioId: func.id },
      select: { funcionarioId: true, tipo: true, dataInicio: true, dataFim: true },
    }),
  ]);

  const marcacoesPorDia = new Map<string, { tipo: string; timestamp: Date }[]>();
  for (const m of marcacoes) {
    const d = dateToStrBRT(m.timestamp);
    if (!marcacoesPorDia.has(d)) marcacoesPorDia.set(d, []);
    marcacoesPorDia.get(d)!.push(m);
  }

  const cargaMin = resolverCargaHorariaDia(
    func.cargaHorariaDia,
    func.cargoRef?.cargaHorariaDia,
    cargaDaJornada(cfg.jornadaEntrada, cfg.jornadaSaida, cfg.intervaloMin),
  ) * 60;

  const r = calcularFechamentoPeriodo({
    dias,
    marcacoesPorDia,
    diasFuncionamento: cfg.diasFuncionamento ?? [1, 2, 3, 4, 5],
    feriados,
    funcionarioId: func.id,
    afastamentos,
    cargaHorariaDiaMin: cargaMin,
    intervaloMin: cfg.intervaloMin ?? 0,
  });

  return {
    inicio,
    fim,
    diasDecorridos: dias.length,
    diasTotais,
    horasEsperadas: r.horasEsperadas,
    horasTrabalhadas: r.horasTrabalhadas,
    saldoParcial: r.saldoPeriodo,
    diasFalta: r.diasFalta,
    detalhe: r.detalhe,
  };
}

/** Saldo de toda a equipe — a visão do gestor. */
export async function saldosDaEquipe(empresaId: string, cfg: Cfg): Promise<SaldoFuncionario[]> {
  const funcionarios = await prisma.dpFuncionario.findMany({
    where: { empresaId, status: 'ATIVO' },
    select: { id: true },
    orderBy: { nome: 'asc' },
  });

  const saldos: SaldoFuncionario[] = [];
  for (const f of funcionarios) {
    const s = await saldoDoFuncionario(empresaId, f.id, cfg, false);
    if (s) saldos.push(s);
  }
  return saldos;
}
