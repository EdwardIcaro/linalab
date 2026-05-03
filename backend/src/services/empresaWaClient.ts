/**
 * Cliente HTTP para endpoints de WhatsApp por empresa no bot service.
 */

const BOT_URL    = process.env.BOT_SERVICE_URL ?? '';
const BOT_SECRET = process.env.BOT_SECRET      ?? '';

async function botEmpresaFetch(path: string, opts?: { method?: string; body?: unknown }): Promise<any> {
  if (!BOT_URL) throw new Error('BOT_SERVICE_URL não configurado');
  const res = await fetch(`${BOT_URL}${path}`, {
    method:  opts?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': BOT_SECRET },
    body:    opts?.body ? JSON.stringify(opts.body) : undefined,
    signal:  AbortSignal.timeout(35000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bot empresa service ${res.status}: ${text}`);
  }
  return res.json();
}

export async function empresaWaConnect(empresaId: string): Promise<{ status: string; qrDataUrl?: string }> {
  return botEmpresaFetch(`/empresa-wa/connect/${encodeURIComponent(empresaId)}`, { method: 'POST' });
}

export async function empresaWaStatus(empresaId: string): Promise<{ status: string; qrDataUrl?: string }> {
  return botEmpresaFetch(`/empresa-wa/status/${encodeURIComponent(empresaId)}`);
}

export async function empresaWaSend(empresaId: string, telefone: string, texto: string): Promise<void> {
  await botEmpresaFetch(`/empresa-wa/send/${encodeURIComponent(empresaId)}`, {
    method: 'POST',
    body: { telefone, texto },
  });
}

export async function empresaWaDisconnect(empresaId: string): Promise<void> {
  await botEmpresaFetch(`/empresa-wa/disconnect/${encodeURIComponent(empresaId)}`, { method: 'POST' });
}
