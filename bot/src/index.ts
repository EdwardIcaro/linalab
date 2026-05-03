import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

// Evita crash por promises não tratadas (ex: saveCreds com dir deletado)
process.on('unhandledRejection', (reason) => {
  console.error('[Bot] Unhandled rejection (ignorado para evitar crash):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Bot] Uncaught exception (ignorado para evitar crash):', err);
});

import {
  initBaileys,
  restoreActiveSessions,
  getStatus,
  getQRCode,
  getQrGeneratedAt,
  disconnect,
  sendMessage,
  sendImageBuffer,
  resolvePhoneToJid,
  sendMessageAndCaptureJid,
} from './services/baileyService';

import {
  connectEmpresa,
  getEmpresaStatus,
  sendEmpresaMessage,
  disconnectEmpresa,
  restoreAllEmpresaSessions,
} from './services/empresaWaService';

import {
  generateCode,
  getCodeEntry,
  cancelCode,
} from './services/pairingCodeStore';

import {
  generateBotUserCode,
  getBotUserCode,
  cancelBotUserCode,
} from './services/botUserCodeStore';

import { botAuth } from './middleware/botAuth';
import { scheduleCleanupReports } from './cron/cleanupReports';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// ── Saúde (público) ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'OK', botStatus: getStatus(), timestamp: new Date().toISOString() });
});

// ── Proteger todas as demais rotas ───────────────────────────────────────────
app.use(botAuth);

// ── Status + QR ──────────────────────────────────────────────────────────────
app.get('/status', (_req, res) => {
  const status       = getStatus();
  const qrCode       = getQRCode();
  const generatedAt  = getQrGeneratedAt();
  const qrExpiresIn  = generatedAt ? Math.max(0, 60 - Math.floor((Date.now() - generatedAt) / 1000)) : null;
  res.json({ status, ...(qrCode && { qrCode, qrExpiresIn }) });
});

// ── Inicializar socket ───────────────────────────────────────────────────────
app.post('/initialize', async (_req, res) => {
  try {
    const current = getStatus();
    if (current === 'connected') {
      return res.json({ status: 'connected', message: 'Bot já conectado' });
    }
    if (current === 'reconnecting') {
      return res.status(409).json({ status: 'reconnecting', message: 'Reconexão em andamento' });
    }

    await initBaileys();

    // Aguardar QR ou conexão (até 30s)
    let tries = 0;
    while (tries < 30) {
      await new Promise(r => setTimeout(r, 1000));
      const s = getStatus();
      if (s === 'connected') return res.json({ status: 'connected' });
      if (s === 'qr_code')   return res.json({ status: 'qr_code', qrCode: getQRCode() });
      tries++;
    }

    return res.json({ status: getStatus(), qrCode: getQRCode() });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao inicializar bot', details: String(err) });
  }
});

// ── Desconectar ──────────────────────────────────────────────────────────────
app.post('/disconnect', async (_req, res) => {
  try {
    await disconnect();
    return res.json({ message: 'Bot desconectado' });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao desconectar', details: String(err) });
  }
});

// ── Enviar mensagem de texto ─────────────────────────────────────────────────
app.post('/send', async (req, res) => {
  const { to, text } = req.body as { to: string; text: string };
  if (!to || !text) return res.status(400).json({ error: 'to e text são obrigatórios' });

  try {
    await sendMessage(to, text);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao enviar mensagem', details: String(err) });
  }
});

// ── Enviar imagem ────────────────────────────────────────────────────────────
app.post('/send-image', async (req, res) => {
  const { to, imageBase64, caption } = req.body as { to: string; imageBase64: string; caption?: string };
  if (!to || !imageBase64) return res.status(400).json({ error: 'to e imageBase64 são obrigatórios' });

  try {
    const buf = Buffer.from(imageBase64, 'base64');
    await sendImageBuffer(to, buf, caption);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao enviar imagem', details: String(err) });
  }
});

// ── Resolver phone → JID ─────────────────────────────────────────────────────
app.post('/resolve-jid', async (req, res) => {
  const { phone } = req.body as { phone: string };
  if (!phone) return res.status(400).json({ error: 'phone é obrigatório' });

  try {
    const jid = await resolvePhoneToJid(phone);
    return res.json({ jid });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao resolver JID', details: String(err) });
  }
});

// ── Enviar e capturar JID real ───────────────────────────────────────────────
app.post('/send-capture-jid', async (req, res) => {
  const { phone, text } = req.body as { phone: string; text: string };
  if (!phone || !text) return res.status(400).json({ error: 'phone e text são obrigatórios' });

  try {
    const jid = await sendMessageAndCaptureJid(phone, text);
    return res.json({ jid });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao enviar/capturar JID', details: String(err) });
  }
});

// ── Código de pareamento admin ───────────────────────────────────────────────
app.post('/pairing-code', (req, res) => {
  const { userId, empresaId, nome } = req.body as { userId: string; empresaId: string; nome?: string };
  if (!userId || !empresaId) return res.status(400).json({ error: 'userId e empresaId são obrigatórios' });

  try {
    const code = generateCode(userId, empresaId, nome);
    return res.json({ code, expiresInSeconds: 300 });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao gerar código', details: String(err) });
  }
});

app.get('/pairing-code/:userId', (req, res) => {
  const userId = req.params['userId'] as string;
  const entry = getCodeEntry(userId);
  if (!entry) return res.json({ active: false });
  return res.json({ active: true, claimed: entry.claimed, expiresAt: new Date(entry.expiresAt) });
});

app.delete('/pairing-code/:userId', (req, res) => {
  const userId = req.params['userId'] as string;
  cancelCode(userId);
  return res.json({ ok: true });
});

// ── PIN de bot user ──────────────────────────────────────────────────────────
app.post('/bot-pin/:id', (req, res) => {
  const id = req.params['id'] as string;
  const { empresaId, role, nome, lavadorId } = req.body as {
    empresaId: string; role: string; nome: string; lavadorId?: string;
  };
  if (!empresaId || !role || !nome) return res.status(400).json({ error: 'empresaId, role e nome são obrigatórios' });

  try {
    cancelBotUserCode(id); // cancela PIN anterior se houver
    const code = generateBotUserCode(id, empresaId, role, nome, lavadorId ?? null);
    return res.json({ code, expiresInSeconds: 300 });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao gerar PIN', details: String(err) });
  }
});

app.get('/bot-pin/:id', (req, res) => {
  const id = req.params['id'] as string;
  const entry = getBotUserCode(id);
  if (!entry) return res.json({ active: false });
  return res.json({ active: true, claimed: entry.claimed, expiresAt: entry.expiresAt });
});

app.delete('/bot-pin/:id', (req, res) => {
  const id = req.params['id'] as string;
  cancelBotUserCode(id);
  return res.json({ ok: true });
});

// ── WhatsApp por empresa (passivo) ───────────────────────────────────────────
app.post('/empresa-wa/connect/:empresaId', async (req, res) => {
  const empresaId = req.params['empresaId'] as string;
  try {
    const cur = getEmpresaStatus(empresaId);
    if (cur.status === 'CONECTADO') return res.json({ status: 'CONECTADO' });
    connectEmpresa(empresaId).catch(console.error);
    let tries = 0;
    while (tries < 30) {
      await new Promise(r => setTimeout(r, 1000));
      const s = getEmpresaStatus(empresaId);
      if (s.status === 'CONECTADO') return res.json({ status: 'CONECTADO' });
      if (s.status === 'QR')        return res.json({ status: 'QR', qrDataUrl: s.qrDataUrl });
      tries++;
    }
    return res.json(getEmpresaStatus(empresaId));
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao conectar empresa', details: String(err) });
  }
});

app.get('/empresa-wa/status/:empresaId', (req, res) => {
  const empresaId = req.params['empresaId'] as string;
  return res.json(getEmpresaStatus(empresaId));
});

app.post('/empresa-wa/send/:empresaId', async (req, res) => {
  const empresaId = req.params['empresaId'] as string;
  const { telefone, texto } = req.body as { telefone: string; texto: string };
  if (!telefone || !texto) return res.status(400).json({ error: 'telefone e texto são obrigatórios' });
  try {
    await sendEmpresaMessage(empresaId, telefone, texto);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post('/empresa-wa/disconnect/:empresaId', async (req, res) => {
  const empresaId = req.params['empresaId'] as string;
  try {
    await disconnectEmpresa(empresaId);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ── Iniciar servidor ─────────────────────────────────────────────────────────
async function startBot() {
  try {
    console.log('🤖 Bot Lina X iniciando...');

    app.listen(PORT, () => {
      console.log(`🚀 Bot service rodando na porta ${PORT}`);
    });

    scheduleCleanupReports();

    // Restaurar sessão WhatsApp salva no banco
    console.log('🔄 Restaurando sessão WhatsApp...');
    await new Promise(resolve => setTimeout(resolve, 3000)); // aguarda estabilização
    await restoreActiveSessions();
    // Restaurar sessões WhatsApp das empresas
    await restoreAllEmpresaSessions();
  } catch (err) {
    console.error('❌ Erro ao iniciar bot:', err);
    process.exit(1);
  }
}

startBot();
