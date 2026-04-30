/**
 * Notificações proativas do Bot Lina — enviadas automaticamente sem o admin perguntar.
 * Todas as funções são fire-and-forget: erros são logados mas nunca quebram o fluxo principal.
 */

import prisma from '../db';
import { botSend, botGetStatus } from './botServiceClient';
import { getTodayRangeBRT } from '../utils/dateUtils';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type NotifKey =
  | 'novaOrdem'
  | 'ordemFinalizada'
  | 'ordemCancelada'
  | 'resumoDiario'
  | 'alertaCaixaAberto'
  | 'ordemParada'
  | 'saidaRegistrada'
  | 'comissaoFechada'
  | 'clienteVip';

interface NotifPrefs extends Record<NotifKey, boolean> {
  ordemParadaHoras: number;
}

const DEFAULTS: NotifPrefs = {
  novaOrdem:          true,
  ordemFinalizada:    false,
  ordemCancelada:     false,
  resumoDiario:       true,
  alertaCaixaAberto:  true,
  ordemParada:        false,
  ordemParadaHoras:   2,
  saidaRegistrada:    false,
  comissaoFechada:    false,
  clienteVip:         true,
};

function prefs(empresa: { notificationPreferences: any }): NotifPrefs {
  const p = (empresa.notificationPreferences as any)?.whatsapp ?? {};
  return { ...DEFAULTS, ...p };
}

export function getDefaultPrefs(): NotifPrefs { return { ...DEFAULTS }; }

// ─── Core: enviar para todos os admins da empresa ─────────────────────────────

export async function notifyAdmins(empresaId: string, message: string): Promise<void> {
  try {
    const bot = await botGetStatus();
    if (bot.status !== 'connected') return;
  } catch {
    return; // bot service inacessível
  }

  const admins = await (prisma.whatsappAdminPhone as any).findMany({
    where: { empresaId, ativo: true },
    select: { jid: true, telefone: true },
  }) as Array<{ jid: string | null; telefone: string }>;

  for (const admin of admins) {
    const dest = admin.jid ?? `${admin.telefone.replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      await botSend(dest, message);
    } catch (e) {
      console.error(`[Notif] Erro ao enviar para ${dest}:`, e);
    }
  }
}

// ─── Hooks (chamados pelos controllers) ──────────────────────────────────────

export async function notifyNovaOrdem(empresaId: string, dados: {
  numeroOrdem: number;
  clienteNome: string;
  placa: string;
  servico: string;
  valor: number;
  lavadorNome: string | null;
}): Promise<void> {
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { notificationPreferences: true },
    });
    if (!empresa || !prefs(empresa).novaOrdem) return;

    let msg = `🆕 *Nova Ordem #${dados.numeroOrdem}*\n` +
      `🚗 ${dados.placa} · ${dados.clienteNome}\n` +
      `🧹 ${dados.servico} · *R$ ${dados.valor.toFixed(2)}*`;
    if (dados.lavadorNome) msg += `\n👤 ${dados.lavadorNome}`;

    await notifyAdmins(empresaId, msg);
  } catch (e) {
    console.error('[Notif] notifyNovaOrdem:', e);
  }
}

export async function notifyOrdemFinalizada(empresaId: string, dados: {
  numeroOrdem: number;
  clienteNome: string;
  placa: string;
  valor: number;
  metodoPagamento: string;
}): Promise<void> {
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { notificationPreferences: true },
    });
    if (!empresa || !prefs(empresa).ordemFinalizada) return;

    const msg = `✅ *Ordem #${dados.numeroOrdem} finalizada*\n` +
      `🚗 ${dados.placa} · ${dados.clienteNome}\n` +
      `💰 *R$ ${dados.valor.toFixed(2)}* · ${dados.metodoPagamento}`;

    await notifyAdmins(empresaId, msg);
  } catch (e) {
    console.error('[Notif] notifyOrdemFinalizada:', e);
  }
}

export async function notifyClienteVip(empresaId: string, dados: {
  clienteNome: string;
  placa: string;
  totalVisitas: number;
  gastoTotal: number;
}): Promise<void> {
  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { notificationPreferences: true },
    });
    if (!empresa || !prefs(empresa).clienteVip) return;

    const msg = `🏆 *Cliente VIP chegou!*\n` +
      `👤 ${dados.clienteNome} · 🚗 ${dados.placa}\n` +
      `${dados.totalVisitas}ª visita · Total: *R$ ${dados.gastoTotal.toFixed(2)}*`;

    await notifyAdmins(empresaId, msg);
  } catch (e) {
    console.error('[Notif] notifyClienteVip:', e);
  }
}

export async function notifyOrdemCancelada(empresaId: string, dados: {
  numeroOrdem: number;
  clienteNome: string;
  placa: string;
  valor: number;
}): Promise<void> {
  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { notificationPreferences: true } });
    if (!empresa || !prefs(empresa).ordemCancelada) return;

    const msg = `❌ *Ordem #${dados.numeroOrdem} cancelada*\n` +
      `🚗 ${dados.placa} · ${dados.clienteNome}\n` +
      `💰 R$ ${dados.valor.toFixed(2)}`;

    await notifyAdmins(empresaId, msg);
  } catch (e) {
    console.error('[Notif] notifyOrdemCancelada:', e);
  }
}

export async function notifySaidaRegistrada(empresaId: string, dados: {
  descricao: string;
  valor: number;
  formaPagamento: string;
  lancadoPor?: string;
}): Promise<void> {
  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { notificationPreferences: true } });
    if (!empresa || !prefs(empresa).saidaRegistrada) return;

    let msg = `💸 *Saída registrada*\n` +
      `📝 ${dados.descricao}\n` +
      `💰 *R$ ${dados.valor.toFixed(2)}* · ${dados.formaPagamento}`;
    if (dados.lancadoPor) msg += `\n👤 ${dados.lancadoPor}`;

    await notifyAdmins(empresaId, msg);
  } catch (e) {
    console.error('[Notif] notifySaidaRegistrada:', e);
  }
}

export async function notifyComissaoFechada(empresaId: string, dados: {
  lavadorNome: string;
  valorPago: number;
  ordensCount: number;
}): Promise<void> {
  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { notificationPreferences: true } });
    if (!empresa || !prefs(empresa).comissaoFechada) return;

    const msg = `✅ *Comissão paga — ${dados.lavadorNome}*\n` +
      `📋 ${dados.ordensCount} ordem(ns)\n` +
      `💰 *R$ ${dados.valorPago.toFixed(2)}*`;

    await notifyAdmins(empresaId, msg);
  } catch (e) {
    console.error('[Notif] notifyComissaoFechada:', e);
  }
}

// ─── Cron Jobs ────────────────────────────────────────────────────────────────

export async function cronResumoDiario(): Promise<void> {
  try { const s = await botGetStatus(); if (s.status !== 'connected') return; } catch { return; }

  const empresas = await prisma.empresa.findMany({
    where: { ativo: true },
    select: { id: true, notificationPreferences: true },
  });

  for (const empresa of empresas) {
    if (!prefs(empresa).resumoDiario) continue;
    try {
      const { start: hoje, end: fimHoje } = getTodayRangeBRT();

      const [ordens, caixa] = await Promise.all([
        prisma.ordemServico.findMany({
          where: { empresaId: empresa.id, status: { not: 'CANCELADO' }, createdAt: { gte: hoje, lte: fimHoje } },
          include: { lavador: { select: { nome: true, comissao: true } } },
        }),
        prisma.caixaRegistro.findMany({
          where: { empresaId: empresa.id, data: { gte: hoje, lte: fimHoje } },
        }),
      ]);

      const finalizadas = ordens.filter(o => o.status === 'FINALIZADO');
      const emAberto   = ordens.filter(o => ['PENDENTE','EM_ANDAMENTO','AGUARDANDO_PAGAMENTO'].includes(o.status));
      const fat        = finalizadas.reduce((s, o) => s + o.valorTotal, 0);
      const saidas     = caixa.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);

      // Top lavadores por comissão
      const comPorLav: Record<string, { nome: string; ordens: number; com: number }> = {};
      for (const o of finalizadas) {
        if (!o.lavador || !o.lavadorId) continue;
        if (!comPorLav[o.lavadorId]) comPorLav[o.lavadorId] = { nome: o.lavador.nome, ordens: 0, com: 0 };
        comPorLav[o.lavadorId].ordens++;
        comPorLav[o.lavadorId].com += o.valorTotal * (o.lavador.comissao / 100);
      }
      const topLavs = Object.values(comPorLav).sort((a, b) => b.com - a.com).slice(0, 3);

      let msg = `📊 *Resumo do dia — ${hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}*\n`;
      msg += `━━━━━━━━━━━━━━━\n`;
      msg += `🚗 *${finalizadas.length}* finalizada(s)`;
      if (emAberto.length > 0) msg += ` · ⏳ *${emAberto.length}* em aberto`;
      msg += `\n💰 Faturamento: *R$ ${fat.toFixed(2)}*`;
      msg += `\n💸 Saídas: *R$ ${saidas.toFixed(2)}*`;
      msg += `\n💵 Líquido: *R$ ${(fat - saidas).toFixed(2)}*`;

      if (topLavs.length > 0) {
        msg += `\n━━━━━━━━━━━━━━━\n👷 Lavadores:\n`;
        for (const l of topLavs) {
          msg += `• *${l.nome}*: ${l.ordens} ord. · *R$ ${l.com.toFixed(2)}*\n`;
        }
      }

      await notifyAdmins(empresa.id, msg.trim());
    } catch (e) {
      console.error(`[Notif Resumo] empresa ${empresa.id}:`, e);
    }
  }
}

export async function cronAlertaCaixaAberto(): Promise<void> {
  try { const s = await botGetStatus(); if (s.status !== 'connected') return; } catch { return; }

  const empresas = await prisma.empresa.findMany({
    where: { ativo: true },
    select: { id: true, notificationPreferences: true },
  });

  for (const empresa of empresas) {
    if (!prefs(empresa).alertaCaixaAberto) continue;
    try {
      const { start: hoje, end: fimHoje } = getTodayRangeBRT();

      const [abertura, fechamento] = await Promise.all([
        prisma.aberturaCaixa.findFirst({ where: { empresaId: empresa.id, data: { gte: hoje, lte: fimHoje } } }),
        prisma.fechamentoCaixa.findFirst({ where: { empresaId: empresa.id, data: { gte: hoje, lte: fimHoje } } }),
      ]);

      if (abertura && !fechamento) {
        await notifyAdmins(empresa.id, `🕙 O caixa ainda está aberto. Lembre-se de fechar pelo painel.`);
      }
    } catch (e) {
      console.error(`[Notif Caixa] empresa ${empresa.id}:`, e);
    }
  }
}

export async function cronOrdensParadas(): Promise<void> {
  try { const s = await botGetStatus(); if (s.status !== 'connected') return; } catch { return; }

  const empresas = await prisma.empresa.findMany({
    where: { ativo: true },
    select: { id: true, notificationPreferences: true },
  });

  for (const empresa of empresas) {
    const p = prefs(empresa);
    if (!p.ordemParada) continue;
    try {
      const horas = p.ordemParadaHoras ?? 2;
      const limiteAtras = new Date(Date.now() - horas * 60 * 60 * 1000);

      const paradas = await prisma.ordemServico.findMany({
        where: { empresaId: empresa.id, status: 'EM_ANDAMENTO', updatedAt: { lt: limiteAtras } },
        include: { veiculo: { select: { modelo: true, placa: true } } },
        take: 5,
      });

      if (paradas.length === 0) continue;

      let msg = `⚠️ *${paradas.length} ordem(ns) parada(s) há ${horas}h+:*\n`;
      for (const o of paradas) {
        const horasParada = Math.floor((Date.now() - o.updatedAt.getTime()) / 3600000);
        msg += `• #${o.numeroOrdem} ${o.veiculo.modelo ?? 'Veículo'} ${o.veiculo.placa ?? ''} (${horasParada}h)\n`;
      }

      await notifyAdmins(empresa.id, msg.trim());
    } catch (e) {
      console.error(`[Notif Paradas] empresa ${empresa.id}:`, e);
    }
  }
}
