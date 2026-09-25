/**
 * Monta o espelho de ponto de um mês.
 *
 * Vive fora do controller porque três telas precisam do mesmo número: o espelho do
 * portal, o resumo que o totem mostra antes da assinatura, e qualquer relatório que
 * venha depois. Se cada uma calculasse do seu jeito, o funcionário veria 160h no tablet
 * e 158h no celular — e assinaria sem saber qual das duas é a verdadeira.
 */

import prisma from '../db';
import { getDateRangeBRT, getTodayStrBRT } from '../utils/dateUtils';
import {
  resolveFeriadoDia,
  resolveAfastamentoDia,
  isDiaFechado,
  resolverDia,
  horaFormatadaBRT,
} from '../utils/dpPontoUtils';

export interface DiaEspelho {
  dia: string;
  diaSemana: number;
  status: string; // FUTURO | FOLGA | FERIADO | AFASTAMENTO | FALTA | HOJE | INCOMPLETO | PRESENTE | FALTA_PARCIAL
  minutosTrabalhou: number;
  intervaloPresumido?: number;
  automatica?: boolean; // alguma batida do dia foi lançada pelo sistema
  marcacoes: { tipo: string; hora: string; canal?: string }[];
  horaEntrada?: string | null;
  horaSaida?: string | null;
  label?: string;
}

export interface EspelhoMes {
  cargaEsperadaMin: number;
  dias: DiaEspelho[];
  resumo: { totalMinutos: number; totalPresente: number; totalFalta: number; pendencias: number };
}

export async function montarEspelhoMes(params: {
  empresaId: string;
  funcionarioId: string;
  cargaEsperadaMin: number;
  ano: number;
  mes: number;
  cfg: {
    toleranciaMin?: number; diasFuncionamento?: number[]; intervaloMin?: number;
    pontoValidoDesde?: string | null;
  };
}): Promise<EspelhoMes> {
  const { empresaId, funcionarioId, cargaEsperadaMin, ano, mes, cfg } = params;
  const toleranciaMin: number = cfg.toleranciaMin ?? 10;
  const diasFuncionamento: number[] = cfg.diasFuncionamento ?? [1, 2, 3, 4, 5];

  const diasNoMes = new Date(ano, mes, 0).getDate();
  const diasDoMes: string[] = [];
  for (let d = 1; d <= diasNoMes; d++) {
    diasDoMes.push(`${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  const { start: mesStart } = getDateRangeBRT(diasDoMes[0]);
  // +1 dia: o turno que começa no último dia do mês fecha no primeiro do mês seguinte
  const { end: mesEnd } = getDateRangeBRT(diasDoMes[diasDoMes.length - 1]);
  const limiteBusca = new Date(mesEnd.getTime() + 86400000);

  const [todasMarcacoes, feriados, afastamentos] = await Promise.all([
    prisma.dpMarcacao.findMany({
      where: { funcionarioId, timestamp: { gte: mesStart, lte: limiteBusca }, excluidaEm: null },
      select: { tipo: true, timestamp: true, canal: true },
      orderBy: { timestamp: 'asc' },
    }),
    prisma.dpFeriado.findMany({
      where: { empresaId },
      select: { data: true, nome: true, recorrente: true },
    }),
    prisma.dpAfastamento.findMany({
      where: { funcionarioId },
      select: { funcionarioId: true, tipo: true, dataInicio: true, dataFim: true },
    }),
  ]);

  const hoje = getTodayStrBRT();
  const now = new Date();

  let totalMinutos = 0;
  let totalPresente = 0;
  let totalFalta = 0;
  let pendencias = 0; // incompletas + parciais

  const dias = diasDoMes.map((dia): DiaEspelho => {
    const diaSemana = new Date(dia + 'T12:00:00').getDay();
    const diaFechado = isDiaFechado(diaSemana, diasFuncionamento);
    const isHoje = dia === hoje;
    const isFuturo = dia > hoje;

    const { start, end } = getDateRangeBRT(dia);
    const marcacoesDia = todasMarcacoes.filter((mc) => mc.timestamp >= start && mc.timestamp <= end);

    // Antes da vigência não havia controle, e ausência de controle não é falta
    if (cfg.pontoValidoDesde && dia < cfg.pontoValidoDesde) {
      return { dia, diaSemana, status: 'SEM_CONTROLE', minutosTrabalhou: 0, marcacoes: [] };
    }

    if (isFuturo) {
      return { dia, diaSemana, status: 'FUTURO', minutosTrabalhou: 0, marcacoes: [] };
    }

    if (diaFechado && marcacoesDia.length === 0) {
      return { dia, diaSemana, status: 'FOLGA', minutosTrabalhou: 0, marcacoes: [] };
    }

    if (marcacoesDia.length === 0) {
      const nomeFeriado = resolveFeriadoDia(dia, feriados);
      if (nomeFeriado) {
        return { dia, diaSemana, status: 'FERIADO', minutosTrabalhou: 0, marcacoes: [], label: nomeFeriado };
      }
      const tipoAfastamento = resolveAfastamentoDia(funcionarioId, dia, afastamentos);
      if (tipoAfastamento) {
        return { dia, diaSemana, status: 'AFASTAMENTO', minutosTrabalhou: 0, marcacoes: [], label: tipoAfastamento };
      }
    }

    const marcacoesSimples = marcacoesDia.map((mc) => ({ tipo: mc.tipo, timestamp: mc.timestamp }));
    const doDiaSeguinte = todasMarcacoes
      .filter((mc) => mc.timestamp > end && mc.timestamp <= new Date(end.getTime() + 86400000))
      .map((mc) => ({ tipo: mc.tipo, timestamp: mc.timestamp }));

    const { minutos: minutosTrabalhou, intervaloPresumido, incompleto } = resolverDia({
      marcacoesDia: marcacoesSimples,
      marcacoesDiaSeguinte: doDiaSeguinte,
      agora: isHoje ? now : null,
      cargaMin: cargaEsperadaMin,
      intervaloMin: cfg.intervaloMin,
    });
    const horaEntrada = marcacoesDia.find((mc) => mc.tipo === 'ENTRADA');
    const ultimaSaida = [...marcacoesDia].reverse().find((mc) => mc.tipo === 'SAIDA');

    let status: string;
    if (marcacoesDia.length === 0) {
      status = 'FALTA';
      totalFalta++;
    } else if (isHoje) {
      status = 'HOJE';
      totalMinutos += minutosTrabalhou;
    } else if (incompleto) {
      status = 'INCOMPLETO';
      pendencias++;
      totalMinutos += minutosTrabalhou;
    } else if (minutosTrabalhou >= cargaEsperadaMin - toleranciaMin) {
      status = 'PRESENTE';
      totalPresente++;
      totalMinutos += minutosTrabalhou;
    } else {
      status = 'FALTA_PARCIAL';
      pendencias++;
      totalMinutos += minutosTrabalhou;
    }

    return {
      dia,
      diaSemana,
      status,
      minutosTrabalhou,
      intervaloPresumido,
      // O funcionário precisa ver, antes de assinar, o que não foi ele que bateu
      automatica: marcacoesDia.some((mc) => mc.canal === 'AUTO' || mc.canal === 'MANUAL'),
      marcacoes: marcacoesDia.map((mc) => ({
        tipo: mc.tipo,
        hora: horaFormatadaBRT(mc.timestamp),
        canal: mc.canal,
      })),
      horaEntrada: horaEntrada ? horaFormatadaBRT(horaEntrada.timestamp) : null,
      horaSaida: ultimaSaida ? horaFormatadaBRT(ultimaSaida.timestamp) : null,
    };
  });

  return {
    cargaEsperadaMin,
    dias,
    resumo: { totalMinutos, totalPresente, totalFalta, pendencias },
  };
}

/** Só os dias que merecem uma olhada antes de assinar — é o que cabe na tela do totem. */
export function diasQuePedemAtencao(espelho: EspelhoMes): DiaEspelho[] {
  return espelho.dias.filter(
    (d) =>
      d.status !== 'SEM_CONTROLE' && (
      d.status === 'FALTA' ||
      d.status === 'FALTA_PARCIAL' ||
      d.status === 'INCOMPLETO' ||
      (d.intervaloPresumido ?? 0) > 0 ||
      d.automatica),
  );
}
