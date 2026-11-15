/**
 * Vistoria de entrada da ordem (acompanhamento do veículo, fase 2 — 15/11/2026).
 *
 * `ordens_servico.vistoria` (JSON): { km, obs, avarias: [{ zona, tipo, obs, fotos: [fotoId] }], por, em }
 * Fotos em `ordens_vistoria_fotos` (data URL JPEG já comprimida no navegador).
 * Tudo é opcional. Editável enquanto a ordem não está finalizada/cancelada.
 * Ordens da frota vinculada (têm checklist próprio da Localiza) e avulsas ficam de fora.
 */

import prisma from '../db';
import { clientesFrota } from '../controllers/ordemEdicaoController';
import { cfgAcomp } from './acompanhamentoService';

const ZONAS = new Set([
  // carro
  'pcd', 'capo', 'teto', 'tampa', 'pct', 'pbr', 'vtr', 'rve', 'rvd', 'led', 'let', 'ldd', 'ldt', 'rde', 'rdd', 'rte', 'rtd',
  // moto
  'rdm', 'farol', 'guidao', 'tanque', 'le', 'ld', 'banco', 'esc', 'rabeta', 'rtm',
]);
const TIPOS = new Set(['Risco', 'Amassado', 'Trincado', 'Quebrado', 'Pintura queimada', 'Peça faltando']);
const MAX_FOTOS = 12;
const MAX_FOTOS_AVARIA = 3;
const MAX_FOTO_BYTES = 700_000; // data URL; o navegador já manda ~100-450 KB

export interface AvariaSalva { zona: string; tipo: string; obs: string; fotos: string[] }
export interface VistoriaSalva { km: number | null; obs: string; avarias: AvariaSalva[]; por?: string | null; em?: string }

export function lerVistoria(v: unknown): VistoriaSalva | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as any;
  return {
    km: Number.isFinite(o.km) ? o.km : null,
    obs: typeof o.obs === 'string' ? o.obs : '',
    avarias: Array.isArray(o.avarias) ? o.avarias : [],
    por: o.por ?? null,
    em: o.em,
  };
}

export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string; status: number };
const falha = (erro: string, status: number) => ({ ok: false as const, erro, status });

export const vistoriaVazia = (v: VistoriaSalva | null) => !v || (v.km == null && !v.obs && !v.avarias.length);

/** Vistoria ligada na empresa (Configurações › Preferências); sem a chave = ligada. */
export async function vistoriaAtiva(empresaId: string): Promise<boolean> {
  const e = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { config: true } });
  return cfgAcomp(e?.config).vistoria;
}

async function ordemDaVistoria(ordemId: string, empresaId: string) {
  const o = await prisma.ordemServico.findFirst({
    where: { id: ordemId, empresaId },
    select: { id: true, status: true, tipoOrdem: true, clienteId: true, vistoria: true, veiculo: { select: { placa: true, tipoVeiculo: true } } },
  });
  if (!o) return falha('Ordem não encontrada', 404);
  if (o.tipoOrdem !== 'VEICULO' || !o.veiculo?.placa) return falha('Ordem sem veículo não tem vistoria.', 400);
  if ((await clientesFrota(empresaId).catch(() => new Set<string>())).has(o.clienteId)) return falha('Ordem da frota usa o checklist da Localiza.', 400);
  return { ok: true as const, dados: o };
}

/** GET para o editor: vistoria + fotos como data URL. */
export async function vistoriaParaEditar(ordemId: string, empresaId: string) {
  const r = await ordemDaVistoria(ordemId, empresaId);
  if (!r.ok) return r;
  const o = r.dados;
  const v = lerVistoria(o.vistoria);
  const ids = (v?.avarias || []).flatMap((a) => a.fotos || []);
  const fotos = ids.length
    ? await prisma.ordemVistoriaFoto.findMany({ where: { id: { in: ids }, ordemId }, select: { id: true, imagem: true } })
    : [];
  const mapa = new Map(fotos.map((f) => [f.id, f.imagem]));
  return {
    ok: true as const,
    dados: {
      tipo: (o.veiculo?.tipoVeiculo || '').toUpperCase() === 'MOTO' ? 'moto' : 'carro',
      placa: o.veiculo?.placa || '',
      editavel: !['FINALIZADO', 'CANCELADO'].includes(o.status),
      km: v?.km ?? null,
      obs: v?.obs || '',
      avarias: (v?.avarias || []).map((a) => ({ ...a, fotos: (a.fotos || []).filter((id) => mapa.has(id)).map((id) => ({ id, src: mapa.get(id)! })) })),
      por: v?.por || null,
      em: v?.em || null,
    },
  };
}

/**
 * PUT: grava a vistoria inteira. Fotos chegam como { id } (já salva) ou { src: 'data:image/jpeg;base64,...' } (nova).
 * Fotos que saíram da vistoria são apagadas.
 */
export async function salvarVistoria(ordemId: string, empresaId: string, body: any, por: string | null) {
  const r = await ordemDaVistoria(ordemId, empresaId);
  if (!r.ok) return r;
  if (['FINALIZADO', 'CANCELADO'].includes(r.dados.status)) return falha('Ordem encerrada: a vistoria não muda mais.', 409);

  const kmNum = body?.km === '' || body?.km == null ? null : Number(String(body.km).replace(/\D/g, ''));
  const km = kmNum != null && Number.isFinite(kmNum) && kmNum >= 0 && kmNum < 10_000_000 ? kmNum : null;
  const obs = typeof body?.obs === 'string' ? body.obs.trim().slice(0, 300) : '';
  const brutas: any[] = Array.isArray(body?.avarias) ? body.avarias.slice(0, 30) : [];

  const atuais = await prisma.ordemVistoriaFoto.findMany({ where: { ordemId }, select: { id: true } });
  const idsAtuais = new Set(atuais.map((f) => f.id));
  const vistas = new Set<string>();
  let totalFotos = 0;
  const avarias: { zona: string; tipo: string; obs: string; fotos: ({ id: string } | { src: string })[] }[] = [];

  for (const a of brutas) {
    if (!a || !ZONAS.has(a.zona) || !TIPOS.has(a.tipo) || vistas.has(a.zona)) continue;
    vistas.add(a.zona);
    const fotos: ({ id: string } | { src: string })[] = [];
    for (const f of Array.isArray(a.fotos) ? a.fotos : []) {
      if (fotos.length >= MAX_FOTOS_AVARIA || totalFotos >= MAX_FOTOS) break;
      if (f?.id && idsAtuais.has(f.id)) { fotos.push({ id: f.id }); totalFotos++; }
      else if (typeof f?.src === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f.src) && f.src.length <= MAX_FOTO_BYTES) { fotos.push({ src: f.src }); totalFotos++; }
    }
    avarias.push({ zona: a.zona, tipo: a.tipo, obs: typeof a.obs === 'string' ? a.obs.trim().slice(0, 160) : '', fotos });
  }

  const salva = await prisma.$transaction(async (tx) => {
    const final: AvariaSalva[] = [];
    for (const a of avarias) {
      const ids: string[] = [];
      for (const f of a.fotos) {
        if ('id' in f) ids.push(f.id);
        else ids.push((await tx.ordemVistoriaFoto.create({ data: { ordemId, empresaId, imagem: f.src }, select: { id: true } })).id);
      }
      final.push({ zona: a.zona, tipo: a.tipo, obs: a.obs, fotos: ids });
    }
    const usados = final.flatMap((a) => a.fotos);
    await tx.ordemVistoriaFoto.deleteMany({ where: { ordemId, id: { notIn: usados } } });
    const vistoria: VistoriaSalva = { km, obs, avarias: final, por, em: new Date().toISOString() };
    const vazia = vistoriaVazia(vistoria);
    await tx.ordemServico.update({ where: { id: ordemId }, data: { vistoria: vazia ? (null as any) : (vistoria as any) } });
    return vazia ? null : vistoria;
  }, { timeout: 30000 });

  return { ok: true as const, dados: salva };
}

/** Resumo para o detalhe da ordem: "48.312 km · 3 avarias · 2 fotos". */
export function resumoVistoria(v: unknown) {
  const x = lerVistoria(v);
  if (vistoriaVazia(x)) return null;
  return { km: x!.km, avarias: x!.avarias.length, fotos: x!.avarias.reduce((s, a) => s + (a.fotos?.length || 0), 0), obs: !!x!.obs };
}

/** Foto da página pública: só se pertence à ordem daquele token. */
export async function fotoPublica(token: string, fotoId: string) {
  if (!/^[A-Z2-9]{6,10}$/.test(token) || !/^[a-z0-9]{10,40}$/i.test(fotoId)) return null;
  const f = await prisma.ordemVistoriaFoto.findFirst({ where: { id: fotoId, ordem: { acompToken: token } }, select: { imagem: true } });
  if (!f) return null;
  const m = f.imagem.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return null;
  return { tipo: m[1], buffer: Buffer.from(m[2], 'base64') };
}
