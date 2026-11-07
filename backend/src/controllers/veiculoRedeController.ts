import { Request, Response } from 'express';
import prisma from '../db';
import { empresasIrmas } from '../services/emailEnriquecimento';
import { FORNECEDOR } from '../services/solicitacaoFilaService';
import {
  acharVeiculoPorPlaca, corrigirVeiculoDaPlaca, filtroPlaca, normalizarPlaca,
  registrarConfirmacao, confirmacoesDasPlacas, nomesDasEmpresas,
} from '../services/veiculoPlaca';

interface Req extends Request { empresaId?: string; usuarioNome?: string }

const ORIGEM: Record<string, string> = {
  cadastro: 'cadastro', nova_ordem: 'nova ordem', aceite_localiza: 'aceite Localiza', correcao: 'correção em Clientes', voltar: 'desfeito',
};

/** A placa passou pela rede (cadastrada ou atendida em alguma empresa do mesmo dono)? */
async function placaDaRede(irmas: string[], placa: string) {
  const v = await acharVeiculoPorPlaca(prisma, placa);
  if (!v) return null;
  if (v.cliente && irmas.includes(v.cliente.empresaId)) return v;
  const atendida = await prisma.ordemServico.findFirst({ where: { veiculo: filtroPlaca(placa), empresaId: { in: irmas } }, select: { id: true } });
  return atendida ? v : null;
}

/** GET /veiculos/rede/historico/:placa — modelo atual + histórico de correções na rede. */
export async function historicoDaPlaca(req: Req, res: Response) {
  try {
    const placa = normalizarPlaca(req.params.placa as string);
    const irmas = await empresasIrmas(req.empresaId!);
    const v = await placaDaRede(irmas, placa);
    if (!v) return res.status(404).json({ error: 'Placa não encontrada nesta rede.' });

    const linhas = await prisma.veiculoModeloHistorico.findMany({
      where: { placa, OR: [{ empresaId: { in: irmas } }, { empresaId: null }] },
      orderBy: { createdAt: 'desc' }, take: 50,
    });
    const nomes = await nomesDasEmpresas(linhas.map((l) => l.empresaId));
    return res.json({
      placa, modelo: v.modelo, cor: v.cor,
      historico: linhas.map((l) => ({
        id: l.id, modelo: l.modelo, cor: l.cor, confirmado: l.confirmado, em: l.createdAt,
        por: l.autorNome, empresa: l.empresaId ? nomes.get(l.empresaId) ?? null : null, origem: ORIGEM[l.origem] ?? l.origem,
      })),
    });
  } catch (err) {
    console.error('[VeiculoRede] Histórico:', err);
    return res.status(500).json({ error: 'Erro ao carregar o histórico' });
  }
}

/** POST /veiculos/rede/modelo/:placa — corrige (ou volta para uma linha do histórico) em todas as empresas. */
export async function corrigirModeloNaRede(req: Req, res: Response) {
  try {
    const placa = normalizarPlaca(req.params.placa as string);
    const irmas = await empresasIrmas(req.empresaId!);
    if (!(await placaDaRede(irmas, placa))) return res.status(404).json({ error: 'Placa não encontrada nesta rede.' });

    let modelo = String(req.body?.modelo ?? '').trim();
    let cor = String(req.body?.cor ?? '').trim();
    const voltarPara = req.body?.voltarPara ? String(req.body.voltarPara) : null;
    if (voltarPara) {
      const linha = await prisma.veiculoModeloHistorico.findFirst({ where: { id: voltarPara, placa } });
      if (!linha) return res.status(404).json({ error: 'Item do histórico não encontrado.' });
      modelo = linha.modelo; cor = linha.cor ?? '';
    }
    if (!modelo) return res.status(400).json({ error: 'Informe o modelo.' });

    const c = await corrigirVeiculoDaPlaca(prisma, placa, { modelo, cor });
    await registrarConfirmacao(c, { empresaId: req.empresaId, nome: req.usuarioNome, origem: voltarPara ? 'voltar' : 'correcao' });
    return res.json({ ok: true, modelo: c.modelo, cor: c.cor ?? c.antes?.cor ?? null });
  } catch (err) {
    console.error('[VeiculoRede] Correção:', err);
    return res.status(500).json({ error: 'Erro ao corrigir o modelo' });
  }
}

/**
 * GET /veiculos/rede/frota/:clienteId — quando o cliente é o "Localiza" vinculado desta empresa,
 * devolve a frota que passou por QUALQUER empresa da rede (cadastrada lá ou atendida aqui).
 */
export async function frotaDaRede(req: Req, res: Response) {
  try {
    const empresaId = req.empresaId!;
    const clienteId = req.params.clienteId as string;
    const meu = await prisma.solicitacaoVinculo.findUnique({ where: { empresaId_fornecedor: { empresaId, fornecedor: FORNECEDOR } }, select: { clienteId: true } });
    if (!meu?.clienteId || meu.clienteId !== clienteId) return res.json({ rede: false, veiculos: [] });

    const irmas = await empresasIrmas(empresaId);
    const vinculos = await prisma.solicitacaoVinculo.findMany({
      where: { empresaId: { in: irmas }, fornecedor: FORNECEDOR, clienteId: { not: null } }, select: { clienteId: true },
    });
    const clientes = vinculos.map((v) => v.clienteId!).filter(Boolean);

    const veiculos = await prisma.veiculo.findMany({
      where: { OR: [{ clienteId: { in: clientes } }, { ordens: { some: { clienteId: { in: clientes }, empresaId: { in: irmas } } } }] },
      select: {
        id: true, placa: true, modelo: true, cor: true, clienteId: true,
        ordens: { where: { empresaId: { in: irmas } }, select: { empresaId: true }, distinct: ['empresaId'] },
        cliente: { select: { empresaId: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 2000,
    });

    // Mesma placa em mais de um registro: um cartão só
    const porPlaca = new Map<string, (typeof veiculos)[number] & { empresas: Set<string> }>();
    for (const v of veiculos) {
      const k = normalizarPlaca(v.placa);
      const atual = porPlaca.get(k) ?? { ...v, empresas: new Set<string>() };
      atual.empresas.add(v.cliente.empresaId);
      v.ordens.forEach((o) => atual.empresas.add(o.empresaId));
      if (!porPlaca.has(k)) porPlaca.set(k, atual);
    }
    const nomes = await nomesDasEmpresas(Array.from(porPlaca.values()).flatMap((v) => Array.from(v.empresas)));
    const conf = await confirmacoesDasPlacas(Array.from(porPlaca.keys()));

    return res.json({
      rede: true,
      veiculos: Array.from(porPlaca.entries()).map(([placa, v]) => ({
        id: v.id, placa, modelo: v.modelo, cor: v.cor,
        daqui: v.clienteId === clienteId,
        empresas: Array.from(v.empresas).filter((e) => irmas.includes(e)).map((e) => nomes.get(e) ?? '—'),
        confirmacao: conf.get(placa) ?? null,
      })),
    });
  } catch (err) {
    console.error('[VeiculoRede] Frota:', err);
    return res.status(500).json({ error: 'Erro ao carregar a frota da rede' });
  }
}
