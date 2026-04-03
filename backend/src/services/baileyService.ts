/**
 * Serviço Baileys para WhatsApp
 * Roda instância de WhatsApp direto no backend (sem API externa)
 * Sessão persistida no banco PostgreSQL
 */

import type {
  AuthenticationCreds,
  AuthenticationState,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import prisma from '../db';
import { handleIncomingMessage } from './whatsappCommandHandler';

// ==========================================
// STATE INTERNO - Gerenciador de Sockets
// ==========================================
const sockets = new Map<string, WASocket>();
const qrCodes = new Map<string, string>();
const statuses = new Map<string, string>();

const logger = pino();

// ==========================================
// UTILITIES
// ==========================================

/**
 * Carrega auth state do banco (persistência entre restarts)
 * Salva apenas as credentials - as keys são regeneradas automaticamente
 */
async function saveAuthStateToDb(empresaId: string, creds: AuthenticationCreds) {
  try {
    // Serializar apenas os campos essenciais
    const credsToSave = {
      creds: creds,
    };
    const authStateJson = JSON.stringify(credsToSave, (key, value) => {
      if (value instanceof Uint8Array) {
        return {
          type: 'Buffer',
          data: Array.from(value),
        };
      }
      return value;
    });

    await prisma.whatsappInstance.update({
      where: { empresaId },
      data: { authState: authStateJson },
    });
    console.log(`[Baileys] Auth state salvo para empresa: ${empresaId}`);
  } catch (error) {
    console.error(
      `[Baileys] Erro ao salvar auth state para ${empresaId}:`,
      error
    );
  }
}

/**
 * Carrega auth state salvo do banco
 */
async function loadAuthStateFromDb(empresaId: string): Promise<AuthenticationState> {
  try {
    const instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId },
    });

    if (instance?.authState) {
      try {
        const parsed = JSON.parse(instance.authState, (key, value) => {
          // Converter Buffer objects de volta para Uint8Array
          if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
            return new Uint8Array(value.data);
          }
          return value;
        });

        const creds = parsed.creds as AuthenticationCreds;
        console.log(`[Baileys] Auth state carregado para ${empresaId}`);

        return {
          creds,
          keys: new Map() as any,
        };
      } catch (parseError) {
        console.error(`[Baileys] Erro ao fazer parse do auth state: ${parseError}`);
      }
    }
  } catch (error) {
    console.error(`[Baileys] Erro ao carregar auth state: ${error}`);
  }

  // Retornar estado vazio se não encontrar ou erro ao carregar
  console.log(`[Baileys] Iniciando com estado vazio para ${empresaId}`);
  return {
    creds: {} as AuthenticationCreds,
    keys: new Map() as any,
  };
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

    // Dynamic import (ESM modules) - usar Function para forçar import real (não require)
    const dynamicImport = new Function('module', 'return import(module)');
    const baileysMod = await dynamicImport('@whiskeysockets/baileys') as any;
    const qrcodeMod = await dynamicImport('qrcode') as any;

    const makeWASocket = baileysMod.default;
    const { BufferJSON, isJidBroadcast } = baileysMod;
    const QRCode = qrcodeMod.default || qrcodeMod;

    // Carregar auth state do banco
    const initialState = await loadAuthStateFromDb(empresaId);

    // Criar socket
    const sock = makeWASocket({
      auth: initialState,
      printQRInTerminal: false,
      logger: pino({ level: 'error' }),
      browser: ['Lina X', 'Desktop', '1.0.0'],
      generateHighQualityLinkPreview: true,
      getMessage: async (key: any) => {
        return {
          conversation: 'Mensagem de contexto',
        };
      },
    });

    // Bind para salvar credenciais quando mudarem
    sock.ev.on('creds.update', async (update: any) => {
      await saveAuthStateToDb(empresaId, sock.authState.creds);
    });

    // Evento: Conexão
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      console.log(`[Baileys] connection.update para ${empresaId}:`, {
        connection,
        qr: !!qr,
      });

      // QR Code gerado
      if (qr) {
        try {
          const qrBase64 = await QRCode.toDataURL(qr);
          qrCodes.set(empresaId, qrBase64);
          statuses.set(empresaId, 'qr_code');

          await prisma.whatsappInstance.update({
            where: { empresaId },
            data: {
              status: 'qr_code',
              qrCode: qrBase64,
            },
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

        const jid = sock.user?.id;
        const phoneNumber = jid ? jid.split(':')[0] : null;

        await prisma.whatsappInstance.update({
          where: { empresaId },
          data: {
            status: 'connected',
            qrCode: null,
            ownerPhone: phoneNumber,
          },
        });

        console.log(`[Baileys] ✅ Conectado para ${empresaId}:`, phoneNumber);
      }

      // Desconectado
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          DisconnectReason.loggedOut;

        console.log(
          `[Baileys] Desconectado para ${empresaId}. Reconectar: ${shouldReconnect}`
        );

        if (shouldReconnect) {
          // Tentar reconectar
          sockets.delete(empresaId);
          setTimeout(() => {
            initBaileys(empresaId).catch(console.error);
          }, 3000);
        } else {
          // Logout permanente - limpar estado
          qrCodes.delete(empresaId);
          sockets.delete(empresaId);
          statuses.set(empresaId, 'disconnected');

          await prisma.whatsappInstance.update({
            where: { empresaId },
            data: {
              status: 'disconnected',
              authState: null,
              qrCode: null,
            },
          });
        }
      }
    });

    // Evento: Mensagens recebidas
    sock.ev.on('messages.upsert', async (m: any) => {
      try {
        const message = m.messages[0];

        // Ignorar mensagens do próprio bot e broadcasts
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

        // Obter nome do remetente
        const senderName = message.pushName || 'Usuário';

        // Processar comando/IA
        const response = await handleIncomingMessage(
          empresaId,
          from,
          senderName,
          text,
          empresaId
        );

        // Salvar em banco
        await prisma.whatsappMessage.create({
          data: {
            instanceId: (
              await prisma.whatsappInstance.findUnique({
                where: { empresaId },
              })
            )!.id,
            direction: 'INCOMING',
            phoneNumber: from,
            senderName,
            message: text,
            response,
            status: 'processed',
          },
        });

        // Enviar resposta
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
      data: {
        status: 'disconnected',
        authState: null,
        qrCode: null,
      },
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
      console.log(
        `[Baileys] Restaurando sessão para ${instance.empresaId}...`
      );
      await initBaileys(instance.empresaId).catch((err) => {
        console.error(
          `[Baileys] Erro ao restaurar ${instance.empresaId}:`,
          err
        );
      });
    }

    console.log(`[Baileys] ${instances.length} sessão(ões) restaurada(s)`);
  } catch (error) {
    console.error('[Baileys] Erro ao restaurar sessões:', error);
  }
}

// ==========================================
// HELPERS
// ==========================================

enum DisconnectReason {
  connectionClosed = 0,
  connectionLost = 1,
  connectionReplaced = 2,
  connectionHandoverInProgress = 3,
  connectionHandoverComplete = 4,
  restartRequired = 5,
  malformedMessage = 6,
  forbidden = 7,
  connectionTimeout = 8,
  unknown = 9,
  loggedOut = 10,
}
