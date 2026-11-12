/**
 * Finalização em 2 etapas das ordens da frota vinculada (Localiza) — pedido do dono em 12/11/2026.
 *
 * A equipe aperta "Finalizar" e a ordem some da tela dela (ordemController.finalizarOrdem guarda
 * o pedido em `frotaPedido`). Aqui o dono ou quem tem o cargo com `confirmar_frota`:
 *  - confirma (em lote): roda o finalizarOrdem de sempre com o pedido salvo — só então entram
 *    pagamentos, caixa e comissão;
 *  - devolve com motivo: a ordem volta para a equipe marcada como devolvida;
 *  - cancela pela rota de sempre (PATCH /ordens/:id/cancel), que também limpa o pedido.
 */

import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db';
import { finalizarOrdem } from './ordemController';
import { notifyAdmins, notifyByPermission } from '../services/whatsappNotificationService';

interface Req extends Request { empresaId?: string; usuarioNome?: string; subaccountId?: string }

type Pedido = {
  body: any; porNome: string | null; porSubaccountId: string | null; em: string;
  valorFinal: number; desconto: number; comissao: number;
  pagamentos: { metodo: string; valor: number }[];
  ganhos: { lavadorId: string; ganho: number }[];
  avisadoEm: string | null;
};

function respostaFalsa() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r as Response & { statusCode: number; body: any };
}

const ATIVAS = ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] as const;

/** GET /ordens/frota/pendentes — ordens da frota esperando confirmação. */
export async function listarPendentes(req: Req, res: Response) {
  try {
    const ordens = await prisma.ordemServico.findMany({
      where: { empresaId: req.empresaId!, status: { in: [...ATIVAS] }, NOT: { frotaPedido: { equals: Prisma.DbNull } } },
      orderBy: { updatedAt: 'asc' },
      take: 200,
      select: {
        id: true, numeroOrdem: true, status: true, createdAt: true, valorTotal: true, frotaPedido: true, observacoes: true,
        cliente: { select: { nome: true } },
        veiculo: { select: { placa: true, modelo: true, cor: true } },
        items: { select: { nomeCustom: true, servico: { select: { nome: true } } } },
      },
    });
    const ids = [...new Set(ordens.flatMap((o) => ((o.frotaPedido as Pedido)?.ganhos || []).map((g) => g.lavadorId)))];
    const lavs = ids.length ? await prisma.lavador.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }) : [];
    const nome = new Map(lavs.map((l) => [l.id, l.nome]));
    return res.json({
      ordens: ordens.map((o) => {
        const p = o.frotaPedido as Pedido;
        return {
          id: o.id, numeroOrdem: o.numeroOrdem, status: o.status, createdAt: o.createdAt, observacoes: o.observacoes,
          cliente: o.cliente?.nome, veiculo: o.veiculo,
          servicos: o.items.map((i) => i.servico?.nome || i.nomeCustom).filter(Boolean),
          pedido: {
            porNome: p.porNome, em: p.em, valorFinal: p.valorFinal, desconto: p.desconto, comissao: p.comissao, pagamentos: p.pagamentos,
            ganhos: (p.ganhos || []).map((g) => ({ ...g, nome: nome.get(g.lavadorId) || '—' })),
          },
        };
      }),
    });
  } catch (e) {
    console.error('[Frota] Erro ao listar pendentes:', e);
    return res.status(500).json({ error: 'Erro ao carregar as ordens a confirmar.' });
  }
}

/** POST /ordens/frota/confirmar { ids: string[] } — finaliza de verdade, uma a uma. */
export async function confirmar(req: Req, res: Response) {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string').slice(0, 100) : [];
  if (!ids.length) return res.status(400).json({ error: 'Escolha ao menos uma ordem.' });
  const resultados: { id: string; ok: boolean; numeroOrdem?: number; erro?: string }[] = [];
  for (const id of ids) {
    try {
      const o = await prisma.ordemServico.findFirst({ where: { id, empresaId: req.empresaId! }, select: { numeroOrdem: true, frotaPedido: true } });
      const p = o?.frotaPedido as Pedido | null;
      if (!o || !p) { resultados.push({ id, ok: false, erro: 'Não está mais esperando confirmação.' }); continue; }
      const quem = [p.porNome, req.usuarioNome ? `confirmado por ${req.usuarioNome}` : null].filter(Boolean).join(' · ').slice(0, 190);
      // Limite de desconto já foi checado contra quem pediu; aqui roda sem subconta para não barrar de novo
      const r2 = Object.assign(Object.create(req), {
        params: { id }, body: p.body, empresaId: req.empresaId, subaccountId: undefined,
        confirmandoFrota: true, finalizadoPorFrota: quem || null,
      });
      const resp = respostaFalsa();
      await finalizarOrdem(r2 as any, resp);
      if (resp.statusCode === 200) resultados.push({ id, ok: true, numeroOrdem: o.numeroOrdem });
      else resultados.push({ id, ok: false, numeroOrdem: o.numeroOrdem, erro: resp.body?.error || 'Não foi possível finalizar.' });
    } catch (e) {
      console.error(`[Frota] Erro ao confirmar ${id}:`, e);
      resultados.push({ id, ok: false, erro: 'Erro interno.' });
    }
  }
  return res.json({ resultados, confirmadas: resultados.filter((r) => r.ok).length });
}

/** POST /ordens/:id/frota/devolver { motivo } — volta para a equipe, com o motivo à vista. */
export async function devolver(req: Req, res: Response) {
  try {
    const motivo = String(req.body?.motivo || '').trim().slice(0, 300);
    if (!motivo) return res.status(400).json({ error: 'Diga o motivo para a equipe.' });
    const o = await prisma.ordemServico.findFirst({ where: { id: req.params.id as string, empresaId: req.empresaId! }, select: { id: true, frotaPedido: true } });
    if (!o) return res.status(404).json({ error: 'Ordem não encontrada.' });
    if (!o.frotaPedido) return res.status(409).json({ error: 'Esta ordem não está esperando confirmação.' });
    await prisma.ordemServico.update({
      where: { id: o.id },
      data: { frotaPedido: Prisma.DbNull, frotaDevolvida: { motivo, por: req.usuarioNome || null, em: new Date().toISOString() } },
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[Frota] Erro ao devolver:', e);
    return res.status(500).json({ error: 'Não foi possível devolver a ordem.' });
  }
}

/**
 * Cron de hora em hora (horário comercial): avisa no WhatsApp quem confirma quando
 * chegaram pedidos novos desde o último aviso. Uma mensagem por empresa, só se houver novidade.
 */
export async function cronResumoFrotaPendente() {
  try {
    const pend = await prisma.ordemServico.findMany({
      where: { status: { in: [...ATIVAS] }, NOT: { frotaPedido: { equals: Prisma.DbNull } } },
      select: { id: true, empresaId: true, numeroOrdem: true, frotaPedido: true, veiculo: { select: { placa: true } } },
    });
    const porEmpresa = new Map<string, typeof pend>();
    for (const o of pend) porEmpresa.set(o.empresaId, [...(porEmpresa.get(o.empresaId) || []), o]);
    const url = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    for (const [empresaId, ordens] of porEmpresa) {
      const novas = ordens.filter((o) => !(o.frotaPedido as Pedido).avisadoEm);
      if (!novas.length) continue;
      const total = ordens.reduce((s, o) => s + ((o.frotaPedido as Pedido).valorFinal || 0), 0);
      const texto = [
        `🚗 *Frota esperando confirmação*`,
        ``,
        `${ordens.length} ordem${ordens.length > 1 ? 'ns' : ''} da Localiza finalizada${ordens.length > 1 ? 's' : ''} pela equipe (${novas.length} nova${novas.length > 1 ? 's' : ''} desde o último aviso), somando R$ ${total.toFixed(2).replace('.', ',')}.`,
        novas.slice(0, 8).map((o) => `• #${o.numeroOrdem}${o.veiculo?.placa ? ` · ${o.veiculo.placa}` : ''} — ${(o.frotaPedido as Pedido).porNome || 'equipe'}`).join('\n'),
        ``,
        `Comissão e caixa só entram depois de confirmar.${url ? `\n${url}/frota-confirmar.html` : ''}`,
      ].join('\n');
      await notifyAdmins(empresaId, texto, 'frotaPendente').catch(() => {});
      await notifyByPermission(empresaId, 'confirmar_frota', texto).catch(() => {});
      const agora = new Date().toISOString();
      for (const o of novas) {
        // Só marca se continua pendente (pode ter sido confirmada/devolvida durante o envio)
        await prisma.ordemServico.updateMany({
          where: { id: o.id, status: { in: [...ATIVAS] }, NOT: { frotaPedido: { equals: Prisma.DbNull } } },
          data: { frotaPedido: { ...(o.frotaPedido as any), avisadoEm: agora } },
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('[Frota] Erro no resumo de pendentes:', e);
  }
}
