/**
 * Store em memória para códigos de pareamento de admin via WhatsApp.
 * Código de 4 dígitos, expira em 5 min, invalidado após uso.
 *
 * Phase 1: armazena userId para que, ao validar, todas as empresas
 * do usuário sejam vinculadas ao admin phone (multi-empresa).
 */

interface PairingCodeEntry {
  code:      string;
  expiresAt: number;
  userId:    string;  // owner do código → busca todas as empresas dele
  empresaId: string;  // empresa onde o código foi gerado (contexto inicial)
  nome?:     string;
  claimed:   boolean;
}

const pairingCodes = new Map<string, PairingCodeEntry>(); // chave = userId

export function generateCode(userId: string, empresaId: string, nome?: string): string {
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  pairingCodes.set(userId, {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000,
    userId,
    empresaId,
    nome,
    claimed: false,
  });
  return code;
}

export function getCodeEntry(userId: string): PairingCodeEntry | null {
  const entry = pairingCodes.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pairingCodes.delete(userId);
    return null;
  }
  return entry;
}

/**
 * Valida um código recebido pelo WhatsApp.
 * Varre todos os códigos pendentes (não sabe qual userId enviou a msg).
 */
export function validateAndClaimByCode(input: string): PairingCodeEntry | null {
  for (const [userId, entry] of pairingCodes.entries()) {
    if (entry.claimed || entry.code !== input) continue;
    if (Date.now() > entry.expiresAt) {
      pairingCodes.delete(userId);
      continue;
    }
    entry.claimed = true;
    return entry;
  }
  return null;
}

export function cancelCode(userId: string): void {
  pairingCodes.delete(userId);
}
