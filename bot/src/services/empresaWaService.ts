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
  connectedAt: number | null;
  everConnected: boolean; // já conectou alguma vez nesta sessão (passou da fase de QR)
}

const BASE_DELAY    = 5000;
const MAX_DELAY     = 60000;
const MAX_RECONNECT = 50;
// Sessão que nunca conectou (fase de QR): limita ciclos de geração de QR sem scan.
// Evita loop infinito de "gera 6 QRs → timeout → reconecta" que troca o QR sem parar.
const MAX_QR_CYCLES = 3;

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
      reconnectCount: 0, reconnectDelay: BASE_DELAY, isInitializing: false, connectedAt: null,
      everConnected: false,
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

/** Limpa o auth (arquivos locais + authState no banco) — usado quando a sessão
 *  corrompe (badSession 500). Não mexe no status: o reconnect gera QR novo e
 *  re-pareia do zero. */
async function clearAuthState(empresaId: string): Promise<void> {
  const dir = authDir(empresaId);
  try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch {}
  try {
    await (prisma as any).whatsappEmpresaSession.updateMany({
      where: { empresaId },
      data:  { authState: null },
    });
  } catch (err) {
    console.error(`[EmpresaWA:${empresaId}] Erro ao limpar auth corrompido:`, err);
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
  st.isInitializing  = true;
  st.status          = 'CONECTANDO';
  // ⚠️ NÃO zerar reconnectCount aqui: como o próprio reconnect chama connectEmpresa,
  // zerar aqui fazia o MAX_RECONNECT/MAX_QR_CYCLES nunca serem atingidos (loop infinito).
  // O contador é zerado em 'open' (sucesso) e no desistir/disconnect.

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
      // Cada QR vive 60s (default do Baileys é 60s só no 1º e 20s nos seguintes).
      // Sem isso os QRs trocavam a cada 20s e o usuário não conseguia escanear a tempo.
      qrTimeout: 60000,
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
        console.log(`[EmpresaWA:${empresaId}] QR gerado @ ${new Date().toISOString()}`);
        try {
          await (prisma as any).whatsappEmpresaSession.upsert({
            where:  { empresaId },
            create: { empresaId, status: 'QR', qrCode: st.qrDataUrl },
            update: { status: 'QR', qrCode: st.qrDataUrl },
          });
        } catch (e) {
          console.error(`[EmpresaWA:${empresaId}] Erro ao salvar QR no banco:`, e);
        }
      }

      if (connection === 'open') {
        st.status         = 'CONECTADO';
        st.qrDataUrl      = null;
        st.reconnectCount  = 0;
        st.reconnectDelay  = BASE_DELAY;
        st.isInitializing  = false;
        st.connectedAt     = Date.now();
        st.everConnected   = true;
        const phone = sock.user?.id?.split(':')[0] ?? null;
        console.log(`[EmpresaWA:${empresaId}] ✅ Conectado: ${phone}`);
        try {
          await (prisma as any).whatsappEmpresaSession.upsert({
            where:  { empresaId },
            create: { empresaId, status: 'CONECTADO', phoneNumber: phone, connectedAt: new Date(), qrCode: null },
            update: { status: 'CONECTADO', phoneNumber: phone, connectedAt: new Date(), qrCode: null },
          });
        } catch {}
      }

      if (connection === 'close') {
        const code        = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const logoutCode  = _DisconnectReason?.loggedOut ?? 401;
        const restartCode = _DisconnectReason?.restartRequired ?? 515;
        const badSessCode = _DisconnectReason?.badSession ?? 500;
        const isLogout    = code === logoutCode && st.status === 'CONECTADO';
        const isRestart   = code === restartCode;
        const isBadSession = code === badSessCode;
        // Nunca conectou → está na fase de QR: limita os ciclos (evita trocar QR pra sempre).
        // Já conectou antes → queda de conexão: permite muitas tentativas (resiliência).
        const emFaseQr    = !st.everConnected;
        const limite      = emFaseQr ? MAX_QR_CYCLES : MAX_RECONNECT;
        const shouldRetry = !isLogout && st.reconnectCount < limite;

        st.socket        = null;
        st.isInitializing = false;

        // badSession (500): auth corrompido. Limpar antes de reconectar para
        // re-parear do zero — senão o WhatsApp derruba a cada ~10s em loop.
        if (isBadSession && shouldRetry) {
          console.log(`[EmpresaWA:${empresaId}] Sessão corrompida (badSession) — limpando auth para re-parear`);
          await clearAuthState(empresaId);
        }

        if (shouldRetry) {
          st.reconnectCount++;
          // Conexão instável: se ficou conectado menos de 10s, aplica backoff progressivo
          const wasUnstable = st.connectedAt !== null && (Date.now() - st.connectedAt) < 10000;
          if (wasUnstable) st.reconnectDelay = Math.min(st.reconnectDelay * 1.5, MAX_DELAY);
          const delay = isRestart ? 2000 : st.reconnectDelay;
          if (!isRestart) st.reconnectDelay = Math.min(st.reconnectDelay * 1.5, MAX_DELAY);
          st.connectedAt = null;
          console.log(`[EmpresaWA:${empresaId}] Fechou (code=${code}, fase=${emFaseQr ? 'QR' : 'conectado'}) — reconectando em ${delay / 1000}s (${st.reconnectCount}/${limite})`);
          setTimeout(() => connectEmpresa(empresaId).catch(console.error), delay);
          try {
            await (prisma as any).whatsappEmpresaSession.updateMany({
              where: { empresaId },
              data:  { qrCode: null },
            });
          } catch {}
        } else {
          st.status         = 'DESCONECTADO';
          st.qrDataUrl      = null;
          // Zera o contador para que um novo clique em "Conectar" comece limpo.
          st.reconnectCount = 0;
          st.reconnectDelay = BASE_DELAY;
          try {
            await (prisma as any).whatsappEmpresaSession.updateMany({
              where: { empresaId },
              data:  { status: 'DESCONECTADO', qrCode: null, ...(isLogout ? { authState: null } : {}) },
            });
          } catch {}
          console.log(`[EmpresaWA:${empresaId}] ${isLogout ? 'Logout real — auth limpo' : (emFaseQr ? 'QR não escaneado — geração pausada' : 'Max tentativas atingido')}`);
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

  const results = await st.socket.onWhatsApp(digits);
  const found   = Array.isArray(results) ? results[0] : results;
  if (!found?.exists) throw new Error(`Número ${telefone} não encontrado no WhatsApp`);
  await st.socket.sendMessage(found.jid ?? jid, { text: texto });
}

export async function disconnectEmpresa(empresaId: string): Promise<void> {
  const st = sessions.get(empresaId);
  if (st?.socket) { try { await st.socket.logout(); } catch {} st.socket = null; }
  if (st) {
    st.status         = 'DESCONECTADO';
    st.qrDataUrl      = null;
    st.reconnectCount = 0;
    st.reconnectDelay = BASE_DELAY;
    st.connectedAt    = null;
    st.isInitializing = false;
    st.everConnected  = false;
  }
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
