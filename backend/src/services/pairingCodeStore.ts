/**
 * Store em memória para códigos de pareamento de admin via WhatsApp.
 * O código tem 4 dígitos, expira em 5 minutos e é invalidado após uso.
 */

interface PairingCodeEntry {
  code: string;
  expiresAt: number;
  nome?: string;
  claimed: boolean;
}

const pairingCodes = new Map<string, PairingCodeEntry>();

export function generateCode(empresaId: string, nome?: string): string {
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  pairingCodes.set(empresaId, {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000,
    nome: nome || undefined,
    claimed: false,
  });
  return code;
}

export function getCodeEntry(empresaId: string): PairingCodeEntry | null {
  const entry = pairingCodes.get(empresaId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pairingCodes.delete(empresaId);
    return null;
  }
  return entry;
}

export function validateAndClaim(empresaId: string, input: string): PairingCodeEntry | null {
  const entry = getCodeEntry(empresaId);
  if (!entry || entry.claimed || entry.code !== input) return null;
  entry.claimed = true;
  return entry;
}

export function cancelCode(empresaId: string): void {
  pairingCodes.delete(empresaId);
}
