/**
 * Serviço Baileys — socket único global (Bot Lina, Phase 1)
 * Um único número WhatsApp atende admins e lavadores de todas as empresas.
 */

import type { WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import prisma from '../db';
import { handleIncomingMessage } from './whatsappCommandHandler';
import { validateAndClaimByCode } from './pairingCodeStore';
import { validateAndClaimBotCode } from './botUserCodeStore';

// ==========================================
// CONSTANTES
// ==========================================
const GLOBAL_INSTANCE_NAME = 'lina-global';
const GLOBAL_AUTH_DIR      = join(tmpdir(), 'baileys-global');

const BASE_DELAY    = 3000;
const MAX_DELAY     = 60000;
const MAX_RECONNECT = 100;

// ==========================================
// STATE GLOBAL
// ==========================================
let globalSocket:         WASocket | null = null;
let globalQrCode:         string   | null = null;
let globalStatus:         string          = 'disconnected';
let globalStore:          any             = null;
let reconnectCount:       number          = 0;
let reconnectDelay:       number          = BASE_DELAY;
let freshCreds:           boolean         = false;
let isInitializing:       boolean         = false;
let failedCredsAttempts:  number          = 0;
let qrGeneratedAt:        number | null   = null;

const lidToPhone = new Map<string, string>();

function nextDelay(): number {
  const d = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_DELAY);
  return d;
}
function resetDelay() { reconnectDelay = BASE_DELAY; }

// ==========================================
// AUTH STATE — DB ↔ /tmp
// ==========================================

async function getGlobalInstance() {
  return prisma.whatsappInstance.findFirst({ where: { instanceName: GLOBAL_INSTANCE_NAME } });
}

async function restoreAuthFromDb(): Promise<void> {
  try {
    // Sempre limpar /tmp e restaurar do banco — garante consistência em restarts/deploys
    if (existsSync(GLOBAL_AUTH_DIR)) {
      rmSync(GLOBAL_AUTH_DIR, { recursive: true, force: true });
    }
    mkdirSync(GLOBAL_AUTH_DIR, { recursive: true });

    const instance = await getGlobalInstance();
    if (!instance?.authState) {
      console.log('[Baileys] Início limpo — sem credenciais salvas');
      return;
    }

    const authFiles = JSON.parse(instance.authState) as Record<string, string>;
    for (const [filename, content] of Object.entries(authFiles)) {
      writeFileSync(join(GLOBAL_AUTH_DIR, filename), content, 'utf-8');
    }
    console.log(`[Baileys] Auth state restaurado do banco (${Object.keys(authFiles).length} arquivos)`);
  } catch (err) {
    console.error('[Baileys] Erro ao restaurar auth state:', err);
  }
}

async function persistAuthToDb(): Promise<void> {
  try {
    const files = readdirSync(GLOBAL_AUTH_DIR);
    if (files.length === 0) return;

    const authFiles: Record<string, string> = {};
    for (const f of files) {
      authFiles[f] = readFileSync(join(GLOBAL_AUTH_DIR, f), 'utf-8');
    }

    await prisma.whatsappInstance.updateMany({
      where: { instanceName: GLOBAL_INSTANCE_NAME },
      data: { authState: JSON.stringify(authFiles) },
    });
  } catch (err) {
    console.error('[Baileys] Erro ao persistir auth state:', err);
  }
}

// ==========================================
// MAIN: INICIAR SOCKET GLOBAL
// ==========================================

export async function initBaileys(): Promise<void> {
  try {
    if (globalSocket) {
      console.log('[Baileys] Socket global já ativo');
      return;
    }
    if (isInitializing) {
      console.log('[Baileys] Inicialização já em andamento, ignorando chamada duplicada');
      return;
    }
    isInitializing = true;

    console.log('[Baileys] Iniciando socket global...');

    const dynamicImport = new Function('module', 'return import(module)');
    const baileysMod    = await dynamicImport('@whiskeysockets/baileys') as any;
    const qrcodeMod     = await dynamicImport('qrcode') as any;

    const {
      default: _baileysDefault,
      makeWASocket,
      isJidBroadcast,
      useMultiFileAuthState,
      fetchLatestBaileysVersion,
      Browsers,
      DisconnectReason: BaileysDisconnectReason,
      makeInMemoryStore,
    } = baileysMod;

    const _makeWASocket: typeof makeWASocket =
      makeWASocket ?? _baileysDefault?.makeWASocket ?? _baileysDefault;
    const QRCode = qrcodeMod.default || qrcodeMod;

    if (!globalStore && makeInMemoryStore) {
      globalStore = makeInMemoryStore({ logger: pino({ level: 'silent' }) });
    }

    await restoreAuthFromDb();
    mkdirSync(GLOBAL_AUTH_DIR, { recursive: true });

    const instance = await getGlobalInstance();
    if (instance?.authState) {
      globalStatus = 'reconnecting';
      console.log('[Baileys] Reconectando com credenciais salvas...');
    }

    const { state, saveCreds } = await useMultiFileAuthState(GLOBAL_AUTH_DIR);

    let version: number[] = [2, 3000, 1023000166];
    try {
      const v = await fetchLatestBaileysVersion();
      if (v?.version?.length === 3) {
        version = v.version;
        console.log(`[Baileys] Versão WA obtida: ${version.join('.')}`);
      }
    } catch {
      console.log(`[Baileys] Usando versão fallback: ${version.join('.')}`);
    }

    const sock = _makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Safari'),
      generateHighQualityLinkPreview: false,
      keepAliveIntervalMs: 15000,
      getMessage: async (_key: any) => ({ conversation: 'Mensagem de contexto' }),
    });

    let credsJustUpdated = false;
    // Sessão real = múltiplos arquivos (creds.json sozinho = só noise keys, sem sessão)
    const authFilesOnStart = existsSync(GLOBAL_AUTH_DIR) ? readdirSync(GLOBAL_AUTH_DIR) : [];
    let hadCredsOnStart  = authFilesOnStart.length > 2;
    console.log(`[Baileys] Arquivos de auth no disco: ${authFilesOnStart.length} (sessão real: ${hadCredsOnStart})`);
    if (globalStore) globalStore.bind(sock.ev);

    sock.ev.on('creds.update', async () => {
      credsJustUpdated = true;
      freshCreds = true;
      saveCreds();
      await persistAuthToDb();
    });

    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          qrGeneratedAt = Date.now();
          globalQrCode  = await QRCode.toDataURL(qr);
          globalStatus  = 'qr_code';
          const expiresIn = 60;
          await prisma.whatsappInstance.updateMany({
            where: { instanceName: GLOBAL_INSTANCE_NAME },
            data: { status: 'qr_code', qrCode: globalQrCode },
          });
          console.log(`[Baileys] QR code gerado — você tem ${expiresIn}s para escanear`);
          // Temporizador visual no log
          let remaining = expiresIn;
          const timer = setInterval(() => {
            remaining -= 10;
            if (remaining > 0 && globalStatus === 'qr_code') {
              console.log(`[Baileys] ⏳ ${remaining}s restantes para escanear o QR`);
            } else {
              clearInterval(timer);
            }
          }, 10000);
        } catch (err) {
          console.error('[Baileys] Erro ao gerar QR:', err);
        }
      }

      if (connection === 'open') {
        globalSocket       = sock;
        globalQrCode       = null;
        globalStatus       = 'connected';
        reconnectCount     = 0;
        failedCredsAttempts = 0;
        resetDelay();
        freshCreds     = false;
        isInitializing = false;

        const phone = sock.user?.id?.split(':')[0] ?? null;
        await prisma.whatsappInstance.updateMany({
          where: { instanceName: GLOBAL_INSTANCE_NAME },
          data: { status: 'connected', qrCode: null, ownerPhone: phone },
        });
        console.log('[Baileys] ✅ Conectado:', phone);
      }

      if (connection === 'close') {
        const statusCode    = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const errorMsg      = (lastDisconnect?.error as any)?.message || 'sem mensagem';
        console.log(`[Baileys] Conexão fechada — status: ${statusCode}, motivo: ${errorMsg}`);
        const loggedOutCode  = BaileysDisconnectReason?.loggedOut ?? 401;
        const restartCode    = BaileysDisconnectReason?.restartRequired ?? 515;
        const wasConnected   = globalStatus === 'connected';
        const isRealLogout   = statusCode === loggedOutCode && wasConnected;
        const isStreamError  = statusCode === restartCode;
        const shouldRetry    = !isRealLogout && reconnectCount < MAX_RECONNECT;

        globalSocket   = null;
        isInitializing = false;

        if (shouldRetry) {
          reconnectCount++;
          let delay: number;
          if (isStreamError) {
            // 515 = "restart required" — WA pede reconexão imediata, não espera longa
            delay = 2000;
            console.log('[Baileys] ⚠️ Stream error 515 — reiniciando em 2s (restart required)');
          } else if (wasConnected) {
            delay = credsJustUpdated ? 5000 : nextDelay();
          } else {
            delay = credsJustUpdated ? 30000 : 45000;
          }
          credsJustUpdated = false;
          console.log(`[Baileys] Reconectando em ${delay / 1000}s (tentativa ${reconnectCount}/${MAX_RECONNECT})`);
          setTimeout(() => initBaileys().catch(console.error), delay);
        } else {
          globalStatus = 'disconnected';
          globalQrCode = null;
          freshCreds   = false;

          if (isRealLogout) {
            console.log('[Baileys] ⚠️ Logout real — limpando credenciais');
            await prisma.whatsappInstance.updateMany({
              where: { instanceName: GLOBAL_INSTANCE_NAME },
              data: { status: 'disconnected', authState: null, qrCode: null },
            });
          } else {
            console.log(`[Baileys] ⚠️ Max tentativas — preservando credenciais`);
            await prisma.whatsappInstance.updateMany({
              where: { instanceName: GLOBAL_INSTANCE_NAME },
              data: { status: 'disconnected', qrCode: null },
            });
          }
        }
      }
    });

    // Mapear @lid → telefone
    const processContacts = (contacts: any[]) => {
      let added = 0;
      for (const c of contacts) {
        const id  = c.id  || '';
        const lid = c.lid || '';
        if (id.endsWith('@s.whatsapp.net') && lid) {
          const phone  = id.split('@')[0];
          const lidNum = lid.split('@')[0].replace(/\D/g, '');
          if (phone && lidNum) { lidToPhone.set(lidNum, phone); added++; }
        }
        if (id.endsWith('@lid') && c.phoneNumber) {
          lidToPhone.set(id.split('@')[0], c.phoneNumber.replace(/\D/g, ''));
          added++;
        }
      }
      return added;
    };

    sock.ev.on('contacts.set',    (d: any) => { const cs = Array.isArray(d) ? d : (d?.contacts || []); processContacts(cs); });
    sock.ev.on('contacts.upsert', (d: any) => { const cs = Array.isArray(d) ? d : (d?.contacts || []); processContacts(cs); });

    // ==========================================
    // MENSAGENS RECEBIDAS
    // ==========================================
    sock.ev.on('messages.upsert', async (m: any) => {
      try {
        const message = m.messages[0];
        if (message.key.fromMe || isJidBroadcast(message.key.remoteJid!)) return;

        const rawFrom = message.key.remoteJid!;
        const text    =
          message.message?.conversation ||
          message.message?.extendedTextMessage?.text || '';
        if (!text.trim()) return;

        // Resolver @lid
        let from = rawFrom;
        if (rawFrom.endsWith('@lid')) {
          const lidNum = rawFrom.split('@')[0];
          let resolved = lidToPhone.get(lidNum);
          if (!resolved && globalStore?.contacts) {
            const contact = globalStore.contacts[rawFrom] as any;
            if (contact?.phoneNumber) {
              resolved = String(contact.phoneNumber).replace(/\D/g, '');
              lidToPhone.set(lidNum, resolved);
            } else {
              for (const [jid, c] of Object.entries(globalStore.contacts as Record<string, any>)) {
                if (jid.endsWith('@s.whatsapp.net') && (c as any)?.lid === rawFrom) {
                  resolved = jid.split('@')[0];
                  lidToPhone.set(lidNum, resolved!);
                  break;
                }
              }
            }
          }
          if (resolved) {
            from = `${resolved}@s.whatsapp.net`;
            // Atualizar registro com lid não resolvido
            prisma.whatsappAdminPhone.updateMany({
              where: { jid: rawFrom, telefone: `lid_${lidNum}` },
              data: { telefone: resolved },
            }).catch(() => {});
          }
        }

        const senderName = message.pushName || 'Usuário';
        const trimmed    = text.trim();

        // ── Código de pareamento (4 dígitos) ──────────────────────────────────
        if (/^\d{4}$/.test(trimmed)) {
          const claimed = validateAndClaimByCode(trimmed);
          if (claimed) {
            const globalInst = await getGlobalInstance();
            if (!globalInst) return;

            // Buscar todas as empresas do userId que gerou o código
            const empresas = await prisma.empresa.findMany({
              where: { usuarioId: claimed.userId },
              select: { id: true, nome: true },
            });

            const lidOrPhone = rawFrom.split('@')[0];
            const phoneToStore =
              rawFrom.endsWith('@lid') && from !== rawFrom ? from.split('@')[0]
              : rawFrom.endsWith('@lid') ? `lid_${lidOrPhone}`
              : lidOrPhone;

            const nomeAdmin = claimed.nome || senderName;
            let vinculadas = 0;

            for (const empresa of empresas) {
              try {
                // empresaId_telefone compound key disponível após prisma generate
                await (prisma.whatsappAdminPhone as any).upsert({
                  where: { empresaId_telefone: { empresaId: empresa.id, telefone: phoneToStore } },
                  create: { instanceId: globalInst.id, empresaId: empresa.id, telefone: phoneToStore, jid: rawFrom, nome: nomeAdmin, ativo: true },
                  update: { jid: rawFrom, nome: nomeAdmin, ativo: true },
                });
                vinculadas++;
              } catch { /* ignora */ }
            }

            console.log(`[Baileys] ✅ Admin ${nomeAdmin} vinculado em ${vinculadas} empresa(s)`);
            const empresasNomes = empresas.map(e => `• ${e.nome}`).join('\n');
            await sock.sendMessage(rawFrom, {
              text: `✅ Olá *${nomeAdmin}*! Você foi vinculado como administrador em ${vinculadas} empresa(s):\n\n${empresasNomes}\n\nEnvie *ajuda* para ver os comandos disponíveis.`,
            });
            return;
          }
        }

        // ── PIN de usuário do bot (LAVADOR / CAIXA / FINANCEIRO) ─────────────
        if (/^\d{4}$/.test(trimmed)) {
          const botClaimed = validateAndClaimBotCode(trimmed);
          if (botClaimed) {
            const lidOrPhone = rawFrom.split('@')[0];
            const phoneToStore =
              rawFrom.endsWith('@lid') && from !== rawFrom ? from.split('@')[0]
              : rawFrom.endsWith('@lid') ? `lid_${lidOrPhone}`
              : lidOrPhone;

            await (prisma as any).whatsappBotUser.update({
              where: { id: botClaimed.botUserId },
              data: { jid: rawFrom, telefone: phoneToStore, ativo: true },
            });

            const roleLabel: Record<string, string> = { LAVADOR: 'Lavador', CAIXA: 'Caixa', FINANCEIRO: 'Financeiro' };
            await sock.sendMessage(rawFrom, {
              text: `✅ Olá *${botClaimed.nome}*! Você foi registrado como *${roleLabel[botClaimed.role] ?? botClaimed.role}*.\n\nEnvie *ajuda* para ver o que posso fazer por você.`,
            });
            return;
          }
        }

        // ── Modo de pareamento legado (pairingMode) ────────────────────────────
        const globalInst = await getGlobalInstance();
        if (globalInst?.pairingMode) {
          const lidOrPhone  = rawFrom.split('@')[0];
          const nomeAdmin   = globalInst.pairingNome || senderName;
          const phoneToStore =
            rawFrom.endsWith('@lid') && from !== rawFrom ? from.split('@')[0]
            : rawFrom.endsWith('@lid') ? `lid_${lidOrPhone}`
            : lidOrPhone;

          // Vincula à empresa do pairingMode (armazenada em pairingNome como "nome|empresaId")
          const [nome, empId] = (globalInst.pairingNome || '').split('|');
          if (empId) {
            try {
              await (prisma.whatsappAdminPhone as any).upsert({
                where: { empresaId_telefone: { empresaId: empId, telefone: phoneToStore } },
                create: { instanceId: globalInst.id, empresaId: empId, telefone: phoneToStore, jid: rawFrom, nome: nome || senderName, ativo: true },
                update: { jid: rawFrom, nome: nome || senderName, ativo: true },
              });
            } catch { /* ignora */ }
          }

          await prisma.whatsappInstance.updateMany({
            where: { instanceName: GLOBAL_INSTANCE_NAME },
            data: { pairingMode: false, pairingNome: null },
          });

          await sock.sendMessage(rawFrom, {
            text: `✅ Olá *${nome || senderName}*! Você foi adicionado como administrador.\n\nEnvie *ajuda* para ver os comandos disponíveis.`,
          });
          return;
        }

        // ── Processar comando ──────────────────────────────────────────────────
        const response = await handleIncomingMessage(from, senderName, text);

        // Registrar mensagem (empresaId vem do contexto interno do handler)
        if (globalInst) {
          await prisma.whatsappMessage.create({
            data: {
              instanceId: globalInst.id,
              direction: 'INCOMING',
              phoneNumber: from,
              senderName,
              message: text,
              response,
              status: 'processed',
            },
          }).catch(() => {});
        }

        if (response?.trim()) {
          await sock.sendMessage(from, { text: response });
        }
      } catch (err) {
        console.error('[Baileys] Erro ao processar mensagem:', err);
      }
    });

  } catch (err) {
    console.error('[Baileys] Erro fatal ao iniciar socket global:', err);
    globalStatus   = 'disconnected';
    isInitializing = false;
    throw err;
  }
}

// ==========================================
// API PÚBLICA
// ==========================================

export function getQRCode(): string | null  { return globalQrCode; }
export function getStatus(): string         { return globalStatus; }
export function getQrGeneratedAt(): number | null { return qrGeneratedAt; }

export async function sendMessage(to: string, text: string): Promise<void> {
  if (!globalSocket) throw new Error('Bot Lina não está conectado');
  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  await globalSocket.sendMessage(jid, { text });
}

export async function sendImageBuffer(to: string, imageBuffer: Buffer, caption?: string): Promise<void> {
  if (!globalSocket) throw new Error('Bot Lina não está conectado');
  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  await globalSocket.sendMessage(jid, { image: imageBuffer, caption: caption ?? '', mimetype: 'image/png' });
}

export async function sendMessageAndCaptureJid(toPhone: string, text: string): Promise<string | null> {
  if (!globalSocket) return null;
  try {
    const cleanPhone = toPhone.replace(/\D/g, '');
    const jid        = `${cleanPhone}@s.whatsapp.net`;
    const result     = await globalSocket.sendMessage(jid, { text });
    const actualJid  = result?.key?.remoteJid;
    if (actualJid?.endsWith('@lid')) {
      lidToPhone.set(actualJid.split('@')[0], cleanPhone);
    }
    return actualJid || jid;
  } catch { return null; }
}

export async function resolvePhoneToJid(phone: string): Promise<string | null> {
  if (!globalSocket) return null;
  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const results    = await globalSocket.onWhatsApp(cleanPhone);
    const result     = Array.isArray(results) ? results[0] : results;
    return result?.exists ? result.jid : null;
  } catch { return null; }
}

export async function disconnect(): Promise<void> {
  try {
    if (globalSocket) {
      await globalSocket.logout();
      globalSocket = null;
    }
    globalQrCode   = null;
    globalStatus   = 'disconnected';
    reconnectCount = 0;
    freshCreds     = false;

    if (existsSync(GLOBAL_AUTH_DIR)) {
      rmSync(GLOBAL_AUTH_DIR, { recursive: true, force: true });
    }

    await prisma.whatsappInstance.updateMany({
      where: { instanceName: GLOBAL_INSTANCE_NAME },
      data: { status: 'disconnected', authState: null, qrCode: null },
    });
    console.log('[Baileys] Socket global desconectado');
  } catch (err) {
    console.error('[Baileys] Erro ao desconectar:', err);
    throw err;
  }
}

/** Chamado no startup do servidor para restaurar sessão salva. */
export async function restoreActiveSessions(): Promise<void> {
  try {
    const instance = await getGlobalInstance();
    if (!instance) {
      console.log('[Baileys] Nenhuma instância global — aguardando setup');
      return;
    }
    if (!instance.authState) {
      console.log('[Baileys] Instância global sem credenciais salvas');
      return;
    }
    console.log('[Baileys] Restaurando sessão global...');
    await initBaileys();
  } catch (err) {
    console.error('[Baileys] Erro ao restaurar sessão global:', err);
  }
}
