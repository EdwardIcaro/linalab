import prisma from '../db';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';

/**
 * Memória de curto prazo do bot.
 *
 * 1. Histórico: as últimas trocas da pessoa (gravadas em `whatsapp_messages`) vão junto
 *    pra IA, então "e ontem?" ou "e o Felipe?" continuam a conversa anterior.
 * 2. Estados de menu: o menu numerado aberto vale por alguns minutos e fica salvo em
 *    `bot_estados`, então sobrevive ao restart diário das 05:00.
 */

// ── Histórico ────────────────────────────────────────────────────────────────

const HISTORICO_TROCAS = 6;          // pares pergunta/resposta
const HISTORICO_MINUTOS = 30;        // conversa parada há mais que isso = assunto novo
const RESPOSTA_MAX = 700;            // relatórios longos entram resumidos

export async function historicoRecente(jid: string): Promise<ChatCompletionMessageParam[]> {
  try {
    const desde = new Date(Date.now() - HISTORICO_MINUTOS * 60_000);
    const linhas = await prisma.whatsappMessage.findMany({
      where: { phoneNumber: jid, direction: 'INCOMING', createdAt: { gte: desde } },
      orderBy: { createdAt: 'desc' },
      take: HISTORICO_TROCAS,
      select: { message: true, response: true },
    });
    const msgs: ChatCompletionMessageParam[] = [];
    for (const l of linhas.reverse()) {
      msgs.push({ role: 'user', content: l.message.slice(0, 500) });
      const r = (l.response ?? '').trim();
      if (r) msgs.push({ role: 'assistant', content: r.length > RESPOSTA_MAX ? r.slice(0, RESPOSTA_MAX) + '…' : r });
    }
    return msgs;
  } catch (err: any) {
    console.error('[Memoria] Erro ao ler histórico:', err?.message ?? err);
    return [];
  }
}

// ── Estados persistentes (menus) ─────────────────────────────────────────────

const registro = new Map<string, EstadoPersistente<any>>();

/**
 * Map por JID com validade e cópia no banco. A API é síncrona como a de um Map
 * (os handlers já usavam assim); a gravação no banco roda em segundo plano, em fila
 * por chave, pra um `set` seguido de `delete` não chegar invertido.
 */
export class EstadoPersistente<T> {
  private mem = new Map<string, { v: T; exp: number }>();
  private filas = new Map<string, Promise<unknown>>();

  constructor(private readonly chave: string, private readonly ttlMs: number) {
    registro.set(chave, this);
  }

  get(jid: string): T | undefined {
    const e = this.mem.get(jid);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.delete(jid); return undefined; }
    return e.v;
  }

  /** Quando o estado vence (ms epoch); 0 se não existe. */
  expiraEm(jid: string): number {
    return this.mem.get(jid)?.exp ?? 0;
  }

  has(jid: string): boolean {
    return this.get(jid) !== undefined;
  }

  set(jid: string, v: T): this {
    const exp = Date.now() + this.ttlMs;
    this.mem.set(jid, { v, exp });
    this.enfileirar(jid, () => (prisma as any).botEstado.upsert({
      where: { jid_chave: { jid, chave: this.chave } },
      create: { jid, chave: this.chave, valor: v as any, expiraEm: new Date(exp) },
      update: { valor: v as any, expiraEm: new Date(exp) },
    }));
    return this;
  }

  delete(jid: string): boolean {
    const tinha = this.mem.delete(jid);
    this.enfileirar(jid, () => (prisma as any).botEstado.deleteMany({ where: { jid, chave: this.chave } }));
    return tinha;
  }

  /** Usado só na carga inicial. */
  restaurar(jid: string, v: T, exp: number): void {
    this.mem.set(jid, { v, exp });
  }

  private enfileirar(jid: string, op: () => Promise<unknown>): void {
    const anterior = this.filas.get(jid) ?? Promise.resolve();
    const prox = anterior.then(op).catch((err: any) => {
      console.error(`[Memoria] Erro ao salvar estado ${this.chave}:`, err?.message ?? err);
    });
    this.filas.set(jid, prox);
    prox.finally(() => { if (this.filas.get(jid) === prox) this.filas.delete(jid); });
  }
}

/** Na subida do bot: recarrega os menus ainda válidos e apaga os vencidos. */
export async function carregarEstados(): Promise<void> {
  try {
    await (prisma as any).botEstado.deleteMany({ where: { expiraEm: { lt: new Date() } } });
    const linhas = await (prisma as any).botEstado.findMany();
    let n = 0;
    for (const l of linhas) {
      const est = registro.get(l.chave);
      if (!est) continue;
      est.restaurar(l.jid, l.valor, new Date(l.expiraEm).getTime());
      n++;
    }
    if (n) console.log(`[Memoria] ${n} menu(s) aberto(s) restaurado(s)`);
  } catch (err: any) {
    console.error('[Memoria] Erro ao carregar estados:', err?.message ?? err);
  }
}
