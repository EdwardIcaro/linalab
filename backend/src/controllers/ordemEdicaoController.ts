/**
 * Edição rápida pela própria ordem (pedido do dono em 12/11/2026): nome do cliente e
 * modelo/cor do carro sem ir em Clientes, e o aviso de carro com ordem ativa em outra
 * empresa da rede antes de cadastrar.
 */

import { Request, Response } from 'express';
import prisma from '../db';
import { empresasIrmas } from '../services/emailEnriquecimento';
import { corrigirVeiculoDaPlaca, registrarConfirmacao } from '../services/veiculoPlaca';
import { ordensAtivasNaRede } from '../services/ordemDuplicadaRede';

interface Req extends Request { empresaId?: string; usuarioNome?: string }

/** Nome que o sistema grava quando a ordem é criada sem cliente identificado. */
export const semNome = (nome: string | null | undefined) => !nome || !nome.trim() || nome.trim().toUpperCase() === 'N/A';

/** Clientes da frota vinculada (Localiza) desta empresa e das irmãs. */
export async function clientesFrota(empresaId: string): Promise<Set<string>> {
  const irmas = await empresasIrmas(empresaId);
  const vs = await prisma.solicitacaoVinculo.findMany({ where: { empresaId: { in: irmas }, ativo: true, clienteId: { not: null } }, select: { clienteId: true } });
  return new Set(vs.map((v) => v.clienteId!).filter(Boolean));
}

/**
 * PATCH /ordens/:id/identificacao
 * body: { clienteNome?, telefone?, clienteId?, modelo?, cor? }
 *  - clienteId: liga a ordem a um cliente que já existe nesta empresa
 *  - clienteNome numa ordem sem nome ("N/A"): cria um cliente novo só para ela (o "N/A" é compartilhado)
 *  - clienteNome num cliente com nome: corrige o nome do cliente (vale para todas as ordens dele)
 *  - modelo/cor: corrige o carro em todas as grafias da placa (vale para a rede) e entra no histórico
 */
export async function editarIdentificacao(req: Req, res: Response) {
  try {
    const empresaId = req.empresaId!;
    const id = req.params.id as string;
    const b = req.body || {};
    const nome = typeof b.clienteNome === 'string' ? b.clienteNome.trim().slice(0, 80) : '';
    const telefone = typeof b.telefone === 'string' ? b.telefone.replace(/\D/g, '').slice(0, 13) : '';
    const clienteIdNovo = typeof b.clienteId === 'string' ? b.clienteId : '';
    const modelo = typeof b.modelo === 'string' ? b.modelo.trim() : '';
    const cor = typeof b.cor === 'string' ? b.cor.trim() : '';

    const ordem = await prisma.ordemServico.findFirst({
      where: { id, empresaId },
      select: { id: true, status: true, clienteId: true, veiculoId: true, cliente: { select: { id: true, nome: true } }, veiculo: { select: { id: true, placa: true, clienteId: true } } },
    });
    if (!ordem) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (ordem.status === 'FINALIZADO' || ordem.status === 'CANCELADO') {
      return res.status(400).json({ error: 'Só dá para editar por aqui uma ordem ativa.' });
    }
    if (!nome && !clienteIdNovo && !modelo) return res.status(400).json({ error: 'Nada para salvar.' });

    const frota = (await clientesFrota(empresaId)).has(ordem.clienteId);
    if (frota && (nome || clienteIdNovo)) {
      return res.status(400).json({ error: 'Ordem da frota: o cliente não muda por aqui.' });
    }

    let clienteFinal = ordem.cliente;
    if (clienteIdNovo || nome) {
      const eraSemNome = semNome(ordem.cliente?.nome);
      // O carro acompanha o cliente novo só quando estava preso ao "N/A" desta ordem
      const levarVeiculo = eraSemNome && ordem.veiculo && ordem.veiculo.clienteId === ordem.clienteId;

      if (clienteIdNovo) {
        const c = await prisma.cliente.findFirst({ where: { id: clienteIdNovo, empresaId }, select: { id: true, nome: true } });
        if (!c) return res.status(404).json({ error: 'Cliente não encontrado nesta empresa.' });
        await prisma.$transaction(async (tx) => {
          await tx.ordemServico.update({ where: { id }, data: { clienteId: c.id } });
          if (levarVeiculo) await tx.veiculo.update({ where: { id: ordem.veiculo!.id }, data: { clienteId: c.id } });
        });
        clienteFinal = c;
      } else if (eraSemNome) {
        clienteFinal = await prisma.$transaction(async (tx) => {
          const c = await tx.cliente.create({ data: { empresaId, nome, telefone: telefone || null }, select: { id: true, nome: true } });
          await tx.ordemServico.update({ where: { id }, data: { clienteId: c.id } });
          if (levarVeiculo) await tx.veiculo.update({ where: { id: ordem.veiculo!.id }, data: { clienteId: c.id } });
          return c;
        });
      } else {
        clienteFinal = await prisma.cliente.update({
          where: { id: ordem.clienteId },
          data: { nome, ...(telefone ? { telefone } : {}) },
          select: { id: true, nome: true },
        });
      }
    }

    let veiculo: { modelo: string | null; cor: string | null } | null = null;
    if (modelo && ordem.veiculo?.placa) {
      const c = await corrigirVeiculoDaPlaca(prisma, ordem.veiculo.placa, { modelo, cor: cor || null });
      if (c.count) await registrarConfirmacao(c, { empresaId, nome: req.usuarioNome, origem: 'correcao' });
      veiculo = { modelo: c.modelo, cor: c.cor };
    }

    return res.json({ ok: true, cliente: clienteFinal, veiculo, frota });
  } catch (e) {
    console.error('[OrdemEdicao] Erro ao editar identificação:', e);
    return res.status(500).json({ error: 'Não foi possível salvar.' });
  }
}

/** GET /ordens/rede-ativa/:placa — ordens ativas desta placa aqui e nas empresas irmãs. */
export async function redeAtiva(req: Req, res: Response) {
  try {
    const ordens = await ordensAtivasNaRede(req.empresaId!, req.params.placa as string);
    return res.json({ ordens });
  } catch (e) {
    console.error('[OrdemEdicao] Erro ao buscar placa na rede:', e);
    return res.json({ ordens: [] });
  }
}

/** GET /ordens/clientes-busca?q= — clientes com nome parecido (para "Pôr nome" sugerir o cadastro existente). */
export async function buscarClientesParaNome(req: Req, res: Response) {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ clientes: [] });
    const cs = await prisma.cliente.findMany({
      where: { empresaId: req.empresaId!, nome: { contains: q, mode: 'insensitive' }, NOT: { nome: 'N/A' } },
      take: 5, orderBy: { updatedAt: 'desc' },
      select: { id: true, nome: true, telefone: true, _count: { select: { veiculos: true, ordens: true } } },
    });
    return res.json({ clientes: cs.map((c) => ({ id: c.id, nome: c.nome, telefone: c.telefone, carros: c._count.veiculos, ordens: c._count.ordens })) });
  } catch (e) {
    console.error('[OrdemEdicao] Erro ao buscar clientes:', e);
    return res.json({ clientes: [] });
  }
}
