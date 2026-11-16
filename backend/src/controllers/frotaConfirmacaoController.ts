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
import { botSend, botGetStatus } from '../services/botServiceClient';
import { codigoDoLink } from './frotaRapidoController';

interface Req extends Request { empresaId?: string; usuarioNome?: string; subaccountId?: string }

type Pedido = {
  body: any; porNome: string | null; porSubaccountId: string | null; em: string;
  valorFinal: number; desconto: number; comissao: number;
  pagamentos: { metodo: string; valor: number }[];
  ganhos: { lavadorId: string; ganho: number }[];
  avisadoEm: string | null;
};

export function respostaFalsa() {
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
 * Cron de hora em hora (horário comercial): avisa no WhatsApp quem confirma quando chegaram
 * pedidos novos desde o último aviso. UMA mensagem por pessoa juntando as empresas dela, com o
 * link pessoal do acesso rápido (frotaRapidoController) — 16/11/2026.
 */
export async function cronResumoFrotaPendente() {
  try {
    try {
      if ((await botGetStatus()).status !== 'connected') return; // não marca como avisado se o bot está fora
    } catch { return; }

    const pend = await prisma.ordemServico.findMany({
      where: { status: { in: [...ATIVAS] }, NOT: { frotaPedido: { equals: Prisma.DbNull } } },
      orderBy: { updatedAt: 'asc' },
      select: { id: true, empresaId: true, numeroOrdem: true, frotaPedido: true, veiculo: { select: { placa: true } } },
    });
    const porEmpresa = new Map<string, typeof pend>();
    for (const o of pend) porEmpresa.set(o.empresaId, [...(porEmpresa.get(o.empresaId) || []), o]);
    const comNovidade = [...porEmpresa.entries()].filter(([, os]) => os.some((o) => !(o.frotaPedido as Pedido).avisadoEm));
    if (!comNovidade.length) return;

    const empresas = await prisma.empresa.findMany({ where: { id: { in: comNovidade.map(([id]) => id) } }, select: { id: true, nome: true, usuarioId: true } });
    const empresaPorId = new Map(empresas.map((e) => [e.id, e]));

    // destino (jid) → quem é + empresas que entram no aviso
    const dest = new Map<string, { quem: { tipo: 'u' | 's'; id: string }; empresas: string[] }>();
    const somar = (jid: string, quem: { tipo: 'u' | 's'; id: string }, empresaId: string) => {
      const d = dest.get(jid) || { quem, empresas: [] };
      if (!d.empresas.includes(empresaId)) d.empresas.push(empresaId);
      dest.set(jid, d);
    };
    for (const [empresaId] of comNovidade) {
      const emp = empresaPorId.get(empresaId);
      if (!emp) continue;
      const admins = await prisma.whatsappAdminPhone.findMany({ where: { empresaId, ativo: true }, select: { jid: true, telefone: true, notifPrefs: true } });
      for (const a of admins) {
        if (((a.notifPrefs as any) ?? {}).frotaPendente === false) continue;
        somar(a.jid ?? `${a.telefone.replace(/\D/g, '')}@s.whatsapp.net`, { tipo: 'u', id: emp.usuarioId }, empresaId);
      }
      const equipe = await prisma.whatsappBotUser.findMany({
        where: { empresaId, ativo: true, jid: { not: null }, subaccountId: { not: null }, subaccount: { roleInt: { permissoes: { some: { name: 'confirmar_frota' } } } } },
        select: { jid: true, subaccountId: true },
      });
      for (const u of equipe) if (u.jid && u.subaccountId) somar(u.jid, { tipo: 's', id: u.subaccountId }, empresaId);
    }

    const url = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
    for (const [jid, d] of dest) {
      const blocos = d.empresas.map((empresaId) => {
        const ordens = porEmpresa.get(empresaId) || [];
        const total = ordens.reduce((s, o) => s + ((o.frotaPedido as Pedido).valorFinal || 0), 0);
        const linhas = ordens.slice(0, 6).map((o) => `• #${o.numeroOrdem}${o.veiculo?.placa ? ` · ${o.veiculo.placa}` : ''} — ${(o.frotaPedido as Pedido).porNome || 'equipe'}`);
        if (ordens.length > 6) linhas.push(`• e mais ${ordens.length - 6}`);
        return [`*${empresaPorId.get(empresaId)?.nome || 'Empresa'}* · ${ordens.length} ordem${ordens.length > 1 ? 'ns' : ''} · ${brl(total)}`, ...linhas].join('\n');
      });
      const texto = [
        `🚗 *Frota esperando confirmação*`,
        ``,
        blocos.join('\n\n'),
        ``,
        `Comissão e caixa só entram depois de confirmar.${url ? `\n${url}/frota-confirmar.html?k=${codigoDoLink(d.quem)}` : ''}`,
      ].join('\n');
      await botSend(jid, texto, { empresaId: d.empresas[0], tipo: 'frotaPendente' }).catch((e) => console.error(`[Frota] Erro ao avisar ${jid}:`, e));
    }

    const agora = new Date().toISOString();
    for (const [, ordens] of comNovidade) {
      for (const o of ordens.filter((x) => !(x.frotaPedido as Pedido).avisadoEm)) {
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
