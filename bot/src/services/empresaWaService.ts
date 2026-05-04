/**
 * Sessões WhatsApp passivas por empresa.
 * Cada empresa conecta seu próprio número. As sessões NUNCA respondem
 * mensagens recebidas — apenas enviam quando acionadas pelo sistema.
 * Segue o mesmo padrão de persistência do baileyService.ts.
 */

import type { WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import prisma from '../db';

interface EmpresaState {
  socket: WASocket | null;
  status: 'CONECTADO' | 'DESCONECTADO' | 'CONECTANDO' | 'QR';
  qrDataUrl: string | null;
  reconnectCount: number;
  reconnectDelay: number;
  isInitializing: boolean;
}

const BASE_DELAY    = 5000;
const MAX_DELAY     = 60000;
const MAX_RECONNECT = 50;

const sessions = new Map<string, EmpresaState>();

let _makeWASocket: any            = null;
let _useMultiFileAuthState: any   = null;
let _fetchLatestBaileysVersion: any = null;
let _Browsers: any                = null;
let _DisconnectReason: any        = null;
let _QRCode: any                  = null;
let _baileysLoaded                = false;

async function loadBaileys() {
  if (_baileysLoaded) return;
  const dynamicImport = new Function('module', 'return import(module)');
  const baileysMod    = await dynamicImport('@whiskeysockets/baileys') as any;
  const qrMod         = await dynamicImport('qrcode') as any;
  const def = baileysMod.default || baileysMod;
  _makeWASocket             = baileysMod.makeWASocket ?? def?.makeWASocket ?? def;
  _useMultiFileAuthState    = baileysMod.useMultiFileAuthState;
  _fetchLatestBaileysVersion = baileysMod.fetchLatestBaileysVersion;
  _Browsers                 = baileysMod.Browsers;
  _DisconnectReason         = baileysMod.DisconnectReason;
  _QRCode                   = qrMod.default || qrMod;
  _baileysLoaded = true;
}

function getState(empresaId: string): EmpresaState {
  if (!sessions.has(empresaId)) {
    sessions.set(empresaId, {
      socket: null, status: 'DESCONECTADO', qrDataUrl: null,
      reconnectCount: 0, reconnectDelay: BASE_DELAY, isInitializing: false,
    });
  }
  return sessions.get(empresaId)!;
}

function authDir(empresaId: string): string {
  return join(tmpdir(), `baileys-empresa-${empresaId}`);
}

async function restoreAuthFromDb(empresaId: string): Promise<void> {
  try {
    const dir = authDir(empresaId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const session = await (prisma as any).whatsappEmpresaSession.findUnique({ where: { empresaId } });
    if (!session?.authState) return;
    const authFiles = JSON.parse(session.authState) as Record<string, string>;
    for (const [f, c] of Object.entries(authFiles)) writeFileSync(join(dir, f), c, 'utf-8');
    console.log(`[EmpresaWA:${empresaId}] Auth restaurado (${Object.keys(authFiles).length} arquivos)`);
  } catch (err) {
    console.error(`[EmpresaWA:${empresaId}] Erro ao restaurar auth:`, err);
  }
}

async function persistAuthToDb(empresaId: string): Promise<void> {
  try {
    const dir = authDir(empresaId);
    if (!existsSync(dir)) return;
    const files = readdirSync(dir);
    if (!files.length) return;
    const authFiles: Record<string, string> = {};
    for (const f of files) authFiles[f] = readFileSync(join(dir, f), 'utf-8');
    const authState = JSON.stringify(authFiles);

    const doUpsert = () => (prisma as any).whatsappEmpresaSession.upsert({
      where:  { empresaId },
      create: { empresaId, authState, status: 'DESCONECTADO' },
      update: { authState },
    });

    try {
      await doUpsert();
    } catch (err: any) {
      if (err?.code === 'P1017') {
        await prisma.$disconnect();
        await prisma.$connect();
        await doUpsert();
      } else throw err;
    }
  } catch (err) {
    console.error(`[EmpresaWA:${empresaId}] Erro ao persistir auth:`, err);
  }
}

export async function restoreAllEmpresaSessions(): Promise<void> {
  try {
    const rows = await (prisma as any).whatsappEmpresaSession.findMany({
      where: { status: 'CONECTADO' },
      select: { empresaId: true },
    });
    console.log(`[EmpresaWA] Restaurando ${rows.length} sessão(ões)...`);
    for (const { empresaId } of rows) {
      connectEmpresa(empresaId).catch(err =>
        console.error(`[EmpresaWA:${empresaId}] Erro ao restaurar:`, err)
      );
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error('[EmpresaWA] Erro ao listar sessões para restaurar:', err);
  }
}

export async function connectEmpresa(empresaId: string): Promise<void> {
  const st = getState(empresaId);
  if (st.socket || st.isInitializing) return;
  st.isInitializing = true;
  st.status = 'CONECTANDO';

  try {
    await loadBaileys();
    await restoreAuthFromDb(empresaId);

    const dir = authDir(empresaId);
    mkdirSync(dir, { recursive: true });

    let version: number[] = [2, 3000, 1023000166];
    try {
      const v = await _fetchLatestBaileysVersion();
      if (v?.version?.length === 3) version = v.version;
    } catch {}

    const { state: authState, saveCreds } = await _useMultiFileAuthState(dir);

    const sock: WASocket = _makeWASocket({
      version,
      auth: authState,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: _Browsers.macOS('Safari'),
      generateHighQualityLinkPreview: false,
      keepAliveIntervalMs: 15000,
      getMessage: async () => ({ conversation: '' }),
    });

    st.socket = sock;

    sock.ev.on('creds.update', async () => {
      try { mkdirSync(dir, { recursive: true }); await saveCreds(); } catch { return; }
      await persistAuthToDb(empresaId);
    });

    // Sessão passiva — NÃO processa mensagens recebidas
    sock.ev.on('messages.upsert', () => {});

    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try { st.qrDataUrl = await _QRCode.toDataURL(qr); st.status = 'QR'; } catch {}
        console.log(`[EmpresaWA:${empresaId}] QR gerado`);
      }

      if (connection === 'open') {
        st.status         = 'CONECTADO';
        st.qrDataUrl      = null;
        st.reconnectCount  = 0;
        st.reconnectDelay  = BASE_DELAY;
        st.isInitializing  = false;
        const phone = sock.user?.id?.split(':')[0] ?? null;
        console.log(`[EmpresaWA:${empresaId}] ✅ Conectado: ${phone}`);
        try {
          await (prisma as any).whatsappEmpresaSession.upsert({
            where:  { empresaId },
            create: { empresaId, status: 'CONECTADO', phoneNumber: phone, connectedAt: new Date() },
            update: { status: 'CONECTADO', phoneNumber: phone, connectedAt: new Date() },
          });
        } catch {}
      }

      if (connection === 'close') {
        const code        = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const logoutCode  = _DisconnectReason?.loggedOut ?? 401;
        const restartCode = _DisconnectReason?.restartRequired ?? 515;
        const isLogout    = code === logoutCode && st.status === 'CONECTADO';
        const isRestart   = code === restartCode;
        const shouldRetry = !isLogout && st.reconnectCount < MAX_RECONNECT;

        st.socket        = null;
        st.isInitializing = false;

        if (shouldRetry) {
          st.reconnectCount++;
          const delay = isRestart ? 2000 : st.reconnectDelay;
          st.reconnectDelay = Math.min(st.reconnectDelay * 1.5, MAX_DELAY);
          console.log(`[EmpresaWA:${empresaId}] Reconectando em ${delay / 1000}s (${st.reconnectCount}/${MAX_RECONNECT})`);
          setTimeout(() => connectEmpresa(empresaId).catch(console.error), delay);
        } else {
          st.status    = 'DESCONECTADO';
          st.qrDataUrl = null;
          try {
            await (prisma as any).whatsappEmpresaSession.updateMany({
              where: { empresaId },
              data:  { status: 'DESCONECTADO', ...(isLogout ? { authState: null } : {}) },
            });
          } catch {}
          console.log(`[EmpresaWA:${empresaId}] ${isLogout ? 'Logout real — auth limpo' : 'Max tentativas atingido'}`);
        }
      }
    });

  } catch (err) {
    st.isInitializing = false;
    st.status = 'DESCONECTADO';
    throw err;
  }
}

export function getEmpresaStatus(empresaId: string): { status: string; qrDataUrl?: string } {
  const st = sessions.get(empresaId);
  if (!st) return { status: 'DESCONECTADO' };
  return { status: st.status, ...(st.qrDataUrl ? { qrDataUrl: st.qrDataUrl } : {}) };
}

export async function sendEmpresaMessage(empresaId: string, telefone: string, texto: string): Promise<void> {
  const st = sessions.get(empresaId);
  if (!st?.socket || st.status !== 'CONECTADO') throw new Error('WhatsApp da empresa não está conectado');
  const digits = telefone.replace(/\D/g, '');
  const jid    = `${digits.startsWith('55') ? digits : '55' + digits}@s.whatsapp.net`;

  // Verificar se o número existe no WhatsApp antes de enviar
  try {
    const results = await st.socket.onWhatsApp(digits);
    const found   = Array.isArray(results) ? results[0] : results;
    console.log(`[EmpresaWA:${empresaId}] onWhatsApp(${digits}):`, found);
    if (!found?.exists) throw new Error(`Número ${telefone} não encontrado no WhatsApp`);
    const resolvedJid = found.jid ?? jid;
    console.log(`[EmpresaWA:${empresaId}] Enviando para JID resolvido: ${resolvedJid}`);
    const result = await st.socket.sendMessage(resolvedJid, { text: texto });
    console.log(`[EmpresaWA:${empresaId}] sendMessage retornou:`, result?.key?.id ?? 'sem key');
  } catch (err) {
    console.error(`[EmpresaWA:${empresaId}] Erro ao enviar:`, err);
    throw err;
  }
}

export async function disconnectEmpresa(empresaId: string): Promise<void> {
  const st = sessions.get(empresaId);
  if (st?.socket) { try { await st.socket.logout(); } catch {} st.socket = null; }
  if (st) { st.status = 'DESCONECTADO'; st.qrDataUrl = null; }
  try {
    await (prisma as any).whatsappEmpresaSession.updateMany({
      where: { empresaId },
      data:  { status: 'DESCONECTADO', authState: null, phoneNumber: null },
    });
  } catch {}
  const dir = authDir(empresaId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  console.log(`[EmpresaWA:${empresaId}] Desconectado — auth limpo`);
}
