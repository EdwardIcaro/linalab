/**
 * Modo Owner — acesso "Deus" ao bot, sem depender de número cadastrado.
 * Qualquer aparelho pode ativar dizendo "modo owner" (ou variações) e
 * informando o PIN. Após autenticado, recebe informações globais do sistema
 * (empresas, usuários, status das instâncias, etc).
 */

import prisma from '../db';
import { getTodayFixedRangeBRT } from '../utils/dateUtils';
import { sendMessage as botSend } from './baileyService';

const OWNER_PIN = (process.env.OWNER_MODE_PIN || 'm4ite1105').toLowerCase();

// Normaliza para tolerar autocapitalização/pontuação automática do teclado do WhatsApp
function normalizePin(input: string): string {
  return input.trim().toLowerCase().replace(/[.,!?]+$/, '');
}

const SESSION_TTL_MS = 15 * 60 * 1000; // sessão expira após 15min de inatividade
const AUTH_TTL_MS    = 2  * 60 * 1000; // 2min para digitar o PIN após o gatilho

const MAX_ATTEMPTS  = 3;               // tentativas erradas antes de bloquear
const LOCKOUT_MS    = 15 * 60 * 1000;  // bloqueio de 15min após exceder tentativas

const TRIGGER_REGEX = /^(modo\s+(owner|admin|deus|god)|owner|god\s*mode)$/i;
const EXIT_REGEX    = /^(sair|saiir|encerrar|exit|logout)$/i;

const pendingAuth = new Map<string, number>(); // jid → expira em (ms epoch)
const sessions    = new Map<string, number>(); // jid → expira em (ms epoch)

interface AttemptInfo {
  count: number;
  lockedUntil: number; // 0 = não bloqueado
}
const attempts = new Map<string, AttemptInfo>(); // jid → tentativas erradas de PIN

const novidadesListaAtiva = new Set<string>(); // jid → está no submenu de gerenciar lista de novidades
const novidadeState = new Map<string, { fase: 'texto' } | { fase: 'confirmar'; texto: string }>(); // jid → composição em andamento

function isSessionActive(from: string): boolean {
  const exp = sessions.get(from);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(from); return false; }
  return true;
}

function refreshSession(from: string) {
  sessions.set(from, Date.now() + SESSION_TTL_MS);
}

function getLockMinutesRemaining(from: string): number {
  const info = attempts.get(from);
  if (!info || !info.lockedUntil) return 0;
  const remaining = info.lockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 60000) : 0;
}

function registerFailedAttempt(from: string) {
  const info = attempts.get(from) ?? { count: 0, lockedUntil: 0 };
  info.count += 1;
  if (info.count >= MAX_ATTEMPTS) {
    info.lockedUntil = Date.now() + LOCKOUT_MS;
    info.count = 0;
  }
  attempts.set(from, info);
}

function clearAttempts(from: string) {
  attempts.delete(from);
}

/**
 * Intercepta a mensagem para o fluxo de Modo Owner.
 * Retorna `null` se a mensagem não tem nada a ver (segue o fluxo normal),
 * ou uma string com a resposta a ser enviada.
 */
export async function handleOwnerModeMessage(from: string, message: string): Promise<string | null> {
  const command = message.trim().toLowerCase();

  // Já autenticado nesta sessão
  if (isSessionActive(from)) {
    if (EXIT_REGEX.test(command)) {
      sessions.delete(from);
      novidadesListaAtiva.delete(from);
      novidadeState.delete(from);
      return '🔓 Modo Owner encerrado.';
    }
    refreshSession(from);

    if (novidadesListaAtiva.has(from)) return handleNovidadesListaStep(from, command);
    if (novidadeState.has(from))       return handleNovidadeStep(from, message);

    return handleOwnerCommand(from, command);
  }

  // Aguardando o PIN ser digitado
  const pendingExp = pendingAuth.get(from);
  if (pendingExp) {
    if (pendingExp >= Date.now()) {
      // Bloqueado por excesso de tentativas erradas
      const lockMin = getLockMinutesRemaining(from);
      if (lockMin > 0) {
        pendingAuth.delete(from);
        return `🔒 Muitas tentativas erradas. Tente novamente em ${lockMin}min.`;
      }

      if (normalizePin(message) === OWNER_PIN) {
        pendingAuth.delete(from);
        clearAttempts(from);
        refreshSession(from);
        return `🔓 *Modo Owner ativado.*\n\n${ownerHelpText()}`;
      }

      registerFailedAttempt(from);
      const novoLockMin = getLockMinutesRemaining(from);
      if (novoLockMin > 0) {
        pendingAuth.delete(from);
        return `❌ PIN incorreto. Muitas tentativas — bloqueado por ${novoLockMin}min.`;
      }
      // mantém pendingAuth — usuário pode tentar de novo até expirar
      return '❌ PIN incorreto. Tente novamente:';
    }
    // expirou — descarta e cai para checar se a própria mensagem é um novo gatilho
    pendingAuth.delete(from);
  }

  // Gatilho de ativação
  if (TRIGGER_REGEX.test(command)) {
    const lockMin = getLockMinutesRemaining(from);
    if (lockMin > 0) {
      return `🔒 Muitas tentativas erradas. Tente novamente em ${lockMin}min.`;
    }
    pendingAuth.set(from, Date.now() + AUTH_TTL_MS);
    return '🔒 Digite o PIN de acesso ao Modo Owner:';
  }

  return null;
}

function ownerHelpText(): string {
  return `━━━━━━━━━━━━━━━\n👑 *MODO OWNER*\n━━━━━━━━━━━━━━━\n\n` +
    `• *empresas* — lista empresas cadastradas\n` +
    `• *usuarios* — lista usuários cadastrados\n` +
    `• *status* — status das instâncias WhatsApp\n` +
    `• *stats* — visão geral do sistema\n` +
    `• *novidades* — gerenciar quem recebe avisos de novidade\n` +
    `• *novidade* — enviar um aviso pra quem está na lista\n` +
    `• *sair* — encerra o modo owner\n\n` +
    `_Sessão expira após 15min de inatividade._`;
}

async function handleOwnerCommand(from: string, command: string): Promise<string> {
  if (command === 'ajuda' || command === 'menu')        return ownerHelpText();
  if (command === 'empresas')                           return handleEmpresasCommand();
  if (command === 'usuarios' || command === 'usuários') return handleUsuariosCommand();
  if (command === 'status')                             return handleStatusCommand();
  if (command === 'stats' || command === 'resumo')      return handleStatsCommand();
  if (command === 'novidades') { novidadesListaAtiva.add(from); return handleNovidadesListaStep(from, ''); }
  if (command === 'novidade')  return iniciarNovidade(from);
  return `Não reconheci esse comando.\n\n${ownerHelpText()}`;
}

async function handleEmpresasCommand(): Promise<string> {
  const empresas = await prisma.empresa.findMany({
    select: {
      nome: true,
      ativo: true,
      createdAt: true,
      usuario: { select: { email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (empresas.length === 0) return '🏢 Nenhuma empresa cadastrada.';

  let r = `🏢 *EMPRESAS CADASTRADAS* (${empresas.length})\n\n`;
  for (const e of empresas) {
    const status = e.ativo ? '✅' : '🚫';
    const data = e.createdAt.toLocaleDateString('pt-BR');
    r += `${status} *${e.nome}*\n  📧 ${e.usuario.email}\n  📅 ${data}\n\n`;
  }
  return r.trim();
}

async function handleUsuariosCommand(): Promise<string> {
  const usuarios = await prisma.usuario.findMany({
    select: {
      nome: true,
      email: true,
      role: true,
      createdAt: true,
      _count: { select: { empresas: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (usuarios.length === 0) return '👤 Nenhum usuário cadastrado.';

  let r = `👤 *USUÁRIOS CADASTRADOS* (${usuarios.length})\n\n`;
  for (const u of usuarios) {
    const data = u.createdAt.toLocaleDateString('pt-BR');
    r += `*${u.nome}* (${u.role})\n  📧 ${u.email}\n  🏢 ${u._count.empresas} empresa(s) · 📅 ${data}\n\n`;
  }
  return r.trim();
}

async function handleStatusCommand(): Promise<string> {
  const instances = await (prisma.whatsappInstance as any).findMany({
    select: { instanceName: true, status: true, empresaId: true, updatedAt: true },
    orderBy: { instanceName: 'asc' },
  });

  if (instances.length === 0) return '🤖 Nenhuma instância de WhatsApp configurada.';

  let r = `🤖 *STATUS DO SISTEMA*\n\n`;
  for (const inst of instances) {
    const emoji = inst.status === 'connected' ? '🟢' : inst.status === 'qr_code' ? '🟡' : '🔴';
    const atualizado = inst.updatedAt.toLocaleString('pt-BR');
    r += `${emoji} *${inst.instanceName}* — ${inst.status}\n  _atualizado em ${atualizado}_\n\n`;
  }
  return r.trim();
}

async function handleStatsCommand(): Promise<string> {
  const { start: hojeStart, end: hojeEnd } = getTodayFixedRangeBRT();

  const [empresas, empresasAtivas, usuarios, lavadores, subaccounts, ordensHoje] = await Promise.all([
    prisma.empresa.count(),
    prisma.empresa.count({ where: { ativo: true } }),
    prisma.usuario.count(),
    prisma.lavador.count({ where: { ativo: true } }),
    prisma.subaccount.count(),
    prisma.ordemServico.count({ where: { createdAt: { gte: hojeStart, lte: hojeEnd } } }),
  ]);

  return `📊 *VISÃO GERAL DO SISTEMA*\n\n` +
    `🏢 Empresas: *${empresas}* (${empresasAtivas} ativas)\n` +
    `👤 Usuários: *${usuarios}*\n` +
    `👷 Lavadores ativos: *${lavadores}*\n` +
    `🧑‍💼 Funcionários (subaccounts): *${subaccounts}*\n` +
    `📋 Ordens criadas hoje: *${ordensHoje}*`;
}

// ═══════════════════════════════════════════════════════════════════════════
// NOVIDADES — lista persistente de destinatários + envio de avisos
// ═══════════════════════════════════════════════════════════════════════════

async function buscarUsuariosParaNovidades() {
  const usuarios = await prisma.usuario.findMany({
    select: { id: true, nome: true, recebeNovidades: true, empresas: { select: { id: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const empresaIds = usuarios.flatMap(u => u.empresas.map(e => e.id));
  const phones = empresaIds.length > 0
    ? await (prisma.whatsappAdminPhone as any).findMany({
        where: { empresaId: { in: empresaIds }, ativo: true },
        select: { empresaId: true, telefone: true, jid: true },
      })
    : [];

  const phonesPorEmpresa = new Map<string, { telefone: string; jid: string | null }[]>();
  for (const p of phones as Array<{ empresaId: string; telefone: string; jid: string | null }>) {
    if (!phonesPorEmpresa.has(p.empresaId)) phonesPorEmpresa.set(p.empresaId, []);
    phonesPorEmpresa.get(p.empresaId)!.push({ telefone: p.telefone, jid: p.jid });
  }

  return usuarios.map(u => ({
    id: u.id,
    nome: u.nome,
    recebeNovidades: u.recebeNovidades,
    telefones: u.empresas.flatMap(e => phonesPorEmpresa.get(e.id) ?? []),
  }));
}

async function handleNovidadesListaStep(from: string, resposta: string): Promise<string> {
  const r = resposta.trim().toLowerCase();

  if (r === '0' || r === 'pronto' || r === 'fim') {
    novidadesListaAtiva.delete(from);
    return `✅ Lista de novidades atualizada.\n\n${ownerHelpText()}`;
  }

  if (/^[\d,\s]+$/.test(r) && r !== '') {
    const usuarios = await buscarUsuariosParaNovidades();
    const indices = r.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => !isNaN(i));
    for (const idx of indices) {
      const u = usuarios[idx];
      if (u) await prisma.usuario.update({ where: { id: u.id }, data: { recebeNovidades: !u.recebeNovidades } });
    }
  }

  const usuariosAtualizados = await buscarUsuariosParaNovidades();
  let texto = `📋 *LISTA DE NOVIDADES* (${usuariosAtualizados.filter(u => u.recebeNovidades).length} marcado(s))\n\n`;
  usuariosAtualizados.forEach((u, i) => {
    const marcado = u.recebeNovidades ? '✅' : '⬜';
    const alcance = u.telefones.length > 0 ? '📱' : '⚠️';
    texto += `${marcado} *${i + 1}.* ${u.nome} ${alcance}\n`;
  });
  texto += `\n_Responda com números separados por vírgula pra ligar/desligar (ex: 1,3,5), ou *0* pra sair._\n_⚠️ = sem WhatsApp pareado, não recebe mesmo se marcado._`;
  return texto;
}

async function iniciarNovidade(from: string): Promise<string> {
  const total = await prisma.usuario.count({ where: { recebeNovidades: true } });
  if (total === 0) return '📭 Nenhum destinatário na lista. Use *novidades* pra adicionar antes.';
  novidadeState.set(from, { fase: 'texto' });
  return '📢 Mande o texto da novidade (pode ter várias linhas). Envie *cancelar* pra desistir.';
}

async function handleNovidadeStep(from: string, message: string): Promise<string> {
  const state = novidadeState.get(from);
  if (!state) return handleOwnerCommand(from, 'ajuda');
  const raw = message.trim();

  if (/^cancelar$/i.test(raw)) {
    novidadeState.delete(from);
    return '❌ Novidade cancelada.';
  }

  if (state.fase === 'texto') {
    const texto = message.trim();
    novidadeState.set(from, { fase: 'confirmar', texto });
    const total = await prisma.usuario.count({ where: { recebeNovidades: true } });
    return `📢 *Prévia:*\n\n${texto}\n\n━━━━━━━━━━━━━━━\nEnviar pra *${total}* destinatário(s)? Responda *sim* ou *cancelar*.`;
  }

  // fase === 'confirmar'
  if (/^(sim|confirmar|s)$/i.test(raw)) {
    const { enviados, semWhatsapp } = await enviarNovidade(state.texto);
    novidadeState.delete(from);
    return `✅ Enviado pra *${enviados}* número(s).` +
      (semWhatsapp > 0 ? `\n⚠️ *${semWhatsapp}* usuário(s) na lista sem WhatsApp pareado (não recebeu).` : '');
  }

  return `Responda *sim* pra confirmar ou *cancelar* pra desistir.\n\n📢 *Prévia:*\n\n${state.texto}`;
}

async function enviarNovidade(texto: string): Promise<{ enviados: number; semWhatsapp: number }> {
  const destinatarios = (await buscarUsuariosParaNovidades()).filter(u => u.recebeNovidades);
  const msg = `🆕 *Novidade no Lina X*\n\n${texto}`;

  const telefonesUnicos = new Map<string, { telefone: string; jid: string | null }>();
  let semWhatsapp = 0;
  for (const u of destinatarios) {
    if (u.telefones.length === 0) { semWhatsapp++; continue; }
    for (const t of u.telefones) telefonesUnicos.set(t.telefone, t);
  }

  let enviados = 0;
  for (const t of telefonesUnicos.values()) {
    const dest = t.jid ?? `${t.telefone.replace(/\D/g, '')}@s.whatsapp.net`;
    try {
      await botSend(dest, msg);
      enviados++;
    } catch (e) {
      console.error(`[Novidade] Erro ao enviar para ${dest}:`, e);
    }
  }
  return { enviados, semWhatsapp };
}
