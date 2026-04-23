interface BotUserCodeEntry {
  code:       string;
  expiresAt:  number;
  botUserId:  string;
  empresaId:  string;
  role:       string;
  nome:       string;
  lavadorId?: string | null;
  claimed:    boolean;
}

const store = new Map<string, BotUserCodeEntry>(); // chave = botUserId

export function generateBotUserCode(
  botUserId: string,
  empresaId: string,
  role: string,
  nome: string,
  lavadorId?: string | null,
): string {
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  store.set(botUserId, {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000,
    botUserId,
    empresaId,
    role,
    nome,
    lavadorId,
    claimed: false,
  });
  return code;
}

export function getBotUserCode(botUserId: string): BotUserCodeEntry | null {
  const entry = store.get(botUserId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { store.delete(botUserId); return null; }
  return entry;
}

export function validateAndClaimBotCode(input: string): BotUserCodeEntry | null {
  for (const [id, entry] of store.entries()) {
    if (entry.claimed || entry.code !== input) continue;
    if (Date.now() > entry.expiresAt) { store.delete(id); continue; }
    entry.claimed = true;
    return entry;
  }
  return null;
}

export function cancelBotUserCode(botUserId: string): void {
  store.delete(botUserId);
}
