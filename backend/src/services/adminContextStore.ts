/**
 * Store em memória para contexto de empresa ativo por admin.
 * Admins com múltiplas empresas precisam selecionar qual empresa
 * estão gerenciando antes de executar comandos no bot.
 * TTL: 5 minutos, renovado a cada comando executado com sucesso.
 */

interface AdminContext {
  empresaId:   string;
  empresaNome: string;
  expiresAt:   number;
}

const store = new Map<string, AdminContext>(); // chave = JID do admin

// Limpar contextos expirados a cada 2 minutos
setInterval(() => {
  const now = Date.now();
  for (const [jid, ctx] of store.entries()) {
    if (ctx.expiresAt < now) store.delete(jid);
  }
}, 2 * 60 * 1000);

const TTL_MS = 5 * 60 * 1000;

/** Retorna contexto ativo e renova TTL. Null se expirado/ausente. */
export function getContext(jid: string): AdminContext | null {
  const ctx = store.get(jid);
  if (!ctx) return null;
  if (Date.now() > ctx.expiresAt) {
    store.delete(jid);
    return null;
  }
  ctx.expiresAt = Date.now() + TTL_MS;
  return ctx;
}

/** Define/atualiza contexto de empresa para o admin. */
export function setContext(jid: string, empresaId: string, empresaNome: string): void {
  store.set(jid, { empresaId, empresaNome, expiresAt: Date.now() + TTL_MS });
}

/** Remove contexto (ex: comando "mudar empresa"). */
export function clearContext(jid: string): void {
  store.delete(jid);
}

/**
 * Tenta detectar empresa pelo nome digitado na mensagem.
 * Ex: "relatorio do lava jato norte" → retorna empresa cujo nome contém "lava jato norte".
 */
export function detectEmpresaNoTexto(
  texto: string,
  empresas: Array<{ id: string; nome: string }>
): { id: string; nome: string } | null {
  const lower = texto.toLowerCase();
  for (const e of empresas) {
    if (lower.includes(e.nome.toLowerCase())) return e;
  }
  return null;
}
