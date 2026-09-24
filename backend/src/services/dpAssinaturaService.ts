/**
 * Assinatura do espelho de ponto pelo funcionário.
 *
 * O que dá valor a essa assinatura não é o clique: é poder provar, depois, *o que* foi
 * assinado. Por isso a assinatura guarda um snapshot do mês e o hash dele.
 *
 * O snapshot é feito dos dados que determinam o espelho — as batidas ativas, a carga, o
 * intervalo, os dias de funcionamento, feriados e afastamentos — e não do desenho da
 * tela. Assim, mudar a aparência do espelho não invalida assinatura nenhuma, mas mexer
 * numa batida invalida: o hash deixa de bater e o funcionário precisa dar ciência de
 * novo, o que é exatamente o comportamento que se espera de um documento assinado.
 */

import { createHash } from 'crypto';
import prisma from '../db';
import { getDateRangeBRT } from '../utils/dateUtils';

export interface SnapshotEspelho {
  competencia: string;
  funcionarioId: string;
  cargaEsperadaMin: number;
  intervaloMin: number;
  toleranciaMin: number;
  diasFuncionamento: number[];
  feriados: { data: string; nome: string; recorrente: boolean }[];
  afastamentos: { tipo: string; dataInicio: string; dataFim: string }[];
  marcacoes: { tipo: string; ts: string; canal: string; ajustada: boolean }[];
}

/** "2026-09" → primeiro e último dia do mês, em YYYY-MM-DD. */
function limitesDaCompetencia(competencia: string): { primeiro: string; ultimo: string } {
  const [ano, mes] = competencia.split('-').map(Number);
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const mm = String(mes).padStart(2, '0');
  return { primeiro: `${ano}-${mm}-01`, ultimo: `${ano}-${mm}-${String(diasNoMes).padStart(2, '0')}` };
}

export function competenciaValida(competencia: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(competencia)) return false;
  const mes = Number(competencia.slice(5));
  return mes >= 1 && mes <= 12;
}

/** A competência já terminou? Mês em curso ainda vai mudar, e assinar não faria sentido. */
export function competenciaEncerrada(competencia: string, hojeStr: string): boolean {
  return competencia < hojeStr.slice(0, 7);
}

export async function montarSnapshot(
  empresaId: string,
  funcionario: { id: string; cargaEsperadaMin: number },
  competencia: string,
  cfg: { intervaloMin?: number; toleranciaMin?: number; diasFuncionamento?: number[] },
): Promise<SnapshotEspelho> {
  const { primeiro, ultimo } = limitesDaCompetencia(competencia);
  const inicio = getDateRangeBRT(primeiro).start;
  const fim = getDateRangeBRT(ultimo).end;

  const [marcacoes, feriados, afastamentos] = await Promise.all([
    prisma.dpMarcacao.findMany({
      where: { funcionarioId: funcionario.id, timestamp: { gte: inicio, lte: fim }, excluidaEm: null },
      select: { tipo: true, timestamp: true, canal: true, ajustado: true },
      orderBy: { timestamp: 'asc' },
    }),
    prisma.dpFeriado.findMany({
      where: { empresaId },
      select: { data: true, nome: true, recorrente: true },
      orderBy: { data: 'asc' },
    }),
    prisma.dpAfastamento.findMany({
      where: { funcionarioId: funcionario.id },
      select: { tipo: true, dataInicio: true, dataFim: true },
      orderBy: { dataInicio: 'asc' },
    }),
  ]);

  return {
    competencia,
    funcionarioId: funcionario.id,
    cargaEsperadaMin: funcionario.cargaEsperadaMin,
    intervaloMin: cfg.intervaloMin ?? 0,
    toleranciaMin: cfg.toleranciaMin ?? 10,
    diasFuncionamento: cfg.diasFuncionamento ?? [1, 2, 3, 4, 5],
    feriados,
    afastamentos,
    marcacoes: marcacoes.map((m) => ({
      tipo: m.tipo,
      ts: m.timestamp.toISOString(),
      canal: m.canal,
      ajustada: m.ajustado,
    })),
  };
}

/**
 * Hash do snapshot. A serialização é feita campo a campo, em ordem fixa, porque
 * JSON.stringify de objeto montado em outra ordem produziria outro hash para o mesmo
 * conteúdo — e uma assinatura válida apareceria como desatualizada.
 */
export function hashDoSnapshot(s: SnapshotEspelho): string {
  const canonico = [
    s.competencia,
    s.funcionarioId,
    s.cargaEsperadaMin,
    s.intervaloMin,
    s.toleranciaMin,
    s.diasFuncionamento.join(','),
    s.feriados.map((f) => `${f.data}|${f.nome}|${f.recorrente ? 1 : 0}`).join(';'),
    s.afastamentos.map((a) => `${a.tipo}|${a.dataInicio}|${a.dataFim}`).join(';'),
    s.marcacoes.map((m) => `${m.tipo}|${m.ts}|${m.canal}|${m.ajustada ? 1 : 0}`).join(';'),
  ].join('\n');
  return createHash('sha256').update(canonico).digest('hex');
}

export interface EstadoAssinatura {
  assinadoEm: Date;
  atual: boolean; // false = o espelho mudou depois da assinatura
  alteradoDepois: boolean;
}

/** A assinatura mais recente da competência, e se ela ainda corresponde ao espelho de hoje. */
export async function estadoDaAssinatura(
  funcionarioId: string,
  competencia: string,
  hashAtual: string,
): Promise<EstadoAssinatura | null> {
  const ultima = await prisma.dpEspelhoAssinatura.findFirst({
    where: { funcionarioId, competencia },
    orderBy: { assinadoEm: 'desc' },
    select: { assinadoEm: true, hashConteudo: true },
  });
  if (!ultima) return null;
  const atual = ultima.hashConteudo === hashAtual;
  return { assinadoEm: ultima.assinadoEm, atual, alteradoDepois: !atual };
}

/** Competência fechada mais recente. É a única que faz sentido cobrar assinatura. */
export function competenciaAnterior(hojeStr: string): string {
  const [ano, mes] = hojeStr.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 2, 1)); // mês anterior
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "2026-08" → "agosto". */
export function nomeDaCompetencia(competencia: string): string {
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return meses[Number(competencia.slice(5)) - 1] ?? competencia;
}
