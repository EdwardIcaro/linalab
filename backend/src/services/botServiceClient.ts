/**
 * Cliente HTTP para o Bot Service (serviço separado no Railway).
 * Substitui todas as chamadas diretas ao baileyService, pairingCodeStore e botUserCodeStore.
 */

const BOT_URL    = (process.env.BOT_SERVICE_URL ?? '').replace(/\/$/, '');
const BOT_SECRET = process.env.BOT_SECRET ?? '';

async function botFetch(path: string, opts: RequestInit = {}): Promise<any> {
  if (!BOT_URL) throw new Error('BOT_SERVICE_URL não configurado');

  const res = await fetch(`${BOT_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Bot-Secret': BOT_SECRET,
      ...(opts.headers as Record<string, string> ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bot service error ${res.status}: ${body}`);
  }

  return res.json();
}

// ── Conexão ──────────────────────────────────────────────────────────────────

export async function botGetStatus(): Promise<{ status: string; qrCode?: string; ownerPhone?: string }> {
  try { return await botFetch('/status'); }
  catch { return { status: 'disconnected' }; }
}

export async function botInitialize(): Promise<{ status: string; qrCode?: string }> {
  return botFetch('/initialize', { method: 'POST' });
}

export async function botDisconnect(): Promise<void> {
  await botFetch('/disconnect', { method: 'POST' });
}

// ── Mensagens ────────────────────────────────────────────────────────────────

export async function botSend(to: string, text: string): Promise<void> {
  await botFetch('/send', {
    method: 'POST',
    body: JSON.stringify({ to, text }),
  });
}

export async function botSendImage(to: string, imageBuffer: Buffer, caption?: string): Promise<void> {
  await botFetch('/send-image', {
    method: 'POST',
    body: JSON.stringify({ to, imageBase64: imageBuffer.toString('base64'), caption }),
  });
}

export async function botResolveJid(phone: string): Promise<string | null> {
  try {
    const r = await botFetch('/resolve-jid', { method: 'POST', body: JSON.stringify({ phone }) });
    return r.jid ?? null;
  } catch { return null; }
}

export async function botSendCaptureJid(phone: string, text: string): Promise<string | null> {
  try {
    const r = await botFetch('/send-capture-jid', { method: 'POST', body: JSON.stringify({ phone, text }) });
    return r.jid ?? null;
  } catch { return null; }
}

// ── Código de pareamento admin ───────────────────────────────────────────────

export async function botGeneratePairingCode(userId: string, empresaId: string, nome?: string): Promise<string> {
  const r = await botFetch('/pairing-code', {
    method: 'POST',
    body: JSON.stringify({ userId, empresaId, nome }),
  });
  return r.code as string;
}

export async function botGetPairingCode(userId: string): Promise<{ active: boolean; claimed: boolean; expiresAt?: Date }> {
  try { return await botFetch(`/pairing-code/${encodeURIComponent(userId)}`); }
  catch { return { active: false, claimed: false }; }
}

export async function botCancelPairingCode(userId: string): Promise<void> {
  await botFetch(`/pairing-code/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

// ── PIN de bot user ──────────────────────────────────────────────────────────

export async function botGeneratePin(
  id: string,
  empresaId: string,
  role: string,
  nome: string,
  lavadorId?: string | null
): Promise<string> {
  const r = await botFetch(`/bot-pin/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ empresaId, role, nome, lavadorId }),
  });
  return r.code as string;
}

export async function botGetPin(id: string): Promise<{ active: boolean; claimed: boolean; expiresAt?: Date }> {
  try { return await botFetch(`/bot-pin/${encodeURIComponent(id)}`); }
  catch { return { active: false, claimed: false }; }
}

export async function botCancelPin(id: string): Promise<void> {
  await botFetch(`/bot-pin/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
}
