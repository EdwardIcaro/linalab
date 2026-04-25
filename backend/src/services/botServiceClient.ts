/**
 * Cliente HTTP para o bot service (VPS Oracle).
 * Centraliza todas as chamadas do backend ao serviço separado.
 */

const BOT_URL    = process.env.BOT_SERVICE_URL ?? '';
const BOT_SECRET = process.env.BOT_SECRET      ?? '';

async function botFetch(path: string, opts?: { method?: string; body?: unknown }): Promise<any> {
  if (!BOT_URL) throw new Error('BOT_SERVICE_URL não configurado');
  const res = await fetch(`${BOT_URL}${path}`, {
    method:  opts?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': BOT_SECRET },
    body:    opts?.body ? JSON.stringify(opts.body) : undefined,
    signal:  AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bot service ${res.status}: ${text}`);
  }
  return res.json();
}

export async function botSend(to: string, text: string): Promise<void> {
  await botFetch('/send', { method: 'POST', body: { to, text } });
}

export async function botSendImage(to: string, buf: Buffer, caption?: string): Promise<void> {
  await botFetch('/send-image', {
    method: 'POST',
    body: { to, imageBase64: buf.toString('base64'), caption },
  });
}

export async function botGetStatus(): Promise<{ status: string; qrCode?: string; qrExpiresIn?: number }> {
  return botFetch('/status');
}

export async function botInitialize(): Promise<{ status: string; qrCode?: string }> {
  return botFetch('/initialize', { method: 'POST' });
}

export async function botDisconnect(): Promise<void> {
  await botFetch('/disconnect', { method: 'POST' });
}

export async function botResolveJid(phone: string): Promise<string | null> {
  const data = await botFetch('/resolve-jid', { method: 'POST', body: { phone } });
  return data.jid ?? null;
}

export async function botSendCaptureJid(phone: string, text: string): Promise<string | null> {
  const data = await botFetch('/send-capture-jid', { method: 'POST', body: { phone, text } });
  return data.jid ?? null;
}

export async function botGeneratePairingCode(userId: string, empresaId: string, nome?: string): Promise<string> {
  const data = await botFetch('/pairing-code', { method: 'POST', body: { userId, empresaId, nome } });
  return data.code;
}

export async function botGetPairingCode(userId: string): Promise<{ active: boolean; claimed: boolean; expiresAt?: Date }> {
  return botFetch(`/pairing-code/${encodeURIComponent(userId)}`);
}

export async function botCancelPairingCode(userId: string): Promise<void> {
  await botFetch(`/pairing-code/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export async function botGeneratePin(
  id: string, empresaId: string, role: string, nome: string, lavadorId?: string | null
): Promise<string> {
  const data = await botFetch(`/bot-pin/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: { empresaId, role, nome, ...(lavadorId ? { lavadorId } : {}) },
  });
  return data.code;
}

export async function botGetPin(id: string): Promise<{ active: boolean; claimed: boolean; expiresAt?: Date }> {
  return botFetch(`/bot-pin/${encodeURIComponent(id)}`);
}

export async function botCancelPin(id: string): Promise<void> {
  await botFetch(`/bot-pin/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
