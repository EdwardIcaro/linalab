/**
 * Notificações do dono da plataforma (você) — restart do bot, erros não
 * tratados, perguntas que a Lina não conseguiu responder no tool-calling.
 *
 * Regra central: grava no banco SEMPRE, antes de tentar enviar. Se o envio
 * falhar (ex: o próprio bot caiu bem naquela hora), o evento não se perde —
 * fica pendente (`enviadoEm: null`) e é entregue no próximo boot bem-sucedido.
 *
 * Entrega agrupada por padrão: eventos do mesmo tipo dentro de uma janela
 * curta viram um resumo só, não uma mensagem por ocorrência.
 */

import prisma from '../db';
import { sendMessage as botSendWa } from './baileyService';

const GROUP_WINDOW_MS = 5 * 60 * 1000; // janela de agrupamento por tipo

const timersPendentes = new Map<string, NodeJS.Timeout>();

// Devolve o valor cru (telefone ou JID) — NÃO monta "@s.whatsapp.net" aqui.
// `sendMessage` (baileyService) já resolve telefone → JID real via onWhatsApp(),
// cobrindo a variação do 9º dígito no Brasil; montar o JID à mão aqui pularia
// essa resolução e arrisca cair no mesmo bug de "entrega no vácuo" documentado
// em CLAUDE.md.
function destinoJid(): string | null {
  const raw = process.env.OWNER_ALERT_JID;
  if (!raw) return null;
  return raw.trim();
}

const LABELS: Record<string, { emoji: string; titulo: string }> = {
  RESTART:       { emoji: '🔄', titulo: 'Bot reconectou' },
  ERRO_USUARIO:  { emoji: '⚠️', titulo: 'Erro ao processar mensagem' },
  ERRO_DB:       { emoji: '🗄️', titulo: 'Erro de banco de dados' },
  TOOL_FALHA:    { emoji: '🤷', titulo: 'Lina não conseguiu responder' },
};

function labelDe(tipo: string) {
  return LABELS[tipo] ?? { emoji: '📋', titulo: tipo };
}

/**
 * Registra um evento (grava sempre) e agenda a entrega agrupada.
 * `imediato: true` pula o agrupamento — usado só pra RESTART, que já é
 * naturalmente um evento único por vez.
 */
export async function registrarEvento(
  tipo: string,
  mensagem: string,
  contexto?: Record<string, unknown>,
  opts?: { imediato?: boolean }
): Promise<void> {
  try {
    await prisma.systemEvent.create({
      data: { tipo, mensagem, contexto: contexto ? (contexto as any) : undefined },
    });
  } catch (e) {
    console.error('[OwnerNotify] Erro ao gravar evento:', e);
    return;
  }

  if (opts?.imediato) {
    await flushTipo(tipo);
  } else {
    agendarFlush(tipo);
  }
}

function agendarFlush(tipo: string) {
  if (timersPendentes.has(tipo)) return; // já tem uma janela rodando pra esse tipo
  const timer = setTimeout(() => {
    timersPendentes.delete(tipo);
    flushTipo(tipo).catch(e => console.error('[OwnerNotify] Erro no flush agendado:', e));
  }, GROUP_WINDOW_MS);
  timersPendentes.set(tipo, timer);
}

async function flushTipo(tipo: string): Promise<void> {
  const dest = destinoJid();
  if (!dest) return;

  const pendentes = await prisma.systemEvent.findMany({
    where: { tipo, enviadoEm: null },
    orderBy: { criadoEm: 'asc' },
  });
  if (pendentes.length === 0) return;

  await enviarResumo(dest, tipo, pendentes);

  await prisma.systemEvent.updateMany({
    where: { id: { in: pendentes.map(p => p.id) } },
    data: { enviadoEm: new Date() },
  });
}

async function enviarResumo(
  dest: string,
  tipo: string,
  eventos: Array<{ mensagem: string; criadoEm: Date }>
): Promise<void> {
  const { emoji, titulo } = labelDe(tipo);
  let texto = `${emoji} *${titulo}*`;

  if (eventos.length === 1) {
    texto += `\n${eventos[0].mensagem}`;
  } else {
    texto += ` — *${eventos.length}x* nos últimos minutos\n_Primeiro:_ ${eventos[0].mensagem}`;
    const ultimo = eventos[eventos.length - 1];
    if (ultimo.mensagem !== eventos[0].mensagem) {
      texto += `\n_Último:_ ${ultimo.mensagem}`;
    }
  }

  try {
    await botSendWa(dest, texto);
  } catch (e) {
    console.error('[OwnerNotify] Erro ao enviar WhatsApp:', e);
  }
}

/**
 * Chamado quando o bot conecta com sucesso (baileyService, connection === 'open').
 * Manda o aviso de reconexão na hora e junto entrega qualquer coisa que ficou
 * pendente de quando o bot esteve fora do ar (erros que não puderam ser
 * avisados porque o próprio canal de aviso estava indisponível).
 */
export async function notificarReconexao(phone: string | null): Promise<void> {
  await registrarEvento(
    'RESTART',
    `Bot reconectado${phone ? ` — ${phone}` : ''}.`,
    undefined,
    { imediato: true }
  );

  const dest = destinoJid();
  if (!dest) return;

  const outrosPendentes = await prisma.systemEvent.findMany({
    where: { enviadoEm: null, tipo: { not: 'RESTART' } },
  });
  if (outrosPendentes.length === 0) return;

  const porTipo = new Map<string, typeof outrosPendentes>();
  for (const evento of outrosPendentes) {
    if (!porTipo.has(evento.tipo)) porTipo.set(evento.tipo, []);
    porTipo.get(evento.tipo)!.push(evento);
  }
  for (const [tipo, eventos] of porTipo) {
    await enviarResumo(dest, tipo, eventos);
  }
  await prisma.systemEvent.updateMany({
    where: { id: { in: outrosPendentes.map(e => e.id) } },
    data: { enviadoEm: new Date() },
  });
}

/**
 * Formata um erro capturado (com atenção especial a códigos Prisma
 * conhecidos) numa mensagem curta o bastante pro WhatsApp, guardando o
 * contexto completo (stack, empresa, mensagem original) à parte no banco.
 */
export function formatarErro(
  error: unknown,
  ctx: { empresaId?: string; from?: string; mensagemUsuario?: string }
): { texto: string; contexto: Record<string, unknown> } {
  const err = error as any;
  const codigo = err?.code as string | undefined;

  const rotulosPrisma: Record<string, string> = {
    P1001: 'Neon fora do ar (conexão recusada)',
    P1017: 'Neon fechou a conexão por ociosidade',
    P2032: 'Tipo incompatível — possível schema drift bot vs backend',
  };
  const rotulo = codigo ? (rotulosPrisma[codigo] ?? `Prisma ${codigo}`) : null;

  let texto = rotulo ? `${rotulo}\n` : '';
  texto += String(err?.message ?? error).slice(0, 300);
  if (ctx.empresaId) texto += `\nEmpresa: ${ctx.empresaId}`;
  if (ctx.mensagemUsuario) texto += `\nMsg: "${ctx.mensagemUsuario.slice(0, 80)}"`;

  return {
    texto,
    contexto: {
      codigo: codigo ?? null,
      stack: err?.stack ?? null,
      empresaId: ctx.empresaId ?? null,
      from: ctx.from ?? null,
      mensagemUsuario: ctx.mensagemUsuario ?? null,
    },
  };
}
