import { Prisma } from '@prisma/client';
import prisma from '../db';
import { normalizarPlaca } from './solicitacaoFilaService';

export { normalizarPlaca };

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Filtro que acha a placa em qualquer grafia já gravada: "ABC1D23", "abc-1d23", "ABC 1D23".
 * A placa é a mesma na rede inteira, mas cadastros antigos foram salvos do jeito que foram
 * digitados — por isso a mesma placa pode existir em mais de um registro.
 */
export function filtroPlaca(placas: string | string[]): Prisma.VeiculoWhereInput {
  const lista = (Array.isArray(placas) ? placas : [placas]).map(normalizarPlaca).filter(Boolean);
  const grafias = lista.flatMap((p) => [p, `${p.slice(0, 3)}-${p.slice(3)}`, `${p.slice(0, 3)} ${p.slice(3)}`]);
  return { OR: grafias.map((g) => ({ placa: { equals: g, mode: 'insensitive' as const } })) };
}

/** Veículo da placa: prefere o registro já padronizado, senão o mais recente. */
export async function acharVeiculoPorPlaca(db: Db, placa: string, where: Prisma.VeiculoWhereInput = {}) {
  if (!normalizarPlaca(placa)) return null;
  const achados = await db.veiculo.findMany({
    where: { AND: [filtroPlaca(placa), where] },
    include: { cliente: true },
    orderBy: { updatedAt: 'desc' },
  });
  const norm = normalizarPlaca(placa);
  return achados.find((v) => v.placa === norm) ?? achados[0] ?? null;
}

/**
 * Quem está na frente do carro confirmou modelo/cor: grava em todos os registros da placa,
 * para nenhuma empresa da rede continuar vendo o modelo antigo.
 */
export async function corrigirVeiculoDaPlaca(
  db: Db, placa: string, dados: { modelo?: string | null; cor?: string | null; tipoVeiculo?: string | null; subtipoVeiculo?: string | null },
): Promise<number> {
  const data: Prisma.VeiculoUpdateManyMutationInput = {};
  const modelo = dados.modelo?.trim();
  const cor = dados.cor?.trim();
  if (modelo) data.modelo = modelo.slice(0, 60);
  if (cor) data.cor = cor.slice(0, 40);
  if (dados.tipoVeiculo) data.tipoVeiculo = dados.tipoVeiculo;
  if (dados.subtipoVeiculo) data.subtipoVeiculo = dados.subtipoVeiculo;
  if (!Object.keys(data).length || !normalizarPlaca(placa)) return 0;
  const r = await db.veiculo.updateMany({ where: filtroPlaca(placa), data });
  return r.count;
}
