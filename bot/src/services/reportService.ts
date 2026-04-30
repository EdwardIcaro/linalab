/**
 * reportService — módulo de Report de Avaria
 * Gerencia estado multi-step, disco e banco para o fluxo lavador → admin.
 */

import { join, resolve } from 'path';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import prisma from '../db';
import { getTodayStrBRT } from '../utils/dateUtils';

// Diretório raiz das fotos — bot/reports/
export const REPORTS_ROOT = resolve(__dirname, '../../reports');

// ==========================================
// ESTADO MULTI-STEP — LAVADOR
// ==========================================
type ReportStep = 'escolha_ordem' | 'descricao' | 'fotos';

interface PendingReport {
  step: ReportStep;
  ordemId: string | null;
  ordemNumero: number | null;
  ordemModelo: string | null;
  ordemPlaca: string | null;
  lavadorId: string;
  empresaId: string;
  descricao: string | null;
  fotosTemp: string[];
  ordensCache: any[];
  expiresAt: number;
}

export const pendingReports = new Map<string, PendingReport>();

// ==========================================
// ESTADO — ADMIN AGUARDANDO RESPOSTA 1/2
// ==========================================
const pendingAdminReportView = new Map<string, string>(); // JID → reportId

export function setPendingAdminReportView(jid: string, reportId: string) {
  pendingAdminReportView.set(jid, reportId);
  setTimeout(() => pendingAdminReportView.delete(jid), 5 * 60 * 1000);
}

export function hasPendingAdminReportView(jid: string): boolean {
  return pendingAdminReportView.has(jid);
}

// ==========================================
// ESTADO — ADMIN NAVEGANDO LISTA DE REPORTS
// ==========================================
const pendingReportsList = new Map<string, any[]>(); // JID → reports[]

// ==========================================
// LIMPEZA PERIÓDICA DE SESSÕES EXPIRADAS
// ==========================================
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingReports.entries()) {
    if (val.expiresAt < now) pendingReports.delete(key);
  }
}, 5 * 60 * 1000);

// ==========================================
// DISCO — SALVAR FOTO
// ==========================================
export function saveFotoReport(ordemNumero: number, sequencia: number, buffer: Buffer): string {
  const dateStr = getTodayStrBRT();
  const dir = join(REPORTS_ROOT, dateStr);
  mkdirSync(dir, { recursive: true });
  const filename = `ord${ordemNumero}-${Date.now()}-${sequencia}.jpg`;
  writeFileSync(join(dir, filename), buffer);
  return `reports/${dateStr}/${filename}`;
}

// ==========================================
// FLUXO LAVADOR — INICIAR
// ==========================================
export async function handleReportarCommand(jid: string, lavadorId: string, empresaId: string): Promise<string> {
  const ordens = await (prisma as any).ordemServico.findMany({
    where: { empresaId, lavadorId, status: { in: ['PENDENTE', 'EM_ANDAMENTO'] } },
    include: {
      veiculo: { select: { modelo: true, placa: true } },
      cliente: { select: { nome: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 9,
  });

  if (ordens.length === 0) {
    return '❌ Você não tem ordens ativas no momento.';
  }

  const lista = ordens.map((o: any, i: number) =>
    `*${i + 1}* · #${o.numeroOrdem} · ${o.veiculo?.modelo ?? 'Veículo'} (${o.veiculo?.placa ?? ''}) — ${o.cliente?.nome ?? 'sem cliente'}`
  ).join('\n');

  pendingReports.set(jid, {
    step: 'escolha_ordem',
    ordemId: null, ordemNumero: null, ordemModelo: null, ordemPlaca: null,
    lavadorId, empresaId,
    descricao: null,
    fotosTemp: [],
    ordensCache: ordens,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  return `Suas ordens ativas:\n\n${lista}\n\n*0* · Cancelar\n\nDigite o número da ordem com avaria:`;
}

// ==========================================
// FLUXO LAVADOR — PASSOS DE TEXTO
// ==========================================
export async function handleReportStep(jid: string, message: string): Promise<string> {
  const state = pendingReports.get(jid)!;
  const msg   = message.trim();

  if (msg === '0' || /^cancelar$/i.test(msg)) {
    pendingReports.delete(jid);
    return '❌ Report cancelado.';
  }

  if (state.step === 'escolha_ordem') {
    const idx = parseInt(msg) - 1;
    if (isNaN(idx) || idx < 0 || idx >= state.ordensCache.length) {
      return `❌ Opção inválida. Digite um número de 1 a ${state.ordensCache.length} ou *0* para cancelar.`;
    }
    const ordem = state.ordensCache[idx];
    state.ordemId     = ordem.id;
    state.ordemNumero = ordem.numeroOrdem;
    state.ordemModelo = ordem.veiculo?.modelo ?? 'Veículo';
    state.ordemPlaca  = ordem.veiculo?.placa  ?? '';
    state.step        = 'descricao';
    state.expiresAt   = Date.now() + 10 * 60 * 1000;
    return `Ordem *#${ordem.numeroOrdem} — ${state.ordemModelo} (${state.ordemPlaca})*\n\nDescreva o problema encontrado:`;
  }

  if (state.step === 'descricao') {
    if (msg.length < 5) return '❌ Descrição muito curta. Descreva o problema com mais detalhes.';
    state.descricao = msg;
    state.step      = 'fotos';
    state.expiresAt = Date.now() + 10 * 60 * 1000;
    return `📷 Envie as fotos do problema.\n\nDigite *pronto* quando terminar de enviar.`;
  }

  if (state.step === 'fotos') {
    if (/^pronto$/i.test(msg)) {
      if (state.fotosTemp.length === 0) return '⚠️ Envie pelo menos 1 foto antes de finalizar.';
      return finalizeReport(jid, state);
    }
    return '📷 Envie a(s) foto(s) ou digite *pronto* para finalizar.';
  }

  return '❓ Não entendi. Envie uma foto ou digite *pronto*.';
}

// ==========================================
// FLUXO LAVADOR — RECEBER IMAGEM
// ==========================================
export async function handleIncomingImageForReport(jid: string, buffer: Buffer): Promise<string | null> {
  const state = pendingReports.get(jid);
  if (!state || state.step !== 'fotos') return null;

  state.expiresAt = Date.now() + 10 * 60 * 1000;
  const seq  = state.fotosTemp.length + 1;
  const path = saveFotoReport(state.ordemNumero!, seq, buffer);
  state.fotosTemp.push(path);

  return `📷 Foto ${seq} recebida. Envie mais ou digite *pronto* para finalizar.`;
}

// ==========================================
// FINALIZAR REPORT
// ==========================================
async function finalizeReport(jid: string, state: PendingReport): Promise<string> {
  const report = await (prisma as any).ordemReport.create({
    data: {
      ordemId:   state.ordemId!,
      lavadorId: state.lavadorId,
      empresaId: state.empresaId,
      descricao: state.descricao!,
      fotos:     JSON.stringify(state.fotosTemp),
    },
    include: { lavador: { select: { nome: true } } },
  });

  pendingReports.delete(jid);

  notifyAdminsNewReport(state.empresaId, {
    reportId:    report.id,
    ordemNumero: state.ordemNumero!,
    ordemModelo: state.ordemModelo!,
    ordemPlaca:  state.ordemPlaca!,
    lavadorNome: report.lavador.nome,
    descricao:   state.descricao!,
    fotosCount:  state.fotosTemp.length,
  }).catch(e => console.error('[Report] Erro ao notificar admin:', e));

  return `✅ *Report salvo!*\nOrdem #${state.ordemNumero} · ${state.fotosTemp.length} foto(s)\nO admin foi notificado.`;
}

// ==========================================
// NOTIFICAR ADMINS (fire-and-forget)
// ==========================================
async function notifyAdminsNewReport(empresaId: string, dados: {
  reportId: string; ordemNumero: number; ordemModelo: string; ordemPlaca: string;
  lavadorNome: string; descricao: string; fotosCount: number;
}): Promise<void> {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { notificationPreferences: true },
  });
  const prefs = (empresa?.notificationPreferences as any)?.whatsapp ?? {};
  if (prefs.reportAvaria === false) return; // padrão true

  const admins = await (prisma.whatsappAdminPhone as any).findMany({
    where: { empresaId, ativo: true },
    select: { jid: true, telefone: true },
  }) as Array<{ jid: string | null; telefone: string }>;

  if (admins.length === 0) return;

  const { sendMessage: botSend } = await import('./baileyService');

  const agora = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const msg =
    `⚠️ *Report de Avaria — Ordem #${dados.ordemNumero}*\n` +
    `Lavador: ${dados.lavadorNome} · ${dados.ordemModelo} (${dados.ordemPlaca})\n` +
    `_${dados.descricao}_\n` +
    `📷 ${dados.fotosCount} foto(s) · ${agora}\n\n` +
    `*1* · Ver fotos\n*2* · Ignorar`;

  for (const admin of admins) {
    const dest = admin.jid ?? `${admin.telefone.replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      await botSend(dest, msg);
      setPendingAdminReportView(dest, dados.reportId);
    } catch (e) {
      console.error(`[Report] Erro ao notificar ${dest}:`, e);
    }
  }
}

// ==========================================
// ADMIN — RESPOSTA À NOTIFICAÇÃO (1/2)
// ==========================================
export async function handleAdminReportResponse(jid: string, choice: string): Promise<string> {
  const reportId = pendingAdminReportView.get(jid);
  if (!reportId) return '';

  pendingAdminReportView.delete(jid);

  if (choice === '2') return '✅ Report ignorado.';

  if (choice === '1') return sendReportFotos(jid, reportId);

  return '';
}

// ==========================================
// ADMIN — COMANDO "reports"
// ==========================================
export async function handleReportsCommand(jid: string, empresaId: string): Promise<string> {
  const reports = await (prisma as any).ordemReport.findMany({
    where: { empresaId, visto: false },
    include: {
      ordem:   { select: { numeroOrdem: true } },
      lavador: { select: { nome: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 9,
  });

  if (reports.length === 0) return '📋 Nenhum report pendente.';

  pendingReportsList.set(jid, reports);
  setTimeout(() => pendingReportsList.delete(jid), 5 * 60 * 1000);

  const lista = reports.map((r: any, i: number) => {
    const fotos: string[] = JSON.parse(r.fotos || '[]');
    const data = new Date(r.createdAt).toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
    });
    const desc = r.descricao.length > 55 ? r.descricao.slice(0, 55) + '…' : r.descricao;
    return `*${i + 1}* · #${r.ordem.numeroOrdem} · ${r.lavador.nome} · ${data}\n   _${desc}_ · 📷 ${fotos.length}`;
  }).join('\n\n');

  return `📋 *REPORTS PENDENTES*\n\n${lista}\n\nDigite o número para ver as fotos ou *0* para fechar.`;
}

export function hasPendingReportsList(jid: string): boolean {
  return pendingReportsList.has(jid);
}

export async function handleReportsListSelection(jid: string, choice: string): Promise<string> {
  const reports = pendingReportsList.get(jid);
  if (!reports) return '';

  if (choice === '0') {
    pendingReportsList.delete(jid);
    return '✅ Fechado.';
  }

  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= reports.length) return '';

  pendingReportsList.delete(jid);
  const report = reports[idx];

  await (prisma as any).ordemReport.update({ where: { id: report.id }, data: { visto: true } });

  return sendReportFotos(jid, report.id);
}

// ==========================================
// ENVIAR FOTOS PARA UM JID
// ==========================================
async function sendReportFotos(jid: string, reportId: string): Promise<string> {
  const report = await (prisma as any).ordemReport.findUnique({ where: { id: reportId } });
  if (!report) return '❌ Report não encontrado.';

  const fotos: string[] = JSON.parse(report.fotos || '[]');
  if (fotos.length === 0) return '⚠️ As fotos deste report expiraram ou não estão disponíveis.';

  await (prisma as any).ordemReport.update({ where: { id: reportId }, data: { visto: true } });

  const { sendImageBuffer: botSendImage } = await import('./baileyService');

  let enviadas = 0;
  for (let i = 0; i < fotos.length; i++) {
    const filePath = join(REPORTS_ROOT, '..', fotos[i].replace(/^reports\//, ''));
    if (existsSync(filePath)) {
      const buf = readFileSync(filePath);
      await botSendImage(jid, buf, `📷 ${i + 1}/${fotos.length}`);
      enviadas++;
    }
  }

  if (enviadas === 0) return '⚠️ As fotos expiraram ou foram removidas.';
  return '';
}
