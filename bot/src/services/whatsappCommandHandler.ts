/*
 * Parser de comandos WhatsApp e construtor de contexto
 * Identifica comandos específicos e passa para Groq quando não encontra match
 */

import prisma from '../db';
import { chatCompletion, transcribeAudio } from './groqService';
import { identifyWhatsAppUser, hasPermission, getDeniedAccessMessage, getPermissionDeniedMessage, DEFAULT_LAVADOR_FEATURES, type WhatsAppUser } from './whatsappAuthService';
import { getContext, setContext, clearContext, detectEmpresaNoTexto } from './adminContextStore';
import { handleOwnerModeMessage } from './ownerModeService';
import { gerarPixParaOrdem } from './pixService';
import { sendImageBuffer } from './baileyService';
import { getWorkdayRangeBRT, getDateRangeBRT, getFixedDayRangeBRT, getTodayFixedRangeBRT, getTodayStrBRT, getMonthRangeBRT, getTodayRangeBRT } from '../utils/dateUtils';
import {
  pendingReports,
  hasPendingAdminReportView,
  hasPendingReportsList,
  handleReportarCommand,
  handleReportarCommandFuncionario,
  handleReportStep,
  handleIncomingImageForReport,
  handleAdminReportResponse,
  handleReportsCommand,
  handleReportsListSelection,
} from './reportService';

const PORTAL_URL = (process.env.PORTAL_URL ?? '').replace(/\/$/, '');

/** Chamado pelo baileyService quando recebe uma imagem. */
export async function handleIncomingImage(from: string, buffer: Buffer): Promise<string | null> {
  return handleIncomingImageForReport(from, buffer);
}

/** Chamado pelo baileyService quando recebe um áudio — transcreve e processa como texto. */
export async function handleIncomingAudio(from: string, senderName: string, buffer: Buffer): Promise<string> {
  let transcript: string;
  try {
    transcript = await transcribeAudio(buffer);
  } catch (err) {
    console.error('[WhatsApp] Erro ao transcrever áudio:', err);
    return '❌ Não consegui entender o áudio. Pode tentar de novo ou mandar por texto?';
  }

  if (!transcript) {
    return '❌ Não consegui entender o áudio. Pode tentar de novo ou mandar por texto?';
  }

  const resposta = await handleIncomingMessage(from, senderName, transcript);
  return `🎙️ _Entendi: "${transcript}"_\n\n${resposta}`;
}

// ==========================================
// ESTADO DE COLETA CONVERSACIONAL DE SAÍDAS
// ==========================================
type SaidaStep = 'valor' | 'descricao' | 'formaPagamento' | 'lavador' | 'fornecedor' | 'confirming';

interface PendingSaida {
  valor: number;                   // 0 = ainda não informado
  descricao: string | null;
  formaPagamento: string | null;
  categoria: string;
  fornecedorNome: string | null | undefined; // undefined = não perguntado; null = pulou; string = fornecido
  lavadorId: string | null | undefined;      // undefined = não perguntado; null = pulou
  lavadorNome: string | null | undefined;
  lavadoresList: Array<{ id: string; nome: string }>;
  step: SaidaStep;
  empresaId: string;
  userName: string;
  expiresAt: number;
}
const pendingSaidas = new Map<string, PendingSaida>(); // chave = JID (empresa vem do contexto)

// Comando pendente aguardando seleção de empresa (JID → mensagem original)
const pendingCommands = new Map<string, string>();

// Admin navegando menu de notificações individuais (JID → empresaId)
const pendingNotifMenu = new Map<string, string>();

// Lavador com menu numerado aberto (JID → { lavadorId, empresaId })
const pendingLavadorMenu = new Map<string, { lavadorId: string; empresaId: string; actions: string[] }>();

// Funcionário (subaccount): mapeia comando → permissão necessária do Role
const COMMAND_PERMISSION_MAP: Record<string, string> = {
  'resumo':          'ver_financeiro',
  'resumo do dia':   'ver_financeiro',
  'resumo diario':   'ver_financeiro',
  'resumo diário':   'ver_financeiro',
  'caixa':           'ver_financeiro',
  'status caixa':    'ver_financeiro',
  'ordens':          'gerenciar_ordens',
  'ordens paradas':  'gerenciar_ordens',
  'ordens em andamento': 'gerenciar_ordens',
  'clientes':        'gerenciar_clientes',
  'clientes hoje':   'gerenciar_clientes',
  'funcionarios':    'gerenciar_funcionarios',
  'funcionários':    'gerenciar_funcionarios',
  'equipe':          'gerenciar_funcionarios',
  'lavadores':       'gerenciar_funcionarios',
};

// Limpa sessões expiradas a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingSaidas.entries()) {
    if (val.expiresAt < now) pendingSaidas.delete(key);
  }
}, 5 * 60 * 1000);

// ==========================================
// MENU DE NOTIFICAÇÕES INDIVIDUAIS
// ==========================================
const NOTIF_MENU_ITEMS = [
  { key: 'novaOrdem',         label: '🆕 Nova ordem criada' },
  { key: 'ordemFinalizada',   label: '✅ Ordem finalizada' },
  { key: 'ordemCancelada',    label: '❌ Ordem cancelada' },
  { key: 'ordemParada',       label: '⚠️ Ordens paradas' },
  { key: 'resumoDiario',      label: '📊 Resumo diário (20h)' },
  { key: 'alertaCaixaAberto', label: '🕙 Alerta caixa aberto' },
  { key: 'saidaRegistrada',   label: '💸 Saída registrada' },
  { key: 'comissaoFechada',   label: '💰 Comissão fechada' },
  { key: 'clienteVip',        label: '🏆 Cliente VIP chegou' },
  { key: 'reportAvaria',      label: '📸 Report de avaria' },
];

// Defaults do sistema (espelha o backend whatsappNotificationService.ts)
const NOTIF_SISTEMA_DEFAULTS: Record<string, boolean> = {
  novaOrdem:          true,
  ordemFinalizada:    false,
  ordemCancelada:     false,
  resumoDiario:       true,
  alertaCaixaAberto:  true,
  ordemParada:        false,
  saidaRegistrada:    false,
  comissaoFechada:    false,
  clienteVip:         true,
  reportAvaria:       true,
};

async function buildNotifMenuText(jid: string, empresaId: string): Promise<string> {
  const [admin, empresa] = await Promise.all([
    (prisma.whatsappAdminPhone as any).findFirst({
      where: { empresaId, ativo: true, jid },
      select: { notifPrefs: true },
    }),
    prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { notificationPreferences: true },
    }),
  ]);

  const prefs: any = (admin?.notifPrefs as any) ?? {};
  const sistemaPrefs: any = (empresa?.notificationPreferences as any)?.whatsapp ?? {};

  const lista = NOTIF_MENU_ITEMS.map((item, i) => {
    const defaultSistema = NOTIF_SISTEMA_DEFAULTS[item.key] !== false;
    const sistemaAtivo = sistemaPrefs[item.key] !== undefined
      ? sistemaPrefs[item.key] !== false
      : defaultSistema;

    if (!sistemaAtivo) {
      return `*${i + 1}* ${item.label} — 🚫 _desativado no sistema_`;
    }

    const individualAtivo = prefs[item.key] !== false;
    return `*${i + 1}* ${item.label} — ${individualAtivo ? '✅' : '❌'}`;
  }).join('\n');

  return `🔔 *Suas notificações*\n_Preferências individuais (ativo por padrão)_\n\n${lista}\n\n_Digite o número para ativar/desativar ou *0* para sair._\n_🚫 = desativado nas configurações do sistema_`;
}

async function handleNotifMenuStep(jid: string, empresaId: string, choice: string): Promise<string> {
  if (choice === '0') {
    pendingNotifMenu.delete(jid);
    return '✅ Preferências salvas.';
  }

  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= NOTIF_MENU_ITEMS.length) {
    return buildNotifMenuText(jid, empresaId);
  }

  const item = NOTIF_MENU_ITEMS[idx];
  const admin = await (prisma.whatsappAdminPhone as any).findFirst({
    where: { empresaId, ativo: true, jid },
    select: { id: true, notifPrefs: true },
  });

  if (!admin) {
    pendingNotifMenu.delete(jid);
    return '❌ Erro ao carregar preferências.';
  }

  const prefs: any = { ...((admin.notifPrefs as any) ?? {}) };
  const eraAtivo = prefs[item.key] !== false;
  prefs[item.key] = !eraAtivo;

  await (prisma.whatsappAdminPhone as any).update({
    where: { id: admin.id },
    data: { notifPrefs: prefs },
  });

  const status = !eraAtivo ? '✅ ativada' : '❌ desativada';
  return `${status} — *${item.label}*\n\n${await buildNotifMenuText(jid, empresaId)}`;
}

/*
 * Processa mensagem recebida do WhatsApp
 */
// ─── Self-onboarding portal: "conectar CODIGO" ───────────────────────────────
async function handleConectarPortal(from: string, message: string): Promise<string | null> {
  const match = message.trim().match(/^conectar\s+([A-Z0-9]{6})$/i);
  if (!match) return null;

  const codigo = match[1].toUpperCase();
  const agora  = new Date();

  const lavador = await (prisma.lavador as any).findFirst({
    where: {
      codigoWpp: codigo,
      codigoWppExpiraEm: { gte: agora },
      ativo: true,
    },
    select: { id: true, nome: true },
  }) as { id: string; nome: string } | null;

  const telefone = from.split('@')[0];

  if (lavador) {
    await (prisma.lavador as any).update({
      where: { id: lavador.id },
      data: { telefone, codigoWpp: null, codigoWppExpiraEm: null },
    });
    return `Oi, ${lavador.nome}! 👋 Sou a Lina, tudo bem?\n\nSeu WhatsApp tá vinculado agora — a partir de agora você recebe suas notificações de comissão por aqui e pode me perguntar qualquer coisa sobre seus serviços. Manda um *ajuda* pra ver o que eu consigo fazer por você, viu?`;
  }

  // Fallback: dpFuncionario standalone (sem lavadorId)
  const dpFuncConn = await (prisma as any).dpFuncionario.findFirst({
    where: { codigoWpp: codigo, codigoWppExpiraEm: { gte: agora }, status: 'ATIVO' },
    select: { id: true, nome: true },
  }) as { id: string; nome: string } | null;

  if (!dpFuncConn) return '❌ Código inválido ou expirado. Gere um novo código pelo portal e tente novamente.';

  await (prisma as any).dpFuncionario.update({
    where: { id: dpFuncConn.id },
    data: { wppJid: from, codigoWpp: null, codigoWppExpiraEm: null },
  });

  return `Oi, ${dpFuncConn.nome}! 👋 Sou a Lina!\n\nSeu WhatsApp tá vinculado ao ponto agora — manda *ponto* aqui quando quiser registrar sua presença. 🎯`;
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA POINT — PONTO VIA WHATSAPP
// ═══════════════════════════════════════════════════════════════════════════

const PONTO_KEYWORDS  = /\b(ponto|bater\s+ponto|registrar\s+ponto|cheguei|fui\s+embora|saindo|t[aá]\s+saindo)\b/i;
const ESPELHO_KEYWORDS = /\b(espelho|meu\s+ponto|banco\s+de\s+horas?|horas?\s+trabalhadas?|resumo\s+ponto|ver\s+ponto|ponto\s+de\s+hoje)\b/i;

// ── helpers ──────────────────────────────────────────────────────────────────

function haversineDP(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function horaFormatadaBRTDp(d: Date): string {
  return new Date(d).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

function fmtMinDP(min: number): string {
  const abs = Math.abs(min);
  const h   = Math.floor(abs / 60);
  const m   = abs % 60;
  const str = h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}min`;
  return min < 0 ? `-${str}` : str;
}

function calcMinutosDP(
  marcacoes: Array<{ tipo: string; timestamp: Date }>,
  agora: Date,
): number {
  let total = 0; let i = 0;
  while (i < marcacoes.length) {
    if (marcacoes[i].tipo === 'ENTRADA') {
      let j = i + 1;
      while (j < marcacoes.length && marcacoes[j].tipo !== 'SAIDA') j++;
      if (j < marcacoes.length) {
        total += Math.round((marcacoes[j].timestamp.getTime() - marcacoes[i].timestamp.getTime()) / 60000);
        i = j + 1;
      } else {
        total += Math.round((agora.getTime() - marcacoes[i].timestamp.getTime()) / 60000);
        i++;
      }
    } else { i++; }
  }
  return total;
}

type DpFunc = { id: string; nome: string; empresaId: string; cargaHorariaDia: number | null };

async function resolveWppDpFuncionario(jid: string): Promise<DpFunc | null> {
  const sel = { id: true, nome: true, empresaId: true, cargaHorariaDia: true };

  // 1. Por wppJid direto
  const porJid = await (prisma as any).dpFuncionario.findFirst({
    where: { wppJid: jid, status: 'ATIVO' }, select: sel,
  }) as DpFunc | null;
  if (porJid) return porJid;

  // 2. Lavador com telefone = phone extraído do JID → dpFuncionario.lavadorId
  const phone = jid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
  if (!phone) return null;

  const lavador = await (prisma.lavador as any).findFirst({
    where: { telefone: phone }, select: { id: true },
  }) as { id: string } | null;
  if (lavador) {
    const porLavador = await (prisma as any).dpFuncionario.findFirst({
      where: { lavadorId: lavador.id, status: 'ATIVO' }, select: sel,
    }) as DpFunc | null;
    if (porLavador) return porLavador;
  }

  // 3. dpFuncionario standalone com telefone = phone
  return await (prisma as any).dpFuncionario.findFirst({
    where: { telefone: phone, status: 'ATIVO', lavadorId: null }, select: sel,
  }) as DpFunc | null;
}

// ── exports ──────────────────────────────────────────────────────────────────

/**
 * Informa o funcionário sobre qual marcação virá a seguir.
 * Não exige mais que o funcionário mande a localização em seguida —
 * a localização pode ser enviada diretamente a qualquer momento.
 */
export async function handleDpPontoKeyword(from: string, text: string): Promise<string | null> {
  if (!PONTO_KEYWORDS.test(text)) return null;

  const func = await resolveWppDpFuncionario(from);
  if (!func) return null;

  const sistema = await (prisma as any).empresaSistema.findFirst({
    where: { empresaId: func.empresaId, sistema: 'data-point', ativo: true },
  });
  if (!sistema) return null;

  const { start, end } = getTodayRangeBRT();
  const marcacoes = await (prisma as any).dpMarcacao.findMany({
    where: { funcionarioId: func.id, timestamp: { gte: start, lte: end } },
    orderBy: { timestamp: 'asc' },
  }) as Array<{ tipo: string; timestamp: Date }>;

  const ultima = marcacoes[marcacoes.length - 1];
  const proximoTipo = (!ultima || ultima.tipo === 'SAIDA') ? 'ENTRADA' : 'SAIDA';

  // Cooldown informativo
  if (ultima && ultima.tipo === proximoTipo) {
    const diffMin = (Date.now() - new Date(ultima.timestamp).getTime()) / 60000;
    if (diffMin < 5) {
      const wait = Math.ceil(5 - diffMin);
      return `⏳ Aguarde ${wait} minuto${wait !== 1 ? 's' : ''} antes de registrar novamente.`;
    }
  }

  const emoji = proximoTipo === 'ENTRADA' ? '🟢' : '🔴';
  return `${emoji} *${proximoTipo}*\n\nCompartilhe sua localização para registrar. 📍\n\n📎 _Clipe de anexo → Localização → Enviar localização atual_`;
}

/**
 * Chamado pelo baileyService quando recebe mensagem de localização.
 * Registra o ponto diretamente — sem necessidade de digitar "ponto" antes.
 * ENTRADA: valida GPS. SAIDA: apenas registra (sem validação de raio).
 */
export async function handleDpLocation(
  from: string,
  lat: number,
  lng: number,
  accuracy: number | null,
  isForwarded: boolean = false,
  msgTimestampMs: number = 0,
): Promise<string | null> {
  const agora = Date.now();

  // Identifica usuário DP primeiro — se não for, ignora silenciosamente
  const func = await resolveWppDpFuncionario(from);
  if (!func) return null;

  // ── Anti-fraude ────────────────────────────────────────────────────────────
  if (isForwarded) {
    return '⚠️ Localização encaminhada não é aceita.\n\nCompartilhe sua *localização atual* diretamente (clipe → Localização → Enviar localização atual).';
  }
  if (msgTimestampMs > 0 && agora - msgTimestampMs > 2 * 60 * 1000) {
    return '⚠️ Essa localização parece ser antiga. Compartilhe sua *localização atual* para registrar o ponto.';
  }

  const sistema = await (prisma as any).empresaSistema.findFirst({
    where: { empresaId: func.empresaId, sistema: 'data-point', ativo: true },
  });
  if (!sistema) return '❌ Data Point não está ativo para sua empresa.';

  const cfg = sistema.config ? JSON.parse(sistema.config as string) : {};
  const { start, end } = getTodayRangeBRT();

  const marcacoes = await (prisma as any).dpMarcacao.findMany({
    where: { funcionarioId: func.id, timestamp: { gte: start, lte: end } },
    orderBy: { timestamp: 'asc' },
  }) as Array<{ tipo: string; timestamp: Date }>;

  const ultima = marcacoes[marcacoes.length - 1];
  const tipo: 'ENTRADA' | 'SAIDA' = (!ultima || ultima.tipo === 'SAIDA') ? 'ENTRADA' : 'SAIDA';

  // Cooldown 5 min entre marcações do mesmo tipo
  if (ultima && ultima.tipo === tipo) {
    const diffMin = (agora - new Date(ultima.timestamp).getTime()) / 60000;
    if (diffMin < 5) {
      const wait = Math.ceil(5 - diffMin);
      return `⏳ Aguarde ${wait} minuto${wait !== 1 ? 's' : ''} antes de registrar novamente.`;
    }
  }

  // ── Validação GPS — apenas para ENTRADA ────────────────────────────────────
  const empLat     = parseFloat(cfg.lat);
  const empLng     = parseFloat(cfg.lng);
  const raioGps: number   = cfg.raioGps || 80;
  const nivelGps: string  = cfg.nivelGps || 'BASICO';
  const temLocEmpresa     = !isNaN(empLat) && !isNaN(empLng);

  let distanciaMetros: number | null = null;
  let dentroRaio = true;
  let gpsPrecisaoSuspeita = false;

  if (tipo === 'ENTRADA' && temLocEmpresa) {
    distanciaMetros = Math.round(haversineDP(empLat, empLng, lat, lng));
    dentroRaio = distanciaMetros <= raioGps;
    if (distanciaMetros > raioGps * 3) gpsPrecisaoSuspeita = true;
  }
  if (accuracy != null && accuracy < 1) gpsPrecisaoSuspeita = true;

  // Bloqueia ENTRADA fora do raio para RIGIDO/MAXIMO
  if (tipo === 'ENTRADA' && temLocEmpresa && !dentroRaio && (nivelGps === 'RIGIDO' || nivelGps === 'MAXIMO')) {
    return `🚫 Você está fora da área autorizada (${distanciaMetros}m da empresa, raio: ${raioGps}m).\nENTRADA *não* foi registrada.`;
  }

  const marcacao = await (prisma as any).dpMarcacao.create({
    data: {
      empresaId: func.empresaId,
      funcionarioId: func.id,
      tipo,
      canal: 'WHATSAPP',
      lat,
      lng,
      gpsPrecisao: accuracy,
      gpsPrecisaoSuspeita,
      gpsNegado: false,
    },
  });

  const hora = horaFormatadaBRTDp(marcacao.timestamp);

  if (tipo === 'ENTRADA' && !dentroRaio && temLocEmpresa) {
    return `⚠️ *ENTRADA* registrada às ${hora}!\n\n📍 Você está a ${distanciaMetros}m da empresa (raio: ${raioGps}m).\nPonto salvo com alerta para o gestor.`;
  }

  if (tipo === 'ENTRADA') {
    const distStr = distanciaMetros != null ? `📍 A ${distanciaMetros}m da empresa.\n` : '';
    return `✅ *ENTRADA* registrada às ${hora}!\n\n${distStr}Bom trabalho! 💪`;
  }

  // SAIDA — sem validação de raio
  const minutosHoje = calcMinutosDP(
    [...marcacoes, { tipo: 'SAIDA', timestamp: marcacao.timestamp }],
    marcacao.timestamp,
  );
  return `👋 *SAÍDA* registrada às ${hora}!\n\n⏱ Trabalhado hoje: *${fmtMinDP(minutosHoje)}*`;
}

/** Exibe espelho da semana + banco de horas para o funcionário DP. */
export async function handleDpEspelho(from: string, text: string): Promise<string | null> {
  if (!ESPELHO_KEYWORDS.test(text)) return null;

  const func = await resolveWppDpFuncionario(from);
  if (!func) return null;

  const sistema = await (prisma as any).empresaSistema.findFirst({
    where: { empresaId: func.empresaId, sistema: 'data-point', ativo: true },
  });
  if (!sistema) return null;

  const cfg = sistema.config ? JSON.parse(sistema.config as string) : {};
  const cargaHorariaDia = (func.cargaHorariaDia ?? 8) * 60; // minutos

  const now   = new Date();
  const { start: hojStart, end: hojEnd } = getTodayRangeBRT();
  const todayStr = getTodayStrBRT();

  // Início da semana — segunda-feira BRT
  const brtNow     = new Date(now.getTime() - 3 * 3600000);
  const diaSemana  = brtNow.getDay(); // 0=dom,1=seg,...
  const diasAteSegBRT = diaSemana === 0 ? 6 : diaSemana - 1;
  const segStart   = new Date(hojStart.getTime() - diasAteSegBRT * 86400000);

  const todasMarcacoes = await (prisma as any).dpMarcacao.findMany({
    where: {
      funcionarioId: func.id,
      timestamp: { gte: segStart, lte: hojEnd },
    },
    orderBy: { timestamp: 'asc' },
  }) as Array<{ tipo: string; timestamp: Date }>;

  // Gera lista de datas da semana (seg → hoje)
  const dias: string[] = [];
  const cur = new Date(segStart);
  while (cur <= hojStart) {
    const y = cur.getUTCFullYear();
    const mo = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d  = String(cur.getUTCDate()).padStart(2, '0');
    dias.push(`${y}-${mo}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const DIAS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  let totalTrabalhadoMin = 0;
  let totalEsperadoMin   = 0;
  const linhasDias: string[] = [];

  for (const diaStr of dias) {
    const { start: dStart, end: dEnd } = getDateRangeBRT(diaStr);
    const marcsDia = todasMarcacoes.filter(m => m.timestamp >= dStart && m.timestamp <= dEnd);
    const ehHoje = diaStr === todayStr;
    const fimCalc = ehHoje ? now : dEnd;
    const minutos = calcMinutosDP(marcsDia, fimCalc);

    // Data label
    const [, , dd] = diaStr.split('-');
    const [, mm]   = diaStr.split('-');
    const nomeDia  = DIAS_PT[new Date(diaStr + 'T12:00:00').getDay()];
    const label    = `${nomeDia} ${dd}/${mm}`;

    // Primeira entrada e última saída do dia
    const entrada = marcsDia.find(m => m.tipo === 'ENTRADA');
    const saida   = [...marcsDia].reverse().find(m => m.tipo === 'SAIDA');

    if (marcsDia.length === 0) {
      const emoji = ehHoje ? '⏳' : '❌';
      linhasDias.push(`${emoji} ${label}: —`);
    } else if (ehHoje && !saida) {
      linhasDias.push(`🔄 ${label}: ${horaFormatadaBRTDp(entrada!.timestamp)} → em andamento (${fmtMinDP(minutos)})`);
    } else {
      const hE = entrada ? horaFormatadaBRTDp(entrada.timestamp) : '?';
      const hS = saida   ? horaFormatadaBRTDp(saida.timestamp)   : '?';
      linhasDias.push(`✅ ${label}: ${hE}–${hS} (${fmtMinDP(minutos)})`);
    }

    // Dias úteis (seg–sex) contam para banco de horas
    const dow = new Date(diaStr + 'T12:00:00').getDay();
    if (dow !== 0 && dow !== 6) {
      totalTrabalhadoMin += minutos;
      if (!ehHoje) totalEsperadoMin += cargaHorariaDia; // dias passados contam totais
      else totalEsperadoMin += Math.min(minutos, cargaHorariaDia); // hoje: até o que foi trabalhado
    }
  }

  const saldo = totalTrabalhadoMin - totalEsperadoMin;
  const saldoStr = saldo >= 0
    ? `✅ *+${fmtMinDP(saldo)}*`
    : `⚠️ *${fmtMinDP(saldo)}*`;

  return (
    `📋 *ESPELHO DE PONTO — ${func.nome.split(' ')[0]}*\n\n` +
    linhasDias.join('\n') +
    `\n\n📊 *Banco da semana*\n` +
    `Trabalhado: *${fmtMinDP(totalTrabalhadoMin)}* | Esperado: *${fmtMinDP(totalEsperadoMin)}* | Saldo: ${saldoStr}`
  );
}

export async function handleIncomingMessage(
  from: string,
  senderName: string,
  message: string,
): Promise<string> {
  try {
    // ── SELF-ONBOARDING (antes da auth — número ainda não cadastrado) ─────────
    if (/^conectar\s+[A-Z0-9]{6}$/i.test(message.trim())) {
      const resp = await handleConectarPortal(from, message);
      if (resp) return resp;
    }

    // ── MODO OWNER (acesso global, qualquer número, mediante PIN) ─────────────
    const ownerResp = await handleOwnerModeMessage(from, message);
    if (ownerResp !== null) return ownerResp;

    // ── AUTENTICAÇÃO ─────────────────────────────────────────────────────────
    const user = await identifyWhatsAppUser(from);

    if (user.type === 'unknown') {
      return getDeniedAccessMessage(user);
    }

    const command = message.trim().toLowerCase().replace(/\//g, '');

    // ── LAVADOR: empresa implícita ────────────────────────────────────────────
    if (user.type === 'lavador') {
      const empresaId = user.empresaId!;
      const lavadorId = user.lavadorId!;
      const lavFeatures = user.botFeatures ?? DEFAULT_LAVADOR_FEATURES;
      const podeStatus    = lavFeatures.includes('meu_status');
      const podeComissoes = lavFeatures.includes('minhas_comissoes');

      // Step pendente de report tem prioridade
      if (pendingReports.has(from)) return handleReportStep(from, message);

      // Resposta numérica ao menu interativo
      if (pendingLavadorMenu.has(from)) {
        const ctx = pendingLavadorMenu.get(from)!;
        pendingLavadorMenu.delete(from);
        const idx = parseInt(command) - 1;
        const acao = ctx.actions[idx];
        if (acao === 'status')    return handleStatusLavador(ctx.lavadorId, ctx.empresaId);
        if (acao === 'comissoes') return handleComissoesLavador(ctx.lavadorId, ctx.empresaId);
        if (acao === 'link')      return handleLinkLavador(ctx.lavadorId);
        if (acao === 'reportar')  return handleReportarCommand(from, ctx.lavadorId, ctx.empresaId);
        // não reconheceu o número — cai nos handlers normais abaixo
      }

      // Saudação → mini-status + menu numerado
      const isSaudacao = /^(oi|ol[aá]|bom\s*dia|boa\s*tarde|boa\s*noite|e\s*a[ií]|tudo|hey|opa|eae|boa|salve|boas|al[oô])$/i.test(command);
      if (isSaudacao || command === 'ajuda' || command === 'menu')
        return handleSaudacaoLavador(from, lavadorId, empresaId, lavFeatures);

      if (command === 'reportar') return handleReportarCommand(from, lavadorId, empresaId);
      if (command === 'link')     return handleLinkLavador(lavadorId);
      if (['status','meu-status','minhas-comissoes','resumo'].includes(command))
        return podeStatus ? handleStatusLavador(lavadorId, empresaId) : getPermissionDeniedMessage();
      if (['comissoes','comissões','comissão','comissao'].includes(command))
        return podeComissoes ? handleComissoesLavador(lavadorId, empresaId) : getPermissionDeniedMessage();

      const isComissaoAberto = /comiss[aã][eo]s?\s*(em aberto|abertas?|pendentes?)/i.test(message) ||
        /(em aberto|abertas?|pendentes?)\s*(comiss[aã][eo]s?|comiss[oõ]es)/i.test(message);
      if (isComissaoAberto) return podeComissoes ? handleComissoesLavador(lavadorId, empresaId) : getPermissionDeniedMessage();

      const pixMatch = message.trim().match(/^(?:pix|pagamento)(?:\s+ordem)?\s+(\d+)$/i);
      if (pixMatch) return handlePixOrdem(parseInt(pixMatch[1]), empresaId, from, user, false);

      return `Não entendi, não. 😅 Manda *ajuda* pra ver o que eu consigo fazer por você!`;
    }

    // ── FUNCIONÁRIO (subaccount): comandos limitados pela permissão do Role ────
    if (user.type === 'funcionario') {
      const empresaId = user.empresaId!;

      // Step pendente de report tem prioridade
      if (pendingReports.has(from)) return handleReportStep(from, message);

      const isSaudacaoFunc = /^(oi|ol[aá]|bom\s*dia|boa\s*tarde|boa\s*noite|e\s*a[ií]|tudo|hey|opa|eae|boa|salve|boas|al[oô])$/i.test(command);
      if (isSaudacaoFunc || command === 'ajuda' || command === 'menu')
        return handleSaudacaoFuncionario(user);

      // Opção permanente, disponível para todos os funcionários
      if (command === 'reportar')
        return handleReportarCommandFuncionario(from, user.subaccountId!, empresaId, user.nome ?? 'Funcionário');

      const feature = COMMAND_PERMISSION_MAP[command];
      if (feature && !hasPermission(user, feature)) return getPermissionDeniedMessage();

      if (['resumo', 'resumo do dia', 'resumo diario', 'resumo diário'].includes(command))
        return handleResumoCommand(empresaId);
      if (['caixa', 'status caixa'].includes(command))
        return handleCaixaCommand(empresaId);
      if (['ordens', 'ordens paradas', 'ordens em andamento'].includes(command))
        return handleOrdensAtivas(empresaId, user);
      if (['clientes', 'clientes hoje'].includes(command))
        return handleClientesCommand(empresaId);
      if (['funcionarios', 'funcionários', 'equipe', 'lavadores'].includes(command))
        return handleLavadoresCommand(empresaId);

      return `Não entendi, não. 😅 Manda *ajuda* pra ver o que eu consigo fazer por você!`;
    }

    // ── ADMIN: pendências com prioridade (não dependem de empresa ativa) ────────
    // Devem ser verificadas ANTES da resolução de empresa para evitar que
    // respostas numéricas (ex: "1") sejam capturadas pelo menu de seleção de empresa.

    // Report de avaria — admin respondendo à notificação (1 = ver fotos / 2 = ignorar)
    if (hasPendingAdminReportView(from) && (command === '1' || command === '2')) {
      return handleAdminReportResponse(from, command);
    }

    // Report de avaria — admin navegando lista de reports
    if (hasPendingReportsList(from)) {
      const r = await handleReportsListSelection(from, command);
      if (r !== '') return r;
    }

    // Fluxo de saída/despesa em andamento (empresaId está dentro do struct)
    if (pendingSaidas.has(from)) {
      return handlePendingSaidaStep(message, from, senderName);
    }

    // Menu de notificações individuais (empresaId está dentro do Map)
    if (pendingNotifMenu.has(from)) {
      return handleNotifMenuStep(from, pendingNotifMenu.get(from)!, command);
    }

    // Detectar saudação simples — usada para evitar menu de empresa e contexto desnecessário
    const isSaudacao = /^(oi|ol[aá]|bom\s*dia|boa\s*tarde|boa\s*noite|e\s*a[ií]|tudo\s*bem|ol[aá]\s*lina|oi\s*lina|hey|opa|eae|boa|sauda[çc][aã]o|sauda[çc][oõ]es|salve|oi\s*gente|oi\s*pessoal|boas|al[oô])$/i.test(command);

    if (isSaudacao) {
      const r = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

      if (/bom\s*dia/i.test(command)) return r([
        'Olá, bom dia! 😊 tudo bem? como posso ajudar?',
        'Bom dia! tudo certo? no que posso te ajudar hoje?',
        'Olá, bom dia! que bom te ver por aqui. como posso ajudar?',
        'Bom dia! tudo bem? pode falar, tô aqui pra ajudar.',
      ]);

      if (/boa\s*tarde/i.test(command)) return r([
        'Olá, boa tarde! 😊 como posso te ajudar?',
        'Boa tarde! tudo bem? no que posso ajudar?',
        'Olá, boa tarde! que bom te ver. como posso ajudar?',
      ]);

      if (/boa\s*noite/i.test(command)) return r([
        'Olá, boa noite! 😊 como posso te ajudar?',
        'Boa noite! tudo bem? no que posso ajudar?',
        'Olá, boa noite! pode falar, tô aqui.',
      ]);

      return r([
        'Olá! 😊 como posso te ajudar?',
        'Olá, tudo bem? no que posso ajudar?',
        'Oi! que bom te ver. como posso te ajudar hoje?',
        'Olá! tô aqui, pode falar.',
        'Oi! tudo certo? como posso ajudar?',
        'Olá! no que posso te ajudar?',
        'Oi, tudo bem? pode falar, tô à disposição.',
      ]);
    }

    // ── ADMIN: resolver empresa pelo contexto ─────────────────────────────────
    const empresas = user.empresas ?? [];

    // "detalhes N" — resposta ao resumo diário de admin com múltiplas empresas
    // (o N corresponde à posição da empresa em `empresas`, ordenadas por nome — mesma ordem usada no cron)
    const detalhesMatch = command.match(/^detalhes?\s*(\d+)$/);
    if (detalhesMatch && empresas.length > 1) {
      const idx = parseInt(detalhesMatch[1]) - 1;
      if (idx >= 0 && idx < empresas.length) return handleRelatorioData(new Date(), empresas[idx].id);
      return `❌ Empresa inválida. Digite *detalhes 1* a *detalhes ${empresas.length}*.`;
    }

    // "trocar para [nome]" → troca direta sem mostrar menu
    const trocarParaMatch = message.match(/(?:trocar?|mudar|ir)\s+(?:para|pra|p\/|pro?)\s+(.+)/i);
    if (trocarParaMatch) {
      const alvo = detectEmpresaNoTexto(trocarParaMatch[1].trim(), empresas);
      if (alvo) {
        setContext(from, alvo.id, alvo.nome);
        return `✅ Empresa alterada para *${alvo.nome}*.`;
      }
    }

    // "trocar empresa / mudar empresa" → abre menu de seleção
    if (/trocar?\s*(?:de\s*)?empresa|mudar\s*(?:de\s*)?empresa|trocar\s*contexto|mudar\s*contexto|\btrocar\b|\bmudar\b/i.test(message)) {
      clearContext(from);
      if (empresas.length === 1) {
        setContext(from, empresas[0].id, empresas[0].nome);
        return `ℹ️ Você só tem uma empresa: *${empresas[0].nome}*.`;
      }
      return buildEmpresaMenu(empresas, '🔄 Qual empresa você quer gerenciar?');
    }

    // ── MULTI-EMPRESA: "resumo das duas", "relatório de todas", etc. ──────────
    const isMultiEmpresaRequest = empresas.length > 1 &&
      /\b(das?\s+duas?|de\s+todas?|ambas?|as\s+duas?|todas?\s+(?:as\s+)?empresas?|os\s+dois|todo[as]?\s*mundo|ambas?\s+empresas?)\b/i.test(message);

    if (isMultiEmpresaRequest) {
      const rangeM  = parseDateRangeFromMessage(message);
      const dateM   = parseDateFromMessage(message);
      const isCaixa = /\bcaixa\b/.test(command);
      const isLavs  = /\blavadores?\b/.test(command);

      const blocos = await Promise.all(empresas.map(async e => {
        let r: string;
        if (rangeM)       r = await handleRelatorioPeriodo(rangeM.inicio, rangeM.fim, e.id);
        else if (dateM)   r = await handleRelatorioData(dateM, e.id);
        else if (isCaixa) r = await handleCaixaCommand(e.id);
        else if (isLavs)  r = await handleLavadoresCommand(e.id);
        else              r = await handleResumoCommand(e.id);
        return `━━ *${e.nome}* ━━\n${r}`;
      }));

      return blocos.join('\n\n');
    }

    // Detectar empresa pelo nome na mensagem (shortcut tipo "dados da Empresa X")
    const empresaDetectada = detectEmpresaNoTexto(message, empresas);
    if (empresaDetectada) {
      setContext(from, empresaDetectada.id, empresaDetectada.nome);
    }

    // Verificar contexto ativo
    let ctx = getContext(from);

    // Admin com 1 empresa → contexto automático sem menu
    if (!ctx && empresas.length === 1) {
      setContext(from, empresas[0].id, empresas[0].nome);
      ctx = getContext(from)!;
    }

    // Admin com múltiplas empresas sem contexto → pede seleção com mini-dica
    if (!ctx && empresas.length > 1) {
      const escolha = parseInt(command);
      if (!isNaN(escolha) && escolha >= 1 && escolha <= empresas.length) {
        const escolhida = empresas[escolha - 1];
        setContext(from, escolhida.id, escolhida.nome);

        // Se havia comando pendente, executa-o após conectar na empresa
        const pendingMsg = pendingCommands.get(from);
        pendingCommands.delete(from);

        if (pendingMsg) {
          const resultado = await handleIncomingMessage(from, senderName, pendingMsg);
          return `✅ *${escolhida.nome}* selecionada.\n\n${resultado}`;
        }

        return `✅ *${escolhida.nome}*\nDigite *ajuda* para ver o que posso fazer.`;
      } else {
        pendingCommands.set(from, message);
        return buildEmpresaMenu(empresas, `Qual empresa você quer consultar?\n\n_Dica: "resumo das duas" para ver todas juntas_`);
      }
    }

    if (!ctx) return '❌ Nenhuma empresa disponível para este usuário.';

    const empresaId   = ctx.empresaId;
    const empresaNome = ctx.empresaNome;

    // ── Comandos do admin com empresa resolvida ───────────────────────────────
    // "saídas ..." — verificar ANTES do isRelatorioRequest para "saídas da semana" não ser capturado por "semana"
    if (/^sa[íi]das?(\s|$)/i.test(message)) {
      const range = parseDateRangeFromMessage(message);
      if (range) return handleSaidasDetalhadas(range.inicio, range.fim, empresaId);
      const date = parseDateFromMessage(message);
      if (date) {
        const ini = new Date(date); ini.setHours(0,0,0,0);
        const fim = new Date(date); fim.setHours(23,59,59,999);
        return handleSaidasDetalhadas(ini, fim, empresaId);
      }
      const hoje = new Date(); hoje.setHours(0,0,0,0);
      const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1);
      return handleSaidasDetalhadas(hoje, amanha, empresaId);
    }

    const isRelatorioRequest = /resumo|relat[oó]rio|detalhe|semanal|semana/.test(command);
    if (isRelatorioRequest || /^ontem$/.test(command)) {
      const range = parseDateRangeFromMessage(message);
      if (range) return handleRelatorioPeriodo(range.inicio, range.fim, empresaId);
      const date  = parseDateFromMessage(message);
      if (date)  return handleRelatorioData(date, empresaId);
      if (/\b(mais\s+)?detalhes?\b/.test(command)) return handleRelatorioData(new Date(), empresaId);
    }

    const isComissaoAberto = /comiss[aã][eo]s?\s*(em aberto|abertas?|pendentes?)/i.test(message) ||
      /(em aberto|abertas?|pendentes?)\s*(comiss[aã][eo]s?|comiss[oõ]es)/i.test(message);
    if (isComissaoAberto) {
      return handleComissoesEmAberto(extrairNomeLavador(message), empresaId);
    }

    // "comissão [nome]" — acesso rápido por lavador
    const comissaoNomeMatch = message.match(/^comiss[aã][eo](?:s)?\s+(?:do?\s+|da?\s+)?(.+)$/i);
    if (comissaoNomeMatch) {
      return handleComissoesEmAberto(comissaoNomeMatch[1].trim().toLowerCase(), empresaId);
    }

    // "vale [nome]" ou "vales [nome]"
    const valeMatch = message.match(/^vales?\s+(?:do?\s+|da?\s+)?(.+)$/i);
    if (valeMatch) {
      return handleValesLavador(valeMatch[1].trim().toLowerCase(), empresaId);
    }


    if (/^notifica[çc]([aã]o|[oõ]es?)$|^notifs?$/.test(command)) {
      pendingNotifMenu.set(from, empresaId);
      return buildNotifMenuText(from, empresaId);
    }

    const isReports = (
      command === 'reports' ||
      /\bavarias?\b/i.test(message) ||
      /\breports?\b/i.test(message) ||
      /\bver\s+(?:as\s+)?fotos?\b/i.test(message) ||
      /\bfotos?\s+(?:de\s+)?avarias?\b/i.test(message) ||
      /\breports?\s+(?:de\s+)?avarias?\b/i.test(message) ||
      /\breport(?:es)?\s+pendentes?\b/i.test(message) ||
      /\bver\s+(?:os\s+)?reports?\b/i.test(message) ||
      /\btem\s+(?:algum\s+)?report\b/i.test(message) ||
      /\bver\s+avarias?\b/i.test(message)
    );
    if (isReports) return handleReportsCommand(from, empresaId);

    // Detectar intenção de lançar despesa — padrões claros apenas
    // Evita falsos positivos como "saída do caixa de ontem" ou "ver saída"
    const isSaida = (
      /^(sa[íi]da|despesa|gasto|desp)$/i.test(command) ||                                         // comando exato
      /\b(sa[íi]da|despesa)\s+[\d,\.]/i.test(message) ||                                          // "saída 50", "despesa 120,50"
      /\b(gastei|paguei|comprei)\b/i.test(message) ||                                             // verbos de gasto
      /\b(nova\s+sa[íi]da|lan[çc]ar\s+sa[íi]da|lan[çc]ar\s+despesa|registrar?\s+(sa[íi]da|despesa))\b/i.test(message) ||
      /\badiantamento\s+(?:de\s+)?[\d,\.]/i.test(message) ||                                      // "adiantamento de 200"
      /\b(sa[íi]da|despesa)\s+d[eo]\s+\w/i.test(message)                                          // "saída de gasolina"
    );
    if (isSaida) return handleSaidaWhatsapp(message, from, senderName, empresaId);

    if (command === 'ordens')    return handleOrdensAtivas(empresaId, user);
    if (command === 'resumo')    return handleResumoCommand(empresaId);
    if (command === 'lavadores') return handleLavadoresCommand(empresaId);
    if (command === 'caixa')     return handleCaixaCommand(empresaId);
    if (command === 'pendentes') return handlePendentesCommand(empresaId);
    if (command === 'patio' || command === 'pátio') return handlePatioCommand(empresaId);
    if (command === 'ajuda')     return handleAjudaCommand();
    if (command === 'empresa')   return `📍 *${empresaNome}*\n_Envie "trocar empresa" para mudar._`;

    // Fechamento de caixa
    const isFechamento = /\bfechamento\b|\bfechament[oa]\b|\babertura\b/i.test(message);
    if (isFechamento) {
      const dataFech = parseDateFromMessage(message) ?? new Date();
      return handleFechamentoCaixa(empresaId, dataFech);
    }

    const pixMatch = message.trim().match(/^(?:pix|pagamento)(?:\s+ordem)?\s+(\d+)$/i);
    if (pixMatch) return handlePixOrdem(parseInt(pixMatch[1]), empresaId, from, user, false);

    const reenviarMatch = message.trim().match(/^reenviar\s+pix(?:\s+ordem)?\s+(\d+)$/i);
    if (reenviarMatch) return handlePixOrdem(parseInt(reenviarMatch[1]), empresaId, from, user, true);

    // Consulta conversacional sobre lavador ("como tá o Felipe?", "como anda o João?")
    // → passa dados pro Groq para resposta pessoal e descontraída
    const isConversacionalLavador = /\b(como\s+(est[aá]|t[aá]|anda|vai|foi|est[aá]\s+indo|t[aá]\s+indo)|e\s+o\s+\w|e\s+a\s+\w|t[aá]\s+indo\s+bem)\b/i.test(message);

    if (isConversacionalLavador) {
      const ctxLavador = await buildContextLavadorConversacional(message, empresaId);
      if (ctxLavador) return chatCompletion(message, ctxLavador);
    }

    const lavadorResponse = await handleLavadorEspecifico(message, empresaId);
    if (lavadorResponse) return lavadorResponse;

    // Só constrói o contexto pesado quando vai para a IA
    let dailyContext = await buildDailyContext(empresaId);

    // Se a mensagem menciona uma data passada específica, enriquecer o contexto com dados daquele dia
    const dataReferenciada = parseDateFromMessage(message);
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    if (dataReferenciada && dataReferenciada < hoje) {
      const ctxExtra = await buildContextForDate(empresaId, dataReferenciada);
      dailyContext += ctxExtra;
    }

    return chatCompletion(message, dailyContext);

  } catch (error) {
    console.error('[WhatsApp] Erro ao processar mensagem:', error);
    return '❌ Desculpe, ocorreu um erro. Tente novamente.';
  }
}

const NUM_EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

function buildEmpresaMenu(empresas: Array<{ id: string; nome: string }>, header: string): string {
  const lista = empresas.map((e, i) => `${NUM_EMOJIS[i] ?? `${i+1}.`} *${e.nome}*`).join('\n');
  return `${header}\n\n${lista}\n\n_Responda com o número._`;
}

// ==========================================
// PARSING DE DATA
// ==========================================

const DIAS_SEMANA = ['domingo','segunda','terça','quarta','quinta','sexta','sábado','sabado','terca'];

function parseDateFromMessage(message: string): Date | null {
  const msg = message.toLowerCase();

  if (/antes\s+de\s+ontem|anteontem/i.test(msg)) {
    const d = new Date(); d.setDate(d.getDate() - 2); d.setHours(0,0,0,0); return d;
  }
  if (/\bontem\b/.test(msg)) {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0); return d;
  }
  if (/\bhoje\b/.test(msg)) {
    const d = new Date(); d.setHours(0,0,0,0); return d;
  }

  // Dia da semana passado: "sábado passado", "última sexta", "segunda passada", etc.
  const diasMap: Record<string, number> = {
    'domingo': 0, 'segunda': 1, 'terca': 2, 'quarta': 3,
    'quinta': 4, 'sexta': 5, 'sabado': 6,
  };
  const diaPassadoMatch = msg.match(
    /\b(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)\b.{0,25}?\b(passad[oa]|[uú]ltim[oa])\b|\b([uú]ltim[oa])\b.{0,15}?\b(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)\b/i
  );
  if (diaPassadoMatch) {
    const diaRaw = (diaPassadoMatch[1] || diaPassadoMatch[4] || '')
      .toLowerCase().replace(/[áà]/g, 'a').replace(/ç/g, 'c').replace(/ã/g, 'a');
    const targetDay = diasMap[diaRaw];
    if (targetDay !== undefined) {
      const currentDay = new Date().getDay();
      let daysBack = currentDay - targetDay;
      if (daysBack <= 0) daysBack += 7;
      const d = new Date(); d.setDate(d.getDate() - daysBack); d.setHours(0,0,0,0);
      return d;
    }
  }

  // dd/mm ou dd/mm/yy ou dd/mm/yyyy
  const m = msg.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    const day = parseInt(m[1]);
    const month = parseInt(m[2]) - 1;
    const rawYear = m[3];
    const year = rawYear
      ? (rawYear.length === 2 ? 2000 + parseInt(rawYear) : parseInt(rawYear))
      : new Date().getFullYear();
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) { d.setHours(0,0,0,0); return d; }
  }

  return null;
}

/**
 * Extrai intervalo de datas da mensagem para relatórios de período.
 * Suporta: "do dia 10/01 ao dia 15/01", "de 10/01 a 15/01",
 *          "semanal", "da semana", "últimos 7 dias", "últimos N dias"
 */
function parseDateRangeFromMessage(message: string): { inicio: Date; fim: Date } | null {
  const msg = message.toLowerCase();

  // Semanal / últimos 7 dias / esta semana
  if (/semanal|[uú]ltimos\s+7\s+dias|\besta\s+semana\b|\bda\s+semana\b/.test(msg)) {
    const fim = new Date(); fim.setHours(23, 59, 59, 999);
    const inicio = new Date(); inicio.setDate(inicio.getDate() - 6); inicio.setHours(0, 0, 0, 0);
    return { inicio, fim };
  }

  // Últimos N dias (ex: "últimos 10 dias")
  const nDiasMatch = msg.match(/[uú]ltimos\s+(\d+)\s+dias/);
  if (nDiasMatch) {
    const n = parseInt(nDiasMatch[1]);
    if (n >= 2 && n <= 365) {
      const fim = new Date(); fim.setHours(23, 59, 59, 999);
      const inicio = new Date(); inicio.setDate(inicio.getDate() - (n - 1)); inicio.setHours(0, 0, 0, 0);
      return { inicio, fim };
    }
  }

  // Duas datas: "10/01 ao 15/01", "de 10/01 a 15/01", "do dia 10/01 até 15/01"
  const twoDateMatch = msg.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)[\s\S]{0,20}?(?:\bao?\b|\baté\b|\ba\b)[\s\S]{0,10}?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
  if (twoDateMatch) {
    const parseSingle = (s: string): Date | null => {
      const parts = s.split('/');
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      const rawYear = parts[2];
      const year = rawYear
        ? (rawYear.length === 2 ? 2000 + parseInt(rawYear) : parseInt(rawYear))
        : new Date().getFullYear();
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
    };
    const d1 = parseSingle(twoDateMatch[1]);
    const d2 = parseSingle(twoDateMatch[2]);
    if (d1 && d2 && d1 <= d2) {
      d1.setHours(0, 0, 0, 0);
      d2.setHours(23, 59, 59, 999);
      return { inicio: d1, fim: d2 };
    }
  }

  return null;
}

function extrairNomeLavador(message: string): string | null {
  // "comissão em aberto do carlos" → "carlos"
  const m = message.match(/\b(?:do|da|de)\s+([a-záéíóúâêîôûãõç]+(?:\s+[a-záéíóúâêîôûãõç]+)?)/i);
  if (m) {
    const nome = m[1].toLowerCase();
    // Ignorar palavras que não são nomes
    if (!['comissao','comissão','aberto','abertas','mes','dia','hoje'].includes(nome)) {
      return nome;
    }
  }
  return null;
}

function nomeDiaSemana(date: Date): string {
  return ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][date.getDay()];
}

function formatarMetodo(metodo: string): string {
  const map: Record<string, string> = {
    PIX: 'PIX', DINHEIRO: 'DINHEIRO', CARTAO: 'CARTÃO',
    CARTAO_CREDITO: 'CARTÃO CRÉDITO', CARTAO_DEBITO: 'CARTÃO DÉBITO',
    NFE: 'NFE/FROTA', OUTRO: 'OUTRO', PENDENTE: 'PENDENTE',
    DEBITO_FUNCIONARIO: 'DÉB. FUNCIONÁRIO',
  };
  return map[metodo] ?? metodo;
}

// ==========================================
// RELATÓRIO DETALHADO DE UM DIA
// ==========================================

async function handleRelatorioData(date: Date, empresaId: string): Promise<string> {
  // Janela fixa 07:00–23:59 BRT da data solicitada
  const dateStr = new Date(date.getTime() - 3 * 3600000).toISOString().split('T')[0];
  const { start: inicio, end: fim } = getFixedDayRangeBRT(dateStr);

  const ordens = await prisma.ordemServico.findMany({
    where: { empresaId, status: 'FINALIZADO' as any, dataFim: { gte: inicio, lte: fim } },
    include: {
      veiculo:  { select: { modelo: true } },
      lavador:  { select: { nome: true, comissao: true } },
      ordemLavadores: { include: { lavador: { select: { nome: true, comissao: true } } } },
      pagamentos: { select: { metodo: true, valor: true, status: true } },
    },
    orderBy: { dataFim: 'asc' },
  });

  if (ordens.length === 0) {
    return `📋 Sem ordens registradas em ${inicio.toLocaleDateString('pt-BR')}.`;
  }

  const dataFmt = inicio.toLocaleDateString('pt-BR');
  const diaSemana = nomeDiaSemana(inicio);

  // Linha por ordem
  let linhas = '';
  for (const o of ordens) {
    const modelo = o.veiculo.modelo ?? 'Veículo';
    const pagMethods = o.pagamentos.length > 0
      ? o.pagamentos.map(p => formatarMetodo(p.metodo)).join('/')
      : 'PENDENTE';
    linhas += `${modelo.toUpperCase()}: R$ ${o.valorTotal.toFixed(2)} · *${pagMethods}*\n`;
  }

  const total = ordens.reduce((s, o) => s + o.valorTotal, 0);

  // Totais por método de pagamento
  const porMetodo: Record<string, number> = {};
  for (const o of ordens) {
    if (o.pagamentos.length === 0) {
      porMetodo['PENDENTE'] = (porMetodo['PENDENTE'] ?? 0) + o.valorTotal;
    } else {
      for (const p of o.pagamentos) {
        const m = formatarMetodo(p.metodo);
        porMetodo[m] = (porMetodo[m] ?? 0) + p.valor;
      }
    }
  }
  const pagamentosFmt = Object.entries(porMetodo)
    .map(([m, v]) => `${m}: *R$ ${v.toFixed(2)}*`)
    .join('\n');

  // Comissões por lavador — usa OrdemServicoLavador.ganho (já divide multi-lavador)
  const comissoesPorLavador: Record<string, { taxa: number; total: number; itens: string[] }> = {};
  for (const o of ordens) {
    const modelo = (o.veiculo.modelo ?? 'Veículo').toUpperCase();
    if (o.ordemLavadores.length > 0) {
      for (const ol of o.ordemLavadores) {
        const nome = ol.lavador.nome;
        if (!comissoesPorLavador[nome]) comissoesPorLavador[nome] = { taxa: ol.lavador.comissao, total: 0, itens: [] };
        comissoesPorLavador[nome].total += ol.ganho;
        comissoesPorLavador[nome].itens.push(`${modelo}: *${ol.ganho.toFixed(2)}*`);
      }
    } else if (o.lavador) {
      const nome = o.lavador.nome;
      const comValor = (o as any).comissao ?? 0;
      if (!comissoesPorLavador[nome]) comissoesPorLavador[nome] = { taxa: o.lavador.comissao, total: 0, itens: [] };
      comissoesPorLavador[nome].total += comValor;
      comissoesPorLavador[nome].itens.push(`${modelo}: *${comValor.toFixed(2)}*`);
    }
  }

  let comissoesFmt = '';
  for (const [nome, dados] of Object.entries(comissoesPorLavador)) {
    comissoesFmt += `\n*${nome.toUpperCase()}*: *R$ ${dados.total.toFixed(2)}*\n`;
    comissoesFmt += `(${dados.itens.join(' + ')})\n`;
  }

  return `📋 *RELATÓRIO DE SERVIÇOS*\n` +
    `_${dataFmt} - ${diaSemana}_\n\n` +
    `${linhas}\n` +
    `TOTAL: *R$ ${total.toFixed(2)}* | *${ordens.length}* lavagem(ns)\n\n` +
    `📊 PAGAMENTOS:\n${pagamentosFmt}\n\n` +
    `👷 COMISSÕES (por serviço):\n${comissoesFmt}`;
}

// ==========================================
// RELATÓRIO DE PERÍODO (vários dias)
// ==========================================

async function handleRelatorioPeriodo(inicio: Date, fim: Date, empresaId: string): Promise<string> {
  // Âncora: dataFim (quando o serviço foi concluído) — só ordens FINALIZADAS
  const ordens = await prisma.ordemServico.findMany({
    where: { empresaId, status: 'FINALIZADO' as any, dataFim: { gte: inicio, lte: fim } },
    include: {
      veiculo:  { select: { modelo: true } },
      lavador:  { select: { nome: true, comissao: true } },
      ordemLavadores: { include: { lavador: { select: { nome: true, comissao: true } } } },
      pagamentos: { select: { metodo: true, valor: true } },
    },
    orderBy: { dataFim: 'asc' },
  });

  const iniciofmt = inicio.toLocaleDateString('pt-BR');
  const fimfmt    = fim.toLocaleDateString('pt-BR');
  const diasCount = Math.round((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const titulo    = iniciofmt === fimfmt ? `*${iniciofmt}*` : `*${iniciofmt} a ${fimfmt}* (${diasCount} dias)`;

  if (ordens.length === 0) {
    return `📋 Sem ordens finalizadas de ${iniciofmt} a ${fimfmt}.`;
  }

  // Agrupamento por dia de finalização (dataFim em BRT)
  const porDia = new Map<string, { date: Date; ordens: typeof ordens; total: number }>();
  for (const o of ordens) {
    const dataRef = o.dataFim ?? o.createdAt;
    const chave = dataRef.toLocaleDateString('pt-BR');
    if (!porDia.has(chave)) porDia.set(chave, { date: dataRef, ordens: [], total: 0 });
    const d = porDia.get(chave)!;
    d.ordens.push(o);
    d.total += o.valorTotal;
  }

  // Abreviações de dia da semana
  const DIA_ABREV = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  // Cabeçalho
  let r = `📊 RELATÓRIO DO PERÍODO\n${titulo}\n\n`;

  // Breakdown por dia
  r += `📅 POR DIA:\n`;
  for (const [chave, d] of porDia) {
    const abrev = DIA_ABREV[d.date.getDay()];
    r += `${chave} (${abrev}): *R$ ${d.total.toFixed(2)}* | ${d.ordens.length} lavagem(ns)\n`;
  }

  // Totais gerais
  const totalFat    = ordens.reduce((s, o) => s + o.valorTotal, 0);
  const totalOrdens = ordens.length;
  r += `\nTOTAL: *R$ ${totalFat.toFixed(2)}* | *${totalOrdens}* lavagem(ns)\n`;

  // Faturamento por método de pagamento
  const porMetodo: Record<string, number> = {};
  for (const o of ordens) {
    if (o.pagamentos.length === 0) {
      porMetodo['PENDENTE'] = (porMetodo['PENDENTE'] ?? 0) + o.valorTotal;
    } else {
      for (const p of o.pagamentos) {
        const m = formatarMetodo(p.metodo);
        porMetodo[m] = (porMetodo[m] ?? 0) + p.valor;
      }
    }
  }
  r += `\n💳 PAGAMENTOS:\n`;
  r += Object.entries(porMetodo).map(([m, v]) => `${m}: *R$ ${v.toFixed(2)}*`).join('\n');

  // Saídas de caixa no período
  const saidas = await prisma.caixaRegistro.findMany({
    where: { empresaId, tipo: 'SAIDA', data: { gte: inicio, lte: fim } },
    orderBy: { data: 'asc' },
  });
  const totalSaidas = saidas.reduce((s, c) => s + c.valor, 0);
  if (totalSaidas > 0) {
    r += `\n\n💸 SAÍDAS DE CAIXA: *R$ ${totalSaidas.toFixed(2)}*`;
    // Listar saídas se forem poucas
    if (saidas.length <= 6) {
      for (const s of saidas) {
        r += `\n  ${s.descricao}: *R$ ${s.valor.toFixed(2)}*`;
      }
    } else {
      r += ` (${saidas.length} lançamentos)`;
    }
  }

  // Lucro líquido estimado
  const lucro = totalFat - totalSaidas;
  r += `\n\n💰 LUCRO ESTIMADO: *R$ ${lucro.toFixed(2)}*`;

  // Comissões totais por lavador — usa OrdemServicoLavador.ganho (já divide multi-lavador)
  const comissoesPorLavador: Record<string, { taxa: number; total: number }> = {};
  for (const o of ordens) {
    if (o.ordemLavadores.length > 0) {
      for (const ol of o.ordemLavadores) {
        const nome = ol.lavador.nome;
        if (!comissoesPorLavador[nome]) comissoesPorLavador[nome] = { taxa: ol.lavador.comissao, total: 0 };
        comissoesPorLavador[nome].total += ol.ganho;
      }
    } else if (o.lavador) {
      const nome = o.lavador.nome;
      if (!comissoesPorLavador[nome]) comissoesPorLavador[nome] = { taxa: o.lavador.comissao, total: 0 };
      comissoesPorLavador[nome].total += (o as any).comissao ?? 0;
    }
  }

  if (Object.keys(comissoesPorLavador).length > 0) {
    r += `\n\n👷 COMISSÕES DO PERÍODO:\n`;
    for (const [nome, dados] of Object.entries(comissoesPorLavador)) {
      r += `*${nome.toUpperCase()}* (${dados.taxa}%): *R$ ${dados.total.toFixed(2)}*\n`;
    }
    const totalComissoes = Object.values(comissoesPorLavador).reduce((s, d) => s + d.total, 0);
    r += `Total: *R$ ${totalComissoes.toFixed(2)}*`;
  }

  return r.trim();
}

// ==========================================
// SAÍDAS DETALHADAS
// ==========================================

async function handleSaidasDetalhadas(inicio: Date, fim: Date, empresaId: string): Promise<string> {
  const saidas = await prisma.caixaRegistro.findMany({
    where: {
      empresaId,
      tipo: 'SAIDA',
      data: { gte: inicio, lte: fim },
      // Excluir vales (adiantamentos) — registros vinculados a um Adiantamento
      adiantamento: null,
      // Excluir por descrição padrão de vale/comissão como fallback
      NOT: [
        { descricao: { startsWith: 'Adiantamento' } },
        { descricao: { startsWith: 'Comissão' } },
        { descricao: { startsWith: 'Comissao' } },
      ],
    },
    orderBy: { data: 'asc' },
  });

  const iniciofmt = inicio.toLocaleDateString('pt-BR');
  const fimfmt    = fim.toLocaleDateString('pt-BR');
  const titulo    = iniciofmt === fimfmt ? `_${iniciofmt}_` : `_${iniciofmt} a ${fimfmt}_`;

  if (saidas.length === 0) return `💸 *SAÍDAS*\n${titulo}\n\nNenhuma saída registrada.`;

  let r = `💸 *SAÍDAS*\n${titulo}\n\n`;
  for (const s of saidas) {
    const data = s.data.toLocaleDateString('pt-BR');
    const dataLabel = iniciofmt !== fimfmt ? `${data} · ` : '';
    r += `• ${dataLabel}${s.descricao}: *R$ ${s.valor.toFixed(2)}*\n`;
  }
  const total = saidas.reduce((acc, s) => acc + s.valor, 0);
  r += `\nTotal: *R$ ${total.toFixed(2)}* (${saidas.length} lançamento(s))`;
  return r.trim();
}

// ==========================================
// VALES EM ABERTO POR LAVADOR
// ==========================================

async function handleValesLavador(nomeLavador: string, empresaId: string): Promise<string> {
  const lavadores = await prisma.lavador.findMany({ where: { empresaId, ativo: true } });
  const lav = lavadores.find(l =>
    l.nome.toLowerCase().includes(nomeLavador) ||
    nomeLavador.includes(l.nome.toLowerCase())
  );
  if (!lav) return `❌ Lavador "${nomeLavador}" não encontrado.`;

  const vales = await (prisma.adiantamento as any).findMany({
    where: { lavadorId: lav.id, status: 'PENDENTE' },
    include: { caixaRegistro: { select: { descricao: true } } },
    orderBy: { data: 'asc' },
  });

  if (vales.length === 0) return `✅ *${lav.nome}* não tem vales em aberto.`;

  let r = `💵 *VALES EM ABERTO — ${lav.nome.toUpperCase()}*\n\n`;
  for (const v of vales) {
    const descricaoCaixa = v.caixaRegistro?.descricao ?? '';
    const partes = descricaoCaixa.split(' — ');
    const desc = partes.length > 1 ? partes[1] : (v.descricao ?? 'Vale');
    const data = new Date(v.data).toLocaleDateString('pt-BR');
    r += `• ${data} · ${desc}: *R$ ${v.valor.toFixed(2)}*\n`;
  }
  const total = vales.reduce((acc: number, v: any) => acc + v.valor, 0);
  r += `\nTotal em aberto: *R$ ${total.toFixed(2)}* (${vales.length} vale(s))`;
  return r.trim();
}

// ==========================================
// COMISSÕES EM ABERTO
// ==========================================

async function handleComissoesEmAberto(
  nomeLavador: string | null,
  empresaId: string
): Promise<string> {
  const lavadores = await prisma.lavador.findMany({
    where: { empresaId, ativo: true },
  });

  // Filtrar lavador se nome foi fornecido
  const lavadoresFiltrados = nomeLavador
    ? lavadores.filter(l =>
        l.nome.toLowerCase().includes(nomeLavador) ||
        nomeLavador.includes(l.nome.toLowerCase())
      )
    : lavadores;

  if (lavadoresFiltrados.length === 0) {
    return `❌ Lavador não encontrado: "${nomeLavador}".`;
  }

  let resultado = nomeLavador
    ? ''
    : `💰 COMISSÕES EM ABERTO\n\n`;

  for (const lav of lavadoresFiltrados) {
    // Ordens finalizadas sem fechamento de comissão
    const ordens = await prisma.ordemServico.findMany({
      where: {
        empresaId,
        status: 'FINALIZADO',
        OR: [
          // Lavador principal sem fechamento
          { lavadorId: lav.id, fechamentoComissaoId: null },
          // Multi-lavador: entrada na tabela pivot sem fechamento
          {
            ordemLavadores: {
              some: { lavadorId: lav.id, fechamentoComissaoId: null },
            },
          },
        ],
      },
      include: {
        veiculo: { select: { modelo: true } },
        ordemLavadores: { where: { lavadorId: lav.id }, select: { ganho: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (ordens.length === 0) {
      resultado += `✅ *${lav.nome.toUpperCase()}*: sem comissões em aberto.\n\n`;
      continue;
    }

    const getGanho = (o: any) => {
      const ol = o.ordemLavadores?.[0];
      return ol ? ol.ganho : (o.comissao ?? 0);
    };
    const totalCom = ordens.reduce((s, o) => s + getGanho(o), 0);

    // Adiantamentos pendentes desse lavador
    const adiantamentos = await prisma.adiantamento.findMany({
      where: { lavadorId: lav.id, status: 'PENDENTE' },
    });
    const totalAdiant = adiantamentos.reduce((s, a) => s + a.valor, 0);
    const comLiquida = totalCom - totalAdiant;

    // Agrupar por mês
    const porMes: Record<string, number> = {};
    for (const o of ordens) {
      const mes = o.createdAt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      porMes[mes] = (porMes[mes] ?? 0) + getGanho(o);
    }
    const porMesFmt = Object.entries(porMes)
      .map(([m, v]) => `  *${m}*: *R$ ${v.toFixed(2)}*`)
      .join('\n');

    // Comparação com mês anterior (quando consultando lavador específico)
    let comparacaoFmt = '';
    if (nomeLavador) {
      const hoje = new Date();
      const inicioMesAtual  = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const inicioMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      const fimMesAnterior    = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59);
      const lavInclude = { ordemLavadores: { where: { lavadorId: lav.id }, select: { ganho: true } } };
      const [ordensAtual, ordensAnterior] = await Promise.all([
        prisma.ordemServico.findMany({
          where: { empresaId, status: 'FINALIZADO', OR: [{ lavadorId: lav.id }, { ordemLavadores: { some: { lavadorId: lav.id } } }], createdAt: { gte: inicioMesAtual } },
          include: lavInclude,
        }),
        prisma.ordemServico.findMany({
          where: { empresaId, status: 'FINALIZADO', OR: [{ lavadorId: lav.id }, { ordemLavadores: { some: { lavadorId: lav.id } } }], createdAt: { gte: inicioMesAnterior, lte: fimMesAnterior } },
          include: lavInclude,
        }),
      ]);
      const getG = (o: any) => { const ol = o.ordemLavadores?.[0]; return ol ? ol.ganho : (o.comissao ?? 0); };
      const fatAtual    = ordensAtual.reduce((s, o) => s + getG(o), 0);
      const fatAnterior = ordensAnterior.reduce((s, o) => s + getG(o), 0);
      if (fatAnterior > 0) {
        const diff = fatAtual - fatAnterior;
        const emoji = diff >= 0 ? '📈' : '📉';
        const sinal = diff >= 0 ? '+' : '';
        comparacaoFmt = `\n${emoji} vs mês passado: ${sinal}R$ ${diff.toFixed(2)}`;
      }
    }

    // Listar ordens individualmente
    const ordensDetalhe = ordens.slice(0, 10).map(o => {
      const modelo = (o.veiculo?.modelo ?? 'Veículo').toUpperCase();
      const data = o.createdAt.toLocaleDateString('pt-BR');
      const com = getGanho(o);
      return `  • ${data} · ${modelo}: *R$ ${com.toFixed(2)}*`;
    }).join('\n');
    const maisLabel = ordens.length > 10 ? `\n  _...e mais ${ordens.length - 10} ordens_` : '';

    resultado += `👤 *${lav.nome.toUpperCase()}* (${lav.comissao}%)\n` +
      `Comissão bruta: *R$ ${totalCom.toFixed(2)}*\n` +
      `Adiantamentos: *R$ ${totalAdiant.toFixed(2)}*\n` +
      `A receber: *R$ ${comLiquida.toFixed(2)}*` +
      comparacaoFmt +
      `\n\nOrdens (${ordens.length}):\n${ordensDetalhe}${maisLabel}\n\n`;
  }

  return resultado.trim();
}

// ==========================================
// FECHAMENTO DE CAIXA
// ==========================================

async function handleFechamentoCaixa(empresaId: string, data: Date): Promise<string> {
  const inicio = new Date(data); inicio.setHours(0,0,0,0);
  const fim    = new Date(data); fim.setHours(23,59,59,999);
  const dataFmt = inicio.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'2-digit', year:'numeric' });

  const [fechamento, abertura, registros] = await Promise.all([
    prisma.fechamentoCaixa.findFirst({
      where: { empresaId, data: { gte: inicio, lte: fim } },
      orderBy: { data: 'desc' },
    }),
    prisma.aberturaCaixa.findFirst({
      where: { empresaId, data: { gte: inicio, lte: fim } },
      orderBy: { data: 'asc' },
    }),
    prisma.caixaRegistro.findMany({
      where: { empresaId, data: { gte: inicio, lte: fim } },
    }),
  ]);

  const entradas = registros.filter(r => r.tipo === 'ENTRADA').reduce((s,r) => s + r.valor, 0);
  const saidas   = registros.filter(r => r.tipo === 'SAIDA').reduce((s,r) => s + r.valor, 0);
  const saldo    = entradas - saidas;

  let r = `📅 *${dataFmt.toUpperCase()}*\n\n`;

  // Abertura
  if (abertura) {
    r += `🔓 Abertura: *R$ ${abertura.valorInicial.toFixed(2)}*\n`;
  } else {
    r += `🔓 Abertura: _não registrada_\n`;
  }

  // Movimento do dia
  r += `\n💰 Movimento:\n`;
  r += `Entradas: *R$ ${entradas.toFixed(2)}*\n`;
  r += `Saídas: *R$ ${saidas.toFixed(2)}*\n`;
  r += `Saldo: *R$ ${saldo.toFixed(2)}*\n`;

  // Fechamento
  if (!fechamento) {
    r += `\n🔒 Fechamento: _não realizado neste dia_`;
    return r.trim();
  }

  r += `\n🔒 *Fechamento:*\n`;
  r += `PIX: *R$ ${fechamento.pix.toFixed(2)}*\n`;
  r += `Dinheiro: *R$ ${fechamento.dinheiro.toFixed(2)}*\n`;
  r += `Cartão: *R$ ${fechamento.cartao.toFixed(2)}*\n`;
  if (fechamento.nfe) r += `NFe: *R$ ${fechamento.nfe.toFixed(2)}*\n`;

  const totalDigitado = fechamento.pix + fechamento.dinheiro + fechamento.cartao + (fechamento.nfe ?? 0);
  r += `Total digitado: *R$ ${totalDigitado.toFixed(2)}*\n`;

  // Divergência
  if (Math.abs(fechamento.diferenca) > 0.01) {
    const sinal = fechamento.diferenca > 0 ? '📈 Sobra' : '📉 Falta';
    r += `\n${sinal}: *R$ ${Math.abs(fechamento.diferenca).toFixed(2)}*`;
    if (fechamento.observacao) r += `\n_Obs: ${fechamento.observacao}_`;
  } else {
    r += `\n✅ Sem divergência`;
  }

  return r.trim();
}

// ==========================================
// PÁTIO (CARROS ATIVOS)
// ==========================================

async function handlePatioCommand(empresaId: string): Promise<string> {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const amanha = new Date(hoje);
  amanha.setDate(amanha.getDate() + 1);

  const ordensAtivas = await prisma.ordemServico.findMany({
    where: {
      empresaId,
      status: 'EM_ANDAMENTO',
      createdAt: { gte: hoje, lt: amanha },
    },
    include: {
      veiculo: { select: { modelo: true, placa: true } },
      cliente: { select: { nome: true } },
      lavador: { select: { nome: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (ordensAtivas.length === 0) {
    return `🅿️ PÁTIO\n\n✅ Nenhum carro em lavagem no momento.`;
  }

  let resultado = `🅿️ PÁTIO - CARROS ATIVOS\n\n`;

  for (const ordem of ordensAtivas) {
    const horarioEntrada = ordem.dataInicio?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      ?? ordem.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    resultado += `🚗 *${(ordem.veiculo.modelo ?? 'Veículo').toUpperCase()}* (${ordem.veiculo.placa})\n`;
    resultado += `  Cliente: ${ordem.cliente.nome}\n`;
    resultado += `  Entrada: *${horarioEntrada}*\n`;
    resultado += `  Lavador: ${ordem.lavador?.nome ?? '(sem atribuição)'}\n`;
    resultado += `  Valor: *R$ ${ordem.valorTotal.toFixed(2)}*\n\n`;
  }

  return resultado.trim();
}

// ==========================================
// HANDLERS ESPECÍFICOS PARA LAVADOR
// ==========================================

async function handleSaudacaoLavador(from: string, lavadorId: string, empresaId: string, botFeatures: string[]): Promise<string> {
  const lavador = await prisma.lavador.findUnique({ where: { id: lavadorId } });
  if (!lavador) {
    const { text, actions } = buildMenuLavador(botFeatures);
    pendingLavadorMenu.set(from, { lavadorId, empresaId, actions });
    return text;
  }

  const { start: diaStart, end: diaEnd } = getTodayFixedRangeBRT();
  const ordens = await prisma.ordemServico.findMany({
    where: {
      empresaId,
      status: 'FINALIZADO',
      OR: [{ lavadorId }, { ordemLavadores: { some: { lavadorId } } }],
      dataFim: { gte: diaStart, lte: diaEnd },
    },
    include: { ordemLavadores: { where: { lavadorId }, select: { ganho: true } } },
  });

  const comDia = ordens.reduce((s, o) => {
    const entrada = o.ordemLavadores[0];
    return s + (entrada ? entrada.ganho : o.valorTotal * (lavador.comissao / 100));
  }, 0);

  const hora = new Date().getHours();
  const [saudacao, emoji] = hora < 12 ? ['Bom dia', '☀️'] : hora < 18 ? ['Boa tarde', '🌤️'] : ['Boa noite', '🌙'];
  const primeiroNome = lavador.nome.split(' ')[0];

  let msg = `${saudacao}, *${primeiroNome}*! ${emoji}\n\n`;
  if (ordens.length > 0) {
    msg += `📊 Hoje: *${ordens.length} ${ordens.length === 1 ? 'ordem' : 'ordens'}* · 💰 *R$ ${comDia.toFixed(2)}*\n\n`;
  } else {
    msg += `📊 Nenhuma ordem finalizada hoje ainda.\n\n`;
  }
  const { text, actions } = buildMenuLavador(botFeatures);
  msg += text;

  pendingLavadorMenu.set(from, { lavadorId, empresaId, actions });
  return msg;
}

function buildMenuFuncionario(botFeatures: string[]): string {
  const itens: string[] = [];
  if (botFeatures.includes('ver_financeiro'))        itens.push('• *resumo* — resumo do dia\n• *caixa* — status do caixa');
  if (botFeatures.includes('gerenciar_ordens'))      itens.push('• *ordens* — ordens em andamento');
  if (botFeatures.includes('gerenciar_clientes'))    itens.push('• *clientes* — clientes atendidos hoje');
  if (botFeatures.includes('gerenciar_funcionarios')) itens.push('• *equipe* — produtividade dos lavadores hoje');

  itens.push('• *reportar* — relatar avaria em um veículo');

  if (itens.length === 1) {
    return `_Você ainda não tem permissões configuradas pra consultas por aqui. Fala com o administrador, viu?_\n\n${itens.join('\n')}\n\n_Manda o comando que quiser, tô aqui!_`;
  }

  return `━━━━━━━━━━━━━━━\n📋 *O QUE EU CONSIGO FAZER*\n━━━━━━━━━━━━━━━\n\n${itens.join('\n')}\n\n_Manda o comando que quiser, tô aqui!_`;
}

async function handleSaudacaoFuncionario(user: WhatsAppUser): Promise<string> {
  const hora = new Date().getHours();
  const [saudacao, emoji] = hora < 12 ? ['Bom dia', '☀️'] : hora < 18 ? ['Boa tarde', '🌤️'] : ['Boa noite', '🌙'];
  const primeiroNome = (user.nome ?? '').split(' ')[0] || 'tudo bem';

  return `${saudacao}, *${primeiroNome}*! ${emoji}\n\n${buildMenuFuncionario(user.botFeatures ?? user.permissoes ?? [])}`;
}

const NUMEROS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

function buildMenuLavador(botFeatures: string[]): { text: string; actions: string[] } {
  const itens: Array<{ acao: string; label: string }> = [];
  if (botFeatures.includes('meu_status'))    itens.push({ acao: 'status',    label: 'Meu status hoje' });
  if (botFeatures.includes('minhas_comissoes')) itens.push({ acao: 'comissoes', label: 'Comissões em aberto' });
  itens.push({ acao: 'link',     label: 'Meu portal (link)' });
  itens.push({ acao: 'reportar', label: 'Reportar avaria' });

  const linhas = itens.map((item, i) => `${NUMEROS[i]}  ${item.label}`);
  const text = `━━━━━━━━━━━━━━━\n${linhas.join('\n')}\n━━━━━━━━━━━━━━━\n\n_Responda com o número ou o comando._`;
  return { text, actions: itens.map(i => i.acao) };
}

async function handleStatusLavador(lavadorId: string, empresaId: string): Promise<string> {
  const { start: diaStart, end: diaEnd } = getTodayFixedRangeBRT();
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimMes    = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

  const lavador = await prisma.lavador.findUnique({ where: { id: lavadorId } });
  if (!lavador) return '❌ Erro ao buscar seus dados.';

  const filtroLavador = { OR: [{ lavadorId }, { ordemLavadores: { some: { lavadorId } } }] };

  const [ordensDia, ordensMes] = await Promise.all([
    prisma.ordemServico.findMany({
      where: { empresaId, status: 'FINALIZADO', ...filtroLavador, dataFim: { gte: diaStart, lte: diaEnd } },
      include: { ordemLavadores: { where: { lavadorId }, select: { ganho: true } } },
    }),
    prisma.ordemServico.findMany({
      where: { empresaId, status: 'FINALIZADO', ...filtroLavador, dataFim: { gte: inicioMes, lte: fimMes } },
      include: { ordemLavadores: { where: { lavadorId }, select: { ganho: true } } },
    }),
  ]);

  const calcCom = (ordens: typeof ordensDia) => ordens.reduce((s, o) => {
    const entrada = o.ordemLavadores[0];
    return s + (entrada ? entrada.ganho : o.valorTotal * (lavador.comissao / 100));
  }, 0);

  const fatDia  = ordensDia.reduce((s, o) => s + o.valorTotal, 0);
  const comDia  = calcCom(ordensDia);
  const fatMes  = ordensMes.reduce((s, o) => s + o.valorTotal, 0);
  const comMes  = calcCom(ordensMes);

  const portalLink = await getLinkPortal(lavadorId);

  let msg = `━━━━━━━━━━━━━━━\n📊 *STATUS — HOJE*\n━━━━━━━━━━━━━━━\n\n`;
  msg += `🚗 *${ordensDia.length}* ${ordensDia.length === 1 ? 'ordem' : 'ordens'} finalizada(s)\n`;
  msg += `💵 Faturamento: R$ ${fatDia.toFixed(2)}\n`;
  msg += `👷 Sua comissão: *R$ ${comDia.toFixed(2)}*\n\n`;

  msg += `━━━━━━━━━━━━━━━\n📅 *ESTE MÊS*\n━━━━━━━━━━━━━━━\n\n`;
  msg += `🚗 *${ordensMes.length}* ${ordensMes.length === 1 ? 'ordem' : 'ordens'}\n`;
  msg += `💵 Faturamento: R$ ${fatMes.toFixed(2)}\n`;
  msg += `👷 Comissão bruta: *R$ ${comMes.toFixed(2)}*`;

  if (portalLink) msg += `\n\n🔗 _Detalhes completos: ${portalLink}_`;

  return msg;
}

async function handleLinkLavador(lavadorId: string): Promise<string> {
  const link = await getLinkPortal(lavadorId);
  if (!link) return '❌ Seu portal não está disponível. Contate o gerente.';
  return `🔗 *Seu portal pessoal:*\n\n${link}\n\n_Acesse aqui para ver suas ordens, extrato e histórico completo._`;
}

async function getLinkPortal(lavadorId: string): Promise<string | null> {
  if (!PORTAL_URL) return null;
  const rows = await prisma.$queryRaw<Array<{ linkTokenCurto: string | null }>>`
    SELECT "linkTokenCurto" FROM "lavadores" WHERE "id" = ${lavadorId}
  `;
  const token = rows[0]?.linkTokenCurto;
  if (!token) return null;
  return `${PORTAL_URL}/p/${token}`;
}

/*
 * Suas comissões em aberto (apenas do lavador)
 */
async function handleComissoesLavador(lavadorId: string, empresaId: string): Promise<string> {
  const lavador = await prisma.lavador.findUnique({ where: { id: lavadorId } });
  if (!lavador) return '❌ Erro ao buscar dados.';

  const ordens = await prisma.ordemServico.findMany({
    where: {
      empresaId,
      status: 'FINALIZADO',
      OR: [
        { lavadorId, fechamentoComissaoId: null },
        { ordemLavadores: { some: { lavadorId, fechamentoComissaoId: null } } },
      ],
    },
    include: { ordemLavadores: { where: { lavadorId }, select: { ganho: true } } },
  });

  if (ordens.length === 0) {
    return `✅ Tudo certo, *${lavador.nome.split(' ')[0]}*!\nVocê não tem comissões em aberto.`;
  }

  const totalCom = ordens.reduce((s, o) => {
    const entrada = o.ordemLavadores[0];
    return s + (entrada ? entrada.ganho : o.valorTotal * (lavador.comissao / 100));
  }, 0);

  // Agrupar por mês usando dataFim
  const porMes: Record<string, number> = {};
  for (const o of ordens) {
    const ref = o.dataFim ?? o.createdAt;
    const mes = ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    const ganho = o.ordemLavadores[0]?.ganho ?? o.valorTotal * (lavador.comissao / 100);
    porMes[mes] = (porMes[mes] ?? 0) + ganho;
  }

  const porMesFmt = Object.entries(porMes)
    .map(([m, v]) => `📅 *${m.charAt(0).toUpperCase() + m.slice(1)}*: R$ ${v.toFixed(2)}`)
    .join('\n');

  return `━━━━━━━━━━━━━━━\n` +
    `💰 *COMISSÕES EM ABERTO*\n` +
    `━━━━━━━━━━━━━━━\n\n` +
    `📋 *${ordens.length}* ${ordens.length === 1 ? 'ordem' : 'ordens'} a receber\n\n` +
    `${porMesFmt}\n\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💵 Total: *R$ ${totalCom.toFixed(2)}*\n` +
    `━━━━━━━━━━━━━━━`;
}

// ==========================================
// CONTEXTO COMPLETO PARA IA
// ==========================================

/*
 * Constrói contexto com dados do dia E do mês para a IA responder qualquer período
 */
async function buildContextForDate(empresaId: string, date: Date): Promise<string> {
  try {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const { start, end } = getDateRangeBRT(dateStr);

    const [ordens, caixa, lavadores] = await Promise.all([
      prisma.ordemServico.findMany({
        where: { empresaId, status: { not: 'CANCELADO' as any }, dataFim: { gte: start, lte: end } },
        include: { lavador: { select: { nome: true } } },
      }),
      prisma.caixaRegistro.findMany({ where: { empresaId, data: { gte: start, lte: end } } }),
      prisma.lavador.findMany({ where: { empresaId, ativo: true } }),
    ]);

    const dataLabel = date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const fat = ordens.reduce((s, o) => s + o.valorTotal, 0);
    const entradas = caixa.filter(c => c.tipo === 'ENTRADA').reduce((s, c) => s + c.valor, 0);
    const saidas   = caixa.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);

    let ctx = `\n=== ${dataLabel.toUpperCase()} ===\n`;
    ctx += `Ordens: ${ordens.length} | Faturamento: R$ ${fat.toFixed(2)}\n`;
    ctx += `Finalizadas: ${ordens.filter(o => o.status === 'FINALIZADO').length} | Em andamento: ${ordens.filter(o => o.status === 'EM_ANDAMENTO').length}\n`;
    ctx += `Caixa: Entradas R$ ${entradas.toFixed(2)} | Saídas R$ ${saidas.toFixed(2)} | Saldo R$ ${(entradas - saidas).toFixed(2)}\n`;

    for (const lav of lavadores) {
      const ords = ordens.filter(o => o.lavadorId === lav.id);
      if (ords.length > 0) {
        const fatLav = ords.reduce((s, o) => s + o.valorTotal, 0);
        ctx += `• ${lav.nome}: ${ords.length} ordem(ns), R$ ${fatLav.toFixed(2)}\n`;
      }
    }

    return ctx;
  } catch {
    return '';
  }
}

async function buildDailyContext(empresaId: string): Promise<string> {
  try {
    const agora = new Date();
    const todayStr = getTodayStrBRT();
    const { start: diaStart, end: diaEnd } = getTodayFixedRangeBRT();

    // Mês atual em BRT
    const [anoAtual, mesAtual] = todayStr.split('-').map(Number);
    const { start: mesStart, end: mesEnd } = getMonthRangeBRT(anoAtual, mesAtual);

    // Mês anterior em BRT
    const mesAnteriorNum = mesAtual === 1 ? 12 : mesAtual - 1;
    const anoAnterior    = mesAtual === 1 ? anoAtual - 1 : anoAtual;
    const { start: mesAntStart, end: mesAntEnd } = getMonthRangeBRT(anoAnterior, mesAnteriorNum);

    // 1. Empresa
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    if (!empresa) return 'Empresa não encontrada.';

    // 2. Lavadores ativos
    const lavadores = await prisma.lavador.findMany({ where: { empresaId, ativo: true } });

    // 3a. Pátio: ordens criadas hoje, todos os status (para contagem de status)
    const ordensDiaPatio = await prisma.ordemServico.findMany({
      where: { empresaId, status: { not: 'CANCELADO' }, createdAt: { gte: diaStart, lte: diaEnd } },
      include: {
        cliente: { select: { nome: true } },
        veiculo: { select: { placa: true, modelo: true } },
        lavador: { select: { nome: true } },
      }
    });

    // 3b. Faturamento: ordens FINALIZADAS hoje por dataFim (âncora correta para receita)
    const ordensDia = await prisma.ordemServico.findMany({
      where: { empresaId, status: 'FINALIZADO', dataFim: { gte: diaStart, lte: diaEnd } },
      include: {
        lavador: { select: { nome: true } },
        ordemLavadores: { include: { lavador: { select: { nome: true } } } },
      }
    });

    // 4. Ordens FINALIZADAS do MÊS por dataFim
    const ordensMes = await prisma.ordemServico.findMany({
      where: { empresaId, status: 'FINALIZADO', dataFim: { gte: mesStart, lte: mesEnd } },
      include: {
        lavador: { select: { nome: true } },
        ordemLavadores: { include: { lavador: { select: { nome: true } } } },
      }
    });

    // 5. Caixa do dia
    const caixaDia = await prisma.caixaRegistro.findMany({
      where: { empresaId, data: { gte: diaStart, lte: diaEnd } }
    });
    const entradasDia = caixaDia.filter(c => c.tipo === 'ENTRADA').reduce((s, c) => s + c.valor, 0);
    const saidasDia = caixaDia.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);

    // 6. Caixa do mês
    const caixaMes = await prisma.caixaRegistro.findMany({
      where: { empresaId, data: { gte: mesStart, lte: mesEnd } }
    });
    const entradasMes = caixaMes.filter(c => c.tipo === 'ENTRADA').reduce((s, c) => s + c.valor, 0);
    const saidasMes = caixaMes.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);

    // 6b. Ordens e caixa do mês anterior
    const [ordensMesAnterior, caixaMesAnterior] = await Promise.all([
      prisma.ordemServico.findMany({
        where: { empresaId, status: 'FINALIZADO', dataFim: { gte: mesAntStart, lte: mesAntEnd } },
        include: {
          lavador: { select: { nome: true } },
          ordemLavadores: { include: { lavador: { select: { nome: true } } } },
        }
      }),
      prisma.caixaRegistro.findMany({
        where: { empresaId, data: { gte: mesAntStart, lte: mesAntEnd } }
      }),
    ]);

    // 7. Adiantamentos pendentes (todos, sem filtro de data)
    const adiantamentos = await prisma.adiantamento.findMany({
      where: { empresaId, status: 'PENDENTE' },
      include: { lavador: { select: { nome: true } } }
    });

    // 8. Comissões fechadas do mês (FechamentoComissao)
    let fechamentosMes: { lavadorId: string; valorPago: number; data: Date; lavador: { nome: string } }[] = [];
    try {
      fechamentosMes = await prisma.fechamentoComissao.findMany({
        where: { empresaId, data: { gte: mesStart, lte: mesEnd } },
        include: { lavador: { select: { nome: true } } }
      });
    } catch { /* ignorar se não existir */ }

    // ---- MONTAR CONTEXTO ----
    const mesNomeFmt = mesStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    const mesAntNomeFmt = mesAntStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

    let ctx = `CONTEXTO LINA X - ${empresa.nome}\n`;
    ctx += `Data: ${agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} | Mês: ${mesNomeFmt}\n\n`;

    // Helper: calcula ganho real de um lavador em uma lista de ordens (multi-lavador aware)
    const calcGanhoLavador = (ords: typeof ordensDia, lavadorId: string, comissao: number) =>
      ords.reduce((s, o) => {
        const ol = o.ordemLavadores.find((x: any) => x.lavadorId === lavadorId);
        return s + (ol ? ol.ganho : o.lavadorId === lavadorId ? o.valorTotal * (comissao / 100) : 0);
      }, 0);
    const contaOrdensLavador = (ords: typeof ordensDia, lavadorId: string) =>
      ords.filter(o => o.lavadorId === lavadorId || o.ordemLavadores.some((x: any) => x.lavadorId === lavadorId)).length;

    // --- DIA ---
    ctx += `=== HOJE ===\n`;
    const fatDia = ordensDia.reduce((s, o) => s + o.valorTotal, 0);
    ctx += `Finalizadas: *${ordensDia.length}* | Faturamento: *R$ ${fatDia.toFixed(2)}*\n`;
    ctx += `Pátio agora: *${ordensDiaPatio.filter(o => o.status === 'EM_ANDAMENTO').length}* em andamento, `;
    ctx += `*${ordensDiaPatio.filter(o => o.status === 'PENDENTE').length}* pendentes, `;
    ctx += `*${ordensDiaPatio.filter(o => o.status === 'AGUARDANDO_PAGAMENTO').length}* aguardando pagamento\n`;
    ctx += `Caixa: Entradas *R$ ${entradasDia.toFixed(2)}* | Saídas *R$ ${saidasDia.toFixed(2)}* | Saldo *R$ ${(entradasDia - saidasDia).toFixed(2)}*\n\n`;

    ctx += `Lavadores hoje:\n`;
    for (const lav of lavadores) {
      const qtd = contaOrdensLavador(ordensDia, lav.id);
      const fat = ordensDia.filter(o => o.lavadorId === lav.id || o.ordemLavadores.some((x: any) => x.lavadorId === lav.id)).reduce((s, o) => s + o.valorTotal, 0);
      const com = calcGanhoLavador(ordensDia, lav.id, lav.comissao);
      ctx += `• *${lav.nome}*: *${qtd}* ordem(ns), faturamento *R$ ${fat.toFixed(2)}*, comissão hoje *R$ ${com.toFixed(2)}*\n`;
    }
    ctx += '\n';

    // --- MÊS ---
    ctx += `=== MÊS ATUAL (${mesNomeFmt}) ===\n`;
    const fatMes = ordensMes.reduce((s, o) => s + o.valorTotal, 0);
    ctx += `Finalizadas: *${ordensMes.length}* | Faturamento total: *R$ ${fatMes.toFixed(2)}*\n`;
    ctx += `Caixa mês: Entradas *R$ ${entradasMes.toFixed(2)}* | Saídas *R$ ${saidasMes.toFixed(2)}* | Saldo *R$ ${(entradasMes - saidasMes).toFixed(2)}*\n\n`;

    ctx += `Comissões do mês por lavador:\n`;
    for (const lav of lavadores) {
      const qtdMes = contaOrdensLavador(ordensMes, lav.id);
      const fatLav = ordensMes.filter(o => o.lavadorId === lav.id || o.ordemLavadores.some((x: any) => x.lavadorId === lav.id)).reduce((s, o) => s + o.valorTotal, 0);
      const comMes = calcGanhoLavador(ordensMes, lav.id, lav.comissao);
      const adiant = adiantamentos.filter(a => a.lavadorId === lav.id).reduce((s, a) => s + a.valor, 0);
      ctx += `• *${lav.nome}*: *${qtdMes}* ordem(ns), fat. *R$ ${fatLav.toFixed(2)}*, comissão bruta *R$ ${comMes.toFixed(2)}*, adiant. *R$ ${adiant.toFixed(2)}*, líquido *R$ ${(comMes - adiant).toFixed(2)}*\n`;
    }
    ctx += '\n';

    // --- MÊS ANTERIOR ---
    const entradasMesAnt = caixaMesAnterior.filter(c => c.tipo === 'ENTRADA').reduce((s, c) => s + c.valor, 0);
    const saidasMesAnt   = caixaMesAnterior.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);
    const fatMesAnt = ordensMesAnterior.reduce((s, o) => s + o.valorTotal, 0);
    ctx += `=== MÊS ANTERIOR (${mesAntNomeFmt}) ===\n`;
    ctx += `Finalizadas: *${ordensMesAnterior.length}* | Faturamento: *R$ ${fatMesAnt.toFixed(2)}*\n`;
    ctx += `Caixa: Entradas *R$ ${entradasMesAnt.toFixed(2)}* | Saídas *R$ ${saidasMesAnt.toFixed(2)}* | Saldo *R$ ${(entradasMesAnt - saidasMesAnt).toFixed(2)}*\n`;

    ctx += `Comissões do mês anterior por lavador:\n`;
    for (const lav of lavadores) {
      const qtdAnt = contaOrdensLavador(ordensMesAnterior, lav.id);
      const fatAnt = ordensMesAnterior.filter(o => o.lavadorId === lav.id || o.ordemLavadores.some((x: any) => x.lavadorId === lav.id)).reduce((s, o) => s + o.valorTotal, 0);
      const comAnt = calcGanhoLavador(ordensMesAnterior, lav.id, lav.comissao);
      ctx += `• *${lav.nome}*: *${qtdAnt}* ordem(ns), faturamento *R$ ${fatAnt.toFixed(2)}*, comissão *R$ ${comAnt.toFixed(2)}*\n`;
    }
    ctx += '\n';

    // Adiantamentos pendentes
    if (adiantamentos.length > 0) {
      ctx += `Adiantamentos pendentes (total):\n`;
      for (const a of adiantamentos) {
        ctx += `• *${a.lavador.nome}*: *R$ ${a.valor.toFixed(2)}*\n`;
      }
      ctx += '\n';
    }

    // Fechamentos de comissão do mês (se houver)
    if (fechamentosMes.length > 0) {
      ctx += `Fechamentos de comissão no mês:\n`;
      for (const f of fechamentosMes) {
        ctx += `• *${f.lavador.nome}*: *R$ ${f.valorPago.toFixed(2)}* em ${f.data.toLocaleDateString('pt-BR')}\n`;
      }
      ctx += '\n';
    }

    return ctx;
  } catch (error) {
    console.error('[WhatsApp Context] Erro:', error);
    return 'Erro ao carregar contexto.';
  }
}

/*
 * Handler: /resumo — query direta ao banco
 */
async function handleResumoCommand(empresaId: string): Promise<string> {
  // Janela fixa 07:00–23:59 BRT do dia atual — sem depender de horarioAbertura
  const { start, end } = getTodayFixedRangeBRT();

  const [ordens, caixa] = await Promise.all([
    // Só FINALIZADAS com dataFim dentro da janela de hoje
    prisma.ordemServico.findMany({
      where: { empresaId, status: 'FINALIZADO' as any, dataFim: { gte: start, lte: end } },
    }),
    prisma.caixaRegistro.findMany({
      where: { empresaId, data: { gte: start, lte: end } },
    }),
  ]);

  const fat      = ordens.reduce((s, o) => s + o.valorTotal, 0);
  const entradas = caixa.filter(c => c.tipo === 'ENTRADA').reduce((s, c) => s + c.valor, 0);
  const saidas   = caixa.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);

  return `📊 *RESUMO DO DIA*\n\n` +
    `✅ Ordens finalizadas: *${ordens.length}* | Faturamento: *R$ ${fat.toFixed(2)}*\n\n` +
    `💰 CAIXA:\n` +
    `Entradas: *R$ ${entradas.toFixed(2)}* | Saídas: *R$ ${saidas.toFixed(2)}*\n` +
    `Saldo: *R$ ${(entradas - saidas).toFixed(2)}*`;
}

/*
 * Handler: /lavadores — query direta ao banco
 */
async function handleLavadoresCommand(empresaId: string): Promise<string> {
  const { start, end } = getTodayFixedRangeBRT();

  const [lavadores, ordens] = await Promise.all([
    prisma.lavador.findMany({ where: { empresaId, ativo: true } }),
    prisma.ordemServico.findMany({
      where: { empresaId, status: 'FINALIZADO' as any, dataFim: { gte: start, lte: end } },
      include: { ordemLavadores: { select: { lavadorId: true } } },
    }),
  ]);

  if (lavadores.length === 0) return '❌ Nenhum lavador cadastrado.';

  let r = `👷 *LAVADORES HOJE*\n\n`;
  for (const lav of lavadores) {
    // Conta ordens onde o lavador participou (principal ou multi-lavador)
    const ords = ordens.filter(o =>
      o.lavadorId === lav.id || o.ordemLavadores.some(ol => ol.lavadorId === lav.id)
    );
    const fat = ords.reduce((s, o) => s + o.valorTotal, 0);
    const com = fat * (lav.comissao / 100);
    r += `• *${lav.nome}*: ${ords.length} ordem(ns) | Fat.: *R$ ${fat.toFixed(2)}* | Com.: *R$ ${com.toFixed(2)}*\n`;
  }

  return r.trim();
}

/*
 * Handler: /clientes — clientes atendidos hoje (query direta ao banco)
 */
async function handleClientesCommand(empresaId: string): Promise<string> {
  const { start, end } = getTodayFixedRangeBRT();

  const [ordensHoje, novosClientes] = await Promise.all([
    prisma.ordemServico.findMany({
      where: { empresaId, createdAt: { gte: start, lte: end }, status: { not: 'CANCELADO' as any } },
      include: { cliente: { select: { id: true, nome: true } }, veiculo: { select: { placa: true, modelo: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.cliente.count({ where: { empresaId, createdAt: { gte: start, lte: end } } }),
  ]);

  if (ordensHoje.length === 0) {
    return `👥 *CLIENTES HOJE*\n\n✅ Nenhum cliente atendido ainda hoje.`;
  }

  const porCliente = new Map<string, { nome: string; veiculos: Set<string>; total: number }>();
  for (const o of ordensHoje) {
    const c = porCliente.get(o.cliente.id) ?? { nome: o.cliente.nome, veiculos: new Set<string>(), total: 0 };
    if (o.veiculo?.placa) c.veiculos.add(o.veiculo.placa);
    c.total += o.valorTotal;
    porCliente.set(o.cliente.id, c);
  }

  let r = `👥 *CLIENTES HOJE*\n\n`;
  r += `${porCliente.size} cliente(s) · ${ordensHoje.length} ordem(ns)`;
  if (novosClientes > 0) r += ` · ${novosClientes} novo(s) cadastro(s)`;
  r += `\n\n`;

  for (const c of porCliente.values()) {
    r += `• *${c.nome}* — ${[...c.veiculos].join(', ') || '—'} · *R$ ${c.total.toFixed(2)}*\n`;
  }

  return r.trim();
}

/*
 * Handler: /caixa — query direta ao banco
 */
async function handleCaixaCommand(empresaId: string): Promise<string> {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1);

  const caixa = await prisma.caixaRegistro.findMany({
    where: { empresaId, data: { gte: hoje, lt: amanha } },
    orderBy: { data: 'desc' },
  });

  const entradas = caixa.filter(c => c.tipo === 'ENTRADA').reduce((s,c) => s + c.valor, 0);
  const saidas   = caixa.filter(c => c.tipo === 'SAIDA').reduce((s,c) => s + c.valor, 0);

  let r = `💰 *CAIXA DO DIA*\n\n`;
  r += `Entradas: *R$ ${entradas.toFixed(2)}*\n`;
  r += `Saídas: *R$ ${saidas.toFixed(2)}*\n`;
  r += `Saldo: *R$ ${(entradas - saidas).toFixed(2)}*`;

  const ultSaidas = caixa.filter(c => c.tipo === 'SAIDA').slice(0, 5);
  if (ultSaidas.length > 0) {
    r += `\n\n📋 Últimas saídas:\n`;
    for (const s of ultSaidas) {
      r += `• ${s.descricao}: *R$ ${s.valor.toFixed(2)}*\n`;
    }
  }

  return r.trim();
}

/*
 * Handler: /pendentes — query direta ao banco
 */
async function handlePendentesCommand(empresaId: string): Promise<string> {
  const ordens = await prisma.ordemServico.findMany({
    where: { empresaId, status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] } },
    include: {
      veiculo: { select: { modelo: true, placa: true } },
      lavador: { select: { nome: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  if (ordens.length === 0) return '✅ Nenhuma ordem ativa no momento.';

  const lbl: Record<string, string> = {
    PENDENTE: 'PENDENTE', EM_ANDAMENTO: 'EM ANDAMENTO', AGUARDANDO_PAGAMENTO: 'AGUARD. PAGAMENTO',
  };

  let r = `⏳ *ORDENS ATIVAS (${ordens.length})*\n\n`;
  for (const o of ordens) {
    const modelo = (o.veiculo.modelo ?? 'Veículo').toUpperCase();
    r += `#${o.numeroOrdem} · ${modelo} ${o.veiculo.placa ?? ''} · *R$ ${o.valorTotal.toFixed(2)}*\n`;
    r += `  ${lbl[o.status] ?? o.status} · ${o.lavador?.nome ?? '(sem lavador)'}\n\n`;
  }

  return r.trim();
}

/*
 * Handler: /ajuda
 */
function handleAjudaCommand(): string {
  return `📚 *COMANDOS*\n\n` +
    `*Dia a dia:*\n` +
    `resumo · lavadores · caixa · pendentes · pátio\n\n` +
    `*Despesas:*\n` +
    `saída 50 · saída de gasolina 80\n` +
    `gastei 120 conta de luz · despesa 200 pix\n` +
    `adiantamento de 150 · nova saída\n\n` +
    `*Caixa:*\n` +
    `fechamento · fechamento ontem · fechamento 02/04\n\n` +
    `*Relatórios:*\n` +
    `relatório ontem · relatório 02/04\n` +
    `relatório semanal · últimos 15 dias\n` +
    `relatório de 01/04 a 07/04\n\n` +
    `*Multi-empresa:*\n` +
    `resumo das duas · caixa de todas · lavadores das duas\n\n` +
    `*Comissões e Vales:*\n` +
    `comissões em aberto · comissão [nome]\n` +
    `vale [nome] · vales em aberto\n\n` +
    `*Saídas:*\n` +
    `saídas · saídas hoje · saídas semana · saídas mês\n` +
    `saídas 01/04 · saídas de 01/04 a 07/04\n\n` +
    `*Avarias:*\n` +
    `reports · ver avarias · tem report · fotos de avaria\n\n` +
    `*PIX:*\n` +
    `ordens · pix [nº] · reenviar pix [nº]\n\n` +
    `*Empresa:*\n` +
    `trocar empresa · trocar para [nome]\n\n` +
    `_Qualquer pergunta livre → respondo com IA_`;
}

/*
 * Monta contexto de lavador para o Groq responder de forma conversacional e pessoal.
 * Usado quando a pergunta é "como tá o Felipe?" e não "relatório do Felipe".
 */
async function buildContextLavadorConversacional(message: string, empresaId: string): Promise<string | null> {
  try {
    const lavadores = await prisma.lavador.findMany({ where: { empresaId, ativo: true } });
    const msgLower  = message.toLowerCase();
    const lavador   = lavadores.find(l =>
      msgLower.includes(l.nome.toLowerCase()) ||
      l.nome.toLowerCase().split(' ').some(p => p.length > 3 && msgLower.includes(p))
    );
    if (!lavador) return null;

    const hoje       = new Date(); hoje.setHours(0, 0, 0, 0);
    const amanha     = new Date(hoje); amanha.setDate(amanha.getDate() + 1);
    const inicioMes  = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fimMes     = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

    const lavOlInclude = { ordemLavadores: { where: { lavadorId: lavador.id }, select: { ganho: true } } };
    const lavOlWhere = (extra: object) => ({ empresaId, status: { not: 'CANCELADO' as const }, OR: [{ lavadorId: lavador.id }, { ordemLavadores: { some: { lavadorId: lavador.id } } }], ...extra });
    const [ordensDia, ordensMes, adiantamentos] = await Promise.all([
      prisma.ordemServico.findMany({ where: lavOlWhere({ createdAt: { gte: hoje, lt: amanha } }), include: lavOlInclude }),
      prisma.ordemServico.findMany({ where: lavOlWhere({ createdAt: { gte: inicioMes, lte: fimMes } }), include: lavOlInclude }),
      prisma.adiantamento.findMany({ where: { lavadorId: lavador.id, status: 'PENDENTE' } }),
    ]);

    const getG = (o: any) => { const ol = o.ordemLavadores?.[0]; return ol ? ol.ganho : (o.comissao ?? 0); };
    const fatDia      = ordensDia.reduce((s, o) => s + o.valorTotal, 0);
    const comDia      = ordensDia.reduce((s, o) => s + getG(o), 0);
    const fatMes      = ordensMes.reduce((s, o) => s + o.valorTotal, 0);
    const comBrutaMes = ordensMes.reduce((s, o) => s + getG(o), 0);
    const totalAdiant = adiantamentos.reduce((s, a) => s + a.valor, 0);
    const comLiqMes   = comBrutaMes - totalAdiant;

    return `DADOS DO LAVADOR — responda de forma conversacional, pessoal e descontraída. ` +
      `Dê uma avaliação humana do desempenho: se tá fraco, diga com leveza; se tá bem, parabenize. ` +
      `Use os números, mas não liste friamente — comente sobre eles como quem conhece a pessoa.\n\n` +
      `Lavador: ${lavador.nome} | Comissão: ${lavador.comissao}%\n` +
      `HOJE: ${ordensDia.length} ordem(ns) | faturamento R$ ${fatDia.toFixed(2)} | comissão R$ ${comDia.toFixed(2)}\n` +
      `MÊS: ${ordensMes.length} ordem(ns) | faturamento R$ ${fatMes.toFixed(2)} | comissão bruta R$ ${comBrutaMes.toFixed(2)} | líquida R$ ${comLiqMes.toFixed(2)}`;
  } catch {
    return null;
  }
}

/*
 * Busca lavador específico por nome (parcial) — retorna dados do dia E do mês
 */
async function handleLavadorEspecifico(
  message: string,
  empresaId: string,
): Promise<string | null> {
  try {
    const lavadores = await prisma.lavador.findMany({
      where: { empresaId, ativo: true }
    });

    const messageLower = message.toLowerCase().trim();
    const lavador = lavadores.find(l =>
      l.nome.toLowerCase().includes(messageLower) ||
      messageLower.includes(l.nome.toLowerCase())
    );

    if (!lavador) return null;

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

    const lavOlInclude = { ordemLavadores: { where: { lavadorId: lavador.id }, select: { ganho: true } } };
    const lavOlWhere = (extra: object) => ({ empresaId, status: { not: 'CANCELADO' as const }, OR: [{ lavadorId: lavador.id }, { ordemLavadores: { some: { lavadorId: lavador.id } } }], ...extra });
    const [ordensDia, ordensMes, adiantamentos] = await Promise.all([
      prisma.ordemServico.findMany({ where: lavOlWhere({ createdAt: { gte: hoje, lt: amanha } }), include: lavOlInclude }),
      prisma.ordemServico.findMany({ where: lavOlWhere({ createdAt: { gte: inicioMes, lte: fimMes } }), include: lavOlInclude }),
      prisma.adiantamento.findMany({
        where: { lavadorId: lavador.id, status: 'PENDENTE' }
      }),
    ]);

    const getG = (o: any) => { const ol = o.ordemLavadores?.[0]; return ol ? ol.ganho : (o.comissao ?? 0); };
    const fatDia = ordensDia.reduce((s, o) => s + o.valorTotal, 0);
    const comDia = ordensDia.reduce((s, o) => s + getG(o), 0);
    const fatMes = ordensMes.reduce((s, o) => s + o.valorTotal, 0);
    const comBrutaMes = ordensMes.reduce((s, o) => s + getG(o), 0);
    const totalAdiant = adiantamentos.reduce((s, a) => s + a.valor, 0);
    const comLiquidaMes = comBrutaMes - totalAdiant;

    return `👤 *${lavador.nome.toUpperCase()}*\n\n` +
      `📅 HOJE:\n` +
      `  Ordens: *${ordensDia.length}* | Faturamento: *R$ ${fatDia.toFixed(2)}*\n` +
      `  Comissão: *R$ ${comDia.toFixed(2)}*\n\n` +
      `📆 MÊS ATUAL:\n` +
      `  Ordens: *${ordensMes.length}* | Faturamento: *R$ ${fatMes.toFixed(2)}*\n` +
      `  Comissão bruta (${lavador.comissao}%): *R$ ${comBrutaMes.toFixed(2)}*\n` +
      `  Adiantamentos em aberto: *R$ ${totalAdiant.toFixed(2)}*\n` +
      `  Comissão líquida a receber: *R$ ${comLiquidaMes.toFixed(2)}*`;
  } catch (error) {
    console.error('[WhatsApp] Erro ao buscar lavador:', error);
    return null;
  }
}

// ==========================================
// LANÇAMENTO DE SAÍDA VIA WHATSAPP
// ==========================================

// ==========================================
// SAÍDAS — FLUXO CONVERSACIONAL POR ETAPAS
// ==========================================

const FORMA_LABELS: Record<string, string> = {
  PIX: 'PIX', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão', NFE: 'NFe',
};

/**
 * Determina a próxima etapa com base no que falta coletar
 */
function getNextSaidaStep(p: Partial<PendingSaida>): SaidaStep {
  if (!p.valor || p.valor <= 0) return 'valor';
  if (!p.descricao) return 'descricao';
  if (!p.formaPagamento) return 'formaPagamento';
  if (p.categoria === 'Adiantamento' && p.lavadorId === undefined) return 'lavador';
  if (p.categoria !== 'Adiantamento' && p.fornecedorNome === undefined) return 'fornecedor';
  return 'confirming';
}

/**
 * Retorna a pergunta/mensagem para a etapa atual
 */
function promptForSaidaStep(p: PendingSaida): string {
  switch (p.step) {
    case 'valor':
      return (
        `💸 *Lançar despesa*\n\n` +
        `💰 *Qual o valor?*\n` +
        `_Ex: 50, 120,50, 200_\n\n` +
        `_Envie "cancelar" para abortar._`
      );

    case 'descricao':
      return (
        `💸 *R$ ${p.valor.toFixed(2)}*\n\n` +
        `📝 *O que foi pago? (descrição breve)*\n` +
        `_Ex: Produto químico, Conta de luz, Gasolina_`
      );

    case 'formaPagamento':
      return (
        `📝 _${p.descricao}_\n\n` +
        `💳 *Qual a forma de pagamento?*\n` +
        `1️⃣ Dinheiro\n2️⃣ PIX\n3️⃣ Cartão\n4️⃣ NFe`
      );

    case 'lavador': {
      const lista = p.lavadoresList.length > 0
        ? p.lavadoresList.map((l, i) => `${i + 1}️⃣ ${l.nome}`).join('\n')
        : '_(nenhum funcionário cadastrado)_';
      return (
        `👤 *Para qual funcionário é o adiantamento?*\n\n` +
        lista +
        `\n\n_Digite o número correspondente_`
      );
    }

    case 'fornecedor':
      return (
        `🏪 *Nome do fornecedor ou responsável?*\n` +
        `_(ou envie *pular* para deixar em branco)_`
      );

    case 'confirming': {
      const formaLabel = FORMA_LABELS[p.formaPagamento || 'DINHEIRO'] || p.formaPagamento;
      const fornLine    = p.fornecedorNome ? `\n  🏪 ${p.fornecedorNome}` : '';
      const lavLine     = p.lavadorNome    ? `\n  👤 ${p.lavadorNome}` : '';
      return (
        `💸 *Confirmar despesa?*\n\n` +
        `  💰 *R$ ${p.valor.toFixed(2)}*\n` +
        `  📝 ${p.descricao}\n` +
        `  💳 ${formaLabel}\n` +
        `  🏷️ ${p.categoria}` +
        lavLine +
        fornLine +
        `\n\n*sim* para lançar · *não* para cancelar`
      );
    }
  }
}

/**
 * Tenta parsear forma de pagamento de um texto livre
 */
function parseFormaPagamento(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (/^1$|dinheiro|esp[eé]cie/.test(t)) return 'DINHEIRO';
  if (/^2$|^pix$/.test(t)) return 'PIX';
  if (/^3$|cart[aã]o|cr[eé]dito|d[eé]bito/.test(t)) return 'CARTAO';
  if (/^4$|nf[e\-]?|nota\s*fiscal/.test(t)) return 'NFE';
  return null;
}

/**
 * Extrai o que for possível da mensagem inicial usando Groq.
 * Retorna null apenas se não conseguir extrair o valor.
 * descricao e formaPagamento podem ser null (serão coletados depois).
 */
async function extrairDadosSaida(message: string): Promise<{
  valor: number;
  descricao: string | null;
  formaPagamento: string | null;
  categoria: string;
} | null> {
  const prompt = `Extraia dados de uma saída financeira. Retorne APENAS JSON sem markdown.
Campos:
- valor: número (obrigatório; null se ausente)
- descricao: texto do que foi pago (null se não mencionado explicitamente)
- formaPagamento: "PIX" | "DINHEIRO" | "CARTAO" | "NFE" (null se não mencionado)
- categoria: "Despesa" | "Adiantamento" | "Outro" (padrão "Despesa")

Regras:
- formaPagamento: só preencha se o usuário mencionar explicitamente
- descricao: só preencha se descreve claramente o gasto; capitalize
- Se a mensagem tiver "adiantamento" → categoria = "Adiantamento"

Exemplos:
"saida 50 material de limpeza pix" → {"valor":50,"descricao":"Material de limpeza","formaPagamento":"PIX","categoria":"Despesa"}
"gastei 120 conta de luz" → {"valor":120,"descricao":"Conta de luz","formaPagamento":null,"categoria":"Despesa"}
"saida 120 dinheiro" → {"valor":120,"descricao":null,"formaPagamento":"DINHEIRO","categoria":"Despesa"}
"despesa 80" → {"valor":80,"descricao":null,"formaPagamento":null,"categoria":"Despesa"}
"adiantamento 200" → {"valor":200,"descricao":null,"formaPagamento":null,"categoria":"Adiantamento"}

Mensagem: "${message}"`;

  try {
    const resposta = await chatCompletion(prompt, '', 'Retorne APENAS o JSON, sem texto adicional, sem markdown.');
    const json = resposta.replace(/```json?|```/g, '').trim();
    const dados = JSON.parse(json);
    const valor = Number(dados.valor);
    if (!dados.valor || isNaN(valor) || valor <= 0) return null;
    return {
      valor,
      descricao: dados.descricao || null,
      formaPagamento: dados.formaPagamento || null,
      categoria: dados.categoria || 'Despesa',
    };
  } catch {
    return null;
  }
}

/**
 * Ponto de entrada: detectou intenção de saída na mensagem inicial
 */
async function handleSaidaWhatsapp(message: string, from: string, senderName: string, empresaId: string): Promise<string> {
  const dados = await extrairDadosSaida(message);
  const pendingKey = from; // chave = JID; empresa vem do adminContextStore

  const pending: PendingSaida = {
    valor:          dados?.valor ?? 0,
    descricao:      dados?.descricao ?? null,
    formaPagamento: dados?.formaPagamento ?? null,
    categoria:      dados?.categoria ?? 'Despesa',
    fornecedorNome: undefined,
    lavadorId:      undefined,
    lavadorNome:    undefined,
    lavadoresList:  [],
    step:           'valor', // será recalculado abaixo
    empresaId,
    userName:       senderName,
    expiresAt:      Date.now() + 10 * 60 * 1000,
  };

  pending.step = getNextSaidaStep(pending);

  // Se o próximo step é lavador, pré-carrega a lista
  if (pending.step === 'lavador') {
    pending.lavadoresList = await prisma.lavador.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
  }

  pendingSaidas.set(pendingKey, pending);
  return promptForSaidaStep(pending);
}

/**
 * Processa resposta do usuário em uma etapa de coleta ativa
 */
async function handlePendingSaidaStep(message: string, pendingKey: string, senderName: string): Promise<string> {
  const pending = pendingSaidas.get(pendingKey)!;
  const resp = message.trim();
  const lower = resp.toLowerCase();

  // Cancelamento a qualquer momento
  if (/^(n[aã]o|nao|cancelar|cancel|sair|abortar|parar)$/.test(lower)) {
    pendingSaidas.delete(pendingKey);
    return '❌ Lançamento cancelado.';
  }

  // Renova sessão (usuário está ativo)
  pending.expiresAt = Date.now() + 10 * 60 * 1000;

  switch (pending.step) {
    case 'valor': {
      const val = parseFloat(resp.replace(',', '.').replace(/[^\d.]/g, ''));
      if (!val || val <= 0) {
        return '⚠️ Informe um valor válido.\n_Ex: 50, 120,50, 200_';
      }
      pending.valor = val;
      break;
    }

    case 'descricao': {
      if (resp.length < 2) {
        return '⚠️ Descrição muito curta. Descreva melhor o gasto.\nEx: _Produto químico_, _Conta de luz_';
      }
      pending.descricao = resp.charAt(0).toUpperCase() + resp.slice(1);
      break;
    }

    case 'formaPagamento': {
      const forma = parseFormaPagamento(resp);
      if (!forma) {
        return (
          `❓ Não reconheci a forma de pagamento. Escolha:\n` +
          `1️⃣ Dinheiro\n2️⃣ PIX\n3️⃣ Cartão\n4️⃣ NFe`
        );
      }
      pending.formaPagamento = forma;
      break;
    }

    case 'lavador': {
      const num = parseInt(resp, 10);
      if (!isNaN(num) && num >= 1 && num <= pending.lavadoresList.length) {
        const lav = pending.lavadoresList[num - 1];
        pending.lavadorId   = lav.id;
        pending.lavadorNome = lav.nome;
      } else {
        const lista = pending.lavadoresList.map((l, i) => `${i + 1}️⃣ ${l.nome}`).join('\n');
        return (
          `❓ Opção inválida. Escolha digitando o número:\n\n` +
          lista
        );
      }
      break;
    }

    case 'fornecedor': {
      if (/^(pular|skip|n[aã]o|nao|nenhum|-)$/.test(lower)) {
        pending.fornecedorNome = null;
      } else {
        pending.fornecedorNome = resp;
      }
      break;
    }

    case 'confirming': {
      if (/^(sim|s|yes|confirmar|confirma|ok)$/.test(lower)) {
        return await confirmarSaida(pendingKey, senderName);
      }
      pendingSaidas.delete(pendingKey);
      return '❌ Lançamento cancelado.';
    }
  }

  // Avança para próxima etapa
  pending.step = getNextSaidaStep(pending);

  // Se o próximo step é lavador, carrega a lista de funcionários
  if (pending.step === 'lavador' && pending.lavadoresList.length === 0) {
    pending.lavadoresList = await prisma.lavador.findMany({
      where: { empresaId: pending.empresaId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
  }

  pendingSaidas.set(pendingKey, pending);
  return promptForSaidaStep(pending);
}

/**
 * Cria o CaixaRegistro após confirmação final
 */
async function confirmarSaida(pendingKey: string, senderName: string): Promise<string> {
  const pending = pendingSaidas.get(pendingKey);
  if (!pending) return '❌ Sessão expirada. Tente novamente.';
  pendingSaidas.delete(pendingKey);

  try {
    const finalDescricao = `[${pending.categoria}] ${pending.descricao || 'Saída'}`;
    const formaFinal = (pending.formaPagamento || 'DINHEIRO') as any;

    // Lookup ou cria fornecedor se informado
    let fornecedorId: string | undefined;
    if (pending.fornecedorNome) {
      let fornecedor = await prisma.fornecedor.findFirst({
        where: { nome: pending.fornecedorNome, empresaId: pending.empresaId },
      });
      if (!fornecedor) {
        fornecedor = await prisma.fornecedor.create({
          data: { nome: pending.fornecedorNome, empresaId: pending.empresaId },
        });
      }
      fornecedorId = fornecedor.id;
    }

    const registro = await prisma.caixaRegistro.create({
      data: {
        empresaId: pending.empresaId,
        tipo: 'SAIDA',
        valor: pending.valor,
        formaPagamento: formaFinal,
        descricao: finalDescricao,
        ...(fornecedorId ? { fornecedorId } : {}),
        origem: 'WHATSAPP',
        lancadoPor: senderName,
      },
    });

    // Se for adiantamento com lavador vinculado, cria o registro de adiantamento
    if (pending.categoria === 'Adiantamento' && pending.lavadorId) {
      await prisma.adiantamento.create({
        data: {
          valor:          pending.valor,
          lavadorId:      pending.lavadorId,
          empresaId:      pending.empresaId,
          caixaRegistroId: registro.id,
          status:         'PENDENTE',
        },
      });
    }

    const formaLabel = FORMA_LABELS[pending.formaPagamento || 'DINHEIRO'] || pending.formaPagamento;
    const fornLine  = pending.fornecedorNome ? `\n  🏪 ${pending.fornecedorNome}` : '';
    const lavLine   = pending.lavadorNome    ? `\n  👤 Funcionário: ${pending.lavadorNome}` : '';

    return (
      `✅ *Saída registrada!*\n\n` +
      `  💰 R$ ${pending.valor.toFixed(2)}\n` +
      `  📝 ${pending.descricao || 'Saída'}\n` +
      `  💳 ${formaLabel}\n` +
      `  🏷️ ${pending.categoria}` +
      lavLine +
      fornLine +
      `\n  👤 ${senderName}`
    );
  } catch (error) {
    console.error('[WhatsApp] Erro ao criar saída:', error);
    return '❌ Erro ao registrar. Tente novamente.';
  }
}

// ==========================================
// COMANDOS PIX
// ==========================================

/**
 * Lista ordens ativas da empresa (admin: todas; lavador: só as suas)
 */
async function handleOrdensAtivas(empresaId: string, user: WhatsAppUser): Promise<string> {
  const statusAtivos = ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'];

  const where: Record<string, unknown> = { empresaId, status: { in: statusAtivos } };
  if (user.type === 'lavador') {
    where.OR = [
      { lavadorId: user.lavadorId },
      { ordemLavadores: { some: { lavadorId: user.lavadorId } } },
    ];
  }

  const ordens = await prisma.ordemServico.findMany({
    where: where as any,
    include: {
      veiculo: { select: { modelo: true, placa: true } },
      cliente: { select: { nome: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  if (ordens.length === 0) {
    return `📋 Nenhuma ordem ativa no momento.`;
  }

  const statusLabel: Record<string, string> = {
    PENDENTE: 'PENDENTE',
    EM_ANDAMENTO: 'EM ANDAMENTO',
    AGUARDANDO_PAGAMENTO: 'AGUARD. PAGAMENTO',
  };

  let r = `📋 *Ordens ativas agora (${ordens.length}):*\n\n`;
  for (const o of ordens) {
    const modelo = (o.veiculo.modelo ?? 'Veículo').toUpperCase();
    const placa = o.veiculo.placa ?? '';
    const status = statusLabel[o.status] ?? o.status;
    r += `#${o.numeroOrdem} · ${modelo} ${placa} · *R$ ${o.valorTotal.toFixed(2)}* · ${status}\n`;
  }

  r += `\n────────────────\n`;
  r += `Para gerar PIX: *pix [número]*\nEx: _pix ${ordens[0]?.numeroOrdem ?? '1'}_`;

  return r.trim();
}

/**
 * Gera ou reenvia QR Code PIX para uma ordem
 */
async function handlePixOrdem(
  numOrdem: number,
  empresaId: string,
  from: string,
  user: WhatsAppUser,
  reusar: boolean
): Promise<string> {
  // Buscar a ordem
  const ordem = await prisma.ordemServico.findFirst({
    where: { empresaId, numeroOrdem: numOrdem },
    include: {
      cliente: { select: { nome: true } },
      veiculo: { select: { modelo: true, placa: true } },
    },
  });

  if (!ordem) {
    return `❌ Ordem #${numOrdem} não encontrada.`;
  }

  // Lavador só pode gerar PIX das próprias ordens
  if (user.type === 'lavador') {
    const ehSua = ordem.lavadorId === user.lavadorId ||
      (await prisma.ordemServicoLavador.findFirst({
        where: { ordemId: ordem.id, lavadorId: user.lavadorId! },
      })) !== null;

    if (!ehSua) {
      return `❌ Você só pode gerar PIX para as suas próprias ordens.`;
    }
  }

  // Verificar status
  const statusAtivo = ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'];
  if (!statusAtivo.includes(ordem.status)) {
    return `❌ Ordem #${numOrdem} não está ativa (status: ${ordem.status}).`;
  }

  // Verificar integração bancária
  const bankIntegration = await prisma.bankIntegration.findUnique({
    where: { empresaId },
  });

  if (!bankIntegration || !bankIntegration.chavePix || !bankIntegration.ativo) {
    return `⚠️ Nenhuma integração bancária configurada.\n\nAcesse *Configurações → WhatsApp Bot → Integração PIX* para cadastrar sua chave PIX.`;
  }

  try {
    const { qrCodeBuffer, expiraEm, txId } = await gerarPixParaOrdem(ordem.id, empresaId, reusar);

    const cliente = ordem.cliente.nome;
    const modelo = (ordem.veiculo.modelo ?? 'Veículo').toUpperCase();
    const placa = ordem.veiculo.placa ?? '';
    const expMin = Math.round((expiraEm.getTime() - Date.now()) / 60000);

    const caption =
      `💳 *PIX gerado para Ordem #${numOrdem}*\n\n` +
      `👤 ${cliente} · ${modelo} ${placa}\n` +
      `💰 *R$ ${ordem.valorTotal.toFixed(2)}*\n` +
      `⏳ Válido por ${expMin} minuto(s)\n\n` +
      `Mostre este QR Code para o cliente escanear e pagar.`;

    // Enviar imagem diretamente (retornar string vazia para não duplicar msg)
    await sendImageBuffer(from, qrCodeBuffer, caption);
    return ''; // Baileys ignora string vazia

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[PIX] Erro ao gerar QR Code:', error);
    return `❌ Erro ao gerar PIX: ${msg}`;
  }
}
