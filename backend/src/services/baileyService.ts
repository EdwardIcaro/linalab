/**
 * Serviço Baileys para WhatsApp
 * Usa useMultiFileAuthState (oficial) com /tmp + persistência no banco PostgreSQL
 */

import type { WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
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
const MAX_RECONNECT = 10;

// Mapeamento de @lid → número de telefone (novo protocolo WhatsApp)
const lidToPhone = new Map<string, string>();

// Store em memória por empresa (makeInMemoryStore do Baileys — mantém @lid mappings)
const stores = new Map<string, any>();

// Empresas com credenciais recém-atualizadas via creds.update (QR scan)
// Protege /tmp de ser limpo entre o scan e o reconnect bem-sucedido
const freshCredsSet = new Set<string>();

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
    const authDir = getAuthDir(empresaId);

    // Verificar estado no banco ANTES de decidir o que fazer com /tmp
    const instance = await prisma.whatsappInstance.findUnique({
      where: { empresaId },
    });

    if (existsSync(authDir)) {
      const files = readdirSync(authDir);
      if (files.length > 0) {
        if (!instance?.authState && !freshCredsSet.has(empresaId)) {
          // /tmp tem arquivos mas DB não tem authState e não há scan recente
          // → arquivos stale (sessão desconectada anteriormente) — limpar
          rmSync(authDir, { recursive: true, force: true });
          mkdirSync(authDir, { recursive: true });
          console.log(`[Baileys] Credenciais stale removidas para ${empresaId} (DB null, não há scan recente)`);
        } else {
          // /tmp tem arquivos recém-salvos por creds.update (QR scan em andamento)
          console.log(`[Baileys] /tmp já tem ${files.length} arquivo(s) para ${empresaId}, mantendo`);
          return;
        }
      }
    }

    if (!instance?.authState) {
      // Sem authState no banco e /tmp vazio → início limpo, vai gerar QR
      mkdirSync(authDir, { recursive: true });
      console.log(`[Baileys] Início limpo para ${empresaId} (sem credenciais)`);
      return;
    }

    const authFiles = JSON.parse(instance.authState) as Record<string, string>;
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
      makeInMemoryStore,
    } = baileysMod;
    const QRCode = qrcodeMod.default || qrcodeMod;

    // Criar/reusar store em memória (persiste entre reconexões para manter @lid mappings)
    if (!stores.has(empresaId) && makeInMemoryStore) {
      const store = makeInMemoryStore({ logger: pino({ level: 'silent' }) });
      stores.set(empresaId, store);
      console.log(`[Baileys] Store criado para ${empresaId}`);
    }

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

    // Flag: credenciais foram atualizadas (indica QR escaneado com sucesso)
    let credsJustUpdated = false;

    // Vincular store ao socket (popula @lid ↔ phone mappings automaticamente)
    const store = stores.get(empresaId);
    if (store) {
      store.bind(sock.ev);
      console.log(`[Baileys] Store vinculado ao socket de ${empresaId}`);
    }

    // Salvar credenciais quando mudarem (em /tmp e no banco)
    sock.ev.on('creds.update', async () => {
      credsJustUpdated = true;
      freshCredsSet.add(empresaId); // Marcar como recém-atualizado (protege /tmp durante reconexão)
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
        freshCredsSet.delete(empresaId); // Conexão estabelecida, creds já persistidos no DB

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
        // 401 durante fase QR (sem sessão ativa) = não é logout real, deve tentar novamente
        const wasAuthenticated = statuses.get(empresaId) === 'connected';
        const isRealLogout = isLoggedOut && wasAuthenticated;
        const shouldReconnect = !isRealLogout && attempts < MAX_RECONNECT;

        console.log(
          `[Baileys] Desconectado para ${empresaId}. Código: ${statusCode} | Autenticado: ${wasAuthenticated} | Reconectar: ${shouldReconnect} (tentativa ${attempts}/${MAX_RECONNECT})`
        );

        if (shouldReconnect) {
          reconnectAttempts.set(empresaId, attempts + 1);
          sockets.delete(empresaId);
          // QR escaneado → creds atualizadas → reconectar imediatamente (1s)
          // Sessão ativa caiu → reconectar rápido (3s)
          // Erro durante fase QR sem scan → delay maior para QR não mudar (15s)
          const reconnectDelay = credsJustUpdated ? 1000 : (wasAuthenticated ? 3000 : 15000);
          credsJustUpdated = false;
          console.log(`[Baileys] Reconectando em ${reconnectDelay / 1000}s... (creds=${credsJustUpdated}, auth=${wasAuthenticated})`);
          setTimeout(() => {
            initBaileys(empresaId).catch(console.error);
          }, reconnectDelay);
        } else {
          qrCodes.delete(empresaId);
          sockets.delete(empresaId);
          statuses.set(empresaId, 'disconnected');
          reconnectAttempts.delete(empresaId); // Reset para permitir nova tentativa manual
          freshCredsSet.delete(empresaId);

          await prisma.whatsappInstance.update({
            where: { empresaId },
            data: { status: 'disconnected', authState: null, qrCode: null },
          });
        }
      }
    });

    // Evento: Sincronização de contatos (mapeia @lid → telefone)
    const processContacts = (contacts: any[]) => {
      let added = 0;
      for (const contact of contacts) {
        const id = contact.id || '';
        const lid = contact.lid || '';

        // Caso 1: id é @s.whatsapp.net e tem lid associado
        if (id.endsWith('@s.whatsapp.net') && lid) {
          const phone = id.split('@')[0];
          const lidNum = lid.split('@')[0].replace(/\D/g, '');
          if (phone && lidNum) { lidToPhone.set(lidNum, phone); added++; }
        }
        // Caso 2: id é @lid e tem phoneNumber
        if (id.endsWith('@lid') && contact.phoneNumber) {
          const lidNum = id.split('@')[0];
          lidToPhone.set(lidNum, contact.phoneNumber.replace(/\D/g, ''));
          added++;
        }
      }
      return added;
    };

    sock.ev.on('contacts.set', (data: any) => {
      const contacts = Array.isArray(data) ? data : (data?.contacts || []);
      // Log da estrutura do primeiro contato para debug
      if (contacts.length > 0) {
        console.log(`[Baileys] contacts.set sample:`, JSON.stringify(contacts[0]).slice(0, 200));
      } else {
        console.log(`[Baileys] contacts.set: array vazio (${JSON.stringify(data).slice(0, 100)})`);
      }
      const added = processContacts(contacts);
      console.log(`[Baileys] Contatos sincronizados: ${contacts.length} total, ${added} @lid mapeados`);
    });

    sock.ev.on('contacts.upsert', (data: any) => {
      const contacts = Array.isArray(data) ? data : (data?.contacts || []);
      const added = processContacts(contacts);
      if (added > 0) console.log(`[Baileys] contacts.upsert: ${added} @lid mapeados`);
    });

    // Evento: Mensagens recebidas
    sock.ev.on('messages.upsert', async (m: any) => {
      try {
        const message = m.messages[0];

        if (message.key.fromMe || isJidBroadcast(message.key.remoteJid!)) {
          return;
        }

        const rawFrom = message.key.remoteJid!;
        const text =
          message.message?.conversation ||
          message.message?.extendedTextMessage?.text ||
          '';

        if (!text.trim()) return;

        // Resolver @lid para número de telefone
        let from = rawFrom;
        if (rawFrom.endsWith('@lid')) {
          const lidNum = rawFrom.split('@')[0];

          // 1. Verificar mapa manual lidToPhone
          let resolvedPhone = lidToPhone.get(lidNum);

          // 2. Tentar via makeInMemoryStore (contacts map)
          if (!resolvedPhone && store?.contacts) {
            const contact = store.contacts[rawFrom] as any;
            const phoneFromContact: string | undefined = contact?.phoneNumber
              ? String(contact.phoneNumber).replace(/\D/g, '')
              : undefined;
            if (phoneFromContact) {
              resolvedPhone = phoneFromContact;
              lidToPhone.set(lidNum, resolvedPhone);
            } else {
              // Procurar contato @s.whatsapp.net que tenha lid = rawFrom
              for (const [jid, c] of Object.entries(store.contacts as Record<string, any>)) {
                if (jid.endsWith('@s.whatsapp.net') && (c as any)?.lid === rawFrom) {
                  const phone = jid.split('@')[0];
                  if (phone) {
                    resolvedPhone = phone;
                    lidToPhone.set(lidNum, phone);
                  }
                  break;
                }
              }
            }
          }

          if (resolvedPhone) {
            from = `${resolvedPhone}@s.whatsapp.net`;
            console.log(`[Baileys] @lid resolvido: ${rawFrom} → ${from}`);
          } else {
            console.log(`[Baileys] @lid sem mapeamento: ${rawFrom} (store contacts: ${Object.keys(store?.contacts || {}).length})`);
          }
        }

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

        // Só envia se houver resposta (string vazia = ignorar silenciosamente)
        if (response && response.trim()) {
          await sock.sendMessage(from, { text: response });
          console.log(`[Baileys] Resposta enviada para ${from}`);
        } else {
          console.log(`[Baileys] Mensagem ignorada silenciosamente de ${from}`);
        }
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
 * Envia mensagem e retorna o JID real usado pelo WhatsApp (pode ser @lid)
 * Útil para capturar o mapeamento @lid → phone ao enviar para admins
 */
export async function sendMessageAndCaptureJid(
  empresaId: string,
  toPhone: string,
  text: string
): Promise<string | null> {
  const sock = sockets.get(empresaId);
  if (!sock) return null;

  try {
    const cleanPhone = toPhone.replace(/\D/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const result = await sock.sendMessage(jid, { text });

    // O remoteJid retornado pode ser @lid — capturar mapeamento
    const actualJid = result?.key?.remoteJid;
    if (actualJid && actualJid.endsWith('@lid')) {
      const lidNum = actualJid.split('@')[0];
      lidToPhone.set(lidNum, cleanPhone);
      console.log(`[Baileys] Mapeamento capturado ao enviar: ${actualJid} → ${cleanPhone}`);
    }
    return actualJid || jid;
  } catch (error) {
    console.warn(`[Baileys] Erro ao enviar mensagem para ${toPhone}:`, error);
    return null;
  }
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
 * Resolve número de telefone para JID do WhatsApp (@s.whatsapp.net ou @lid)
 * Necessário para identificar números no novo protocolo WhatsApp (@lid)
 */
export async function resolvePhoneToJid(empresaId: string, phone: string): Promise<string | null> {
  const sock = sockets.get(empresaId);
  if (!sock) return null;

  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const results = await sock.onWhatsApp(cleanPhone);
    const result = Array.isArray(results) ? results[0] : results;
    if (result?.exists && result?.jid) {
      console.log(`[Baileys] JID resolvido: ${cleanPhone} → ${result.jid}`);
      return result.jid;
    }
    return null;
  } catch (error) {
    console.warn(`[Baileys] Não foi possível resolver JID para ${phone}:`, error);
    return null;
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
    reconnectAttempts.delete(empresaId); // Reset para não bloquear nova conexão
    freshCredsSet.delete(empresaId);

    // Limpar /tmp para evitar credenciais stale na próxima conexão
    const authDir = join(tmpdir(), `baileys-${empresaId}`);
    if (existsSync(authDir)) {
      rmSync(authDir, { recursive: true, force: true });
      console.log(`[Baileys] /tmp limpo para ${empresaId}`);
    }

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
