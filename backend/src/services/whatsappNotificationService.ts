/**
 * Notificações proativas do Bot Lina — enviadas automaticamente sem o admin perguntar.
 * Todas as funções são fire-and-forget: erros são logados mas nunca quebram o fluxo principal.
 */

import prisma from '../db';
import { botSend, botGetStatus } from './botServiceClient';
import { getTodayFixedRangeBRT, getTodayRangeBRT, getTodayStrBRT } from '../utils/dateUtils';

// Evita reenvio do resumo se o bot estava offline e o cron de retry disparou
const resumoEnviadoHoje = new Set<string>(); // key: `${empresaId}_${YYYY-MM-DD}`
function resumoKey(empresaId: string) { return `${empresaId}_${getTodayStrBRT()}`; }

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
  | 'clienteVip'
  | 'fechamentoCaixa';

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
  fechamentoCaixa:    true,
};

// Tolera dados antigos onde notificationPreferences foi salvo como string JSON
// (bug corrigido em updateEmpresa, mas registros já gravados ainda podem estar assim).
function getNotifPrefsObj(empresa: { notificationPreferences: any }): any {
  let np = empresa.notificationPreferences;
  if (typeof np === 'string') {
    try { np = JSON.parse(np); } catch { np = {}; }
  }
  return np ?? {};
}

function prefs(empresa: { notificationPreferences: any }): NotifPrefs {
  const p = getNotifPrefsObj(empresa).whatsapp ?? {};
  return { ...DEFAULTS, ...p };
}

// Config de "Capacidades do Bot" — quais notificações cada permissão de Cargo recebe.
// Default = todas habilitadas (comportamento anterior, sem config).
function permissionNotifEnabled(empresa: { notificationPreferences: any }, permission: string, notifKey: string): boolean {
  const roles = getNotifPrefsObj(empresa).whatsappRoles ?? {};
  const notifs = roles[permission]?.notifs;
  if (!Array.isArray(notifs)) return true;
  return notifs.includes(notifKey);
}

export function getDefaultPrefs(): NotifPrefs { return { ...DEFAULTS }; }

// ─── Core: enviar para admins da empresa, respeitando prefs individuais ───────

export async function notifyAdmins(empresaId: string, message: string, notifKey?: string): Promise<void> {
  try {
    const bot = await botGetStatus();
    if (bot.status !== 'connected') return;
  } catch {
    return;
  }

  const admins = await (prisma.whatsappAdminPhone as any).findMany({
    where: { empresaId, ativo: true },
    select: { jid: true, telefone: true, notifPrefs: true },
  }) as Array<{ jid: string | null; telefone: string; notifPrefs: any }>;

  for (const admin of admins) {
    if (notifKey) {
      const prefs = (admin.notifPrefs as any) ?? {};
      if (prefs[notifKey] === false) continue;
    }
    const dest = admin.jid ?? `${admin.telefone.replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      await botSend(dest, message);
    } catch (e) {
      console.error(`[Notif] Erro ao enviar para ${dest}:`, e);
    }
  }
}

// ─── Notificar funcionários (subaccounts) conforme permissão do Role ─────────

export async function notifyByPermission(empresaId: string, permission: string, message: string): Promise<void> {
  try {
    const bot = await botGetStatus();
    if (bot.status !== 'connected') return;
  } catch {
    return;
  }

  const botUsers = await (prisma.whatsappBotUser as any).findMany({
    where: {
      empresaId,
      ativo: true,
      jid: { not: null },
      subaccountId: { not: null },
      subaccount: {
        roleInt: { permissoes: { some: { name: permission } } },
      },
    },
    select: { jid: true },
  }) as Array<{ jid: string | null }>;

  for (const u of botUsers) {
    if (!u.jid) continue;
    try {
      await botSend(u.jid, message);
    } catch (e) {
      console.error(`[Notif] Erro ao enviar para ${u.jid}:`, e);
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

    await notifyAdmins(empresaId, msg, 'novaOrdem');
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

    await notifyAdmins(empresaId, msg, 'ordemFinalizada');
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

    await notifyAdmins(empresaId, msg, 'clienteVip');
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

    await notifyAdmins(empresaId, msg, 'ordemCancelada');
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
    const bot = await botGetStatus();
    if (bot.status !== 'connected') return;
  } catch { return; }

  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true, notificationPreferences: true } });
    if (!empresa || !prefs(empresa).saidaRegistrada) return;

    let corpo = `\n📝 ${dados.descricao}\n` +
      `💰 *R$ ${dados.valor.toFixed(2)}* · ${dados.formaPagamento}`;
    if (dados.lancadoPor) corpo += `\n👤 ${dados.lancadoPor}`;

    // sendAdminBlocks adiciona o nome da empresa no cabeçalho automaticamente
    // quando o admin gerencia mais de uma empresa (headerMulti).
    await sendAdminBlocks([{
      empresaId,
      empresaNome:  empresa.nome,
      notifKey:     'saidaRegistrada',
      corpo,
      headerSingle: `💸 *Saída registrada*`,
      headerMulti:  (nome) => `🏢 *${nome}*\n💸 *Saída registrada*`,
    }]);
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

    await notifyAdmins(empresaId, msg, 'comissaoFechada');
  } catch (e) {
    console.error('[Notif] notifyComissaoFechada:', e);
  }
}

export async function notifyFechamentoCaixa(empresaId: string, _fechamentoId?: string): Promise<void> {
  try {
    const bot = await botGetStatus();
    if (bot.status !== 'connected') return;
  } catch { return; }

  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true, notificationPreferences: true } });
    if (!empresa || !prefs(empresa).fechamentoCaixa) return;

    // Comando simples "fechamento do caixa" (já tratado pelo bot) — sem código/ID.
    const corpo = `\n\n🔍 Digite *fechamento do caixa* para ver os detalhes\n` +
      `(valores digitados, computados e observações)`;

    // sendAdminBlocks adiciona o nome da empresa no cabeçalho automaticamente
    // quando o admin gerencia mais de uma empresa (headerMulti).
    await sendAdminBlocks([{
      empresaId,
      empresaNome:  empresa.nome,
      notifKey:     'fechamentoCaixa',
      corpo,
      headerSingle: `💼 *Fechamento de Caixa Disponível*`,
      headerMulti:  (nome) => `🏢 *${nome}*\n💼 *Fechamento de Caixa Disponível*`,
    }]);
  } catch (e) {
    console.error('[Notif] notifyFechamentoCaixa:', e);
  }
}

// ─── Envio agrupado para admins de múltiplas empresas ─────────────────────────
// Um mesmo número de WhatsApp pode ser admin em mais de uma empresa
// (uma linha em whatsapp_admin_phones por empresa, mesmo telefone/jid).
// Quando isso acontece, cada mensagem recebe o nome da empresa no cabeçalho
// e, se houver, um índice estável (`detalhes N`) baseado na lista completa
// e ordenada (por nome) de empresas que esse admin gerencia.

interface AdminBloco {
  empresaId: string;
  empresaNome: string;
  notifKey: string;
  corpo: string;
  headerSingle: string;
  headerMulti: (empresaNome: string) => string;
  footerSingle?: string;
  footerMulti?: (indice: number) => string;
}

async function sendAdminBlocks(blocos: AdminBloco[]): Promise<void> {
  if (blocos.length === 0) return;

  const empresaIds = blocos.map(b => b.empresaId);
  const admins = await (prisma.whatsappAdminPhone as any).findMany({
    where: { empresaId: { in: empresaIds }, ativo: true },
    select: { telefone: true, jid: true, empresaId: true, notifPrefs: true },
  }) as Array<{ telefone: string; jid: string | null; empresaId: string; notifPrefs: any }>;

  const telefones = [...new Set(admins.map(a => a.telefone))];

  // Lista completa (todas as empresas ativas, não só as com bloco hoje) de cada telefone,
  // ordenada por nome — define a numeração estável usada em "detalhes N".
  const todasEmpresasDoAdmin = await (prisma.whatsappAdminPhone as any).findMany({
    where: { telefone: { in: telefones }, ativo: true },
    select: { telefone: true, empresaId: true },
  }) as Array<{ telefone: string; empresaId: string }>;

  const empresaIdsTodas = [...new Set(todasEmpresasDoAdmin.map(a => a.empresaId))];
  const empresasInfo = await prisma.empresa.findMany({
    where: { id: { in: empresaIdsTodas } },
    select: { id: true, nome: true },
  });
  const nomeById = new Map(empresasInfo.map(e => [e.id, e.nome]));

  const ordemPorTelefone = new Map<string, string[]>(); // telefone → empresaIds ordenados por nome
  for (const telefone of telefones) {
    const ids = todasEmpresasDoAdmin.filter(a => a.telefone === telefone).map(a => a.empresaId);
    ids.sort((a, b) => (nomeById.get(a) ?? '').localeCompare(nomeById.get(b) ?? ''));
    ordemPorTelefone.set(telefone, ids);
  }

  const porTelefone = new Map<string, typeof admins>();
  for (const a of admins) {
    if (!porTelefone.has(a.telefone)) porTelefone.set(a.telefone, []);
    porTelefone.get(a.telefone)!.push(a);
  }

  for (const [telefone, rows] of porTelefone) {
    const ordemEmpresas = ordemPorTelefone.get(telefone) ?? [];
    const minhas = rows
      .map(a => {
        const bloco = blocos.find(b => b.empresaId === a.empresaId);
        if (!bloco) return null;
        const prefsAdmin = (a.notifPrefs as any) ?? {};
        if (prefsAdmin[bloco.notifKey] === false) return null;
        return { ...bloco, jid: a.jid, telefone: a.telefone };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    const multi = ordemEmpresas.length > 1;

    for (const b of minhas) {
      const dest = b.jid ?? `${b.telefone.replace(/\D/g, '')}@s.whatsapp.net`;
      const indice = ordemEmpresas.indexOf(b.empresaId) + 1;
      const header = multi ? b.headerMulti(b.empresaNome) : b.headerSingle;
      const footer = multi ? (b.footerMulti?.(indice) ?? '') : (b.footerSingle ?? '');
      try {
        await botSend(dest, `${header}${b.corpo}${footer}`);
      } catch (e) {
        console.error(`[Notif] Erro ao enviar para ${dest}:`, e);
      }
    }
  }
}

// ─── Cron Jobs ────────────────────────────────────────────────────────────────

export async function cronResumoDiario(): Promise<void> {
  try { const s = await botGetStatus(); if (s.status !== 'connected') return; } catch { return; }

  const empresas = await prisma.empresa.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, notificationPreferences: true },
  });

  const adminBlocos: AdminBloco[] = [];

  for (const empresa of empresas) {
    if (!prefs(empresa).resumoDiario) continue;
    if (resumoEnviadoHoje.has(resumoKey(empresa.id))) continue;
    try {
      const { start: hoje, end: fimHoje } = getTodayFixedRangeBRT();

      const [finalizadas, caixa] = await Promise.all([
        prisma.ordemServico.findMany({
          where: { empresaId: empresa.id, status: 'FINALIZADO', dataFim: { gte: hoje, lte: fimHoje } },
          include: { ordemLavadores: { include: { lavador: { select: { nome: true } } } } },
        }),
        prisma.caixaRegistro.findMany({
          where: { empresaId: empresa.id, data: { gte: hoje, lte: fimHoje } },
        }),
      ]);
      const fat    = finalizadas.reduce((s, o) => s + o.valorTotal, 0);
      const saidas = caixa.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);

      // Top lavadores por ganho real (OrdemServicoLavador.ganho já tem divisão multi-lavador aplicada)
      const comPorLav: Record<string, { nome: string; ordens: number; com: number }> = {};
      for (const o of finalizadas) {
        for (const ol of o.ordemLavadores) {
          if (!comPorLav[ol.lavadorId]) comPorLav[ol.lavadorId] = { nome: ol.lavador.nome, ordens: 0, com: 0 };
          comPorLav[ol.lavadorId].ordens++;
          comPorLav[ol.lavadorId].com += ol.ganho;
        }
      }
      const topLavs = Object.values(comPorLav).sort((a, b) => b.com - a.com).slice(0, 3);

      const dataStr = hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

      let corpo = `🚗 *${finalizadas.length}* finalizada(s)`;
      corpo += `\n💰 Faturamento: *R$ ${fat.toFixed(2)}*`;
      corpo += `\n💸 Saídas: *R$ ${saidas.toFixed(2)}*`;
      corpo += `\n💵 Líquido: *R$ ${(fat - saidas).toFixed(2)}*`;

      if (topLavs.length > 0) {
        corpo += `\n━━━━━━━━━━━━━━━\n👷 Lavadores:\n`;
        for (const l of topLavs) {
          corpo += `• *${l.nome}*: ${l.ordens} ord. · *R$ ${l.com.toFixed(2)}*\n`;
        }
      }
      corpo = corpo.trim();

      adminBlocos.push({
        empresaId:    empresa.id,
        empresaNome:  empresa.nome,
        notifKey:     'resumoDiario',
        corpo,
        headerSingle: `📊 *Resumo do dia — ${dataStr}*\n━━━━━━━━━━━━━━━\n`,
        headerMulti:  (nome) => `📊 *Resumo do dia — ${nome} — ${dataStr}*\n━━━━━━━━━━━━━━━\n`,
        footerSingle: `\n\n💡 _Detalhes completos: responda *mais detalhes*_`,
        footerMulti:  (n) => `\n\n💡 _Detalhes completos: responda *detalhes ${n}*_`,
      });

      if (permissionNotifEnabled(empresa, 'ver_financeiro', 'resumoDiario')) {
        const msgFuncionario = `📊 *Resumo do dia — ${dataStr}*\n━━━━━━━━━━━━━━━\n${corpo}\n\n💡 _Detalhes completos: responda *mais detalhes*_`;
        await notifyByPermission(empresa.id, 'ver_financeiro', msgFuncionario);
      }
      resumoEnviadoHoje.add(resumoKey(empresa.id));
    } catch (e) {
      console.error(`[Notif Resumo] empresa ${empresa.id}:`, e);
    }
  }

  await sendAdminBlocks(adminBlocos);
}

export async function cronAlertaCaixaAberto(): Promise<void> {
  try { const s = await botGetStatus(); if (s.status !== 'connected') return; } catch { return; }

  const empresas = await prisma.empresa.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, notificationPreferences: true },
  });

  const adminBlocos: AdminBloco[] = [];

  for (const empresa of empresas) {
    if (!prefs(empresa).alertaCaixaAberto) continue;
    try {
      const { start: hoje, end: fimHoje } = getTodayRangeBRT();

      const [abertura, fechamento] = await Promise.all([
        prisma.aberturaCaixa.findFirst({ where: { empresaId: empresa.id, data: { gte: hoje, lte: fimHoje } } }),
        prisma.fechamentoCaixa.findFirst({ where: { empresaId: empresa.id, data: { gte: hoje, lte: fimHoje } } }),
      ]);

      if (abertura && !fechamento) {
        const corpo = `🕙 O caixa ainda está aberto. Lembre-se de fechar pelo painel.`;
        adminBlocos.push({
          empresaId:    empresa.id,
          empresaNome:  empresa.nome,
          notifKey:     'alertaCaixaAberto',
          corpo,
          headerSingle: ``,
          headerMulti:  (nome) => `🏢 *${nome}*\n`,
          footerSingle: ``,
        });
        if (permissionNotifEnabled(empresa, 'ver_financeiro', 'alertaCaixaAberto')) {
          await notifyByPermission(empresa.id, 'ver_financeiro', corpo);
        }
      }
    } catch (e) {
      console.error(`[Notif Caixa] empresa ${empresa.id}:`, e);
    }
  }

  await sendAdminBlocks(adminBlocos);
}

export async function cronOrdensParadas(): Promise<void> {
  try { const s = await botGetStatus(); if (s.status !== 'connected') return; } catch { return; }

  const empresas = await prisma.empresa.findMany({
    where: { ativo: true },
    select: { id: true, nome: true, notificationPreferences: true },
  });

  const adminBlocos: AdminBloco[] = [];

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

      let corpo = `⚠️ *${paradas.length} ordem(ns) parada(s) há ${horas}h+:*\n`;
      for (const o of paradas) {
        const horasParada = Math.floor((Date.now() - o.updatedAt.getTime()) / 3600000);
        corpo += `• #${o.numeroOrdem} ${o.veiculo?.modelo ?? o.itemAvulso ?? 'Veículo'} ${o.veiculo?.placa ?? ''} (${horasParada}h)\n`;
      }
      corpo = corpo.trim();

      adminBlocos.push({
        empresaId:    empresa.id,
        empresaNome:  empresa.nome,
        notifKey:     'ordemParada',
        corpo,
        headerSingle: ``,
        headerMulti:  (nome) => `🏢 *${nome}*\n`,
        footerSingle: ``,
      });

      if (permissionNotifEnabled(empresa, 'gerenciar_ordens', 'ordemParada')) {
        await notifyByPermission(empresa.id, 'gerenciar_ordens', corpo);
      }
    } catch (e) {
      console.error(`[Notif Paradas] empresa ${empresa.id}:`, e);
    }
  }

  await sendAdminBlocks(adminBlocos);
}
