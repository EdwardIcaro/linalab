/**
 * Lançamentos no banco de horas: o que entra, o que sai e por quê.
 *
 * Toda mudança de saldo passa por aqui e vira uma linha no extrato. O campo
 * `saldoBancoHorasAtual` do funcionário continua existindo como cache — é ele que as
 * telas leem —, mas a verdade é a soma dos movimentos.
 */

import prisma from '../db';
import { estadoDoBanco, EstadoBanco, Movimento } from '../utils/bancoHorasFifo';
import { getTodayStrBRT } from '../utils/dateUtils';

export type TipoMovimento = 'CICLO' | 'FOLGA_COMP' | 'PAGAMENTO' | 'VENCIMENTO' | 'AJUSTE';

/** Prazo de compensação em meses: 6 por acordo individual, 12 por acordo coletivo. */
export function prazoDeCompensacao(cfg: { bancoHorasPrazoMeses?: number }): number {
  const m = Number(cfg?.bancoHorasPrazoMeses);
  return m === 12 ? 12 : 6;
}

/**
 * Grava um movimento e atualiza o cache de saldo, numa transação só.
 *
 * O saldo gravado é sempre recalculado a partir do extrato inteiro, nunca somado em
 * cima do anterior: se um lançamento antigo for corrigido, o número volta a bater.
 */
export async function lancarMovimento(params: {
  empresaId: string;
  funcionarioId: string;
  tipo: TipoMovimento;
  horas: number;
  data: string;
  descricao?: string | null;
  fechamentoId?: string | null;
  afastamentoId?: string | null;
  autorNome?: string | null;
}): Promise<{ saldo: number }> {
  const { empresaId, funcionarioId, tipo, horas, data } = params;

  return prisma.$transaction(async (tx) => {
    const anteriores = await tx.dpBancoMovimento.findMany({
      where: { funcionarioId },
      select: { horas: true },
    });
    const saldo = arred(anteriores.reduce((s, m) => s + m.horas, 0) + horas);

    await tx.dpBancoMovimento.create({
      data: {
        empresaId,
        funcionarioId,
        tipo,
        horas: arred(horas),
        data,
        descricao: params.descricao ?? null,
        fechamentoId: params.fechamentoId ?? null,
        afastamentoId: params.afastamentoId ?? null,
        autorNome: params.autorNome ?? null,
        saldoApos: saldo,
      },
    });

    await tx.dpFuncionario.update({
      where: { id: funcionarioId },
      data: { saldoBancoHorasAtual: saldo },
    });

    return { saldo };
  });
}

/** Apaga os movimentos de um afastamento (quando a folga é cancelada ou editada). */
export async function removerMovimentosDoAfastamento(afastamentoId: string): Promise<void> {
  const movimentos = await prisma.dpBancoMovimento.findMany({
    where: { afastamentoId },
    select: { funcionarioId: true },
  });
  if (movimentos.length === 0) return;

  await prisma.dpBancoMovimento.deleteMany({ where: { afastamentoId } });

  // Recalcula o cache de cada funcionário afetado
  for (const funcionarioId of new Set(movimentos.map((m) => m.funcionarioId))) {
    const restantes = await prisma.dpBancoMovimento.findMany({
      where: { funcionarioId },
      select: { horas: true },
    });
    await prisma.dpFuncionario.update({
      where: { id: funcionarioId },
      data: { saldoBancoHorasAtual: arred(restantes.reduce((s, m) => s + m.horas, 0)) },
    });
  }
}

/** Extrato completo de um funcionário, do mais recente para o mais antigo. */
export async function extratoDoFuncionario(funcionarioId: string, limite = 50) {
  return prisma.dpBancoMovimento.findMany({
    where: { funcionarioId },
    orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
    take: limite,
    select: {
      id: true, tipo: true, horas: true, data: true, descricao: true,
      autorNome: true, saldoApos: true, createdAt: true,
    },
  });
}

/** Situação do banco: saldo, lotes abertos, o que venceu e o que está para vencer. */
export async function situacaoDoBanco(
  funcionarioId: string,
  prazoMeses: number,
  diasDeAlerta = 30,
): Promise<EstadoBanco> {
  const movimentos = await prisma.dpBancoMovimento.findMany({
    where: { funcionarioId },
    orderBy: { data: 'asc' },
    select: { tipo: true, horas: true, data: true },
  });
  return estadoDoBanco(movimentos as Movimento[], prazoMeses, getTodayStrBRT(), diasDeAlerta);
}

function arred(x: number): number {
  return Math.round(x * 100) / 100;
}
