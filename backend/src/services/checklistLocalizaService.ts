/**
 * Checklist da Localiza para o responsável (pedido do dono, 16–17/11/2026).
 * Protótipo aprovado: Features/front/checklist-responsavel-localiza.html + ajustes-subconta.html.
 *
 * - Agenda de responsáveis (quem abre as solicitações) por DONO: o número salvo numa empresa
 *   vale em todas as empresas dele. Os nomes vêm de `solicitacoes_lavagem.solicitante`; a tabela
 *   `solicitacao_responsaveis` só guarda quem tem número ou foi cadastrado à mão.
 * - Depois do checklist, a mensagem sai pelo WhatsApp DA EMPRESA (fila `whatsapp_envios`,
 *   canal EMPRESA, origem CHECKLIST_LOC) com o link público /c/CÓDIGO.
 * - Página pública: só leitura, 90 dias depois do checklist.
 */

import { randomInt } from 'crypto';
import prisma from '../db';
import { FORNECEDOR } from './solicitacaoFilaService';
import { telefoneWhats } from './acompanhamentoService';
import { filtroPlaca } from './veiculoPlaca';

export const ORIGEM_CHECKLIST = 'CHECKLIST_LOC';
const VALIDADE_DIAS = 90;
const DIA = 24 * 60 * 60 * 1000;
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface Envio { nome: string; telefone: string; em: string; por: string | null; empresaId: string }
type ItemCk = { chave: string; st: 'ok' | 'av'; obs?: string };
export type ChecklistJson = { itens?: ItemCk[]; empresaId?: string; primeiroEm?: string };

/** "Nayra  Almeida" / "NAYRA ALMEIDA" → "nayra almeida" (chave da agenda). */
export function chaveNome(nome: string | null | undefined): string {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Nome bonito: cada palavra com maiúscula (os e-mails às vezes vêm em caixa alta). */
function nomeBonito(nome: string): string {
  const n = nome.replace(/\s+/g, ' ').trim();
  if (n !== n.toUpperCase()) return n;
  return n.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

/** Celular BR: 55 + DDD + 9 + 8 dígitos. */
export function celularValido(tel: unknown): string | null {
  const d = telefoneWhats(String(tel ?? ''));
  return d && d.length === 13 && d[4] === '9' ? d : null;
}

export function linkChecklist(token: string): string {
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return `${base}/c/${token}`;
}

// ─────────────────────────────── AGENDA ───────────────────────────────

export interface Responsavel {
  chave: string; nome: string; agencia: string | null; telefone: string | null;
  solicitacoes: number; ultima: string | null; salvoPor: string | null; salvoNa: string | null; salvoEm: string | null;
}

/** Todos os responsáveis do dono: quem já abriu solicitação + quem foi cadastrado à mão. */
export async function listarResponsaveis(usuarioId: string): Promise<Responsavel[]> {
  const [sols, salvos] = await Promise.all([
    prisma.solicitacaoLavagem.findMany({
      where: { usuarioId, fornecedor: FORNECEDOR, solicitante: { not: null } },
      select: { solicitante: true, agencia: true, createdAt: true },
    }),
    prisma.solicitacaoResponsavel.findMany({ where: { usuarioId, fornecedor: FORNECEDOR } }),
  ]);
  const mapa = new Map<string, Responsavel & { agencias: Map<string, number> }>();
  for (const s of sols) {
    const k = chaveNome(s.solicitante);
    if (!k) continue;
    const r = mapa.get(k) ?? {
      chave: k, nome: nomeBonito(s.solicitante!), agencia: null, telefone: null, solicitacoes: 0, ultima: null,
      salvoPor: null, salvoNa: null, salvoEm: null, agencias: new Map<string, number>(),
    };
    r.solicitacoes += 1;
    const iso = s.createdAt.toISOString();
    if (!r.ultima || iso > r.ultima) r.ultima = iso;
    if (s.agencia) r.agencias.set(s.agencia, (r.agencias.get(s.agencia) || 0) + 1);
    mapa.set(k, r);
  }
  for (const r of mapa.values()) {
    r.agencia = [...r.agencias.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a).join(' · ') || null;
  }
  for (const s of salvos) {
    const r = mapa.get(s.chave) ?? {
      chave: s.chave, nome: s.nome, agencia: null, telefone: null, solicitacoes: 0, ultima: null,
      salvoPor: null, salvoNa: null, salvoEm: null, agencias: new Map(),
    };
    r.nome = s.nome;
    if (s.agencia) r.agencia = s.agencia;
    r.telefone = s.telefone;
    r.salvoPor = s.salvoPor; r.salvoNa = s.salvoNa; r.salvoEm = s.salvoEm?.toISOString() ?? null;
    mapa.set(s.chave, r);
  }
  return [...mapa.values()]
    .map(({ agencias, ...r }) => r)
    .sort((a, b) => b.solicitacoes - a.solicitacoes || a.nome.localeCompare(b.nome, 'pt-BR'));
}

export async function responsavelPorNome(usuarioId: string, nome: string | null | undefined) {
  const chave = chaveNome(nome);
  if (!chave) return null;
  return prisma.solicitacaoResponsavel.findUnique({ where: { usuarioId_fornecedor_chave: { usuarioId, fornecedor: FORNECEDOR, chave } } });
}

/**
 * Salva/atualiza na agenda. `chaveAntiga` = editando alguém já listado (o nome pode ter mudado).
 * telefone: string = salva (já validado), null = apaga o número, undefined = não mexe.
 */
export async function salvarResponsavel(
  usuarioId: string,
  dados: { chaveAntiga?: string | null; nome: string; agencia?: string | null; telefone?: string | null },
  quem: { nome: string | null; empresa: string | null },
) {
  const nome = nomeBonito(String(dados.nome || '').slice(0, 60));
  const chave = chaveNome(nome);
  if (!chave) throw new Error('NOME');
  const antiga = dados.chaveAntiga ? chaveNome(dados.chaveAntiga) : chave;
  const agencia = dados.agencia === undefined ? undefined : (String(dados.agencia || '').trim().toUpperCase().slice(0, 20) || null);
  const marca = dados.telefone !== undefined ? { salvoPor: quem.nome, salvoNa: quem.empresa, salvoEm: new Date() } : {};
  const where = { usuarioId_fornecedor_chave: { usuarioId, fornecedor: FORNECEDOR, chave: antiga } };

  return prisma.$transaction(async (tx) => {
    const atual = await tx.solicitacaoResponsavel.findUnique({ where });
    if (atual) {
      if (antiga !== chave) {
        const outro = await tx.solicitacaoResponsavel.findUnique({ where: { usuarioId_fornecedor_chave: { usuarioId, fornecedor: FORNECEDOR, chave } } });
        if (outro) throw new Error('DUPLICADO');
      }
      return tx.solicitacaoResponsavel.update({
        where: { id: atual.id },
        data: { chave, nome, ...(agencia !== undefined ? { agencia } : {}), ...(dados.telefone !== undefined ? { telefone: dados.telefone } : {}), ...marca },
      });
    }
    return tx.solicitacaoResponsavel.upsert({
      where: { usuarioId_fornecedor_chave: { usuarioId, fornecedor: FORNECEDOR, chave } },
      create: { usuarioId, fornecedor: FORNECEDOR, chave, nome, agencia: agencia ?? null, telefone: dados.telefone ?? null, ...marca },
      update: { nome, ...(agencia !== undefined ? { agencia } : {}), ...(dados.telefone !== undefined ? { telefone: dados.telefone } : {}), ...marca },
    });
  });
}

// ─────────────────────────────── ENVIO ───────────────────────────────

async function gerarToken(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    let t = '';
    for (let j = 0; j < 10; j++) t += CHARS[randomInt(CHARS.length)];
    const existe = await prisma.solicitacaoLavagem.findUnique({ where: { checklistToken: t }, select: { id: true } });
    if (!existe) return t;
  }
  throw new Error('Não foi possível gerar o código do link');
}

export async function garantirTokenChecklist(solicitacaoId: string): Promise<string> {
  const s = await prisma.solicitacaoLavagem.findUnique({ where: { id: solicitacaoId }, select: { checklistToken: true } });
  if (s?.checklistToken) return s.checklistToken;
  const token = await gerarToken();
  const r = await prisma.solicitacaoLavagem.updateMany({ where: { id: solicitacaoId, checklistToken: null }, data: { checklistToken: token } });
  if (r.count) return token;
  return (await prisma.solicitacaoLavagem.findUnique({ where: { id: solicitacaoId }, select: { checklistToken: true } }))!.checklistToken!;
}

export async function whatsEmpresaConectado(empresaId: string): Promise<boolean> {
  const s = await prisma.whatsappEmpresaSession.findUnique({ where: { empresaId }, select: { status: true } });
  return s?.status === 'CONECTADO';
}

export function enviosDe(v: unknown): Envio[] {
  return Array.isArray(v) ? (v as Envio[]) : [];
}

/** Coloca a mensagem do checklist na fila do WhatsApp da empresa e registra o envio. */
export async function enfileirarChecklist(
  solicitacaoId: string,
  empresaId: string,
  para: { nome: string; telefone: string },
  por: string | null,
) {
  const s = await prisma.solicitacaoLavagem.findUnique({ where: { id: solicitacaoId } });
  if (!s?.checklistEm) throw new Error('SEM_CHECKLIST');
  const token = await garantirTokenChecklist(s.id);
  const [empresa, veic, nFotos] = await Promise.all([
    prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true } }),
    prisma.veiculo.findFirst({ where: filtroPlaca(s.placa), select: { modelo: true }, orderBy: { updatedAt: 'desc' } }),
    prisma.solicitacaoFoto.count({ where: { solicitacaoId: s.id } }),
  ]);
  const itens = ((s.checklist ?? {}) as ChecklistJson).itens ?? [];
  const avarias = itens.filter((i) => i.st === 'av').length;
  const primeiro = para.nome.trim().split(/\s+/)[0] || '';
  const fotos = nFotos ? ` · ${nFotos} foto${nFotos > 1 ? 's' : ''}` : '';
  const texto = [
    `Olá${primeiro ? ', ' + primeiro : ''}! Aqui é da ${empresa?.nome || 'equipe de lavagem'}.`,
    `Checklist de entrada do *${s.placa}*${veic?.modelo ? ` (${veic.modelo})` : ''}, solicitação ${s.numero}:`,
    avarias ? `⚠️ ${avarias} avaria${avarias > 1 ? 's' : ''} registrada${avarias > 1 ? 's' : ''}${fotos}` : `✔ Sem avarias${fotos}`,
    linkChecklist(token),
  ].join('\n');

  await prisma.whatsappEnvio.create({ data: { empresaId, origem: ORIGEM_CHECKLIST, destino: para.telefone, texto, canal: 'EMPRESA' } });
  const envio: Envio = { nome: para.nome, telefone: para.telefone, em: new Date().toISOString(), por, empresaId };
  await prisma.solicitacaoLavagem.update({
    where: { id: s.id },
    data: { checklistEnvios: [...enviosDe(s.checklistEnvios), envio] as any },
  });
  return { link: linkChecklist(token), conectado: await whatsEmpresaConectado(empresaId), envio };
}

// ─────────────────────────────── PÁGINA PÚBLICA ───────────────────────────────

const tokenOk = (t: string) => /^[A-Z2-9]{10}$/.test(t);

async function solicitacaoDoToken(token: string) {
  if (!tokenOk(token)) return null;
  const s = await prisma.solicitacaoLavagem.findUnique({ where: { checklistToken: token } });
  if (!s?.checklistEm) return null;
  if (Date.now() - s.checklistEm.getTime() > VALIDADE_DIAS * DIA) return 'expirado' as const;
  return s;
}

export async function dadosPublicosChecklist(token: string, rotulos: Map<string, string>) {
  const s = await solicitacaoDoToken(token);
  if (!s || s === 'expirado') return s;
  const ck = (s.checklist ?? {}) as ChecklistJson;
  const empresaId = ck.empresaId || s.aceitaEmpresaId || s.origemEmpresaId;
  const [empresa, veic, fotos] = await Promise.all([
    prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true } }),
    prisma.veiculo.findFirst({ where: filtroPlaca(s.placa), select: { modelo: true, cor: true }, orderBy: { updatedAt: 'desc' } }),
    prisma.solicitacaoFoto.findMany({ where: { solicitacaoId: s.id }, select: { id: true, lado: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  const marcados = new Map((ck.itens ?? []).map((i) => [i.chave, i]));
  const itens = [...rotulos.entries()].map(([chave, rotulo]) => {
    const i = marcados.get(chave);
    return { rotulo, st: i?.st ?? 'nc', obs: i?.st === 'av' ? i.obs || '' : '' };
  });
  const ordem = { av: 0, ok: 1, nc: 2 } as const;
  itens.sort((a, b) => ordem[a.st as keyof typeof ordem] - ordem[b.st as keyof typeof ordem]);
  const primeiroEm = ck.primeiroEm ? new Date(ck.primeiroEm) : s.checklistEm!;
  return {
    empresa: empresa?.nome || '',
    placa: s.placa,
    modelo: veic?.modelo || null,
    cor: veic?.cor || null,
    numero: s.numero,
    agencia: s.agencia,
    solicitante: s.solicitante ? nomeBonito(s.solicitante) : null,
    abertaEm: s.createdAt,
    aceitaPor: s.aceitaPorNome,
    aceitaEm: s.aceitaEm,
    checklistPor: s.checklistPor,
    checklistEm: primeiroEm,
    editadoEm: s.checklistEm!.getTime() - primeiroEm.getTime() > 60_000 ? s.checklistEm : null,
    itens,
    fotos: fotos.map((f) => ({ id: f.id, lado: f.lado, em: f.createdAt })),
  };
}

export async function fotoPublicaChecklist(token: string, fotoId: string) {
  if (!/^[a-z0-9]{10,40}$/i.test(fotoId)) return null;
  const s = await solicitacaoDoToken(token);
  if (!s || s === 'expirado') return null;
  const f = await prisma.solicitacaoFoto.findFirst({ where: { id: fotoId, solicitacaoId: s.id }, select: { imagem: true } });
  const m = f?.imagem.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return null;
  return { tipo: m[1], buffer: Buffer.from(m[2], 'base64') };
}
