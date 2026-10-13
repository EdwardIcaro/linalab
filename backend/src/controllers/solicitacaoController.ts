import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { createOrdem } from './ordemController';
import { MODELOS, modeloPorId } from '../services/emailModelos';
import { empresasIrmas } from '../services/emailEnriquecimento';
import { sistemaPrincipalDaEmpresa } from '../utils/sistemaEmpresa';
import { notifyAdmins } from '../services/whatsappNotificationService';
import { FORNECEDOR, VALIDADE_DIAS, chavePreco, normalizarPlaca } from '../services/solicitacaoFilaService';

/**
 * Fila de solicitações de lavagem da Localiza.
 *
 * Portal (subconta com gerenciar_ordens): ver a fila, aceitar (vira ordem na empresa de
 * quem aceitou) e fazer o checklist de avarias.
 * Hub (só o dono): ligar os modelos permanentes e vincular cliente/serviços por empresa.
 */

type Req = Request & { empresaId?: string; usuarioId?: string; usuarioNome?: string; subaccountId?: string };

const DIA = 24 * 60 * 60 * 1000;
const REPETIDA_DIAS = 15;
const MAX_FOTOS = 8;
const MAX_FOTO_CHARS = 700_000; // ~500 KB de JPEG em base64 — a tela já comprime antes
const FILA_DO_MODELO: Record<string, string> = {
  'localiza-solicitacao-lavagem': 'SOLICITACAO',
  'localiza-cancelamento-lavagem': 'CANCELAMENTO',
};

export const CHECKLIST_ITENS: Array<[string, string]> = [
  ['parachoque_dianteiro', 'Para-choque dianteiro'],
  ['parachoque_traseiro', 'Para-choque traseiro'],
  ['lateral_esquerda', 'Lateral esquerda'],
  ['lateral_direita', 'Lateral direita'],
  ['capo_teto', 'Capô / teto'],
  ['vidros', 'Para-brisa e vidros'],
  ['rodas_pneus', 'Rodas e pneus'],
  ['retrovisores', 'Retrovisores'],
  ['interior', 'Interior / bancos'],
];
const ROTULO_ITEM = new Map(CHECKLIST_ITENS);

async function vinculoDa(empresaId: string) {
  return prisma.solicitacaoVinculo.findUnique({
    where: { empresaId_fornecedor: { empresaId, fornecedor: FORNECEDOR } },
  });
}

async function donoDa(empresaId: string): Promise<string | null> {
  const e = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { usuarioId: true } });
  return e?.usuarioId ?? null;
}

function servicosDoVinculo(v: { servicos: unknown } | null): Record<string, string> {
  const s = v?.servicos;
  return s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, string>) : {};
}

/** Modelo/cor por placa e última lavagem em menos de 15 dias, nas empresas do dono. */
async function contexto(irmas: string[], placas: string[]) {
  const veiculos = new Map<string, { modelo: string | null; cor: string | null }>();
  const ultimas = new Map<string, { id: string; numeroOrdem: number; createdAt: Date; empresa: string }[]>();
  if (!placas.length) return { veiculos, ultimas };
  const variantes = placas.flatMap((p) => [p, `${p.slice(0, 3)}-${p.slice(3)}`]);
  const vs = await prisma.veiculo.findMany({
    where: { placa: { in: variantes }, cliente: { empresaId: { in: irmas } } },
    select: { placa: true, modelo: true, cor: true },
  });
  for (const v of vs) veiculos.set(normalizarPlaca(v.placa), { modelo: v.modelo, cor: v.cor });

  const ordens = await prisma.ordemServico.findMany({
    where: {
      empresaId: { in: irmas },
      status: { not: 'CANCELADO' as any },
      createdAt: { gte: new Date(Date.now() - REPETIDA_DIAS * DIA) },
      veiculo: { placa: { in: variantes } },
    },
    select: { id: true, numeroOrdem: true, createdAt: true, empresa: { select: { nome: true } }, veiculo: { select: { placa: true } } },
    orderBy: { createdAt: 'desc' },
  });
  for (const o of ordens) {
    const k = normalizarPlaca(o.veiculo?.placa);
    const lista = ultimas.get(k) ?? [];
    lista.push({ id: o.id, numeroOrdem: o.numeroOrdem, createdAt: o.createdAt, empresa: o.empresa.nome });
    ultimas.set(k, lista);
  }
  return { veiculos, ultimas };
}

// ─────────────────────────────── PORTAL ───────────────────────────────

export async function listarFila(req: Req, res: Response) {
  const empresaId = req.empresaId!;
  try {
    const vinculo = await vinculoDa(empresaId);
    if (!vinculo?.ativo) return res.json({ habilitado: false, pendentes: [], aceitas: [] });
    const dono = await donoDa(empresaId);
    if (!dono) return res.json({ habilitado: false, pendentes: [], aceitas: [] });

    const [pendentes, aceitas, lavadores] = await Promise.all([
      prisma.solicitacaoLavagem.findMany({
        where: { usuarioId: dono, fornecedor: FORNECEDOR, status: 'PENDENTE', createdAt: { gte: new Date(Date.now() - VALIDADE_DIAS * DIA) } },
        orderBy: { createdAt: 'asc' },
        take: 60,
        include: { _count: { select: { fotos: true } } },
      }),
      prisma.solicitacaoLavagem.findMany({
        where: { aceitaEmpresaId: empresaId, status: 'ACEITA', aceitaEm: { gte: new Date(Date.now() - DIA) } },
        orderBy: { aceitaEm: 'desc' },
        take: 30,
        include: { _count: { select: { fotos: true } } },
      }),
      prisma.lavador.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
    ]);

    const irmas = await empresasIrmas(empresaId);
    const todas = [...pendentes, ...aceitas];
    const { veiculos, ultimas } = await contexto(irmas, Array.from(new Set(todas.map((s) => s.placa))));
    const mapa = servicosDoVinculo(vinculo);
    const servIds = Array.from(new Set(Object.values(mapa)));
    const servicos = servIds.length
      ? await prisma.servico.findMany({ where: { id: { in: servIds }, empresaId }, select: { id: true, nome: true } })
      : [];
    const nomeServ = new Map(servicos.map((s) => [s.id, s.nome]));
    const ordensAceitas = new Map(
      (await prisma.ordemServico.findMany({
        where: { id: { in: aceitas.map((a) => a.ordemId).filter((x): x is string => !!x) } },
        select: { id: true, numeroOrdem: true },
      })).map((o) => [o.id, o.numeroOrdem])
    );
    const lote = new Map<string, string[]>();
    for (const s of pendentes) lote.set(s.numero, [...(lote.get(s.numero) ?? []), s.placa]);

    const montar = (s: (typeof todas)[number]) => {
      const veic = veiculos.get(s.placa);
      const anterior = (ultimas.get(s.placa) ?? []).find((o) => o.id !== s.ordemId);
      const checklist = (s.checklist ?? null) as { itens?: Array<{ st?: string }> } | null;
      return {
        id: s.id,
        numero: s.numero,
        placa: s.placa,
        tipo: s.tipo,
        preco: s.preco,
        precoTexto: s.precoTexto,
        solicitante: s.solicitante,
        agencia: s.agencia,
        diaAbertura: s.diaAbertura,
        chegouEm: s.createdAt,
        modelo: veic?.modelo ?? null,
        cor: veic?.cor ?? null,
        servico: nomeServ.get(mapa[chavePreco(s.preco)]) ?? null,
        repetida: anterior
          ? { numeroOrdem: anterior.numeroOrdem, empresa: anterior.empresa, dias: Math.floor((Date.now() - anterior.createdAt.getTime()) / DIA) }
          : null,
        mesmoPedido: (lote.get(s.numero) ?? []).filter((p) => p !== s.placa),
        checklist: checklist
          ? { feito: true, avarias: (checklist.itens ?? []).filter((i) => i.st === 'av').length, fotos: s._count.fotos }
          : null,
        aceitaPorNome: s.aceitaPorNome,
        ordemNumero: s.ordemId ? ordensAceitas.get(s.ordemId) ?? null : null,
        canceladaEm: s.canceladaEm,
      };
    };

    return res.json({ habilitado: true, pendentes: pendentes.map(montar), aceitas: aceitas.map(montar), lavadores });
  } catch (err) {
    console.error('[Solicitacoes] Erro ao listar fila:', err);
    return res.status(500).json({ error: 'Erro ao carregar as solicitações' });
  }
}

/** Resposta capturada do createOrdem — reaproveita a criação de ordem que já funciona. */
function respostaFalsa() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r as Response & { statusCode: number; body: any };
}

export async function aceitar(req: Req, res: Response) {
  const empresaId = req.empresaId!;
  const id = req.params.id as string;
  const modelo = String(req.body?.modelo ?? '').trim().slice(0, 60);
  const cor = String(req.body?.cor ?? '').trim().slice(0, 40);
  const lavadorId = req.body?.lavadorId ? String(req.body.lavadorId) : null;
  const obs = String(req.body?.observacoes ?? '').trim().slice(0, 300);
  if (!modelo) return res.status(400).json({ error: 'Informe o modelo do veículo.' });

  try {
    const [s, vinculo, dono] = await Promise.all([
      prisma.solicitacaoLavagem.findUnique({ where: { id } }),
      vinculoDa(empresaId),
      donoDa(empresaId),
    ]);
    if (!s || s.usuarioId !== dono || !vinculo?.ativo) return res.status(404).json({ error: 'Solicitação não encontrada.' });
    if (s.status === 'CANCELADA') return res.status(409).json({ error: 'A Localiza cancelou esta solicitação.', code: 'CANCELADA' });
    if (s.status === 'ACEITA') {
      const emp = s.aceitaEmpresaId ? await prisma.empresa.findUnique({ where: { id: s.aceitaEmpresaId }, select: { nome: true } }) : null;
      return res.status(409).json({ error: `Já aceito por ${s.aceitaPorNome || 'outra pessoa'}${emp ? ` (${emp.nome})` : ''}.`, code: 'JA_ACEITA' });
    }

    const servicoId = servicosDoVinculo(vinculo)[chavePreco(s.preco)];
    const [servico, cliente, lavador] = await Promise.all([
      servicoId ? prisma.servico.findFirst({ where: { id: servicoId, empresaId, ativo: true }, select: { id: true } }) : null,
      vinculo.clienteId ? prisma.cliente.findFirst({ where: { id: vinculo.clienteId, empresaId }, select: { id: true } }) : null,
      lavadorId ? prisma.lavador.findFirst({ where: { id: lavadorId, empresaId, ativo: true }, select: { id: true } }) : null,
    ]);
    if (!servico) {
      return res.status(422).json({
        error: `O valor ${s.precoTexto || ''} não tem serviço vinculado nesta empresa. Peça ao administrador para vincular no Hub › Automações.`,
        code: 'SEM_VINCULO',
      });
    }
    if (!cliente) {
      return res.status(422).json({ error: 'O cliente Localiza desta empresa não está vinculado. Peça ao administrador para vincular no Hub.', code: 'SEM_VINCULO' });
    }

    // Trava: só um aceite vence, mesmo com dois cliques no mesmo segundo
    const trava = await prisma.solicitacaoLavagem.updateMany({
      where: { id, status: 'PENDENTE' },
      data: {
        status: 'ACEITA',
        aceitaEmpresaId: empresaId,
        aceitaPorId: req.subaccountId ?? req.usuarioId ?? null,
        aceitaPorNome: req.usuarioNome ?? null,
        aceitaEm: new Date(),
      },
    });
    if (trava.count === 0) return res.status(409).json({ error: 'Esta solicitação acabou de ser aceita por outra pessoa.', code: 'JA_ACEITA' });

    const desfazer = () => prisma.solicitacaoLavagem.updateMany({
      where: { id, status: 'ACEITA', ordemId: null },
      data: { status: 'PENDENTE', aceitaEmpresaId: null, aceitaPorId: null, aceitaPorNome: null, aceitaEm: null },
    });

    try {
      // Placa já cadastrada (às vezes com hífen) → reaproveita o veículo
      const variantes = [s.placa, `${s.placa.slice(0, 3)}-${s.placa.slice(3)}`];
      const veiculo = await prisma.veiculo.findFirst({ where: { placa: { in: variantes } }, select: { id: true, modelo: true, cor: true } });

      const body: Record<string, unknown> = {
        clienteId: cliente.id,
        itens: [{ tipo: 'SERVICO', itemId: servico.id, quantidade: 1 }],
        observacoes: [`Localiza · solicitação ${s.numero}`, obs].filter(Boolean).join(' — '),
        ...(lavador ? { lavadorId: lavador.id } : {}),
        ...(veiculo ? { veiculoId: veiculo.id } : { novoVeiculo: { placa: s.placa, modelo, cor: cor || null } }),
      };
      const reqOrdem = Object.assign(Object.create(req), { body, empresaId }) as Req;
      const resOrdem = respostaFalsa();
      await createOrdem(reqOrdem as any, resOrdem);

      if (resOrdem.statusCode !== 201 || !resOrdem.body?.ordem?.id) {
        await desfazer();
        const erro = resOrdem.body?.code === 'ACTIVE_ORDER_EXISTS'
          ? 'Já existe uma ordem em aberto para esta placa nesta empresa.'
          : (resOrdem.body?.details || resOrdem.body?.error || 'Não foi possível criar a ordem.');
        return res.status(resOrdem.statusCode >= 400 ? resOrdem.statusCode : 500).json({ error: erro, code: resOrdem.body?.code });
      }

      const ordem = resOrdem.body.ordem as { id: string; numeroOrdem: number };
      await prisma.solicitacaoLavagem.update({ where: { id }, data: { ordemId: ordem.id } });
      // Quem está na frente do carro confirmou modelo/cor — corrige o cadastro
      if (veiculo && (veiculo.modelo !== modelo || (cor && veiculo.cor !== cor))) {
        await prisma.veiculo.update({ where: { id: veiculo.id }, data: { modelo, ...(cor ? { cor } : {}) } }).catch(() => {});
      }
      return res.status(201).json({ ok: true, ordem: { id: ordem.id, numeroOrdem: ordem.numeroOrdem } });
    } catch (err) {
      await desfazer().catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error('[Solicitacoes] Erro ao aceitar:', err);
    return res.status(500).json({ error: 'Erro ao aceitar a solicitação' });
  }
}

/** Pendente da conta (empresa com vínculo) ou aceita por esta empresa. */
async function solicitacaoVisivel(empresaId: string, id: string) {
  const s = await prisma.solicitacaoLavagem.findUnique({ where: { id } });
  if (!s) return null;
  if (s.status === 'ACEITA') return s.aceitaEmpresaId === empresaId ? s : null;
  if (s.status !== 'PENDENTE') return null;
  const [dono, vinculo] = await Promise.all([donoDa(empresaId), vinculoDa(empresaId)]);
  return s.usuarioId === dono && vinculo?.ativo ? s : null;
}

export async function verChecklist(req: Req, res: Response) {
  try {
    const s = await solicitacaoVisivel(req.empresaId!, req.params.id as string);
    if (!s) return res.status(404).json({ error: 'Solicitação não encontrada.' });
    const fotos = await prisma.solicitacaoFoto.findMany({
      where: { solicitacaoId: s.id },
      select: { id: true, lado: true, imagem: true },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({
      itensPadrao: CHECKLIST_ITENS.map(([chave, rotulo]) => ({ chave, rotulo })),
      checklist: s.checklist ?? null,
      checklistPor: s.checklistPor,
      checklistEm: s.checklistEm,
      fotos,
    });
  } catch (err) {
    console.error('[Solicitacoes] Erro ao abrir checklist:', err);
    return res.status(500).json({ error: 'Erro ao abrir o checklist' });
  }
}

export async function salvarChecklist(req: Req, res: Response) {
  const empresaId = req.empresaId!;
  try {
    const s = await solicitacaoVisivel(empresaId, req.params.id as string);
    if (!s) return res.status(404).json({ error: 'Solicitação não encontrada.' });

    const itens = (Array.isArray(req.body?.itens) ? req.body.itens : [])
      .filter((i: any) => ROTULO_ITEM.has(String(i?.chave)) && (i?.st === 'ok' || i?.st === 'av'))
      .map((i: any) => ({ chave: String(i.chave), st: i.st as 'ok' | 'av', obs: String(i.obs ?? '').trim().slice(0, 300) }));

    const entrada = Array.isArray(req.body?.fotos) ? req.body.fotos.slice(0, MAX_FOTOS) : [];
    const manter = entrada.filter((f: any) => typeof f?.id === 'string').map((f: any) => f.id as string);
    const novas = entrada
      .filter((f: any) => !f?.id && typeof f?.imagem === 'string')
      .map((f: any) => ({ lado: f.lado ? String(f.lado).slice(0, 30) : null, imagem: String(f.imagem) }));
    for (const f of novas) {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(f.imagem) || f.imagem.length > MAX_FOTO_CHARS) {
        return res.status(400).json({ error: 'Foto inválida ou grande demais.' });
      }
    }

    const antes = ((s.checklist ?? null) as { itens?: Array<{ chave: string; st: string }> } | null)?.itens ?? [];
    const avariasAntes = new Set(antes.filter((i) => i.st === 'av').map((i) => i.chave));

    await prisma.$transaction([
      prisma.solicitacaoFoto.deleteMany({ where: { solicitacaoId: s.id, id: { notIn: manter } } }),
      ...(novas.length ? [prisma.solicitacaoFoto.createMany({ data: novas.map((f: { lado: string | null; imagem: string }) => ({ ...f, solicitacaoId: s.id })) })] : []),
      prisma.solicitacaoLavagem.update({
        where: { id: s.id },
        data: { checklist: { itens }, checklistPor: req.usuarioNome ?? null, checklistEm: new Date() },
      }),
    ]);

    // Avaria nova → dono avisado no WhatsApp (mesma chave do "Report de avaria")
    const novasAvarias = itens.filter((i: { chave: string; st: string }) => i.st === 'av' && !avariasAntes.has(i.chave));
    if (novasAvarias.length) {
      const veic = await prisma.veiculo.findFirst({
        where: { placa: { in: [s.placa, `${s.placa.slice(0, 3)}-${s.placa.slice(3)}`] } },
        select: { modelo: true, cor: true },
      });
      const nFotos = manter.length + novas.length;
      const linhas = novasAvarias.map((i: { chave: string; obs: string }) => `• ${ROTULO_ITEM.get(i.chave)}${i.obs ? ` — ${i.obs}` : ''}`);
      const msg = `📸 *Checklist Localiza — ${s.placa}*${veic?.modelo ? ` (${[veic.modelo, veic.cor].filter(Boolean).join(' ')})` : ''}\n\n` +
        `⚠️ Avaria(s) registrada(s):\n${linhas.join('\n')}\n\n👤 ${req.usuarioNome || 'Funcionário'}` +
        (nFotos ? ` · ${nFotos} foto(s) no sistema` : '');
      notifyAdmins(s.aceitaEmpresaId ?? empresaId, msg, 'reportAvaria').catch(() => {});
    }

    return res.json({ ok: true, avarias: itens.filter((i: { st: string }) => i.st === 'av').length });
  } catch (err) {
    console.error('[Solicitacoes] Erro ao salvar checklist:', err);
    return res.status(500).json({ error: 'Erro ao salvar o checklist' });
  }
}

// ─────────────────────────────── HUB (dono) ───────────────────────────────

/**
 * O Hub usa token só de usuário, e o token de subconta também passa no userAuthMiddleware.
 * Configuração da conta inteira é do dono: subconta fica de fora aqui.
 */
export function apenasDono(req: Request, res: Response, next: () => void) {
  try {
    const token = String(req.headers.authorization || '').split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { subaccountId?: string };
    if (decoded.subaccountId) return res.status(403).json({ error: 'Só o dono da conta pode alterar isto.' });
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
  next();
}

async function empresasLinaWash(usuarioId: string) {
  const empresas = await prisma.empresa.findMany({ where: { usuarioId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } });
  const sistemas = await Promise.all(empresas.map((e) => sistemaPrincipalDaEmpresa(e.id).catch(() => 'lina-wash')));
  return empresas.filter((_, i) => sistemas[i] === 'lina-wash');
}

/** Sugestão pelo histórico: o cliente com mais ordens e o serviço mais usado em cada valor. */
async function sugerir(empresaId: string, precos: number[]) {
  const clientes = await prisma.$queryRawUnsafe<Array<{ id: string; nome: string; ordens: number }>>(
    `select c.id, c.nome, count(o.id)::int ordens
       from clientes c left join ordens_servico o on o."clienteId" = c.id
      where c."empresaId" = $1 and c.ativo and c.nome ilike '%localiza%'
      group by c.id, c.nome order by ordens desc limit 15`,
    empresaId
  );
  const usados = await prisma.$queryRawUnsafe<Array<{ servicoId: string; preco: number; usos: number }>>(
    `select i."servicoId", i."precoUnit" preco, count(*)::int usos
       from ordens_servico_items i
       join ordens_servico o on o.id = i."ordemId"
       join servicos s on s.id = i."servicoId" and s.ativo
      where o."empresaId" = $1 and o."clienteId" = $2 and o."createdAt" > now() - interval '120 days'
      group by 1, 2 order by usos desc`,
    empresaId, clientes[0]?.id ?? ''
  );
  const servicos: Record<string, string> = {};
  for (const p of precos) {
    const achado = usados.find((u) => Math.abs(u.preco - p) < 0.01);
    if (achado) servicos[chavePreco(p)] = achado.servicoId;
  }
  return { clienteId: clientes[0]?.id ?? null, servicos, clientes };
}

export async function verConfig(req: Req, res: Response) {
  const usuarioId = req.usuarioId!;
  try {
    const empresas = await empresasLinaWash(usuarioId);
    const ids = empresas.map((e) => e.id);
    const [contas, regras, precosVistos] = await Promise.all([
      prisma.emailConta.findMany({ where: { empresaId: { in: ids } }, select: { id: true, email: true, status: true, empresaId: true, ultimoErro: true } }),
      prisma.emailRegra.findMany({
        where: { empresaId: { in: ids }, modeloId: { not: null } },
        select: { id: true, modeloId: true, contaId: true, ativo: true, destinos: true },
      }),
      prisma.$queryRawUnsafe<Array<{ preco: number }>>(
        `select distinct preco from solicitacoes_lavagem where "usuarioId" = $1 and preco is not null and "createdAt" > now() - interval '90 days'`,
        usuarioId
      ),
    ]);
    const precos = Array.from(new Set([30, 130, ...precosVistos.map((p) => p.preco)])).sort((a, b) => a - b);

    const porEmpresa = await Promise.all(empresas.map(async (e) => {
      const [vinculo, sug, servicos] = await Promise.all([
        vinculoDa(e.id),
        sugerir(e.id, precos),
        prisma.servico.findMany({
          where: { empresaId: e.id, ativo: true },
          select: { id: true, nome: true, preco: true, comissaoPercentual: true },
          orderBy: { nome: 'asc' },
        }),
      ]);
      return {
        id: e.id,
        nome: e.nome,
        vinculo: vinculo ? { clienteId: vinculo.clienteId, servicos: servicosDoVinculo(vinculo), ativo: vinculo.ativo } : null,
        sugestao: { clienteId: sug.clienteId, servicos: sug.servicos },
        clientes: sug.clientes,
        servicos,
      };
    }));

    const modelos = MODELOS.map((m) => {
      const lista = regras.filter((r) => r.modeloId === m.id);
      const regra = lista.find((r) => r.ativo) ?? lista[0] ?? null;
      return {
        id: m.id, nome: m.nome, descricao: m.descricao, emoji: m.emoji, fornecedor: m.fornecedor,
        fila: FILA_DO_MODELO[m.id] ?? null,
        regra: regra
          ? { id: regra.id, contaId: regra.contaId, ativo: regra.ativo, destinatarios: Array.isArray(regra.destinos) ? (regra.destinos as unknown[]).length : 0 }
          : null,
      };
    });

    return res.json({ empresas: porEmpresa, contas, modelos, precos });
  } catch (err) {
    console.error('[Solicitacoes] Erro ao carregar config:', err);
    return res.status(500).json({ error: 'Erro ao carregar as automações' });
  }
}

export async function salvarVinculo(req: Req, res: Response) {
  const usuarioId = req.usuarioId!;
  const empresaId = req.params.empresaId as string;
  try {
    const empresa = await prisma.empresa.findFirst({ where: { id: empresaId, usuarioId }, select: { id: true } });
    if (!empresa) return res.status(404).json({ error: 'Empresa não encontrada' });

    const clienteId = req.body?.clienteId ? String(req.body.clienteId) : null;
    if (clienteId && !(await prisma.cliente.findFirst({ where: { id: clienteId, empresaId }, select: { id: true } }))) {
      return res.status(400).json({ error: 'Cliente não pertence a esta empresa' });
    }
    const entrada = req.body?.servicos && typeof req.body.servicos === 'object' ? req.body.servicos : {};
    const pares = Object.entries(entrada)
      .slice(0, 20)
      .map(([k, v]) => [chavePreco(parseFloat(k)), String(v ?? '')] as [string, string])
      .filter(([k, v]) => k && v);
    if (pares.length) {
      const validos = await prisma.servico.count({ where: { id: { in: pares.map(([, v]) => v) }, empresaId } });
      if (validos !== new Set(pares.map(([, v]) => v)).size) return res.status(400).json({ error: 'Serviço não pertence a esta empresa' });
    }
    const servicos = Object.fromEntries(pares);
    const ativo = req.body?.ativo !== false;

    const vinculo = await prisma.solicitacaoVinculo.upsert({
      where: { empresaId_fornecedor: { empresaId, fornecedor: FORNECEDOR } },
      create: { empresaId, fornecedor: FORNECEDOR, clienteId, servicos, ativo },
      update: { clienteId, servicos, ativo },
    });
    return res.json({ ok: true, vinculo: { clienteId: vinculo.clienteId, servicos: vinculo.servicos, ativo: vinculo.ativo } });
  } catch (err) {
    console.error('[Solicitacoes] Erro ao salvar vínculo:', err);
    return res.status(500).json({ error: 'Erro ao salvar o vínculo' });
  }
}

/**
 * Liga/desliga um modelo permanente numa caixa de e-mail. Liga em UMA caixa só: a mesma
 * regra ativa em duas caixas mandaria a mensagem duas vezes.
 */
export async function alternarModelo(req: Req, res: Response) {
  const usuarioId = req.usuarioId!;
  const modelo = modeloPorId(req.params.modeloId as string);
  if (!modelo) return res.status(404).json({ error: 'Modelo não encontrado' });
  const ativo = req.body?.ativo === true;
  try {
    const empresas = await empresasLinaWash(usuarioId);
    const ids = empresas.map((e) => e.id);

    if (!ativo) {
      await prisma.emailRegra.updateMany({ where: { modeloId: modelo.id, empresaId: { in: ids } }, data: { ativo: false } });
      return res.json({ ok: true });
    }

    const contaId = String(req.body?.contaId ?? '');
    const conta = await prisma.emailConta.findFirst({ where: { id: contaId, empresaId: { in: ids } }, select: { id: true, empresaId: true } });
    if (!conta) return res.status(400).json({ error: 'Escolha uma caixa de e-mail conectada.' });

    let regra = await prisma.emailRegra.findFirst({ where: { modeloId: modelo.id, contaId: conta.id } });
    if (regra) {
      regra = await prisma.emailRegra.update({ where: { id: regra.id }, data: { ativo: true, fila: FILA_DO_MODELO[modelo.id] ?? null } });
    } else {
      regra = await prisma.emailRegra.create({
        data: {
          empresaId: conta.empresaId,
          contaId: conta.id,
          modeloId: modelo.id,
          fila: FILA_DO_MODELO[modelo.id] ?? null,
          nome: `${modelo.nome} — ${modelo.fornecedor}`,
          ativo: true,
          remetenteContem: modelo.remetenteContem,
          assuntoContem: modelo.assuntoContem,
          assuntoNaoContem: modelo.assuntoNaoContem,
          regexExtracao: modelo.regexExtracao,
          tipoValor: modelo.tipoValor,
          campos: modelo.campos.length ? (modelo.campos as any) : undefined,
          bloco: (modelo.bloco as any) ?? undefined,
          derivados: (modelo.derivados as any) ?? undefined,
          enriquecer: (modelo.enriquecer as any) ?? undefined,
          template: modelo.template,
          destinos: [],
          destinoTipo: '',
          destinoValor: '',
        },
      });
    }
    await prisma.emailRegra.updateMany({
      where: { modeloId: modelo.id, empresaId: { in: ids }, id: { not: regra.id } },
      data: { ativo: false },
    });
    return res.json({ ok: true, regra: { id: regra.id, contaId: regra.contaId, ativo: regra.ativo } });
  } catch (err) {
    console.error('[Solicitacoes] Erro ao alternar modelo:', err);
    return res.status(500).json({ error: 'Erro ao alterar a automação' });
  }
}
