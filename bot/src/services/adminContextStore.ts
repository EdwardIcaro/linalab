/**
 * Empresa ativa por admin (quem tem várias empresas escolhe uma pra conversar).
 * Vale 12h, renovada a cada uso, e fica salva em `bot_estados` — antes eram 5 minutos
 * só em memória, e o bot perguntava "qual empresa?" a toda hora e depois de todo restart.
 */
import { EstadoPersistente } from './conversaMemoria';

interface AdminContext {
  empresaId:   string;
  empresaNome: string;
}

const TTL_MS = 12 * 60 * 60 * 1000;
const RENOVAR_APOS_MS = 10 * 60 * 1000; // não grava no banco a cada mensagem

const store = new EstadoPersistente<AdminContext>('empresaAtiva', TTL_MS);

/** Retorna contexto ativo e renova a validade. Null se expirado/ausente. */
export function getContext(jid: string): AdminContext | null {
  const ctx = store.get(jid);
  if (!ctx) return null;
  const restante = store.expiraEm(jid) - Date.now();
  if (TTL_MS - restante > RENOVAR_APOS_MS) store.set(jid, ctx);
  return ctx;
}

/** Define/atualiza contexto de empresa para o admin. */
export function setContext(jid: string, empresaId: string, empresaNome: string): void {
  store.set(jid, { empresaId, empresaNome });
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
