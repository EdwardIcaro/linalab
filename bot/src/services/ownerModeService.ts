/**
 * Modo Owner — acesso "Deus" ao bot, sem depender de número cadastrado.
 * Qualquer aparelho pode ativar dizendo "modo owner" (ou variações) e
 * informando o PIN. Após autenticado, recebe informações globais do sistema
 * (empresas, usuários, status das instâncias, etc).
 */

import prisma from '../db';
import { getTodayFixedRangeBRT } from '../utils/dateUtils';

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
      return '🔓 Modo Owner encerrado.';
    }
    refreshSession(from);
    return handleOwnerCommand(command);
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
    `• *sair* — encerra o modo owner\n\n` +
    `_Sessão expira após 15min de inatividade._`;
}

async function handleOwnerCommand(command: string): Promise<string> {
  if (command === 'ajuda' || command === 'menu')        return ownerHelpText();
  if (command === 'empresas')                           return handleEmpresasCommand();
  if (command === 'usuarios' || command === 'usuários') return handleUsuariosCommand();
  if (command === 'status')                             return handleStatusCommand();
  if (command === 'stats' || command === 'resumo')      return handleStatsCommand();
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
