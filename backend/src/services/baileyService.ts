/**
 * Serviço Baileys para WhatsApp
 * Usa useMultiFileAuthState (oficial) com /tmp + persistência no banco PostgreSQL
 */

import type { WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import prisma from '../db';
import { handleIncomingMessage } from './whatsappCommandHandler';

// ==========================================
// STATE INTERNO
// ==========================================
const sockets = new Map<string, WASocket>();
const qrCodes = new Map<string, string>();
const statuses = new Map<string, string>();
const reconnectAttempts = new Map<string, number>();
const MAX_RECONNECT = 3;

// ==========================================
// AUTH STATE — DB ↔ /tmp
// ==========================================

/**
 * Caminho do diretório de auth no sistema de arquivos temporário
 */
function getAuthDir(empresaId: string): string {
  const dir = join(tmpdir(), `baileys-${empresaId}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Carrega auth state do banco para o diretório /tmp antes de iniciar o socket
 */
async function restoreAuthDirFromDb(empresaId: string): Promise<void> {
  try {
    const instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId },
    });

    if (!instance?.authState) return;

    const authFiles = JSON.parse(instance.authState) as Record<string, string>;
    const authDir = getAuthDir(empresaId);

    for (const [filename, content] of Object.entries(authFiles)) {
      writeFileSync(join(authDir, filename), content, 'utf-8');
    }
    console.log(`[Baileys] Auth state restaurado do banco para ${empresaId}`);
  } catch (error) {
    console.error(`[Baileys] Erro ao restaurar auth state: ${error}`);
  }
}

/**
 * Persiste todos os arquivos do /tmp auth dir de volta no banco
 */
async function persistAuthDirToDb(empresaId: string): Promise<void> {
  try {
    const authDir = getAuthDir(empresaId);
    const files = readdirSync(authDir);

    if (files.length === 0) return;

    const authFiles: Record<string, string> = {};
    for (const file of files) {
      authFiles[file] = readFileSync(join(authDir, file), 'utf-8');
    }

    await prisma.whatsappInstance.update({
      where: { empresaId },
      data: { authState: JSON.stringify(authFiles) },
    });
  } catch (error) {
    console.error(`[Baileys] Erro ao persistir auth state: ${error}`);
  }
}

// ==========================================
// MAIN API
// ==========================================

/**
 * Inicia/reconecta socket Baileys para uma empresa
 */
export async function initBaileys(empresaId: string): Promise<void> {
  try {
    console.log(`[Baileys] Iniciando para empresa: ${empresaId}`);

    // Verificar se já tem socket ativo
    if (sockets.has(empresaId)) {
      console.log(`[Baileys] Socket já ativo para ${empresaId}`);
      return;
    }

    // Dynamic import (ESM) — new Function evita que TypeScript converta para require()
    const dynamicImport = new Function('module', 'return import(module)');
    const baileysMod = await dynamicImport('@whiskeysockets/baileys') as any;
    const qrcodeMod = await dynamicImport('qrcode') as any;

    const makeWASocket = baileysMod.default || baileysMod;
    const {
      isJidBroadcast,
      useMultiFileAuthState,
      fetchLatestBaileysVersion,
      Browsers,
      DisconnectReason: BaileysDisconnectReason,
    } = baileysMod;
    const QRCode = qrcodeMod.default || qrcodeMod;

    // Restaurar auth state do banco para /tmp (se existir)
    await restoreAuthDirFromDb(empresaId);
    const authDir = getAuthDir(empresaId);

    // useMultiFileAuthState — implementação oficial do Baileys (SignalKeyStore correto)
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    // Buscar versão atual do WhatsApp para evitar rejeição por versão desatualizada
    let version: number[] = [2, 3000, 1015901307];
    try {
      const versionData = await fetchLatestBaileysVersion();
      version = versionData.version;
      console.log(`[Baileys] Versão WA: ${version.join('.')}`);
    } catch {
      console.warn(`[Baileys] Não conseguiu buscar versão WA, usando fallback`);
    }

    // Criar socket com configuração oficial
    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }), // suprimir logs internos do Baileys
      browser: Browsers.ubuntu('Chrome'), // identificação correta de navegador
      generateHighQualityLinkPreview: false,
      getMessage: async (_key: any) => ({ conversation: 'Mensagem de contexto' }),
    });

    // Salvar credenciais quando mudarem (em /tmp e no banco)
    sock.ev.on('creds.update', async () => {
      saveCreds();
      await persistAuthDirToDb(empresaId);
    });

    // Evento: Conexão
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      console.log(`[Baileys] connection.update para ${empresaId}:`, {
        connection,
        qr: !!qr,
        errorCode: (lastDisconnect?.error as Boom)?.output?.statusCode,
        errorMsg: (lastDisconnect?.error as any)?.message,
      });

      // QR Code gerado
      if (qr) {
        try {
          const qrBase64 = await QRCode.toDataURL(qr);
          qrCodes.set(empresaId, qrBase64);
          statuses.set(empresaId, 'qr_code');

          await prisma.whatsappInstance.update({
            where: { empresaId },
            data: { status: 'qr_code', qrCode: qrBase64 },
          });

          console.log(`[Baileys] QR code gerado para ${empresaId}`);
        } catch (error) {
          console.error(`[Baileys] Erro ao gerar QR code:`, error);
        }
      }

      // Conectado
      if (connection === 'open') {
        qrCodes.delete(empresaId);
        statuses.set(empresaId, 'connected');
        sockets.set(empresaId, sock);
        reconnectAttempts.set(empresaId, 0);

        const jid = sock.user?.id;
        const phoneNumber = jid ? jid.split(':')[0] : null;

        await prisma.whatsappInstance.update({
          where: { empresaId },
          data: { status: 'connected', qrCode: null, ownerPhone: phoneNumber },
        });

        console.log(`[Baileys] ✅ Conectado para ${empresaId}:`, phoneNumber);
      }

      // Desconectado
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOutCode = BaileysDisconnectReason?.loggedOut ?? 401;
        const isLoggedOut = statusCode === loggedOutCode;
        const attempts = reconnectAttempts.get(empresaId) || 0;
        const shouldReconnect = !isLoggedOut && attempts < MAX_RECONNECT;

        console.log(
          `[Baileys] Desconectado para ${empresaId}. Reconectar: ${shouldReconnect} (tentativa ${attempts}/${MAX_RECONNECT})`
        );

        if (shouldReconnect) {
          reconnectAttempts.set(empresaId, attempts + 1);
          sockets.delete(empresaId);
          setTimeout(() => {
            initBaileys(empresaId).catch(console.error);
          }, 3000);
        } else {
          qrCodes.delete(empresaId);
          sockets.delete(empresaId);
          statuses.set(empresaId, 'disconnected');

          await prisma.whatsappInstance.update({
            where: { empresaId },
            data: { status: 'disconnected', authState: null, qrCode: null },
          });
        }
      }
    });

    // Evento: Mensagens recebidas
    sock.ev.on('messages.upsert', async (m: any) => {
      try {
        const message = m.messages[0];

        if (message.key.fromMe || isJidBroadcast(message.key.remoteJid!)) {
          return;
        }

        const from = message.key.remoteJid!;
        const text =
          message.message?.conversation ||
          message.message?.extendedTextMessage?.text ||
          '';

        if (!text.trim()) return;

        console.log(`[Baileys] Mensagem recebida de ${from}: ${text}`);

        const senderName = message.pushName || 'Usuário';

        const response = await handleIncomingMessage(
          empresaId,
          from,
          senderName,
          text,
          empresaId
        );

        const instance = await prisma.whatsappInstance.findUnique({
          where: { empresaId },
        });

        if (instance) {
          await prisma.whatsappMessage.create({
            data: {
              instanceId: instance.id,
              direction: 'INCOMING',
              phoneNumber: from,
              senderName,
              message: text,
              response,
              status: 'processed',
            },
          });
        }

        await sock.sendMessage(from, { text: response });
        console.log(`[Baileys] Resposta enviada para ${from}`);
      } catch (error) {
        console.error('[Baileys] Erro ao processar mensagem:', error);
      }
    });
  } catch (error) {
    console.error(`[Baileys] Erro ao iniciar para ${empresaId}:`, error);
    statuses.set(empresaId, 'disconnected');
    throw error;
  }
}

/**
 * Retorna QR code em base64 (ou null se conectado/não iniciado)
 */
export async function getQRCode(empresaId: string): Promise<string | null> {
  return qrCodes.get(empresaId) || null;
}

/**
 * Retorna status: 'connected' | 'qr_code' | 'disconnected'
 */
export function getStatus(empresaId: string): string {
  return statuses.get(empresaId) || 'disconnected';
}

/**
 * Envia mensagem de texto
 */
export async function sendMessage(
  empresaId: string,
  to: string,
  text: string
): Promise<void> {
  try {
    const sock = sockets.get(empresaId);
    if (!sock) {
      throw new Error(
        `Socket não encontrado para empresa: ${empresaId}. Conecte primeiro.`
      );
    }

    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text });

    console.log(`[Baileys] Mensagem enviada para ${jid}`);
  } catch (error) {
    console.error(`[Baileys] Erro ao enviar mensagem:`, error);
    throw error;
  }
}

/**
 * Desconecta e limpa estado
 */
export async function disconnect(empresaId: string): Promise<void> {
  try {
    const sock = sockets.get(empresaId);
    if (sock) {
      await sock.logout();
      sockets.delete(empresaId);
    }

    qrCodes.delete(empresaId);
    statuses.set(empresaId, 'disconnected');

    await prisma.whatsappInstance.update({
      where: { empresaId },
      data: { status: 'disconnected', authState: null, qrCode: null },
    });

    console.log(`[Baileys] Desconectado para ${empresaId}`);
  } catch (error) {
    console.error(`[Baileys] Erro ao desconectar:`, error);
    throw error;
  }
}

/**
 * Restaura sessões ativas do banco (chamado no startup)
 */
export async function restoreActiveSessions(): Promise<void> {
  try {
    console.log('[Baileys] Restaurando sessões ativas...');

    const instances = await prisma.whatsappInstance.findMany({
      where: { status: 'connected' },
    });

    for (const instance of instances) {
      console.log(`[Baileys] Restaurando sessão para ${instance.empresaId}...`);
      await initBaileys(instance.empresaId).catch((err) => {
        console.error(`[Baileys] Erro ao restaurar ${instance.empresaId}:`, err);
      });
    }

    console.log(`[Baileys] ${instances.length} sessão(ões) restaurada(s)`);
  } catch (error) {
    console.error('[Baileys] Erro ao restaurar sessões:', error);
  }
}
