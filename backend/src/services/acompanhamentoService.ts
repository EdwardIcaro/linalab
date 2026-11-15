/**
 * Acompanhamento do veículo (15/11/2026) — protótipo Features/front/acompanhamento-veiculo.html
 *
 * O cliente recebe pelo WhatsApp DA EMPRESA (nunca pelo número da Lina) um link curto
 * `/v/:token` com o andamento da ordem. Fluxo:
 *  - ao criar a ordem: gera o token e enfileira o link em `whatsapp_envios`
 *    (canal EMPRESA, enviarApos = agora + atraso da config). O bot entrega.
 *  - cron de 1 min: ordem ficou pronta (AGUARDANDO_PAGAMENTO) → enfileira o aviso de pronto;
 *    ordem finalizada/cancelada com link ainda na fila → descarta.
 *  - página pública lê `dadosPublicos(token)`; a 1ª leitura marca `acompAbertoEm`.
 * Config por empresa em `empresa.config.acompanhamento` (sem a chave = desligado).
 * Ordens da frota vinculada (Localiza) e avulsas (tapete etc.) ficam de fora.
 */

import { randomInt } from 'crypto';
import prisma from '../db';
import { gerarQrPixAvulso } from './pixService';
import { clientesFrota, semNome } from '../controllers/ordemEdicaoController';
import { lerVistoria, vistoriaVazia, resumoVistoria } from './vistoriaService';

export interface CfgAcomp {
  ativo: boolean;
  atraso: number;        // minutos depois de criar a ordem (0 = na hora)
  avisoPronto: boolean;
  mostrarValor: boolean; // valor + PIX na página
  tplLink: string;
  tplPronto: string;
  endereco: string;
  horario: string;
  vistoria: boolean;     // seção de vistoria na nova ordem / detalhe (independe do envio)
}

export const TPL_LINK_PADRAO = 'Olá, {{nome}}! Aqui é da {{empresa}}.\nSeu veículo {{placa}} está com a gente. Acompanhe o andamento por aqui:\n{{link}}';
export const TPL_PRONTO_PADRAO = '{{nome}}, seu veículo {{placa}} está pronto para retirada.\nTotal: {{valor}}. Você pode pagar por PIX no mesmo link:\n{{link}}';
const TPL_PRONTO_SEM_PIX = '{{nome}}, seu veículo {{placa}} está pronto para retirada.\n{{link}}';

const PADRAO: CfgAcomp = {
  ativo: false, atraso: 3, avisoPronto: true, mostrarValor: true,
  tplLink: TPL_LINK_PADRAO, tplPronto: TPL_PRONTO_PADRAO, endereco: '', horario: '', vistoria: true,
};

const DIA = 24 * 60 * 60 * 1000;
const ORIGENS = ['ACOMP_LINK', 'ACOMP_PRONTO'];
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function lerJson(c: unknown): Record<string, any> {
  if (!c) return {};
  if (typeof c === 'string') { try { return JSON.parse(c) || {}; } catch { return {}; } }
  return typeof c === 'object' ? (c as Record<string, any>) : {};
}

export function cfgAcomp(config: unknown): CfgAcomp {
  const a = lerJson(config).acompanhamento || {};
  return {
    ativo: a.ativo === true,
    atraso: [0, 3, 5, 10].includes(Number(a.atraso)) ? Number(a.atraso) : PADRAO.atraso,
    avisoPronto: a.avisoPronto !== false,
    mostrarValor: a.mostrarValor !== false,
    tplLink: typeof a.tplLink === 'string' && a.tplLink.trim() ? a.tplLink.slice(0, 600) : PADRAO.tplLink,
    tplPronto: typeof a.tplPronto === 'string' && a.tplPronto.trim() ? a.tplPronto.slice(0, 600) : PADRAO.tplPronto,
    endereco: typeof a.endereco === 'string' ? a.endereco.slice(0, 160) : '',
    horario: typeof a.horario === 'string' ? a.horario.slice(0, 80) : '',
    vistoria: a.vistoria !== false,
  };
}

/** Valida o que vem da tela de Configurações antes de gravar em config.acompanhamento. */
export function sanitizarCfgAcomp(body: any): CfgAcomp {
  return cfgAcomp({ acompanhamento: body && typeof body === 'object' ? body : {} });
}

/** Telefone do cadastro → só dígitos com 55 na frente; null se não parece celular/fixo BR. */
export function telefoneWhats(tel: string | null | undefined): string | null {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!/^55\d{10,11}$/.test(d)) return null;
  return d;
}

function primeiroNome(nome: string | null | undefined): string {
  if (semNome(nome)) return '';
  const p = String(nome).trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

const brl = (n: number) => 'R$ ' + (Math.round(n * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function linkAcomp(token: string): string {
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return `${base}/v/${token}`;
}

function preencher(tpl: string, v: { nome: string; empresa: string; placa: string; valor: string; link: string }): string {
  // "Olá, {{nome}}!" sem nome vira "Olá!"
  let t = v.nome ? tpl : tpl.replace(/,\s*\{\{nome\}\}/g, '').replace(/\{\{nome\}\},?\s*/g, '');
  t = t.replace(/\{\{nome\}\}/g, v.nome).replace(/\{\{empresa\}\}/g, v.empresa).replace(/\{\{placa\}\}/g, v.placa)
       .replace(/\{\{valor\}\}/g, v.valor).replace(/\{\{link\}\}/g, v.link);
  t = t.replace(/[ \t]{2,}/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

async function gerarToken(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    let t = '';
    for (let j = 0; j < 7; j++) t += CHARS[randomInt(CHARS.length)];
    const existe = await prisma.ordemServico.findUnique({ where: { acompToken: t }, select: { id: true } });
    if (!existe) return t;
  }
  throw new Error('Não foi possível gerar o código do link');
}

/** Token da ordem (cria na 1ª vez). */
export async function garantirToken(ordemId: string): Promise<string> {
  const o = await prisma.ordemServico.findUnique({ where: { id: ordemId }, select: { acompToken: true } });
  if (o?.acompToken) return o.acompToken;
  const token = await gerarToken();
  const r = await prisma.ordemServico.updateMany({ where: { id: ordemId, acompToken: null }, data: { acompToken: token } });
  if (r.count) return token;
  const de = await prisma.ordemServico.findUnique({ where: { id: ordemId }, select: { acompToken: true } });
  return de!.acompToken!;
}

const SELECT_ORDEM = {
  id: true, empresaId: true, clienteId: true, numeroOrdem: true, status: true, tipoOrdem: true, valorTotal: true,
  acompToken: true, acompEnviadoEm: true, acompAbertoEm: true, acompProntoEm: true, vistoria: true,
  cliente: { select: { nome: true, telefone: true } },
  veiculo: { select: { placa: true } },
  empresa: { select: { nome: true, config: true } },
} as const;

type OrdemAcomp = NonNullable<Awaited<ReturnType<typeof carregar>>>;
const carregar = (id: string) => prisma.ordemServico.findUnique({ where: { id }, select: SELECT_ORDEM });

/** Por que esta ordem não tem acompanhamento (null = tem). */
async function foraDoAcomp(o: OrdemAcomp): Promise<string | null> {
  if (o.tipoOrdem !== 'VEICULO' || !o.veiculo?.placa) return 'Ordem sem veículo';
  if ((await clientesFrota(o.empresaId).catch(() => new Set<string>())).has(o.clienteId)) return 'Ordem da frota';
  return null;
}

async function textoDe(o: OrdemAcomp, origem: 'ACOMP_LINK' | 'ACOMP_PRONTO', cfg: CfgAcomp, token: string): Promise<string> {
  let tpl = origem === 'ACOMP_LINK' ? cfg.tplLink : cfg.tplPronto;
  if (origem === 'ACOMP_PRONTO' && tpl === TPL_PRONTO_PADRAO) {
    const pix = cfg.mostrarValor && !!(await prisma.bankIntegration.findUnique({ where: { empresaId: o.empresaId }, select: { chavePix: true, ativo: true } }).then((b) => b?.ativo && b.chavePix));
    if (!pix) tpl = TPL_PRONTO_SEM_PIX;
  }
  return preencher(tpl, {
    nome: primeiroNome(o.cliente?.nome),
    empresa: o.empresa.nome,
    placa: o.veiculo?.placa || '',
    valor: cfg.mostrarValor ? brl(o.valorTotal) : '',
    link: linkAcomp(token),
  });
}

async function enfileirar(o: OrdemAcomp, origem: 'ACOMP_LINK' | 'ACOMP_PRONTO', cfg: CfgAcomp, enviarApos: Date): Promise<boolean> {
  const destino = telefoneWhats(o.cliente?.telefone);
  if (!destino) return false;
  const token = await garantirToken(o.id);
  const texto = await textoDe(o, origem, cfg, token);
  await prisma.whatsappEnvio.create({ data: { empresaId: o.empresaId, origem, destino, texto, canal: 'EMPRESA', ordemId: o.id, enviarApos } });
  return true;
}

/** Chamado logo depois de criar a ordem. Silencioso: nunca derruba a criação. */
export async function agendarLinkAoCriar(ordemId: string): Promise<void> {
  try {
    const o = await carregar(ordemId);
    if (!o || o.status === 'CANCELADO' || o.status === 'FINALIZADO') return;
    const cfg = cfgAcomp(o.empresa.config);
    if (!cfg.ativo || (await foraDoAcomp(o))) return;
    await garantirToken(o.id);
    await enfileirar(o, 'ACOMP_LINK', cfg, new Date(Date.now() + cfg.atraso * 60 * 1000));
  } catch (e) {
    console.error('[Acompanhamento] Erro ao agendar link:', (e as Error)?.message);
  }
}

/** Ordem cancelada/apagada: mensagens que ainda não saíram vão embora. */
export async function descartarPendentes(ordemId: string): Promise<void> {
  await prisma.whatsappEnvio.deleteMany({ where: { ordemId, status: 'PENDENTE', origem: { in: ORIGENS } } }).catch(() => {});
}

export type EstadoAcomp = 'agendado' | 'enviando' | 'aguardandoConexao' | 'enviado' | 'lido' | 'falhou' | 'semTelefone' | 'naoEnviado';

/** Estado do acompanhamento para o bloco no detalhe da ordem. */
export async function estadoAcomp(ordemId: string, empresaId: string) {
  const o = await prisma.ordemServico.findFirst({ where: { id: ordemId, empresaId }, select: SELECT_ORDEM });
  if (!o) return null;
  const cfg = cfgAcomp(o.empresa.config);
  const fora = await foraDoAcomp(o);
  if (fora) return { disponivel: false, motivo: fora, ativo: cfg.ativo };
  const vistoria = {
    ativa: cfg.vistoria,
    editavel: !['FINALIZADO', 'CANCELADO'].includes(o.status),
    resumo: resumoVistoria(o.vistoria),
  };

  const [envios, sessao] = await Promise.all([
    prisma.whatsappEnvio.findMany({
      where: { ordemId: o.id, origem: { in: ORIGENS } }, orderBy: { createdAt: 'desc' }, take: 10,
      select: { origem: true, status: true, erro: true, enviarApos: true, enviadoEm: true, createdAt: true, tentativas: true },
    }),
    prisma.whatsappEmpresaSession.findUnique({ where: { empresaId }, select: { status: true } }),
  ]);
  const waConectado = sessao?.status === 'CONECTADO';
  const telefone = telefoneWhats(o.cliente?.telefone);
  const pend = envios.find((e) => e.status === 'PENDENTE');
  const ultimo = envios[0];
  const prontoEnviado = envios.find((e) => e.origem === 'ACOMP_PRONTO' && e.status === 'ENVIADO');

  let estado: EstadoAcomp;
  if (pend) estado = !waConectado ? 'aguardandoConexao' : (pend.enviarApos && pend.enviarApos > new Date() ? 'agendado' : 'enviando');
  else if (o.acompAbertoEm) estado = 'lido';
  else if (o.acompEnviadoEm) estado = 'enviado';
  else if (ultimo?.status === 'ERRO') estado = 'falhou';
  else if (!telefone) estado = 'semTelefone';
  else estado = 'naoEnviado';

  const token = o.acompToken || (cfg.ativo ? await garantirToken(o.id) : null);
  return {
    disponivel: true,
    ativo: cfg.ativo,
    vistoria,
    waConectado,
    temTelefone: !!telefone,
    estado,
    link: token ? linkAcomp(token) : null,
    pendente: pend ? { origem: pend.origem, enviarApos: pend.enviarApos } : null,
    erro: !pend && ultimo?.status === 'ERRO' ? ultimo.erro : null,
    enviadoEm: o.acompEnviadoEm,
    abertoEm: o.acompAbertoEm,
    prontoEm: prontoEnviado?.enviadoEm || null,
  };
}

/** "Enviar agora" / "Reenviar" do detalhe da ordem. */
export async function enviarAgora(ordemId: string, empresaId: string): Promise<{ ok: boolean; erro?: string }> {
  const o = await prisma.ordemServico.findFirst({ where: { id: ordemId, empresaId }, select: SELECT_ORDEM });
  if (!o) return { ok: false, erro: 'Ordem não encontrada' };
  if (await foraDoAcomp(o)) return { ok: false, erro: 'Esta ordem não tem acompanhamento.' };
  if (!telefoneWhats(o.cliente?.telefone)) return { ok: false, erro: 'Cliente sem telefone válido. Cadastre o telefone ou copie o link.' };
  const pend = await prisma.whatsappEnvio.updateMany({
    where: { ordemId: o.id, status: 'PENDENTE', origem: { in: ORIGENS } }, data: { enviarApos: new Date() },
  });
  if (pend.count) return { ok: true };
  const cfg = cfgAcomp(o.empresa.config);
  const origem = o.status === 'AGUARDANDO_PAGAMENTO' ? 'ACOMP_PRONTO' : 'ACOMP_LINK';
  await enfileirar(o, origem, cfg, new Date());
  return { ok: true };
}

/** "Não enviar": tira da fila o que ainda não saiu. */
export async function naoEnviar(ordemId: string, empresaId: string): Promise<boolean> {
  const o = await prisma.ordemServico.findFirst({ where: { id: ordemId, empresaId }, select: { id: true } });
  if (!o) return false;
  await descartarPendentes(o.id);
  return true;
}

/**
 * Cron de 1 min:
 *  - pronta (AGUARDANDO_PAGAMENTO) com link enviado ou na fila → aviso de pronto (o link na fila sai junto, no aviso)
 *  - finalizada/cancelada com mensagem na fila → descarta
 */
export async function cronAcompanhamento(): Promise<void> {
  try {
    const desde = new Date(Date.now() - DIA);
    const pendentes = await prisma.whatsappEnvio.findMany({
      where: { status: 'PENDENTE', origem: { in: ORIGENS }, ordemId: { not: null } }, select: { id: true, ordemId: true },
    });
    const idsPend = [...new Set(pendentes.map((p) => p.ordemId!))];

    if (idsPend.length) {
      const encerradas = await prisma.ordemServico.findMany({
        where: { id: { in: idsPend }, status: { in: ['FINALIZADO', 'CANCELADO'] } }, select: { id: true },
      });
      if (encerradas.length) {
        await prisma.whatsappEnvio.deleteMany({ where: { ordemId: { in: encerradas.map((e) => e.id) }, status: 'PENDENTE', origem: { in: ORIGENS } } });
      }
    }

    const prontas = await prisma.ordemServico.findMany({
      where: {
        status: 'AGUARDANDO_PAGAMENTO', acompToken: { not: null }, acompProntoEm: null, updatedAt: { gte: desde },
        OR: [{ acompEnviadoEm: { not: null } }, { id: { in: idsPend } }],
      },
      select: SELECT_ORDEM, take: 50,
    });
    for (const o of prontas) {
      const marcada = await prisma.ordemServico.updateMany({ where: { id: o.id, acompProntoEm: null }, data: { acompProntoEm: new Date() } });
      if (!marcada.count) continue;
      const cfg = cfgAcomp(o.empresa.config);
      if (!cfg.ativo || !cfg.avisoPronto) continue;
      // O link que ainda não saiu vira o aviso de pronto (que leva o mesmo link)
      await prisma.whatsappEnvio.deleteMany({ where: { ordemId: o.id, status: 'PENDENTE', origem: 'ACOMP_LINK' } });
      await enfileirar(o, 'ACOMP_PRONTO', cfg, new Date()).catch((e) => console.error('[Acompanhamento] aviso de pronto:', e?.message));
    }
  } catch (e) {
    console.error('[Acompanhamento] cron:', (e as Error)?.message);
  }
}

// ── Página pública ─────────────────────────────────────────────────────────────

/** Vistoria para o cliente: fotos viram URLs da própria página (/api/v/:token/foto/:id). */
function vistoriaPublica(v: unknown, token: string, tipoVeiculo?: string | null) {
  const x = lerVistoria(v);
  if (vistoriaVazia(x)) return null;
  return {
    tipo: (tipoVeiculo || '').toUpperCase() === 'MOTO' ? 'moto' : 'carro',
    km: x!.km,
    obs: x!.obs || null,
    avarias: x!.avarias.map((a) => ({ zona: a.zona, tipo: a.tipo, obs: a.obs || '', fotos: (a.fotos || []).map((id) => `/api/v/${token}/foto/${id}`) })),
  };
}

function categoria(tipo?: string | null, sub?: string | null): string {
  if ((tipo || '').toUpperCase() === 'MOTO') return 'moto';
  switch ((sub || '').toUpperCase()) {
    case 'SUV': case 'CAMINHONETE': return 'suv';
    case 'PICKUP': case 'CAMINHAO': return 'picape';
    case 'SEDAN': return 'seda';
    case 'VAN': return 'van';
    default: return 'hatch';
  }
}

const pixCache = new Map<string, { em: number; v: any }>();

export async function dadosPublicos(token: string, opts: { equipe?: boolean } = {}) {
  if (!/^[A-Z2-9]{6,10}$/.test(token)) return null;
  const o = await prisma.ordemServico.findUnique({
    where: { acompToken: token },
    select: {
      id: true, empresaId: true, numeroOrdem: true, status: true, valorTotal: true, createdAt: true, dataFim: true, updatedAt: true, acompAbertoEm: true, vistoria: true,
      cliente: { select: { nome: true } },
      veiculo: { select: { placa: true, cor: true, tipoVeiculo: true, subtipoVeiculo: true } },
      items: { select: { quantidade: true, subtotal: true, nomeCustom: true, servico: { select: { nome: true } }, adicional: { select: { nome: true } } }, orderBy: { createdAt: 'asc' } },
      pagamentos: { select: { metodo: true, valor: true, status: true, pagoEm: true } },
      empresa: { select: { nome: true, config: true, theme: { select: { corPrimaria: true } }, whatsappEmpresaSession: { select: { phoneNumber: true } } } },
    },
  });
  if (!o) return null;
  const cfg = cfgAcomp(o.empresa.config);
  const pagos = o.pagamentos.filter((p) => p.status === 'PAGO' && p.metodo !== 'PENDENTE');
  const recebido = pagos.reduce((s, p) => s + p.valor, 0);
  const restante = Math.max(0, Math.round((o.valorTotal - recebido) * 100) / 100);
  const retiradoEm = o.status === 'FINALIZADO'
    ? pagos.reduce<Date | null>((m, p) => (p.pagoEm && (!m || p.pagoEm > m) ? p.pagoEm : m), null) || o.dataFim || o.updatedAt
    : null;

  const status = ({ PENDENTE: 'pendente', EM_ANDAMENTO: 'lavando', AGUARDANDO_PAGAMENTO: 'pronto', FINALIZADO: 'finalizado', CANCELADO: 'cancelado' } as Record<string, string>)[o.status] || 'pendente';
  const fimEm = status === 'finalizado' ? retiradoEm : status === 'cancelado' ? o.updatedAt : null;
  const expirado = !!fimEm && fimEm.getTime() < Date.now() - 7 * DIA;

  const zap = String(o.empresa.whatsappEmpresaSession?.phoneNumber || '').replace(/\D/g, '');
  const empresa = {
    nome: o.empresa.nome,
    cor: /^#[0-9a-f]{6}$/i.test(o.empresa.theme?.corPrimaria || '') && o.empresa.theme!.corPrimaria !== '#F59E0B' ? o.empresa.theme!.corPrimaria : null,
    whatsapp: zap.length >= 12 ? zap : null,
    endereco: cfg.endereco || null,
    horario: cfg.horario || null,
  };
  if (expirado) return { expirado: true, empresa, retiradoEm: fimEm };

  if (!o.acompAbertoEm && !opts.equipe) {
    await prisma.ordemServico.updateMany({ where: { id: o.id, acompAbertoEm: null }, data: { acompAbertoEm: new Date() } }).catch(() => {});
  }

  let pix: { payload: string; qrDataUrl: string; recebedor: string } | null = null;
  if (status === 'pronto' && cfg.mostrarValor && restante > 0.009) {
    const chave = `${o.id}:${restante}`;
    const c = pixCache.get(chave);
    if (c && Date.now() - c.em < 10 * 60 * 1000) pix = c.v;
    else {
      try {
        const r = await gerarQrPixAvulso(o.empresaId, restante);
        pix = { payload: r.payload, qrDataUrl: r.qrDataUrl, recebedor: r.nomeRecebedor };
        pixCache.set(chave, { em: Date.now(), v: pix });
        if (pixCache.size > 500) pixCache.delete(pixCache.keys().next().value as string);
      } catch { pix = null; }
    }
  }

  return {
    expirado: false,
    empresa,
    cliente: primeiroNome(o.cliente?.nome) || null,
    ordem: {
      numero: o.numeroOrdem,
      status,
      recebidoEm: o.createdAt,
      prontoEm: ['pronto', 'finalizado'].includes(status) ? o.dataFim : null,
      retiradoEm,
    },
    veiculo: {
      placa: o.veiculo?.placa || '',
      tipo: categoria(o.veiculo?.tipoVeiculo, o.veiculo?.subtipoVeiculo),
      cor: o.veiculo?.cor || null,
    },
    mostrarValor: cfg.mostrarValor,
    itens: o.items.map((i) => ({
      nome: i.servico?.nome || i.adicional?.nome || i.nomeCustom || 'Serviço',
      quantidade: i.quantidade,
      valor: cfg.mostrarValor ? i.subtotal : null,
    })),
    total: cfg.mostrarValor ? o.valorTotal : null,
    restante: cfg.mostrarValor ? restante : null,
    pago: status === 'finalizado' || restante <= 0.009,
    pix,
    vistoria: vistoriaPublica(o.vistoria, token, o.veiculo?.tipoVeiculo),
  };
}
