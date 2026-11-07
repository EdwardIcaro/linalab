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
export type Origem = 'nova_ordem' | 'aceite_localiza' | 'correcao' | 'voltar';
export type Autor = { empresaId?: string | null; nome?: string | null; origem: Origem };
export type Antes = { modelo: string | null; cor: string | null; empresaId: string | null; createdAt: Date } | null;
export type Correcao = { count: number; antes: Antes; modelo: string | null; cor: string | null; placa: string };

export async function corrigirVeiculoDaPlaca(
  db: Db, placa: string,
  dados: { modelo?: string | null; cor?: string | null; tipoVeiculo?: string | null; subtipoVeiculo?: string | null },
): Promise<Correcao> {
  const data: Prisma.VeiculoUpdateManyMutationInput = {};
  const modelo = dados.modelo?.trim().slice(0, 60) || null;
  const cor = dados.cor?.trim().slice(0, 40) || null;
  const norm = normalizarPlaca(placa);
  if (modelo) data.modelo = modelo;
  if (cor) data.cor = cor;
  if (dados.tipoVeiculo) data.tipoVeiculo = dados.tipoVeiculo;
  if (dados.subtipoVeiculo) data.subtipoVeiculo = dados.subtipoVeiculo;
  if (!Object.keys(data).length || !norm) return { count: 0, antes: null, modelo, cor, placa: norm };
  const v = await acharVeiculoPorPlaca(db, norm);
  const antes: Antes = v ? { modelo: v.modelo, cor: v.cor, empresaId: v.cliente?.empresaId ?? null, createdAt: v.createdAt } : null;
  const r = await db.veiculo.updateMany({ where: filtroPlaca(norm), data });
  return { count: r.count, antes, modelo, cor, placa: norm };
}

// ── Histórico / confirmação ─────────────────────────────────────────────
// Sempre FORA de transação e sem lançar erro: falha aqui nunca derruba a ordem ou o aceite.

/** Quem está na frente do carro confirmou o modelo: grava no histórico da placa. */
export async function registrarConfirmacao(c: Correcao, autor: Autor) {
  if (!c.modelo || !c.placa) return;
  try {
    const ultima = await prisma.veiculoModeloHistorico.findFirst({ where: { placa: c.placa }, orderBy: { createdAt: 'desc' } });
    // Primeira vez: o modelo de antes da correção vira a linha inicial ("cadastro", sem confirmação)
    if (!ultima && c.antes?.modelo?.trim()) {
      await prisma.veiculoModeloHistorico.create({
        data: { placa: c.placa, modelo: c.antes.modelo.trim(), cor: c.antes.cor, empresaId: c.antes.empresaId, origem: 'cadastro', confirmado: false, createdAt: c.antes.createdAt },
      });
    }
    // Mesmo modelo já confirmado: nada a registrar
    if (ultima && ultima.confirmado && ultima.modelo === c.modelo && autor.origem !== 'voltar') return;
    await prisma.veiculoModeloHistorico.create({
      data: { placa: c.placa, modelo: c.modelo, cor: c.cor, empresaId: autor.empresaId ?? null, autorNome: autor.nome?.slice(0, 80) ?? null, origem: autor.origem, confirmado: true },
    });
  } catch (e) {
    console.error(`[VeiculoHistorico] Confirmação da placa ${c.placa}:`, e);
  }
}

export type Confirmacao = { confirmado: boolean; por: string | null; empresa: string | null; em: Date } | null;

/** Situação atual do modelo de cada placa (linha mais recente do histórico), com o nome da empresa. */
export async function confirmacoesDasPlacas(placas: string[]): Promise<Map<string, Confirmacao>> {
  const mapa = new Map<string, Confirmacao>();
  const lista = Array.from(new Set(placas.map(normalizarPlaca).filter(Boolean)));
  if (!lista.length) return mapa;
  try {
    const linhas = await prisma.veiculoModeloHistorico.findMany({
      where: { placa: { in: lista } }, orderBy: { createdAt: 'desc' },
      select: { placa: true, confirmado: true, autorNome: true, empresaId: true, createdAt: true },
    });
    const nomes = await nomesDasEmpresas(linhas.map((l) => l.empresaId));
    for (const l of linhas) {
      if (mapa.has(l.placa)) continue;
      mapa.set(l.placa, { confirmado: l.confirmado, por: l.autorNome, empresa: l.empresaId ? nomes.get(l.empresaId) ?? null : null, em: l.createdAt });
    }
  } catch (e) {
    console.error('[VeiculoHistorico] Leitura das confirmações:', e);
  }
  return mapa;
}

export async function nomesDasEmpresas(ids: (string | null)[]) {
  const unicos = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!unicos.length) return new Map<string, string>();
  const es = await prisma.empresa.findMany({ where: { id: { in: unicos } }, select: { id: true, nome: true } });
  return new Map(es.map((e) => [e.id, e.nome]));
}
