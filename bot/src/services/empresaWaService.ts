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
  qrShownAt: number | null; // quando o QR atual foi exibido (para distinguir timeout real de erro de stream)
  qrTimeoutCount: number;   // quantos QRs expiraram sem scan (usuário ausente)
  qrErrorCount: number;     // quantas quedas por erro de stream durante o pareamento
}

const BASE_DELAY    = 5000;
const MAX_DELAY     = 60000;
const MAX_RECONNECT = 50;
// Fase de QR (nunca conectou). Distinguimos DOIS motivos de queda:
//  • QR expirou sem scan (~60s no ar) → usuário ausente. Após MAX_QR_TIMEOUTS, pausa.
//  • Queda precoce por erro de stream (badSession 500 / connectionClosed 428) → é o WhatsApp
//    rejeitando o pareamento. ⚠️ Reconexão AGRESSIVA aqui dispara o anti-abuso do WhatsApp
//    ("não é possível conectar novos dispositivos neste momento") e bloqueia o número. Por
//    isso: poucas tentativas, com intervalo LONGO, dando fôlego para o WhatsApp.
const MAX_QR_TIMEOUTS   = 3;      // QRs expirados sem scan antes de pausar (≈3 min)
const MAX_QR_ERRORS     = 4;      // quedas por erro de stream antes de pausar (evita rate-limit)
const QR_ERROR_DELAY    = 20000;  // 20s entre tentativas — NÃO martelar o WhatsApp
const QR_LIFE_THRESHOLD = 45000;  // QR vivo ≥45s = expirou sem scan; <45s = erro de stream

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
      everConnected: false, qrShownAt: null, qrTimeoutCount: 0, qrErrorCount: 0,
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
    // Limpa sessões presas em QR/CONECTANDO de execuções anteriores: após um restart
    // não existe socket vivo para elas, então o status estava mentindo para o frontend.
    try {
      const limpas = await (prisma as any).whatsappEmpresaSession.updateMany({
        where: { status: { in: ['QR', 'CONECTANDO'] } },
        data:  { status: 'DESCONECTADO', qrCode: null },
      });
      if (limpas.count) console.log(`[EmpresaWA] ${limpas.count} sessão(ões) presas em QR/CONECTANDO resetadas para DESCONECTADO`);
    } catch (e) {
      console.error('[EmpresaWA] Erro ao limpar sessões presas:', e);
    }

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
    let versionSource = 'fallback';
    try {
      const v = await _fetchLatestBaileysVersion();
      if (v?.version?.length === 3) { version = v.version; versionSource = 'online'; }
    } catch {}
    console.log(`[EmpresaWA:${empresaId}] Versão WA: ${version.join('.')} (${versionSource})`);

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
      const { connection, lastDisconnect, qr, isNewLogin, receivedPendingNotifications } = update;

      // Diagnóstico do pareamento: loga cada transição relevante (sem o qr em si)
      if (connection || isNewLogin !== undefined) {
        console.log(`[EmpresaWA:${empresaId}] update: connection=${connection ?? '-'} isNewLogin=${isNewLogin ?? '-'} pending=${receivedPendingNotifications ?? '-'} code=${(lastDisconnect?.error as Boom)?.output?.statusCode ?? '-'}`);
      }

      if (qr) {
        try { st.qrDataUrl = await _QRCode.toDataURL(qr); st.status = 'QR'; } catch {}
        st.qrShownAt = Date.now(); // marca quando ESTE QR foi exibido
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
        st.qrShownAt       = null;
        st.qrTimeoutCount  = 0;
        st.qrErrorCount    = 0;
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
        const isLogout    = code === logoutCode && st.status === 'CONECTADO';
        const isRestart   = code === restartCode;
        const emFaseQr    = !st.everConnected;

        st.socket        = null;
        st.isInitializing = false;

        // ── Fase de QR (ainda não pareou) ─────────────────────────────────────
        // Duas causas de queda com tratamento distinto:
        //   • QR ficou no ar ≥45s → expirou sem scan (usuário ausente): conta como
        //     timeout; após MAX_QR_TIMEOUTS pausa a geração.
        //   • Queda precoce (<45s): erro de stream (badSession 500 / 428) porque o
        //     WhatsApp derruba o handshake novo enquanto outra empresa está conectada.
        //     NÃO é culpa do usuário nem QR expirado → reconecta rápido (2s) e tolera
        //     muitas tentativas (MAX_QR_ERRORS) até o WA aceitar o pareamento.
        if (emFaseQr && !isLogout && !isRestart) {
          const viveu       = st.qrShownAt ? Date.now() - st.qrShownAt : 0;
          const expirou     = viveu >= QR_LIFE_THRESHOLD;
          if (expirou) st.qrTimeoutCount++; else st.qrErrorCount++;
          const shouldRetry = st.qrTimeoutCount < MAX_QR_TIMEOUTS && st.qrErrorCount < MAX_QR_ERRORS;

          if (shouldRetry) {
            const delay = expirou ? 1000 : QR_ERROR_DELAY;
            console.log(`[EmpresaWA:${empresaId}] Fechou (code=${code}, fase=QR, ${expirou ? 'QR expirou' : 'erro de stream'}) — reconectando em ${delay / 1000}s (timeouts ${st.qrTimeoutCount}/${MAX_QR_TIMEOUTS}, erros ${st.qrErrorCount}/${MAX_QR_ERRORS})`);
            setTimeout(() => connectEmpresa(empresaId).catch(console.error), delay);
            try {
              await (prisma as any).whatsappEmpresaSession.updateMany({ where: { empresaId }, data: { qrCode: null } });
            } catch {}
          } else {
            st.status = 'DESCONECTADO'; st.qrDataUrl = null; st.qrShownAt = null;
            st.qrTimeoutCount = 0; st.qrErrorCount = 0;
            try {
              await (prisma as any).whatsappEmpresaSession.updateMany({
                where: { empresaId }, data: { status: 'DESCONECTADO', qrCode: null },
              });
            } catch {}
            console.log(`[EmpresaWA:${empresaId}] Pareamento pausado (${st.qrTimeoutCount >= MAX_QR_TIMEOUTS ? 'QR não escaneado' : 'WhatsApp recusou o handshake repetidamente'}) — clique em Conectar para tentar de novo`);
          }
          return;
        }

        // ── Já conectou alguma vez → queda de conexão: resiliência alta ───────
        const shouldRetry = !isLogout && st.reconnectCount < MAX_RECONNECT;
        if (shouldRetry) {
          st.reconnectCount++;
          const wasUnstable = st.connectedAt !== null && (Date.now() - st.connectedAt) < 10000;
          if (wasUnstable) st.reconnectDelay = Math.min(st.reconnectDelay * 1.5, MAX_DELAY);
          const delay = isRestart ? 2000 : st.reconnectDelay;
          if (!isRestart) st.reconnectDelay = Math.min(st.reconnectDelay * 1.5, MAX_DELAY);
          st.connectedAt = null;
          console.log(`[EmpresaWA:${empresaId}] Fechou (code=${code}, fase=conectado) — reconectando em ${delay / 1000}s (${st.reconnectCount}/${MAX_RECONNECT})`);
          setTimeout(() => connectEmpresa(empresaId).catch(console.error), delay);
          try {
            await (prisma as any).whatsappEmpresaSession.updateMany({ where: { empresaId }, data: { qrCode: null } });
          } catch {}
        } else {
          st.status         = 'DESCONECTADO';
          st.qrDataUrl      = null;
          st.reconnectCount = 0;
          st.reconnectDelay = BASE_DELAY;
          try {
            await (prisma as any).whatsappEmpresaSession.updateMany({
              where: { empresaId },
              data:  { status: 'DESCONECTADO', qrCode: null, ...(isLogout ? { authState: null } : {}) },
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
    st.qrShownAt      = null;
    st.qrTimeoutCount = 0;
    st.qrErrorCount   = 0;
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
