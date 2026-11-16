/**
 * Acesso rápido da confirmação de frota (pedido do dono em 16/11/2026).
 *
 * O aviso do WhatsApp leva um link pessoal (`/frota-confirmar.html?k=CÓDIGO`). O código só diz
 * QUEM é a pessoa (dono ou subconta) — não abre nada sozinho. Na tela, a chave pede a senha dela e
 * devolve uma sessão de 12 h que só enxerga estas rotas: ordens da frota esperando confirmação em
 * todas as empresas em que a pessoa confirma frota (dono = todas as dele; subconta = empresas em que
 * o cargo tem `confirmar_frota`). Quem já está logado usa o próprio token no lugar do código.
 *
 * A sessão NÃO tem `id`/`empresaId`, então o authMiddleware normal recusa — ela não abre o resto do sistema.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { listarPendentes, confirmar, devolver, respostaFalsa } from './frotaConfirmacaoController';

type Quem = { tipo: 'u' | 's'; id: string };
type Sessao = Quem & { nome: string };
interface ReqFrota extends Request { frota?: Sessao }

const PERM = 'confirmar_frota';
const SESSAO_HORAS = 12;
const MAX_FALHAS = 5;
const TRAVA_MIN = 15;

function segredo(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET não configurado');
  return s;
}

function assinatura(base: string): string {
  return crypto.createHmac('sha256', segredo()).update(`frota-link:${base}`).digest('base64url').slice(0, 16);
}

/** Código do link pessoal: identifica a pessoa, sem prazo (a senha continua obrigatória). */
export function codigoDoLink(q: Quem): string {
  const base = `${q.tipo}${q.id}`;
  return `${base}.${assinatura(base)}`;
}

function lerCodigo(k: unknown): Quem | null {
  if (typeof k !== 'string' || k.length > 120) return null;
  const [base, sig] = k.split('.');
  if (!base || !sig || base.length < 2) return null;
  const esperado = assinatura(base);
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  const tipo = base[0];
  if (tipo !== 'u' && tipo !== 's') return null;
  return { tipo, id: base.slice(1) };
}

/** Quem já está logado: lê o token normal do painel. */
function lerTokenNormal(req: Request): Quem | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  try {
    const d = jwt.verify(h.slice(7), segredo()) as any;
    if (d?.fr) return null; // sessão rápida não vale como login
    if (d?.subaccountId) return { tipo: 's', id: d.subaccountId };
    if (d?.id) return { tipo: 'u', id: d.id };
  } catch { /* token inválido/expirado */ }
  return null;
}

function identificar(req: Request): Quem | null {
  return lerCodigo(req.body?.k ?? req.query?.k) || lerTokenNormal(req);
}

async function pessoa(q: Quem): Promise<{ nome: string; senha: string } | null> {
  if (q.tipo === 'u') return prisma.usuario.findUnique({ where: { id: q.id }, select: { nome: true, senha: true } });
  return prisma.subaccount.findUnique({ where: { id: q.id }, select: { nome: true, senha: true } });
}

/** Empresas em que a pessoa pode confirmar frota. */
export async function empresasPermitidas(q: Quem): Promise<{ id: string; nome: string }[]> {
  if (q.tipo === 'u') {
    return prisma.empresa.findMany({ where: { usuarioId: q.id }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } });
  }
  const sub = await prisma.subaccount.findUnique({
    where: { id: q.id },
    select: {
      empresa: { select: { id: true, nome: true } },
      roleInt: { select: { permissoes: { select: { name: true } } } },
      empresaAcessos: { select: { empresa: { select: { id: true, nome: true } }, role: { select: { permissoes: { select: { name: true } } } } } },
    },
  });
  if (!sub) return [];
  const lista: { id: string; nome: string }[] = [];
  if (sub.roleInt?.permissoes.some((p) => p.name === PERM)) lista.push(sub.empresa);
  for (const a of sub.empresaAcessos) if (a.role?.permissoes.some((p) => p.name === PERM)) lista.push(a.empresa);
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ─── trava de senha errada (memória do processo) ───────────────────────────
const falhas = new Map<string, { n: number; ate: number }>();
function travado(chave: string): number {
  const f = falhas.get(chave);
  if (!f || !f.ate) return 0;
  if (Date.now() > f.ate) { falhas.delete(chave); return 0; }
  return Math.ceil((f.ate - Date.now()) / 60000);
}
function errou(chave: string): number {
  const f = falhas.get(chave) || { n: 0, ate: 0 };
  f.n += 1;
  if (f.n >= MAX_FALHAS) f.ate = Date.now() + TRAVA_MIN * 60000;
  falhas.set(chave, f);
  return Math.max(0, MAX_FALHAS - f.n);
}

/** GET /api/frota-rapido/quem?k= — nome para o modal (ou do token de quem está logado). */
export async function quem(req: Request, res: Response) {
  const q = identificar(req);
  if (!q) return res.status(400).json({ error: 'Link inválido. Peça um novo aviso.' });
  const p = await pessoa(q).catch(() => null);
  if (!p) return res.status(404).json({ error: 'Conta não encontrada.' });
  return res.json({ nome: p.nome });
}

/** POST /api/frota-rapido/entrar { k?, senha } — devolve a sessão de 12 h. */
export async function entrar(req: Request, res: Response) {
  try {
    const q = identificar(req);
    if (!q) return res.status(400).json({ error: 'Link inválido. Peça um novo aviso.' });
    const senha = String(req.body?.senha || '');
    if (!senha) return res.status(400).json({ error: 'Digite a senha.' });
    const chave = `${q.tipo}${q.id}`;
    const min = travado(chave);
    if (min) return res.status(429).json({ error: `Muitas tentativas. Tente de novo em ${min} min.` });
    const p = await pessoa(q);
    if (!p || !(await bcrypt.compare(senha, p.senha))) {
      const restam = errou(chave);
      return res.status(401).json({ error: restam ? `Senha incorreta. Restam ${restam} tentativa${restam > 1 ? 's' : ''}.` : `Senha incorreta. Acesso travado por ${TRAVA_MIN} min.` });
    }
    falhas.delete(chave);
    const empresas = await empresasPermitidas(q);
    if (!empresas.length) return res.status(403).json({ error: 'Seu cargo não tem a permissão "Confirmar ordens de frota" em nenhuma empresa.' });
    const token = jwt.sign({ fr: 'sessao', tipo: q.tipo, sid: q.id, nome: p.nome }, segredo(), { expiresIn: `${SESSAO_HORAS}h` });
    return res.json({ token, nome: p.nome, expiraEm: Date.now() + SESSAO_HORAS * 3600_000 });
  } catch (e) {
    console.error('[FrotaRapido] Erro ao entrar:', e);
    return res.status(500).json({ error: 'Não foi possível entrar.' });
  }
}

/** Middleware: exige a sessão rápida. */
export function sessaoFrota(req: ReqFrota, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  try {
    const d = jwt.verify(h?.startsWith('Bearer ') ? h.slice(7) : '', segredo()) as any;
    if (d?.fr !== 'sessao' || (d.tipo !== 'u' && d.tipo !== 's') || !d.sid) throw new Error('escopo');
    req.frota = { tipo: d.tipo, id: d.sid, nome: d.nome || '' };
    return next();
  } catch {
    return res.status(401).json({ error: 'Acesso expirado. Toque na chave e digite a senha de novo.', code: 'FROTA_SESSAO' });
  }
}

function reqDe(req: ReqFrota, empresaId: string, extra: Record<string, unknown> = {}) {
  return Object.assign(Object.create(req), {
    empresaId, usuarioNome: req.frota!.nome, subaccountId: undefined, params: {}, body: {}, ...extra,
  });
}

/** GET /api/frota-rapido/pendentes — ordens esperando, agrupadas por empresa. */
export async function pendentes(req: ReqFrota, res: Response) {
  try {
    const empresas = await empresasPermitidas(req.frota!);
    const grupos = [];
    for (const e of empresas) {
      const r = respostaFalsa();
      await listarPendentes(reqDe(req, e.id) as any, r);
      if (r.statusCode !== 200) throw new Error(r.body?.error || 'falha ao listar');
      grupos.push({ id: e.id, nome: e.nome, ordens: r.body?.ordens || [] });
    }
    return res.json({ nome: req.frota!.nome, empresas: grupos });
  } catch (e) {
    console.error('[FrotaRapido] Erro ao listar:', e);
    return res.status(500).json({ error: 'Erro ao carregar as ordens a confirmar.' });
  }
}

/** POST /api/frota-rapido/confirmar { ids } — cada ordem confirma na empresa dela. */
export async function confirmarRapido(req: ReqFrota, res: Response) {
  try {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string').slice(0, 100) : [];
    if (!ids.length) return res.status(400).json({ error: 'Escolha ao menos uma ordem.' });
    const permitidas = new Set((await empresasPermitidas(req.frota!)).map((e) => e.id));
    const ordens = await prisma.ordemServico.findMany({ where: { id: { in: ids } }, select: { id: true, empresaId: true } });
    const porEmpresa = new Map<string, string[]>();
    const resultados: any[] = [];
    for (const id of ids) {
      const o = ordens.find((x) => x.id === id);
      if (!o || !permitidas.has(o.empresaId)) { resultados.push({ id, ok: false, erro: 'Sem acesso a esta ordem.' }); continue; }
      porEmpresa.set(o.empresaId, [...(porEmpresa.get(o.empresaId) || []), id]);
    }
    for (const [empresaId, lista] of porEmpresa) {
      const r = respostaFalsa();
      await confirmar(reqDe(req, empresaId, { body: { ids: lista } }) as any, r);
      if (r.statusCode === 200) resultados.push(...(r.body?.resultados || []));
      else resultados.push(...lista.map((id) => ({ id, ok: false, erro: r.body?.error || 'Não foi possível confirmar.' })));
    }
    return res.json({ resultados, confirmadas: resultados.filter((r) => r.ok).length });
  } catch (e) {
    console.error('[FrotaRapido] Erro ao confirmar:', e);
    return res.status(500).json({ error: 'Não foi possível confirmar.' });
  }
}

/** POST /api/frota-rapido/:id/devolver { motivo } */
export async function devolverRapido(req: ReqFrota, res: Response) {
  try {
    const id = req.params.id as string;
    const o = await prisma.ordemServico.findUnique({ where: { id }, select: { empresaId: true } });
    const permitidas = new Set((await empresasPermitidas(req.frota!)).map((e) => e.id));
    if (!o || !permitidas.has(o.empresaId)) return res.status(404).json({ error: 'Ordem não encontrada.' });
    const r = respostaFalsa();
    await devolver(reqDe(req, o.empresaId, { params: { id }, body: { motivo: req.body?.motivo } }) as any, r);
    return res.status(r.statusCode).json(r.body);
  } catch (e) {
    console.error('[FrotaRapido] Erro ao devolver:', e);
    return res.status(500).json({ error: 'Não foi possível devolver a ordem.' });
  }
}
