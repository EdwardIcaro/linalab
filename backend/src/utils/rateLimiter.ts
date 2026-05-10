interface Registro {
  tentativas: number;
  resetEm: number;
}

const store = new Map<string, Registro>();

// Retorna true se permitido, false se bloqueado
export function verificarRateLimit(
  chave: string,
  maxTentativas = 10,
  janelaMs = 60 * 60 * 1000 // 1 hora
): boolean {
  const agora = Date.now();
  const registro = store.get(chave);

  if (!registro || agora > registro.resetEm) {
    store.set(chave, { tentativas: 1, resetEm: agora + janelaMs });
    return true;
  }

  if (registro.tentativas >= maxTentativas) {
    return false;
  }

  registro.tentativas++;
  return true;
}

export function resetarRateLimit(chave: string): void {
  store.delete(chave);
}
