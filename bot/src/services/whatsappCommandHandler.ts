/*
 * Parser de comandos WhatsApp e construtor de contexto
 * Identifica comandos específicos e passa para Groq quando não encontra match
 */

import prisma from '../db';
import { chatCompletion } from './groqService';
import { identifyWhatsAppUser, hasPermission, getDeniedAccessMessage, type WhatsAppUser } from './whatsappAuthService';
import { getContext, setContext, clearContext, detectEmpresaNoTexto } from './adminContextStore';
import { gerarPixParaOrdem } from './pixService';
import { sendImageBuffer } from './baileyService';
import { getWorkdayRangeBRT, getDateRangeBRT, getFixedDayRangeBRT, getTodayFixedRangeBRT, getTodayStrBRT } from '../utils/dateUtils';
import {
  pendingReports,
  hasPendingAdminReportView,
  hasPendingReportsList,
  handleReportarCommand,
  handleReportStep,
  handleIncomingImageForReport,
  handleAdminReportResponse,
  handleReportsCommand,
  handleReportsListSelection,
} from './reportService';

const PORTAL_URL = (process.env.PORTAL_URL ?? '').replace(/\/$/, '');

/** Chamado pelo baileyService quando recebe uma imagem. */
export async function handleIncomingImage(from: string, buffer: Buffer): Promise<string | null> {
  return handleIncomingImageForReport(from, buffer);
}

// ==========================================
// ESTADO DE COLETA CONVERSACIONAL DE SAÍDAS
// ==========================================
type SaidaStep = 'valor' | 'descricao' | 'formaPagamento' | 'lavador' | 'fornecedor' | 'confirming';

interface PendingSaida {
  valor: number;                   // 0 = ainda não informado
  descricao: string | null;
  formaPagamento: string | null;
  categoria: string;
  fornecedorNome: string | null | undefined; // undefined = não perguntado; null = pulou; string = fornecido
  lavadorId: string | null | undefined;      // undefined = não perguntado; null = pulou
  lavadorNome: string | null | undefined;
  lavadoresList: Array<{ id: string; nome: string }>;
  step: SaidaStep;
  empresaId: string;
  userName: string;
  expiresAt: number;
}
const pendingSaidas = new Map<string, PendingSaida>(); // chave = JID (empresa vem do contexto)

// Comando pendente aguardando seleção de empresa (JID → mensagem original)
const pendingCommands = new Map<string, string>();

// Admin navegando menu de notificações individuais (JID → empresaId)
const pendingNotifMenu = new Map<string, string>();

// Limpa sessões expiradas a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingSaidas.entries()) {
    if (val.expiresAt < now) pendingSaidas.delete(key);
  }
}, 5 * 60 * 1000);

// ==========================================
// MENU DE NOTIFICAÇÕES INDIVIDUAIS
// ==========================================
const NOTIF_MENU_ITEMS = [
  { key: 'novaOrdem',         label: '🆕 Nova ordem criada' },
  { key: 'ordemFinalizada',   label: '✅ Ordem finalizada' },
  { key: 'ordemCancelada',    label: '❌ Ordem cancelada' },
  { key: 'ordemParada',       label: '⚠️ Ordens paradas' },
  { key: 'resumoDiario',      label: '📊 Resumo diário (20h)' },
  { key: 'alertaCaixaAberto', label: '🕙 Alerta caixa aberto' },
  { key: 'saidaRegistrada',   label: '💸 Saída registrada' },
  { key: 'comissaoFechada',   label: '💰 Comissão fechada' },
  { key: 'clienteVip',        label: '🏆 Cliente VIP chegou' },
  { key: 'reportAvaria',      label: '📸 Report de avaria' },
];

// Defaults do sistema (espelha o backend whatsappNotificationService.ts)
const NOTIF_SISTEMA_DEFAULTS: Record<string, boolean> = {
  novaOrdem:          true,
  ordemFinalizada:    false,
  ordemCancelada:     false,
  resumoDiario:       true,
  alertaCaixaAberto:  true,
  ordemParada:        false,
  saidaRegistrada:    false,
  comissaoFechada:    false,
  clienteVip:         true,
  reportAvaria:       true,
};

async function buildNotifMenuText(jid: string, empresaId: string): Promise<string> {
  const [admin, empresa] = await Promise.all([
    (prisma.whatsappAdminPhone as any).findFirst({
      where: { empresaId, ativo: true, jid },
      select: { notifPrefs: true },
    }),
    prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { notificationPreferences: true },
    }),
  ]);

  const prefs: any = (admin?.notifPrefs as any) ?? {};
  const sistemaPrefs: any = (empresa?.notificationPreferences as any)?.whatsapp ?? {};

  const lista = NOTIF_MENU_ITEMS.map((item, i) => {
    const defaultSistema = NOTIF_SISTEMA_DEFAULTS[item.key] !== false;
    const sistemaAtivo = sistemaPrefs[item.key] !== undefined
      ? sistemaPrefs[item.key] !== false
      : defaultSistema;

    if (!sistemaAtivo) {
      return `*${i + 1}* ${item.label} — 🚫 _desativado no sistema_`;
    }

    const individualAtivo = prefs[item.key] !== false;
    return `*${i + 1}* ${item.label} — ${individualAtivo ? '✅' : '❌'}`;
  }).join('\n');

  return `🔔 *Suas notificações*\n_Preferências individuais (ativo por padrão)_\n\n${lista}\n\n_Digite o número para ativar/desativar ou *0* para sair._\n_🚫 = desativado nas configurações do sistema_`;
}

async function handleNotifMenuStep(jid: string, empresaId: string, choice: string): Promise<string> {
  if (choice === '0') {
    pendingNotifMenu.delete(jid);
    return '✅ Preferências salvas.';
  }

  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= NOTIF_MENU_ITEMS.length) {
    return buildNotifMenuText(jid, empresaId);
  }

  const item = NOTIF_MENU_ITEMS[idx];
  const admin = await (prisma.whatsappAdminPhone as any).findFirst({
    where: { empresaId, ativo: true, jid },
    select: { id: true, notifPrefs: true },
  });

  if (!admin) {
    pendingNotifMenu.delete(jid);
    return '❌ Erro ao carregar preferências.';
  }

  const prefs: any = { ...((admin.notifPrefs as any) ?? {}) };
  const eraAtivo = prefs[item.key] !== false;
  prefs[item.key] = !eraAtivo;

  await (prisma.whatsappAdminPhone as any).update({
    where: { id: admin.id },
    data: { notifPrefs: prefs },
  });

  const status = !eraAtivo ? '✅ ativada' : '❌ desativada';
  return `${status} — *${item.label}*\n\n${await buildNotifMenuText(jid, empresaId)}`;
}

/*
 * Processa mensagem recebida do WhatsApp
 */
// ─── Self-onboarding portal: "conectar CODIGO" ───────────────────────────────
async function handleConectarPortal(from: string, message: string): Promise<string | null> {
  const match = message.trim().match(/^conectar\s+([A-Z0-9]{6})$/i);
  if (!match) return null;

  const codigo = match[1].toUpperCase();
  const agora  = new Date();

  const lavador = await (prisma.lavador as any).findFirst({
    where: {
      codigoWpp: codigo,
      codigoWppExpiraEm: { gte: agora },
      ativo: true,
    },
    select: { id: true, nome: true },
  }) as { id: string; nome: string } | null;

  if (!lavador) {
    return '❌ Código inválido ou expirado. Gere um novo código pelo portal e tente novamente.';
  }

  // Extrai número do JID (ex: "5511999999999@s.whatsapp.net" → "5511999999999")
  const telefone = from.split('@')[0];

  await (prisma.lavador as any).update({
    where: { id: lavador.id },
    data: {
      telefone,
      codigoWpp: null,
      codigoWppExpiraEm: null,
    },
  });

  return `Oi, ${lavador.nome}! 👋 Sou a Lina, tudo bem?\n\nSeu WhatsApp tá vinculado agora — a partir de agora você recebe suas notificações de comissão por aqui e pode me perguntar qualquer coisa sobre seus serviços. Manda um *ajuda* pra ver o que eu consigo fazer por você, viu?`;
}

export async function handleIncomingMessage(
  from: string,
  senderName: string,
  message: string,
): Promise<string> {
  try {
    // ── SELF-ONBOARDING (antes da auth — número ainda não cadastrado) ─────────
    if (/^conectar\s+[A-Z0-9]{6}$/i.test(message.trim())) {
      const resp = await handleConectarPortal(from, message);
      if (resp) return resp;
    }

    // ── AUTENTICAÇÃO ─────────────────────────────────────────────────────────
    const user = await identifyWhatsAppUser(from);

    if (user.type === 'unknown') {
      return getDeniedAccessMessage(user);
    }

    const command = message.trim().toLowerCase().replace(/\//g, '');

    // ── LAVADOR: empresa implícita ────────────────────────────────────────────
    if (user.type === 'lavador') {
      const empresaId = user.empresaId!;
      const lavadorId = user.lavadorId!;

      // Step pendente de report tem prioridade
      if (pendingReports.has(from)) return handleReportStep(from, message);

      if (command === 'reportar') return handleReportarCommand(from, lavadorId, empresaId);
      if (command === 'ajuda')    return handleAjudaLavador();
      if (command === 'link')     return handleLinkLavador(lavadorId);
      if (['status','meu-status','minhas-comissoes','resumo'].includes(command))
        return handleStatusLavador(lavadorId, empresaId);
      if (['comissoes','comissão','comissao'].includes(command))
        return handleComissoesLavador(lavadorId, empresaId);

      const isComissaoAberto = /comiss[aã][eo]s?\s*(em aberto|abertas?|pendentes?)/i.test(message) ||
        /(em aberto|abertas?|pendentes?)\s*(comiss[aã][eo]s?|comiss[oõ]es)/i.test(message);
      if (isComissaoAberto) return handleComissoesLavador(lavadorId, empresaId);

      const pixMatch = message.trim().match(/^(?:pix|pagamento)(?:\s+ordem)?\s+(\d+)$/i);
      if (pixMatch) return handlePixOrdem(parseInt(pixMatch[1]), empresaId, from, user, false);

      return getDeniedAccessMessage(user);
    }

    // ── ADMIN: pendências com prioridade (não dependem de empresa ativa) ────────
    // Devem ser verificadas ANTES da resolução de empresa para evitar que
    // respostas numéricas (ex: "1") sejam capturadas pelo menu de seleção de empresa.

    // Report de avaria — admin respondendo à notificação (1 = ver fotos / 2 = ignorar)
    if (hasPendingAdminReportView(from) && (command === '1' || command === '2')) {
      return handleAdminReportResponse(from, command);
    }

    // Report de avaria — admin navegando lista de reports
    if (hasPendingReportsList(from)) {
      const r = await handleReportsListSelection(from, command);
      if (r !== '') return r;
    }

    // Fluxo de saída/despesa em andamento (empresaId está dentro do struct)
    if (pendingSaidas.has(from)) {
      return handlePendingSaidaStep(message, from, senderName);
    }

    // Menu de notificações individuais (empresaId está dentro do Map)
    if (pendingNotifMenu.has(from)) {
      return handleNotifMenuStep(from, pendingNotifMenu.get(from)!, command);
    }

    // Detectar saudação simples — usada para evitar menu de empresa e contexto desnecessário
    const isSaudacao = /^(oi|ol[aá]|bom\s*dia|boa\s*tarde|boa\s*noite|e\s*a[ií]|tudo\s*bem|ol[aá]\s*lina|oi\s*lina|hey|opa|eae|boa|sauda[çc][aã]o|sauda[çc][oõ]es|salve|oi\s*gente|oi\s*pessoal|boas|al[oô])$/i.test(command);

    if (isSaudacao) {
      const r = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

      if (/bom\s*dia/i.test(command)) return r([
        'Olá, bom dia! 😊 tudo bem? como posso ajudar?',
        'Bom dia! tudo certo? no que posso te ajudar hoje?',
        'Olá, bom dia! que bom te ver por aqui. como posso ajudar?',
        'Bom dia! tudo bem? pode falar, tô aqui pra ajudar.',
      ]);

      if (/boa\s*tarde/i.test(command)) return r([
        'Olá, boa tarde! 😊 como posso te ajudar?',
        'Boa tarde! tudo bem? no que posso ajudar?',
        'Olá, boa tarde! que bom te ver. como posso ajudar?',
      ]);

      if (/boa\s*noite/i.test(command)) return r([
        'Olá, boa noite! 😊 como posso te ajudar?',
        'Boa noite! tudo bem? no que posso ajudar?',
        'Olá, boa noite! pode falar, tô aqui.',
      ]);

      return r([
        'Olá! 😊 como posso te ajudar?',
        'Olá, tudo bem? no que posso ajudar?',
        'Oi! que bom te ver. como posso te ajudar hoje?',
        'Olá! tô aqui, pode falar.',
        'Oi! tudo certo? como posso ajudar?',
        'Olá! no que posso te ajudar?',
        'Oi, tudo bem? pode falar, tô à disposição.',
      ]);
    }

    // ── ADMIN: resolver empresa pelo contexto ─────────────────────────────────
    const empresas = user.empresas ?? [];

    // "trocar para [nome]" → troca direta sem mostrar menu
    const trocarParaMatch = message.match(/(?:trocar?|mudar|ir)\s+(?:para|pra|p\/|pro?)\s+(.+)/i);
    if (trocarParaMatch) {
      const alvo = detectEmpresaNoTexto(trocarParaMatch[1].trim(), empresas);
      if (alvo) {
        setContext(from, alvo.id, alvo.nome);
        return `✅ Empresa alterada para *${alvo.nome}*.`;
      }
    }

    // "trocar empresa / mudar empresa" → abre menu de seleção
    if (/trocar?\s*(?:de\s*)?empresa|mudar\s*(?:de\s*)?empresa|trocar\s*contexto|mudar\s*contexto|\btrocar\b|\bmudar\b/i.test(message)) {
      clearContext(from);
      if (empresas.length === 1) {
        setContext(from, empresas[0].id, empresas[0].nome);
        return `ℹ️ Você só tem uma empresa: *${empresas[0].nome}*.`;
      }
      return buildEmpresaMenu(empresas, '🔄 Qual empresa você quer gerenciar?');
    }

    // ── MULTI-EMPRESA: "resumo das duas", "relatório de todas", etc. ──────────
    const isMultiEmpresaRequest = empresas.length > 1 &&
      /\b(das?\s+duas?|de\s+todas?|ambas?|as\s+duas?|todas?\s+(?:as\s+)?empresas?|os\s+dois|todo[as]?\s*mundo|ambas?\s+empresas?)\b/i.test(message);

    if (isMultiEmpresaRequest) {
      const rangeM  = parseDateRangeFromMessage(message);
      const dateM   = parseDateFromMessage(message);
      const isCaixa = /\bcaixa\b/.test(command);
      const isLavs  = /\blavadores?\b/.test(command);

      const blocos = await Promise.all(empresas.map(async e => {
        let r: string;
        if (rangeM)       r = await handleRelatorioPeriodo(rangeM.inicio, rangeM.fim, e.id);
        else if (dateM)   r = await handleRelatorioData(dateM, e.id);
        else if (isCaixa) r = await handleCaixaCommand(e.id);
        else if (isLavs)  r = await handleLavadoresCommand(e.id);
        else              r = await handleResumoCommand(e.id);
        return `━━ *${e.nome}* ━━\n${r}`;
      }));

      return blocos.join('\n\n');
    }

    // Detectar empresa pelo nome na mensagem (shortcut tipo "dados da Empresa X")
    const empresaDetectada = detectEmpresaNoTexto(message, empresas);
    if (empresaDetectada) {
      setContext(from, empresaDetectada.id, empresaDetectada.nome);
    }

    // Verificar contexto ativo
    let ctx = getContext(from);

    // Admin com 1 empresa → contexto automático sem menu
    if (!ctx && empresas.length === 1) {
      setContext(from, empresas[0].id, empresas[0].nome);
      ctx = getContext(from)!;
    }

    // Admin com múltiplas empresas sem contexto → pede seleção com mini-dica
    if (!ctx && empresas.length > 1) {
      const escolha = parseInt(command);
      if (!isNaN(escolha) && escolha >= 1 && escolha <= empresas.length) {
        const escolhida = empresas[escolha - 1];
        setContext(from, escolhida.id, escolhida.nome);

        // Se havia comando pendente, executa-o após conectar na empresa
        const pendingMsg = pendingCommands.get(from);
        pendingCommands.delete(from);

        if (pendingMsg) {
          const resultado = await handleIncomingMessage(from, senderName, pendingMsg);
          return `✅ *${escolhida.nome}* selecionada.\n\n${resultado}`;
        }

        return `✅ *${escolhida.nome}*\nDigite *ajuda* para ver o que posso fazer.`;
      } else {
        pendingCommands.set(from, message);
        return buildEmpresaMenu(empresas, `Qual empresa você quer consultar?\n\n_Dica: "resumo das duas" para ver todas juntas_`);
      }
    }

    if (!ctx) return '❌ Nenhuma empresa disponível para este usuário.';

    const empresaId   = ctx.empresaId;
    const empresaNome = ctx.empresaNome;

    // ── Comandos do admin com empresa resolvida ───────────────────────────────
    // "saídas ..." — verificar ANTES do isRelatorioRequest para "saídas da semana" não ser capturado por "semana"
    if (/^sa[íi]das?(\s|$)/i.test(message)) {
      const range = parseDateRangeFromMessage(message);
      if (range) return handleSaidasDetalhadas(range.inicio, range.fim, empresaId);
      const date = parseDateFromMessage(message);
      if (date) {
        const ini = new Date(date); ini.setHours(0,0,0,0);
        const fim = new Date(date); fim.setHours(23,59,59,999);
        return handleSaidasDetalhadas(ini, fim, empresaId);
      }
      const hoje = new Date(); hoje.setHours(0,0,0,0);
      const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1);
      return handleSaidasDetalhadas(hoje, amanha, empresaId);
    }

    const isRelatorioRequest = /resumo|relat[oó]rio|detalhe|semanal|semana/.test(command);
    if (isRelatorioRequest || /^ontem$/.test(command)) {
      const range = parseDateRangeFromMessage(message);
      if (range) return handleRelatorioPeriodo(range.inicio, range.fim, empresaId);
      const date  = parseDateFromMessage(message);
      if (date)  return handleRelatorioData(date, empresaId);
      if (/\b(mais\s+)?detalhes?\b/.test(command)) return handleRelatorioData(new Date(), empresaId);
    }

    const isComissaoAberto = /comiss[aã][eo]s?\s*(em aberto|abertas?|pendentes?)/i.test(message) ||
      /(em aberto|abertas?|pendentes?)\s*(comiss[aã][eo]s?|comiss[oõ]es)/i.test(message);
    if (isComissaoAberto) {
      return handleComissoesEmAberto(extrairNomeLavador(message), empresaId);
    }

    // "comissão [nome]" — acesso rápido por lavador
    const comissaoNomeMatch = message.match(/^comiss[aã][eo](?:s)?\s+(?:do?\s+|da?\s+)?(.+)$/i);
    if (comissaoNomeMatch) {
      return handleComissoesEmAberto(comissaoNomeMatch[1].trim().toLowerCase(), empresaId);
    }

    // "vale [nome]" ou "vales [nome]"
    const valeMatch = message.match(/^vales?\s+(?:do?\s+|da?\s+)?(.+)$/i);
    if (valeMatch) {
      return handleValesLavador(valeMatch[1].trim().toLowerCase(), empresaId);
    }


    if (/^notifica[çc]([aã]o|[oõ]es?)$|^notifs?$/.test(command)) {
      pendingNotifMenu.set(from, empresaId);
      return buildNotifMenuText(from, empresaId);
    }

    const isReports = (
      command === 'reports' ||
      /\bavarias?\b/i.test(message) ||
      /\breports?\b/i.test(message) ||
      /\bver\s+(?:as\s+)?fotos?\b/i.test(message) ||
      /\bfotos?\s+(?:de\s+)?avarias?\b/i.test(message) ||
      /\breports?\s+(?:de\s+)?avarias?\b/i.test(message) ||
      /\breport(?:es)?\s+pendentes?\b/i.test(message) ||
      /\bver\s+(?:os\s+)?reports?\b/i.test(message) ||
      /\btem\s+(?:algum\s+)?report\b/i.test(message) ||
      /\bver\s+avarias?\b/i.test(message)
    );
    if (isReports) return handleReportsCommand(from, empresaId);

    // Detectar intenção de lançar despesa — padrões claros apenas
    // Evita falsos positivos como "saída do caixa de ontem" ou "ver saída"
    const isSaida = (
      /^(sa[íi]da|despesa|gasto|desp)$/i.test(command) ||                                         // comando exato
      /\b(sa[íi]da|despesa)\s+[\d,\.]/i.test(message) ||                                          // "saída 50", "despesa 120,50"
      /\b(gastei|paguei|comprei)\b/i.test(message) ||                                             // verbos de gasto
      /\b(nova\s+sa[íi]da|lan[çc]ar\s+sa[íi]da|lan[çc]ar\s+despesa|registrar?\s+(sa[íi]da|despesa))\b/i.test(message) ||
      /\badiantamento\s+(?:de\s+)?[\d,\.]/i.test(message) ||                                      // "adiantamento de 200"
      /\b(sa[íi]da|despesa)\s+d[eo]\s+\w/i.test(message)                                          // "saída de gasolina"
    );
    if (isSaida) return handleSaidaWhatsapp(message, from, senderName, empresaId);

    if (command === 'ordens')    return handleOrdensAtivas(empresaId, user);
    if (command === 'resumo')    return handleResumoCommand(empresaId);
    if (command === 'lavadores') return handleLavadoresCommand(empresaId);
    if (command === 'caixa')     return handleCaixaCommand(empresaId);
    if (command === 'pendentes') return handlePendentesCommand(empresaId);
    if (command === 'patio' || command === 'pátio') return handlePatioCommand(empresaId);
    if (command === 'ajuda')     return handleAjudaCommand();
    if (command === 'empresa')   return `📍 *${empresaNome}*\n_Envie "trocar empresa" para mudar._`;

    // Fechamento de caixa
    const isFechamento = /\bfechamento\b|\bfechament[oa]\b|\babertura\b/i.test(message);
    if (isFechamento) {
      const dataFech = parseDateFromMessage(message) ?? new Date();
      return handleFechamentoCaixa(empresaId, dataFech);
    }

    const pixMatch = message.trim().match(/^(?:pix|pagamento)(?:\s+ordem)?\s+(\d+)$/i);
    if (pixMatch) return handlePixOrdem(parseInt(pixMatch[1]), empresaId, from, user, false);

    const reenviarMatch = message.trim().match(/^reenviar\s+pix(?:\s+ordem)?\s+(\d+)$/i);
    if (reenviarMatch) return handlePixOrdem(parseInt(reenviarMatch[1]), empresaId, from, user, true);

    // Consulta conversacional sobre lavador ("como tá o Felipe?", "como anda o João?")
    // → passa dados pro Groq para resposta pessoal e descontraída
    const isConversacionalLavador = /\b(como\s+(est[aá]|t[aá]|anda|vai|foi|est[aá]\s+indo|t[aá]\s+indo)|e\s+o\s+\w|e\s+a\s+\w|t[aá]\s+indo\s+bem)\b/i.test(message);

    if (isConversacionalLavador) {
      const ctxLavador = await buildContextLavadorConversacional(message, empresaId);
      if (ctxLavador) return chatCompletion(message, ctxLavador);
    }

    const lavadorResponse = await handleLavadorEspecifico(message, empresaId);
    if (lavadorResponse) return lavadorResponse;

    // Só constrói o contexto pesado quando vai para a IA
    let dailyContext = await buildDailyContext(empresaId);

    // Se a mensagem menciona uma data passada específica, enriquecer o contexto com dados daquele dia
    const dataReferenciada = parseDateFromMessage(message);
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    if (dataReferenciada && dataReferenciada < hoje) {
      const ctxExtra = await buildContextForDate(empresaId, dataReferenciada);
      dailyContext += ctxExtra;
    }

    return chatCompletion(message, dailyContext);

  } catch (error) {
    console.error('[WhatsApp] Erro ao processar mensagem:', error);
    return '❌ Desculpe, ocorreu um erro. Tente novamente.';
  }
}

const NUM_EMOJIS = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

function buildEmpresaMenu(empresas: Array<{ id: string; nome: string }>, header: string): string {
  const lista = empresas.map((e, i) => `${NUM_EMOJIS[i] ?? `${i+1}.`} *${e.nome}*`).join('\n');
  return `${header}\n\n${lista}\n\n_Responda com o número._`;
}

// ==========================================
// PARSING DE DATA
// ==========================================

const DIAS_SEMANA = ['domingo','segunda','terça','quarta','quinta','sexta','sábado','sabado','terca'];

function parseDateFromMessage(message: string): Date | null {
  const msg = message.toLowerCase();

  if (/antes\s+de\s+ontem|anteontem/i.test(msg)) {
    const d = new Date(); d.setDate(d.getDate() - 2); d.setHours(0,0,0,0); return d;
  }
  if (/\bontem\b/.test(msg)) {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0); return d;
  }
  if (/\bhoje\b/.test(msg)) {
    const d = new Date(); d.setHours(0,0,0,0); return d;
  }

  // Dia da semana passado: "sábado passado", "última sexta", "segunda passada", etc.
  const diasMap: Record<string, number> = {
    'domingo': 0, 'segunda': 1, 'terca': 2, 'quarta': 3,
    'quinta': 4, 'sexta': 5, 'sabado': 6,
  };
  const diaPassadoMatch = msg.match(
    /\b(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)\b.{0,25}?\b(passad[oa]|[uú]ltim[oa])\b|\b([uú]ltim[oa])\b.{0,15}?\b(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)\b/i
  );
  if (diaPassadoMatch) {
    const diaRaw = (diaPassadoMatch[1] || diaPassadoMatch[4] || '')
      .toLowerCase().replace(/[áà]/g, 'a').replace(/ç/g, 'c').replace(/ã/g, 'a');
    const targetDay = diasMap[diaRaw];
    if (targetDay !== undefined) {
      const currentDay = new Date().getDay();
      let daysBack = currentDay - targetDay;
      if (daysBack <= 0) daysBack += 7;
      const d = new Date(); d.setDate(d.getDate() - daysBack); d.setHours(0,0,0,0);
      return d;
    }
  }

  // dd/mm ou dd/mm/yy ou dd/mm/yyyy
  const m = msg.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    const day = parseInt(m[1]);
    const month = parseInt(m[2]) - 1;
    const rawYear = m[3];
    const year = rawYear
      ? (rawYear.length === 2 ? 2000 + parseInt(rawYear) : parseInt(rawYear))
      : new Date().getFullYear();
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) { d.setHours(0,0,0,0); return d; }
  }

  return null;
}

/**
 * Extrai intervalo de datas da mensagem para relatórios de período.
 * Suporta: "do dia 10/01 ao dia 15/01", "de 10/01 a 15/01",
 *          "semanal", "da semana", "últimos 7 dias", "últimos N dias"
 */
function parseDateRangeFromMessage(message: string): { inicio: Date; fim: Date } | null {
  const msg = message.toLowerCase();

  // Semanal / últimos 7 dias / esta semana
  if (/semanal|[uú]ltimos\s+7\s+dias|\besta\s+semana\b|\bda\s+semana\b/.test(msg)) {
    const fim = new Date(); fim.setHours(23, 59, 59, 999);
    const inicio = new Date(); inicio.setDate(inicio.getDate() - 6); inicio.setHours(0, 0, 0, 0);
    return { inicio, fim };
  }

  // Últimos N dias (ex: "últimos 10 dias")
  const nDiasMatch = msg.match(/[uú]ltimos\s+(\d+)\s+dias/);
  if (nDiasMatch) {
    const n = parseInt(nDiasMatch[1]);
    if (n >= 2 && n <= 365) {
      const fim = new Date(); fim.setHours(23, 59, 59, 999);
      const inicio = new Date(); inicio.setDate(inicio.getDate() - (n - 1)); inicio.setHours(0, 0, 0, 0);
      return { inicio, fim };
    }
  }

  // Duas datas: "10/01 ao 15/01", "de 10/01 a 15/01", "do dia 10/01 até 15/01"
  const twoDateMatch = msg.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)[\s\S]{0,20}?(?:\bao?\b|\baté\b|\ba\b)[\s\S]{0,10}?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
  if (twoDateMatch) {
    const parseSingle = (s: string): Date | null => {
      const parts = s.split('/');
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      const rawYear = parts[2];
      const year = rawYear
        ? (rawYear.length === 2 ? 2000 + parseInt(rawYear) : parseInt(rawYear))
        : new Date().getFullYear();
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
    };
    const d1 = parseSingle(twoDateMatch[1]);
    const d2 = parseSingle(twoDateMatch[2]);
    if (d1 && d2 && d1 <= d2) {
      d1.setHours(0, 0, 0, 0);
      d2.setHours(23, 59, 59, 999);
      return { inicio: d1, fim: d2 };
    }
  }

  return null;
}

function extrairNomeLavador(message: string): string | null {
  // "comissão em aberto do carlos" → "carlos"
  const m = message.match(/\b(?:do|da|de)\s+([a-záéíóúâêîôûãõç]+(?:\s+[a-záéíóúâêîôûãõç]+)?)/i);
  if (m) {
    const nome = m[1].toLowerCase();
    // Ignorar palavras que não são nomes
    if (!['comissao','comissão','aberto','abertas','mes','dia','hoje'].includes(nome)) {
      return nome;
    }
  }
  return null;
}

function nomeDiaSemana(date: Date): string {
  return ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][date.getDay()];
}

function formatarMetodo(metodo: string): string {
  const map: Record<string, string> = {
    PIX: 'PIX', DINHEIRO: 'DINHEIRO', CARTAO: 'CARTÃO',
    CARTAO_CREDITO: 'CARTÃO CRÉDITO', CARTAO_DEBITO: 'CARTÃO DÉBITO',
    NFE: 'NFE/FROTA', OUTRO: 'OUTRO', PENDENTE: 'PENDENTE',
    DEBITO_FUNCIONARIO: 'DÉB. FUNCIONÁRIO',
  };
  return map[metodo] ?? metodo;
}

// ==========================================
// RELATÓRIO DETALHADO DE UM DIA
// ==========================================

async function handleRelatorioData(date: Date, empresaId: string): Promise<string> {
  // Janela fixa 07:00–23:59 BRT da data solicitada
  const dateStr = new Date(date.getTime() - 3 * 3600000).toISOString().split('T')[0];
  const { start: inicio, end: fim } = getFixedDayRangeBRT(dateStr);

  const ordens = await prisma.ordemServico.findMany({
    where: { empresaId, status: 'FINALIZADO' as any, dataFim: { gte: inicio, lte: fim } },
    include: {
      veiculo:  { select: { modelo: true } },
      lavador:  { select: { nome: true, comissao: true } },
      ordemLavadores: { include: { lavador: { select: { nome: true, comissao: true } } } },
      pagamentos: { select: { metodo: true, valor: true, status: true } },
    },
    orderBy: { dataFim: 'asc' },
  });

  if (ordens.length === 0) {
    return `📋 Sem ordens registradas em ${inicio.toLocaleDateString('pt-BR')}.`;
  }

  const dataFmt = inicio.toLocaleDateString('pt-BR');
  const diaSemana = nomeDiaSemana(inicio);

  // Linha por ordem
  let linhas = '';
  for (const o of ordens) {
    const modelo = o.veiculo.modelo ?? 'Veículo';
    const pagMethods = o.pagamentos.length > 0
      ? o.pagamentos.map(p => formatarMetodo(p.metodo)).join('/')
      : 'PENDENTE';
    linhas += `${modelo.toUpperCase()}: R$ ${o.valorTotal.toFixed(2)} · *${pagMethods}*\n`;
  }

  const total = ordens.reduce((s, o) => s + o.valorTotal, 0);

  // Totais por método de pagamento
  const porMetodo: Record<string, number> = {};
  for (const o of ordens) {
    if (o.pagamentos.length === 0) {
      porMetodo['PENDENTE'] = (porMetodo['PENDENTE'] ?? 0) + o.valorTotal;
    } else {
      for (const p of o.pagamentos) {
        const m = formatarMetodo(p.metodo);
        porMetodo[m] = (porMetodo[m] ?? 0) + p.valor;
      }
    }
  }
  const pagamentosFmt = Object.entries(porMetodo)
    .map(([m, v]) => `${m}: *R$ ${v.toFixed(2)}*`)
    .join('\n');

  // Comissões por lavador com breakdown
  const comissoesPorLavador: Record<string, { taxa: number; total: number; itens: string[] }> = {};
  for (const o of ordens) {
    // Usar ordemLavadores se existir, senão o lavadorId principal
    const lavs = o.ordemLavadores.length > 0
      ? o.ordemLavadores.map(ol => ol.lavador)
      : o.lavador ? [o.lavador] : [];

    for (const lav of lavs) {
      if (!comissoesPorLavador[lav.nome]) {
        comissoesPorLavador[lav.nome] = { taxa: lav.comissao, total: 0, itens: [] };
      }
      const comValor = o.valorTotal * (lav.comissao / 100);
      comissoesPorLavador[lav.nome].total += comValor;
      comissoesPorLavador[lav.nome].itens.push(
        `${(o.veiculo.modelo ?? 'Veículo').toUpperCase()}: *${comValor.toFixed(2)}*`
      );
    }
  }

  let comissoesFmt = '';
  for (const [nome, dados] of Object.entries(comissoesPorLavador)) {
    comissoesFmt += `\n*${nome.toUpperCase()}*: *R$ ${dados.total.toFixed(2)}*\n`;
    comissoesFmt += `(${dados.itens.join(' + ')})\n`;
  }

  return `📋 *RELATÓRIO DE SERVIÇOS*\n` +
    `_${dataFmt} - ${diaSemana}_\n\n` +
    `${linhas}\n` +
    `TOTAL: *R$ ${total.toFixed(2)}* | *${ordens.length}* lavagem(ns)\n\n` +
    `📊 PAGAMENTOS:\n${pagamentosFmt}\n\n` +
    `👷 COMISSÕES (por serviço):\n${comissoesFmt}`;
}

// ==========================================
// RELATÓRIO DE PERÍODO (vários dias)
// ==========================================

async function handleRelatorioPeriodo(inicio: Date, fim: Date, empresaId: string): Promise<string> {
  // Âncora: dataFim (quando o serviço foi concluído) — só ordens FINALIZADAS
  const ordens = await prisma.ordemServico.findMany({
    where: { empresaId, status: 'FINALIZADO' as any, dataFim: { gte: inicio, lte: fim } },
    include: {
      veiculo:  { select: { modelo: true } },
      lavador:  { select: { nome: true, comissao: true } },
      ordemLavadores: { include: { lavador: { select: { nome: true, comissao: true } } } },
      pagamentos: { select: { metodo: true, valor: true } },
    },
    orderBy: { dataFim: 'asc' },
  });

  const iniciofmt = inicio.toLocaleDateString('pt-BR');
  const fimfmt    = fim.toLocaleDateString('pt-BR');
  const diasCount = Math.round((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const titulo    = iniciofmt === fimfmt ? `*${iniciofmt}*` : `*${iniciofmt} a ${fimfmt}* (${diasCount} dias)`;

  if (ordens.length === 0) {
    return `📋 Sem ordens finalizadas de ${iniciofmt} a ${fimfmt}.`;
  }

  // Agrupamento por dia de finalização (dataFim em BRT)
  const porDia = new Map<string, { date: Date; ordens: typeof ordens; total: number }>();
  for (const o of ordens) {
    const dataRef = o.dataFim ?? o.createdAt;
    const chave = dataRef.toLocaleDateString('pt-BR');
    if (!porDia.has(chave)) porDia.set(chave, { date: dataRef, ordens: [], total: 0 });
    const d = porDia.get(chave)!;
    d.ordens.push(o);
    d.total += o.valorTotal;
  }

  // Abreviações de dia da semana
  const DIA_ABREV = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  // Cabeçalho
  let r = `📊 RELATÓRIO DO PERÍODO\n${titulo}\n\n`;

  // Breakdown por dia
  r += `📅 POR DIA:\n`;
  for (const [chave, d] of porDia) {
    const abrev = DIA_ABREV[d.date.getDay()];
    r += `${chave} (${abrev}): *R$ ${d.total.toFixed(2)}* | ${d.ordens.length} lavagem(ns)\n`;
  }

  // Totais gerais
  const totalFat    = ordens.reduce((s, o) => s + o.valorTotal, 0);
  const totalOrdens = ordens.length;
  r += `\nTOTAL: *R$ ${totalFat.toFixed(2)}* | *${totalOrdens}* lavagem(ns)\n`;

  // Faturamento por método de pagamento
  const porMetodo: Record<string, number> = {};
  for (const o of ordens) {
    if (o.pagamentos.length === 0) {
      porMetodo['PENDENTE'] = (porMetodo['PENDENTE'] ?? 0) + o.valorTotal;
    } else {
      for (const p of o.pagamentos) {
        const m = formatarMetodo(p.metodo);
        porMetodo[m] = (porMetodo[m] ?? 0) + p.valor;
      }
    }
  }
  r += `\n💳 PAGAMENTOS:\n`;
  r += Object.entries(porMetodo).map(([m, v]) => `${m}: *R$ ${v.toFixed(2)}*`).join('\n');

  // Saídas de caixa no período
  const saidas = await prisma.caixaRegistro.findMany({
    where: { empresaId, tipo: 'SAIDA', data: { gte: inicio, lte: fim } },
    orderBy: { data: 'asc' },
  });
  const totalSaidas = saidas.reduce((s, c) => s + c.valor, 0);
  if (totalSaidas > 0) {
    r += `\n\n💸 SAÍDAS DE CAIXA: *R$ ${totalSaidas.toFixed(2)}*`;
    // Listar saídas se forem poucas
    if (saidas.length <= 6) {
      for (const s of saidas) {
        r += `\n  ${s.descricao}: *R$ ${s.valor.toFixed(2)}*`;
      }
    } else {
      r += ` (${saidas.length} lançamentos)`;
    }
  }

  // Lucro líquido estimado
  const lucro = totalFat - totalSaidas;
  r += `\n\n💰 LUCRO ESTIMADO: *R$ ${lucro.toFixed(2)}*`;

  // Comissões totais por lavador no período
  const comissoesPorLavador: Record<string, { taxa: number; total: number }> = {};
  for (const o of ordens) {
    const lavs = o.ordemLavadores.length > 0
      ? o.ordemLavadores.map(ol => ol.lavador)
      : o.lavador ? [o.lavador] : [];
    for (const lav of lavs) {
      if (!comissoesPorLavador[lav.nome]) {
        comissoesPorLavador[lav.nome] = { taxa: lav.comissao, total: 0 };
      }
      comissoesPorLavador[lav.nome].total += o.valorTotal * (lav.comissao / 100);
    }
  }

  if (Object.keys(comissoesPorLavador).length > 0) {
    r += `\n\n👷 COMISSÕES DO PERÍODO:\n`;
    for (const [nome, dados] of Object.entries(comissoesPorLavador)) {
      r += `*${nome.toUpperCase()}* (${dados.taxa}%): *R$ ${dados.total.toFixed(2)}*\n`;
    }
    const totalComissoes = Object.values(comissoesPorLavador).reduce((s, d) => s + d.total, 0);
    r += `Total: *R$ ${totalComissoes.toFixed(2)}*`;
  }

  return r.trim();
}

// ==========================================
// SAÍDAS DETALHADAS
// ==========================================

async function handleSaidasDetalhadas(inicio: Date, fim: Date, empresaId: string): Promise<string> {
  const saidas = await prisma.caixaRegistro.findMany({
    where: {
      empresaId,
      tipo: 'SAIDA',
      data: { gte: inicio, lte: fim },
      // Excluir vales (adiantamentos) — registros vinculados a um Adiantamento
      adiantamento: null,
      // Excluir por descrição padrão de vale/comissão como fallback
      NOT: [
        { descricao: { startsWith: 'Adiantamento' } },
        { descricao: { startsWith: 'Comissão' } },
        { descricao: { startsWith: 'Comissao' } },
      ],
    },
    orderBy: { data: 'asc' },
  });

  const iniciofmt = inicio.toLocaleDateString('pt-BR');
  const fimfmt    = fim.toLocaleDateString('pt-BR');
  const titulo    = iniciofmt === fimfmt ? `_${iniciofmt}_` : `_${iniciofmt} a ${fimfmt}_`;

  if (saidas.length === 0) return `💸 *SAÍDAS*\n${titulo}\n\nNenhuma saída registrada.`;

  let r = `💸 *SAÍDAS*\n${titulo}\n\n`;
  for (const s of saidas) {
    const data = s.data.toLocaleDateString('pt-BR');
    const dataLabel = iniciofmt !== fimfmt ? `${data} · ` : '';
    r += `• ${dataLabel}${s.descricao}: *R$ ${s.valor.toFixed(2)}*\n`;
  }
  const total = saidas.reduce((acc, s) => acc + s.valor, 0);
  r += `\nTotal: *R$ ${total.toFixed(2)}* (${saidas.length} lançamento(s))`;
  return r.trim();
}

// ==========================================
// VALES EM ABERTO POR LAVADOR
// ==========================================

async function handleValesLavador(nomeLavador: string, empresaId: string): Promise<string> {
  const lavadores = await prisma.lavador.findMany({ where: { empresaId, ativo: true } });
  const lav = lavadores.find(l =>
    l.nome.toLowerCase().includes(nomeLavador) ||
    nomeLavador.includes(l.nome.toLowerCase())
  );
  if (!lav) return `❌ Lavador "${nomeLavador}" não encontrado.`;

  const vales = await (prisma.adiantamento as any).findMany({
    where: { lavadorId: lav.id, status: 'PENDENTE' },
    include: { caixaRegistro: { select: { descricao: true } } },
    orderBy: { data: 'asc' },
  });

  if (vales.length === 0) return `✅ *${lav.nome}* não tem vales em aberto.`;

  let r = `💵 *VALES EM ABERTO — ${lav.nome.toUpperCase()}*\n\n`;
  for (const v of vales) {
    const descricaoCaixa = v.caixaRegistro?.descricao ?? '';
    const partes = descricaoCaixa.split(' — ');
    const desc = partes.length > 1 ? partes[1] : (v.descricao ?? 'Vale');
    const data = new Date(v.data).toLocaleDateString('pt-BR');
    r += `• ${data} · ${desc}: *R$ ${v.valor.toFixed(2)}*\n`;
  }
  const total = vales.reduce((acc: number, v: any) => acc + v.valor, 0);
  r += `\nTotal em aberto: *R$ ${total.toFixed(2)}* (${vales.length} vale(s))`;
  return r.trim();
}

// ==========================================
// COMISSÕES EM ABERTO
// ==========================================

async function handleComissoesEmAberto(
  nomeLavador: string | null,
  empresaId: string
): Promise<string> {
  const lavadores = await prisma.lavador.findMany({
    where: { empresaId, ativo: true },
  });

  // Filtrar lavador se nome foi fornecido
  const lavadoresFiltrados = nomeLavador
    ? lavadores.filter(l =>
        l.nome.toLowerCase().includes(nomeLavador) ||
        nomeLavador.includes(l.nome.toLowerCase())
      )
    : lavadores;

  if (lavadoresFiltrados.length === 0) {
    return `❌ Lavador não encontrado: "${nomeLavador}".`;
  }

  let resultado = nomeLavador
    ? ''
    : `💰 COMISSÕES EM ABERTO\n\n`;

  for (const lav of lavadoresFiltrados) {
    // Ordens finalizadas sem fechamento de comissão
    const ordens = await prisma.ordemServico.findMany({
      where: {
        empresaId,
        status: 'FINALIZADO',
        OR: [
          // Lavador principal sem fechamento
          { lavadorId: lav.id, fechamentoComissaoId: null },
          // Multi-lavador: entrada na tabela pivot sem fechamento
          {
            ordemLavadores: {
              some: { lavadorId: lav.id, fechamentoComissaoId: null },
            },
          },
        ],
      },
      include: {
        veiculo: { select: { modelo: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (ordens.length === 0) {
      resultado += `✅ *${lav.nome.toUpperCase()}*: sem comissões em aberto.\n\n`;
      continue;
    }

    const totalFat = ordens.reduce((s, o) => s + o.valorTotal, 0);
    const totalCom = totalFat * (lav.comissao / 100);

    // Adiantamentos pendentes desse lavador
    const adiantamentos = await prisma.adiantamento.findMany({
      where: { lavadorId: lav.id, status: 'PENDENTE' },
    });
    const totalAdiant = adiantamentos.reduce((s, a) => s + a.valor, 0);
    const comLiquida = totalCom - totalAdiant;

    // Agrupar por mês
    const porMes: Record<string, number> = {};
    for (const o of ordens) {
      const mes = o.createdAt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      porMes[mes] = (porMes[mes] ?? 0) + o.valorTotal * (lav.comissao / 100);
    }
    const porMesFmt = Object.entries(porMes)
      .map(([m, v]) => `  *${m}*: *R$ ${v.toFixed(2)}*`)
      .join('\n');

    // Comparação com mês anterior (quando consultando lavador específico)
    let comparacaoFmt = '';
    if (nomeLavador) {
      const hoje = new Date();
      const inicioMesAtual  = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const inicioMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      const fimMesAnterior    = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59);
      const [ordensAtual, ordensAnterior] = await Promise.all([
        prisma.ordemServico.findMany({
          where: { empresaId, status: 'FINALIZADO', OR: [{ lavadorId: lav.id }, { ordemLavadores: { some: { lavadorId: lav.id } } }], createdAt: { gte: inicioMesAtual } },
        }),
        prisma.ordemServico.findMany({
          where: { empresaId, status: 'FINALIZADO', OR: [{ lavadorId: lav.id }, { ordemLavadores: { some: { lavadorId: lav.id } } }], createdAt: { gte: inicioMesAnterior, lte: fimMesAnterior } },
        }),
      ]);
      const fatAtual    = ordensAtual.reduce((s, o) => s + o.valorTotal, 0) * (lav.comissao / 100);
      const fatAnterior = ordensAnterior.reduce((s, o) => s + o.valorTotal, 0) * (lav.comissao / 100);
      if (fatAnterior > 0) {
        const diff = fatAtual - fatAnterior;
        const emoji = diff >= 0 ? '📈' : '📉';
        const sinal = diff >= 0 ? '+' : '';
        comparacaoFmt = `\n${emoji} vs mês passado: ${sinal}R$ ${diff.toFixed(2)}`;
      }
    }

    // Listar ordens individualmente
    const ordensDetalhe = ordens.slice(0, 10).map(o => {
      const modelo = (o.veiculo?.modelo ?? 'Veículo').toUpperCase();
      const data = o.createdAt.toLocaleDateString('pt-BR');
      const com = o.valorTotal * (lav.comissao / 100);
      return `  • ${data} · ${modelo}: *R$ ${com.toFixed(2)}*`;
    }).join('\n');
    const maisLabel = ordens.length > 10 ? `\n  _...e mais ${ordens.length - 10} ordens_` : '';

    resultado += `👤 *${lav.nome.toUpperCase()}* (${lav.comissao}%)\n` +
      `Comissão bruta: *R$ ${totalCom.toFixed(2)}*\n` +
      `Adiantamentos: *R$ ${totalAdiant.toFixed(2)}*\n` +
      `A receber: *R$ ${comLiquida.toFixed(2)}*` +
      comparacaoFmt +
      `\n\nOrdens (${ordens.length}):\n${ordensDetalhe}${maisLabel}\n\n`;
  }

  return resultado.trim();
}

// ==========================================
// FECHAMENTO DE CAIXA
// ==========================================

async function handleFechamentoCaixa(empresaId: string, data: Date): Promise<string> {
  const inicio = new Date(data); inicio.setHours(0,0,0,0);
  const fim    = new Date(data); fim.setHours(23,59,59,999);
  const dataFmt = inicio.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'2-digit', year:'numeric' });

  const [fechamento, abertura, registros] = await Promise.all([
    prisma.fechamentoCaixa.findFirst({
      where: { empresaId, data: { gte: inicio, lte: fim } },
      orderBy: { data: 'desc' },
    }),
    prisma.aberturaCaixa.findFirst({
      where: { empresaId, data: { gte: inicio, lte: fim } },
      orderBy: { data: 'asc' },
    }),
    prisma.caixaRegistro.findMany({
      where: { empresaId, data: { gte: inicio, lte: fim } },
    }),
  ]);

  const entradas = registros.filter(r => r.tipo === 'ENTRADA').reduce((s,r) => s + r.valor, 0);
  const saidas   = registros.filter(r => r.tipo === 'SAIDA').reduce((s,r) => s + r.valor, 0);
  const saldo    = entradas - saidas;

  let r = `📅 *${dataFmt.toUpperCase()}*\n\n`;

  // Abertura
  if (abertura) {
    r += `🔓 Abertura: *R$ ${abertura.valorInicial.toFixed(2)}*\n`;
  } else {
    r += `🔓 Abertura: _não registrada_\n`;
  }

  // Movimento do dia
  r += `\n💰 Movimento:\n`;
  r += `Entradas: *R$ ${entradas.toFixed(2)}*\n`;
  r += `Saídas: *R$ ${saidas.toFixed(2)}*\n`;
  r += `Saldo: *R$ ${saldo.toFixed(2)}*\n`;

  // Fechamento
  if (!fechamento) {
    r += `\n🔒 Fechamento: _não realizado neste dia_`;
    return r.trim();
  }

  r += `\n🔒 *Fechamento:*\n`;
  r += `PIX: *R$ ${fechamento.pix.toFixed(2)}*\n`;
  r += `Dinheiro: *R$ ${fechamento.dinheiro.toFixed(2)}*\n`;
  r += `Cartão: *R$ ${fechamento.cartao.toFixed(2)}*\n`;
  if (fechamento.nfe) r += `NFe: *R$ ${fechamento.nfe.toFixed(2)}*\n`;

  const totalDigitado = fechamento.pix + fechamento.dinheiro + fechamento.cartao + (fechamento.nfe ?? 0);
  r += `Total digitado: *R$ ${totalDigitado.toFixed(2)}*\n`;

  // Divergência
  if (Math.abs(fechamento.diferenca) > 0.01) {
    const sinal = fechamento.diferenca > 0 ? '📈 Sobra' : '📉 Falta';
    r += `\n${sinal}: *R$ ${Math.abs(fechamento.diferenca).toFixed(2)}*`;
    if (fechamento.observacao) r += `\n_Obs: ${fechamento.observacao}_`;
  } else {
    r += `\n✅ Sem divergência`;
  }

  return r.trim();
}

// ==========================================
// PÁTIO (CARROS ATIVOS)
// ==========================================

async function handlePatioCommand(empresaId: string): Promise<string> {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const amanha = new Date(hoje);
  amanha.setDate(amanha.getDate() + 1);

  const ordensAtivas = await prisma.ordemServico.findMany({
    where: {
      empresaId,
      status: 'EM_ANDAMENTO',
      createdAt: { gte: hoje, lt: amanha },
    },
    include: {
      veiculo: { select: { modelo: true, placa: true } },
      cliente: { select: { nome: true } },
      lavador: { select: { nome: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (ordensAtivas.length === 0) {
    return `🅿️ PÁTIO\n\n✅ Nenhum carro em lavagem no momento.`;
  }

  let resultado = `🅿️ PÁTIO - CARROS ATIVOS\n\n`;

  for (const ordem of ordensAtivas) {
    const horarioEntrada = ordem.dataInicio?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      ?? ordem.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    resultado += `🚗 *${(ordem.veiculo.modelo ?? 'Veículo').toUpperCase()}* (${ordem.veiculo.placa})\n`;
    resultado += `  Cliente: ${ordem.cliente.nome}\n`;
    resultado += `  Entrada: *${horarioEntrada}*\n`;
    resultado += `  Lavador: ${ordem.lavador?.nome ?? '(sem atribuição)'}\n`;
    resultado += `  Valor: *R$ ${ordem.valorTotal.toFixed(2)}*\n\n`;
  }

  return resultado.trim();
}

// ==========================================
// HANDLERS ESPECÍFICOS PARA LAVADOR
// ==========================================

async function handleStatusLavador(lavadorId: string, empresaId: string): Promise<string> {
  const { start: diaStart, end: diaEnd } = getTodayFixedRangeBRT();
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimMes    = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

  const lavador = await prisma.lavador.findUnique({ where: { id: lavadorId } });
  if (!lavador) return '❌ Erro ao buscar seus dados.';

  const [ordensDia, ordensMes] = await Promise.all([
    prisma.ordemServico.findMany({
      where: { empresaId, lavadorId, status: { not: 'CANCELADO' }, dataFim: { gte: diaStart, lte: diaEnd } },
    }),
    prisma.ordemServico.findMany({
      where: { empresaId, lavadorId, status: { not: 'CANCELADO' }, dataFim: { gte: inicioMes, lte: fimMes } },
    }),
  ]);

  const fatDia      = ordensDia.reduce((s, o) => s + o.valorTotal, 0);
  const comDia      = fatDia * (lavador.comissao / 100);
  const fatMes      = ordensMes.reduce((s, o) => s + o.valorTotal, 0);
  const comBrutaMes = fatMes * (lavador.comissao / 100);

  const portalLink = await getLinkPortal(lavadorId);

  let msg = `Olá, *${lavador.nome}*! 👋\n\n`;
  msg += `💰 Sua comissão bruta este mês: *R$ ${comBrutaMes.toFixed(2)}*\n`;
  msg += `📅 Hoje: *${ordensDia.length} ${ordensDia.length === 1 ? 'ordem' : 'ordens'}* · comissão *R$ ${comDia.toFixed(2)}*\n\n`;
  msg += portalLink
    ? `Para ver o detalhamento completo, acesse seu portal:\n🔗 ${portalLink}`
    : `Para mais informações, peça o seu link de acesso ao gerente.`;

  return msg;
}

async function handleLinkLavador(lavadorId: string): Promise<string> {
  const link = await getLinkPortal(lavadorId);
  if (!link) return '❌ Seu portal não está disponível. Contate o gerente.';
  return `🔗 *Seu portal pessoal:*\n\n${link}\n\n_Acesse aqui para ver suas ordens, extrato e histórico completo._`;
}

async function getLinkPortal(lavadorId: string): Promise<string | null> {
  if (!PORTAL_URL) return null;
  const rows = await prisma.$queryRaw<Array<{ linkTokenCurto: string | null }>>`
    SELECT "linkTokenCurto" FROM "lavadores" WHERE "id" = ${lavadorId}
  `;
  const token = rows[0]?.linkTokenCurto;
  if (!token) return null;
  return `${PORTAL_URL}/p.html?token=${token}`;
}

/*
 * Suas comissões em aberto (apenas do lavador)
 */
async function handleComissoesLavador(lavadorId: string, empresaId: string): Promise<string> {
  const lavador = await prisma.lavador.findUnique({
    where: { id: lavadorId },
  });

  if (!lavador) return '❌ Erro ao buscar dados.';

  const ordens = await prisma.ordemServico.findMany({
    where: {
      empresaId,
      status: 'FINALIZADO',
      OR: [
        { lavadorId, fechamentoComissaoId: null },
        {
          ordemLavadores: {
            some: { lavadorId, fechamentoComissaoId: null },
          },
        },
      ],
    },
  });

  if (ordens.length === 0) {
    return `✅ *${lavador.nome}*, você não possui comissões em aberto.`;
  }

  const totalFat = ordens.reduce((s, o) => s + o.valorTotal, 0);
  const totalCom = totalFat * (lavador.comissao / 100);

  // Agrupar por mês
  const porMes: Record<string, number> = {};
  for (const o of ordens) {
    const mes = o.createdAt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    porMes[mes] = (porMes[mes] ?? 0) + o.valorTotal * (lavador.comissao / 100);
  }
  const porMesFmt = Object.entries(porMes)
    .map(([m, v]) => `  *${m}*: *R$ ${v.toFixed(2)}*`)
    .join('\n');

  return `💰 SUAS COMISSÕES EM ABERTO\n\n` +
    `Ordens finalizadas: *${ordens.length}*\n` +
    `Faturamento total: *R$ ${totalFat.toFixed(2)}*\n` +
    `Comissão a receber (${lavador.comissao}%): *R$ ${totalCom.toFixed(2)}*\n\n` +
    `Por mês:\n${porMesFmt}`;
}

function handleAjudaLavador(): string {
  return `Oi! Aqui vai o que eu consigo fazer por você 😊\n\n` +
    `*status* — sua comissão do dia e do mês\n` +
    `*comissoes* — comissões em aberto\n` +
    `*link* — acessar seu portal pessoal\n` +
    `*reportar* — avisar uma avaria no veículo\n` +
    `*pix [nº]* — gerar QR Code PIX de uma ordem\n` +
    `*reenviar pix [nº]* — reenviar um QR já gerado\n\n` +
    `Qualquer dúvida é só me chamar aqui, tá?`;
}

// ==========================================
// CONTEXTO COMPLETO PARA IA
// ==========================================

/*
 * Constrói contexto com dados do dia E do mês para a IA responder qualquer período
 */
async function buildContextForDate(empresaId: string, date: Date): Promise<string> {
  try {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const { start, end } = getDateRangeBRT(dateStr);

    const [ordens, caixa, lavadores] = await Promise.all([
      prisma.ordemServico.findMany({
        where: { empresaId, status: { not: 'CANCELADO' as any }, dataFim: { gte: start, lte: end } },
        include: { lavador: { select: { nome: true } } },
      }),
      prisma.caixaRegistro.findMany({ where: { empresaId, data: { gte: start, lte: end } } }),
      prisma.lavador.findMany({ where: { empresaId, ativo: true } }),
    ]);

    const dataLabel = date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const fat = ordens.reduce((s, o) => s + o.valorTotal, 0);
    const entradas = caixa.filter(c => c.tipo === 'ENTRADA').reduce((s, c) => s + c.valor, 0);
    const saidas   = caixa.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);

    let ctx = `\n=== ${dataLabel.toUpperCase()} ===\n`;
    ctx += `Ordens: ${ordens.length} | Faturamento: R$ ${fat.toFixed(2)}\n`;
    ctx += `Finalizadas: ${ordens.filter(o => o.status === 'FINALIZADO').length} | Em andamento: ${ordens.filter(o => o.status === 'EM_ANDAMENTO').length}\n`;
    ctx += `Caixa: Entradas R$ ${entradas.toFixed(2)} | Saídas R$ ${saidas.toFixed(2)} | Saldo R$ ${(entradas - saidas).toFixed(2)}\n`;

    for (const lav of lavadores) {
      const ords = ordens.filter(o => o.lavadorId === lav.id);
      if (ords.length > 0) {
        const fatLav = ords.reduce((s, o) => s + o.valorTotal, 0);
        ctx += `• ${lav.nome}: ${ords.length} ordem(ns), R$ ${fatLav.toFixed(2)}\n`;
      }
    }

    return ctx;
  } catch {
    return '';
  }
}

async function buildDailyContext(empresaId: string): Promise<string> {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);

    // Mês atual
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

    // Mês anterior
    const inicioMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const fimMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 23, 59, 59);

    // 1. Empresa
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    if (!empresa) return 'Empresa não encontrada.';

    // 2. Lavadores ativos
    const lavadores = await prisma.lavador.findMany({
      where: { empresaId, ativo: true }
    });

    // 3. Ordens do DIA
    const ordensDia = await prisma.ordemServico.findMany({
      where: { empresaId, status: { not: 'CANCELADO' }, createdAt: { gte: hoje, lt: amanha } },
      include: {
        cliente: { select: { nome: true } },
        veiculo: { select: { placa: true, modelo: true } },
        lavador: { select: { nome: true } },
      }
    });

    // 4. Ordens do MÊS
    const ordensMes = await prisma.ordemServico.findMany({
      where: { empresaId, status: { not: 'CANCELADO' }, createdAt: { gte: inicioMes, lte: fimMes } },
      include: { lavador: { select: { nome: true } } }
    });

    // 5. Caixa do dia
    const caixaDia = await prisma.caixaRegistro.findMany({
      where: { empresaId, data: { gte: hoje, lt: amanha } }
    });
    const entradasDia = caixaDia.filter(c => c.tipo === 'ENTRADA').reduce((s, c) => s + c.valor, 0);
    const saidasDia = caixaDia.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);

    // 6. Caixa do mês
    const caixaMes = await prisma.caixaRegistro.findMany({
      where: { empresaId, data: { gte: inicioMes, lte: fimMes } }
    });
    const entradasMes = caixaMes.filter(c => c.tipo === 'ENTRADA').reduce((s, c) => s + c.valor, 0);
    const saidasMes = caixaMes.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);

    // 6b. Ordens e caixa do mês anterior
    const [ordensMesAnterior, caixaMesAnterior] = await Promise.all([
      prisma.ordemServico.findMany({
        where: { empresaId, status: { not: 'CANCELADO' }, createdAt: { gte: inicioMesAnterior, lte: fimMesAnterior } },
        include: { lavador: { select: { nome: true } } }
      }),
      prisma.caixaRegistro.findMany({
        where: { empresaId, data: { gte: inicioMesAnterior, lte: fimMesAnterior } }
      }),
    ]);

    // 7. Adiantamentos pendentes (todos, sem filtro de data)
    const adiantamentos = await prisma.adiantamento.findMany({
      where: { empresaId, status: 'PENDENTE' },
      include: { lavador: { select: { nome: true } } }
    });

    // 8. Comissões fechadas do mês (FechamentoComissao)
    let fechamentosMes: { lavadorId: string; valorPago: number; data: Date; lavador: { nome: string } }[] = [];
    try {
      fechamentosMes = await prisma.fechamentoComissao.findMany({
        where: { empresaId, data: { gte: inicioMes, lte: fimMes } },
        include: { lavador: { select: { nome: true } } }
      });
    } catch { /* ignorar se não existir */ }

    // ---- MONTAR CONTEXTO ----
    let ctx = `CONTEXTO LINA X - ${empresa.nome}\n`;
    ctx += `Data: ${hoje.toLocaleDateString('pt-BR')} | Mês: ${inicioMes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}\n\n`;

    // --- DIA ---
    ctx += `=== HOJE ===\n`;
    const fatDia = ordensDia.reduce((s, o) => s + o.valorTotal, 0);
    ctx += `Ordens: *${ordensDia.length}* | Faturamento: *R$ ${fatDia.toFixed(2)}*\n`;
    ctx += `Status: *${ordensDia.filter(o => o.status === 'FINALIZADO').length}* finalizadas, `;
    ctx += `*${ordensDia.filter(o => o.status === 'EM_ANDAMENTO').length}* em andamento, `;
    ctx += `*${ordensDia.filter(o => o.status === 'PENDENTE').length}* pendentes, `;
    ctx += `*${ordensDia.filter(o => o.status === 'AGUARDANDO_PAGAMENTO').length}* aguardando pagamento\n`;
    ctx += `Caixa: Entradas *R$ ${entradasDia.toFixed(2)}* | Saídas *R$ ${saidasDia.toFixed(2)}* | Saldo *R$ ${(entradasDia - saidasDia).toFixed(2)}*\n\n`;

    // Lavadores hoje
    ctx += `Lavadores hoje:\n`;
    for (const lav of lavadores) {
      const ords = ordensDia.filter(o => o.lavadorId === lav.id);
      const fat = ords.reduce((s, o) => s + o.valorTotal, 0);
      const com = fat * (lav.comissao / 100);
      ctx += `• *${lav.nome}*: *${ords.length}* ordem(ns), faturamento *R$ ${fat.toFixed(2)}*, comissão hoje *R$ ${com.toFixed(2)}*\n`;
    }
    ctx += '\n';

    // --- MÊS ---
    ctx += `=== MÊS ATUAL ===\n`;
    const fatMes = ordensMes.reduce((s, o) => s + o.valorTotal, 0);
    ctx += `Ordens: *${ordensMes.length}* | Faturamento total: *R$ ${fatMes.toFixed(2)}*\n`;
    ctx += `Caixa mês: Entradas *R$ ${entradasMes.toFixed(2)}* | Saídas *R$ ${saidasMes.toFixed(2)}* | Saldo *R$ ${(entradasMes - saidasMes).toFixed(2)}*\n\n`;

    // Comissões do mês por lavador
    ctx += `Comissões do mês por lavador:\n`;
    for (const lav of lavadores) {
      const ordsMes = ordensMes.filter(o => o.lavadorId === lav.id);
      const fatLav = ordsMes.reduce((s, o) => s + o.valorTotal, 0);
      const comMes = fatLav * (lav.comissao / 100);
      const adiant = adiantamentos.filter(a => a.lavadorId === lav.id).reduce((s, a) => s + a.valor, 0);
      const comLiquida = comMes - adiant;
      ctx += `• *${lav.nome}*: *${ordsMes.length}* ordem(ns), faturamento *R$ ${fatLav.toFixed(2)}*, comissão bruta *R$ ${comMes.toFixed(2)}*, adiantamentos em aberto *R$ ${adiant.toFixed(2)}*, comissão líquida *R$ ${comLiquida.toFixed(2)}*\n`;
    }
    ctx += '\n';

    // --- MÊS ANTERIOR ---
    const entradasMesAnt = caixaMesAnterior.filter(c => c.tipo === 'ENTRADA').reduce((s, c) => s + c.valor, 0);
    const saidasMesAnt = caixaMesAnterior.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);
    const fatMesAnt = ordensMesAnterior.reduce((s, o) => s + o.valorTotal, 0);
    ctx += `=== MÊS ANTERIOR (${inicioMesAnterior.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}) ===\n`;
    ctx += `Ordens: *${ordensMesAnterior.length}* | Faturamento: *R$ ${fatMesAnt.toFixed(2)}*\n`;
    ctx += `Caixa: Entradas *R$ ${entradasMesAnt.toFixed(2)}* | Saídas *R$ ${saidasMesAnt.toFixed(2)}* | Saldo *R$ ${(entradasMesAnt - saidasMesAnt).toFixed(2)}*\n`;

    ctx += `Comissões do mês anterior por lavador:\n`;
    for (const lav of lavadores) {
      const ords = ordensMesAnterior.filter(o => o.lavadorId === lav.id);
      const fat = ords.reduce((s, o) => s + o.valorTotal, 0);
      const com = fat * (lav.comissao / 100);
      ctx += `• *${lav.nome}*: *${ords.length}* ordem(ns), faturamento *R$ ${fat.toFixed(2)}*, comissão *R$ ${com.toFixed(2)}*\n`;
    }
    ctx += '\n';

    // Adiantamentos pendentes
    if (adiantamentos.length > 0) {
      ctx += `Adiantamentos pendentes (total):\n`;
      for (const a of adiantamentos) {
        ctx += `• *${a.lavador.nome}*: *R$ ${a.valor.toFixed(2)}*\n`;
      }
      ctx += '\n';
    }

    // Fechamentos de comissão do mês (se houver)
    if (fechamentosMes.length > 0) {
      ctx += `Fechamentos de comissão no mês:\n`;
      for (const f of fechamentosMes) {
        ctx += `• *${f.lavador.nome}*: *R$ ${f.valorPago.toFixed(2)}* em ${f.data.toLocaleDateString('pt-BR')}\n`;
      }
      ctx += '\n';
    }

    return ctx;
  } catch (error) {
    console.error('[WhatsApp Context] Erro:', error);
    return 'Erro ao carregar contexto.';
  }
}

/*
 * Handler: /resumo — query direta ao banco
 */
async function handleResumoCommand(empresaId: string): Promise<string> {
  // Janela fixa 07:00–23:59 BRT do dia atual — sem depender de horarioAbertura
  const { start, end } = getTodayFixedRangeBRT();

  const [ordens, caixa] = await Promise.all([
    // Só FINALIZADAS com dataFim dentro da janela de hoje
    prisma.ordemServico.findMany({
      where: { empresaId, status: 'FINALIZADO' as any, dataFim: { gte: start, lte: end } },
    }),
    prisma.caixaRegistro.findMany({
      where: { empresaId, data: { gte: start, lte: end } },
    }),
  ]);

  const fat      = ordens.reduce((s, o) => s + o.valorTotal, 0);
  const entradas = caixa.filter(c => c.tipo === 'ENTRADA').reduce((s, c) => s + c.valor, 0);
  const saidas   = caixa.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);

  return `📊 *RESUMO DO DIA*\n\n` +
    `✅ Ordens finalizadas: *${ordens.length}* | Faturamento: *R$ ${fat.toFixed(2)}*\n\n` +
    `💰 CAIXA:\n` +
    `Entradas: *R$ ${entradas.toFixed(2)}* | Saídas: *R$ ${saidas.toFixed(2)}*\n` +
    `Saldo: *R$ ${(entradas - saidas).toFixed(2)}*`;
}

/*
 * Handler: /lavadores — query direta ao banco
 */
async function handleLavadoresCommand(empresaId: string): Promise<string> {
  const { start, end } = getTodayFixedRangeBRT();

  const [lavadores, ordens] = await Promise.all([
    prisma.lavador.findMany({ where: { empresaId, ativo: true } }),
    prisma.ordemServico.findMany({
      where: { empresaId, status: 'FINALIZADO' as any, dataFim: { gte: start, lte: end } },
      include: { ordemLavadores: { select: { lavadorId: true } } },
    }),
  ]);

  if (lavadores.length === 0) return '❌ Nenhum lavador cadastrado.';

  let r = `👷 *LAVADORES HOJE*\n\n`;
  for (const lav of lavadores) {
    // Conta ordens onde o lavador participou (principal ou multi-lavador)
    const ords = ordens.filter(o =>
      o.lavadorId === lav.id || o.ordemLavadores.some(ol => ol.lavadorId === lav.id)
    );
    const fat = ords.reduce((s, o) => s + o.valorTotal, 0);
    const com = fat * (lav.comissao / 100);
    r += `• *${lav.nome}*: ${ords.length} ordem(ns) | Fat.: *R$ ${fat.toFixed(2)}* | Com.: *R$ ${com.toFixed(2)}*\n`;
  }

  return r.trim();
}

/*
 * Handler: /caixa — query direta ao banco
 */
async function handleCaixaCommand(empresaId: string): Promise<string> {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1);

  const caixa = await prisma.caixaRegistro.findMany({
    where: { empresaId, data: { gte: hoje, lt: amanha } },
    orderBy: { data: 'desc' },
  });

  const entradas = caixa.filter(c => c.tipo === 'ENTRADA').reduce((s,c) => s + c.valor, 0);
  const saidas   = caixa.filter(c => c.tipo === 'SAIDA').reduce((s,c) => s + c.valor, 0);

  let r = `💰 *CAIXA DO DIA*\n\n`;
  r += `Entradas: *R$ ${entradas.toFixed(2)}*\n`;
  r += `Saídas: *R$ ${saidas.toFixed(2)}*\n`;
  r += `Saldo: *R$ ${(entradas - saidas).toFixed(2)}*`;

  const ultSaidas = caixa.filter(c => c.tipo === 'SAIDA').slice(0, 5);
  if (ultSaidas.length > 0) {
    r += `\n\n📋 Últimas saídas:\n`;
    for (const s of ultSaidas) {
      r += `• ${s.descricao}: *R$ ${s.valor.toFixed(2)}*\n`;
    }
  }

  return r.trim();
}

/*
 * Handler: /pendentes — query direta ao banco
 */
async function handlePendentesCommand(empresaId: string): Promise<string> {
  const ordens = await prisma.ordemServico.findMany({
    where: { empresaId, status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] } },
    include: {
      veiculo: { select: { modelo: true, placa: true } },
      lavador: { select: { nome: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  if (ordens.length === 0) return '✅ Nenhuma ordem ativa no momento.';

  const lbl: Record<string, string> = {
    PENDENTE: 'PENDENTE', EM_ANDAMENTO: 'EM ANDAMENTO', AGUARDANDO_PAGAMENTO: 'AGUARD. PAGAMENTO',
  };

  let r = `⏳ *ORDENS ATIVAS (${ordens.length})*\n\n`;
  for (const o of ordens) {
    const modelo = (o.veiculo.modelo ?? 'Veículo').toUpperCase();
    r += `#${o.numeroOrdem} · ${modelo} ${o.veiculo.placa ?? ''} · *R$ ${o.valorTotal.toFixed(2)}*\n`;
    r += `  ${lbl[o.status] ?? o.status} · ${o.lavador?.nome ?? '(sem lavador)'}\n\n`;
  }

  return r.trim();
}

/*
 * Handler: /ajuda
 */
function handleAjudaCommand(): string {
  return `📚 *COMANDOS*\n\n` +
    `*Dia a dia:*\n` +
    `resumo · lavadores · caixa · pendentes · pátio\n\n` +
    `*Despesas:*\n` +
    `saída 50 · saída de gasolina 80\n` +
    `gastei 120 conta de luz · despesa 200 pix\n` +
    `adiantamento de 150 · nova saída\n\n` +
    `*Caixa:*\n` +
    `fechamento · fechamento ontem · fechamento 02/04\n\n` +
    `*Relatórios:*\n` +
    `relatório ontem · relatório 02/04\n` +
    `relatório semanal · últimos 15 dias\n` +
    `relatório de 01/04 a 07/04\n\n` +
    `*Multi-empresa:*\n` +
    `resumo das duas · caixa de todas · lavadores das duas\n\n` +
    `*Comissões e Vales:*\n` +
    `comissões em aberto · comissão [nome]\n` +
    `vale [nome] · vales em aberto\n\n` +
    `*Saídas:*\n` +
    `saídas · saídas hoje · saídas semana · saídas mês\n` +
    `saídas 01/04 · saídas de 01/04 a 07/04\n\n` +
    `*Avarias:*\n` +
    `reports · ver avarias · tem report · fotos de avaria\n\n` +
    `*PIX:*\n` +
    `ordens · pix [nº] · reenviar pix [nº]\n\n` +
    `*Empresa:*\n` +
    `trocar empresa · trocar para [nome]\n\n` +
    `_Qualquer pergunta livre → respondo com IA_`;
}

/*
 * Monta contexto de lavador para o Groq responder de forma conversacional e pessoal.
 * Usado quando a pergunta é "como tá o Felipe?" e não "relatório do Felipe".
 */
async function buildContextLavadorConversacional(message: string, empresaId: string): Promise<string | null> {
  try {
    const lavadores = await prisma.lavador.findMany({ where: { empresaId, ativo: true } });
    const msgLower  = message.toLowerCase();
    const lavador   = lavadores.find(l =>
      msgLower.includes(l.nome.toLowerCase()) ||
      l.nome.toLowerCase().split(' ').some(p => p.length > 3 && msgLower.includes(p))
    );
    if (!lavador) return null;

    const hoje       = new Date(); hoje.setHours(0, 0, 0, 0);
    const amanha     = new Date(hoje); amanha.setDate(amanha.getDate() + 1);
    const inicioMes  = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fimMes     = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

    const [ordensDia, ordensMes, adiantamentos] = await Promise.all([
      prisma.ordemServico.findMany({ where: { empresaId, lavadorId: lavador.id, status: { not: 'CANCELADO' }, createdAt: { gte: hoje, lt: amanha } } }),
      prisma.ordemServico.findMany({ where: { empresaId, lavadorId: lavador.id, status: { not: 'CANCELADO' }, createdAt: { gte: inicioMes, lte: fimMes } } }),
      prisma.adiantamento.findMany({ where: { lavadorId: lavador.id, status: 'PENDENTE' } }),
    ]);

    const fatDia      = ordensDia.reduce((s, o) => s + o.valorTotal, 0);
    const comDia      = fatDia * (lavador.comissao / 100);
    const fatMes      = ordensMes.reduce((s, o) => s + o.valorTotal, 0);
    const comBrutaMes = fatMes * (lavador.comissao / 100);
    const totalAdiant = adiantamentos.reduce((s, a) => s + a.valor, 0);
    const comLiqMes   = comBrutaMes - totalAdiant;

    return `DADOS DO LAVADOR — responda de forma conversacional, pessoal e descontraída. ` +
      `Dê uma avaliação humana do desempenho: se tá fraco, diga com leveza; se tá bem, parabenize. ` +
      `Use os números, mas não liste friamente — comente sobre eles como quem conhece a pessoa.\n\n` +
      `Lavador: ${lavador.nome} | Comissão: ${lavador.comissao}%\n` +
      `HOJE: ${ordensDia.length} ordem(ns) | faturamento R$ ${fatDia.toFixed(2)} | comissão R$ ${comDia.toFixed(2)}\n` +
      `MÊS: ${ordensMes.length} ordem(ns) | faturamento R$ ${fatMes.toFixed(2)} | comissão bruta R$ ${comBrutaMes.toFixed(2)} | líquida R$ ${comLiqMes.toFixed(2)}`;
  } catch {
    return null;
  }
}

/*
 * Busca lavador específico por nome (parcial) — retorna dados do dia E do mês
 */
async function handleLavadorEspecifico(
  message: string,
  empresaId: string,
): Promise<string | null> {
  try {
    const lavadores = await prisma.lavador.findMany({
      where: { empresaId, ativo: true }
    });

    const messageLower = message.toLowerCase().trim();
    const lavador = lavadores.find(l =>
      l.nome.toLowerCase().includes(messageLower) ||
      messageLower.includes(l.nome.toLowerCase())
    );

    if (!lavador) return null;

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

    const [ordensDia, ordensMes, adiantamentos] = await Promise.all([
      prisma.ordemServico.findMany({
        where: { empresaId, lavadorId: lavador.id, status: { not: 'CANCELADO' }, createdAt: { gte: hoje, lt: amanha } }
      }),
      prisma.ordemServico.findMany({
        where: { empresaId, lavadorId: lavador.id, status: { not: 'CANCELADO' }, createdAt: { gte: inicioMes, lte: fimMes } }
      }),
      prisma.adiantamento.findMany({
        where: { lavadorId: lavador.id, status: 'PENDENTE' }
      }),
    ]);

    const fatDia = ordensDia.reduce((s, o) => s + o.valorTotal, 0);
    const comDia = fatDia * (lavador.comissao / 100);
    const fatMes = ordensMes.reduce((s, o) => s + o.valorTotal, 0);
    const comBrutaMes = fatMes * (lavador.comissao / 100);
    const totalAdiant = adiantamentos.reduce((s, a) => s + a.valor, 0);
    const comLiquidaMes = comBrutaMes - totalAdiant;

    return `👤 *${lavador.nome.toUpperCase()}*\n\n` +
      `📅 HOJE:\n` +
      `  Ordens: *${ordensDia.length}* | Faturamento: *R$ ${fatDia.toFixed(2)}*\n` +
      `  Comissão: *R$ ${comDia.toFixed(2)}*\n\n` +
      `📆 MÊS ATUAL:\n` +
      `  Ordens: *${ordensMes.length}* | Faturamento: *R$ ${fatMes.toFixed(2)}*\n` +
      `  Comissão bruta (${lavador.comissao}%): *R$ ${comBrutaMes.toFixed(2)}*\n` +
      `  Adiantamentos em aberto: *R$ ${totalAdiant.toFixed(2)}*\n` +
      `  Comissão líquida a receber: *R$ ${comLiquidaMes.toFixed(2)}*`;
  } catch (error) {
    console.error('[WhatsApp] Erro ao buscar lavador:', error);
    return null;
  }
}

// ==========================================
// LANÇAMENTO DE SAÍDA VIA WHATSAPP
// ==========================================

// ==========================================
// SAÍDAS — FLUXO CONVERSACIONAL POR ETAPAS
// ==========================================

const FORMA_LABELS: Record<string, string> = {
  PIX: 'PIX', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão', NFE: 'NFe',
};

/**
 * Determina a próxima etapa com base no que falta coletar
 */
function getNextSaidaStep(p: Partial<PendingSaida>): SaidaStep {
  if (!p.valor || p.valor <= 0) return 'valor';
  if (!p.descricao) return 'descricao';
  if (!p.formaPagamento) return 'formaPagamento';
  if (p.categoria === 'Adiantamento' && p.lavadorId === undefined) return 'lavador';
  if (p.categoria !== 'Adiantamento' && p.fornecedorNome === undefined) return 'fornecedor';
  return 'confirming';
}

/**
 * Retorna a pergunta/mensagem para a etapa atual
 */
function promptForSaidaStep(p: PendingSaida): string {
  switch (p.step) {
    case 'valor':
      return (
        `💸 *Lançar despesa*\n\n` +
        `💰 *Qual o valor?*\n` +
        `_Ex: 50, 120,50, 200_\n\n` +
        `_Envie "cancelar" para abortar._`
      );

    case 'descricao':
      return (
        `💸 *R$ ${p.valor.toFixed(2)}*\n\n` +
        `📝 *O que foi pago? (descrição breve)*\n` +
        `_Ex: Produto químico, Conta de luz, Gasolina_`
      );

    case 'formaPagamento':
      return (
        `📝 _${p.descricao}_\n\n` +
        `💳 *Qual a forma de pagamento?*\n` +
        `1️⃣ Dinheiro\n2️⃣ PIX\n3️⃣ Cartão\n4️⃣ NFe`
      );

    case 'lavador': {
      const lista = p.lavadoresList.length > 0
        ? p.lavadoresList.map((l, i) => `${i + 1}️⃣ ${l.nome}`).join('\n')
        : '_(nenhum funcionário cadastrado)_';
      return (
        `👤 *Para qual funcionário é o adiantamento?*\n\n` +
        lista +
        `\n\n_Digite o número correspondente_`
      );
    }

    case 'fornecedor':
      return (
        `🏪 *Nome do fornecedor ou responsável?*\n` +
        `_(ou envie *pular* para deixar em branco)_`
      );

    case 'confirming': {
      const formaLabel = FORMA_LABELS[p.formaPagamento || 'DINHEIRO'] || p.formaPagamento;
      const fornLine    = p.fornecedorNome ? `\n  🏪 ${p.fornecedorNome}` : '';
      const lavLine     = p.lavadorNome    ? `\n  👤 ${p.lavadorNome}` : '';
      return (
        `💸 *Confirmar despesa?*\n\n` +
        `  💰 *R$ ${p.valor.toFixed(2)}*\n` +
        `  📝 ${p.descricao}\n` +
        `  💳 ${formaLabel}\n` +
        `  🏷️ ${p.categoria}` +
        lavLine +
        fornLine +
        `\n\n*sim* para lançar · *não* para cancelar`
      );
    }
  }
}

/**
 * Tenta parsear forma de pagamento de um texto livre
 */
function parseFormaPagamento(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (/^1$|dinheiro|esp[eé]cie/.test(t)) return 'DINHEIRO';
  if (/^2$|^pix$/.test(t)) return 'PIX';
  if (/^3$|cart[aã]o|cr[eé]dito|d[eé]bito/.test(t)) return 'CARTAO';
  if (/^4$|nf[e\-]?|nota\s*fiscal/.test(t)) return 'NFE';
  return null;
}

/**
 * Extrai o que for possível da mensagem inicial usando Groq.
 * Retorna null apenas se não conseguir extrair o valor.
 * descricao e formaPagamento podem ser null (serão coletados depois).
 */
async function extrairDadosSaida(message: string): Promise<{
  valor: number;
  descricao: string | null;
  formaPagamento: string | null;
  categoria: string;
} | null> {
  const prompt = `Extraia dados de uma saída financeira. Retorne APENAS JSON sem markdown.
Campos:
- valor: número (obrigatório; null se ausente)
- descricao: texto do que foi pago (null se não mencionado explicitamente)
- formaPagamento: "PIX" | "DINHEIRO" | "CARTAO" | "NFE" (null se não mencionado)
- categoria: "Despesa" | "Adiantamento" | "Outro" (padrão "Despesa")

Regras:
- formaPagamento: só preencha se o usuário mencionar explicitamente
- descricao: só preencha se descreve claramente o gasto; capitalize
- Se a mensagem tiver "adiantamento" → categoria = "Adiantamento"

Exemplos:
"saida 50 material de limpeza pix" → {"valor":50,"descricao":"Material de limpeza","formaPagamento":"PIX","categoria":"Despesa"}
"gastei 120 conta de luz" → {"valor":120,"descricao":"Conta de luz","formaPagamento":null,"categoria":"Despesa"}
"saida 120 dinheiro" → {"valor":120,"descricao":null,"formaPagamento":"DINHEIRO","categoria":"Despesa"}
"despesa 80" → {"valor":80,"descricao":null,"formaPagamento":null,"categoria":"Despesa"}
"adiantamento 200" → {"valor":200,"descricao":null,"formaPagamento":null,"categoria":"Adiantamento"}

Mensagem: "${message}"`;

  try {
    const resposta = await chatCompletion(prompt, '', 'Retorne APENAS o JSON, sem texto adicional, sem markdown.');
    const json = resposta.replace(/```json?|```/g, '').trim();
    const dados = JSON.parse(json);
    const valor = Number(dados.valor);
    if (!dados.valor || isNaN(valor) || valor <= 0) return null;
    return {
      valor,
      descricao: dados.descricao || null,
      formaPagamento: dados.formaPagamento || null,
      categoria: dados.categoria || 'Despesa',
    };
  } catch {
    return null;
  }
}

/**
 * Ponto de entrada: detectou intenção de saída na mensagem inicial
 */
async function handleSaidaWhatsapp(message: string, from: string, senderName: string, empresaId: string): Promise<string> {
  const dados = await extrairDadosSaida(message);
  const pendingKey = from; // chave = JID; empresa vem do adminContextStore

  const pending: PendingSaida = {
    valor:          dados?.valor ?? 0,
    descricao:      dados?.descricao ?? null,
    formaPagamento: dados?.formaPagamento ?? null,
    categoria:      dados?.categoria ?? 'Despesa',
    fornecedorNome: undefined,
    lavadorId:      undefined,
    lavadorNome:    undefined,
    lavadoresList:  [],
    step:           'valor', // será recalculado abaixo
    empresaId,
    userName:       senderName,
    expiresAt:      Date.now() + 10 * 60 * 1000,
  };

  pending.step = getNextSaidaStep(pending);

  // Se o próximo step é lavador, pré-carrega a lista
  if (pending.step === 'lavador') {
    pending.lavadoresList = await prisma.lavador.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
  }

  pendingSaidas.set(pendingKey, pending);
  return promptForSaidaStep(pending);
}

/**
 * Processa resposta do usuário em uma etapa de coleta ativa
 */
async function handlePendingSaidaStep(message: string, pendingKey: string, senderName: string): Promise<string> {
  const pending = pendingSaidas.get(pendingKey)!;
  const resp = message.trim();
  const lower = resp.toLowerCase();

  // Cancelamento a qualquer momento
  if (/^(n[aã]o|nao|cancelar|cancel|sair|abortar|parar)$/.test(lower)) {
    pendingSaidas.delete(pendingKey);
    return '❌ Lançamento cancelado.';
  }

  // Renova sessão (usuário está ativo)
  pending.expiresAt = Date.now() + 10 * 60 * 1000;

  switch (pending.step) {
    case 'valor': {
      const val = parseFloat(resp.replace(',', '.').replace(/[^\d.]/g, ''));
      if (!val || val <= 0) {
        return '⚠️ Informe um valor válido.\n_Ex: 50, 120,50, 200_';
      }
      pending.valor = val;
      break;
    }

    case 'descricao': {
      if (resp.length < 2) {
        return '⚠️ Descrição muito curta. Descreva melhor o gasto.\nEx: _Produto químico_, _Conta de luz_';
      }
      pending.descricao = resp.charAt(0).toUpperCase() + resp.slice(1);
      break;
    }

    case 'formaPagamento': {
      const forma = parseFormaPagamento(resp);
      if (!forma) {
        return (
          `❓ Não reconheci a forma de pagamento. Escolha:\n` +
          `1️⃣ Dinheiro\n2️⃣ PIX\n3️⃣ Cartão\n4️⃣ NFe`
        );
      }
      pending.formaPagamento = forma;
      break;
    }

    case 'lavador': {
      const num = parseInt(resp, 10);
      if (!isNaN(num) && num >= 1 && num <= pending.lavadoresList.length) {
        const lav = pending.lavadoresList[num - 1];
        pending.lavadorId   = lav.id;
        pending.lavadorNome = lav.nome;
      } else {
        const lista = pending.lavadoresList.map((l, i) => `${i + 1}️⃣ ${l.nome}`).join('\n');
        return (
          `❓ Opção inválida. Escolha digitando o número:\n\n` +
          lista
        );
      }
      break;
    }

    case 'fornecedor': {
      if (/^(pular|skip|n[aã]o|nao|nenhum|-)$/.test(lower)) {
        pending.fornecedorNome = null;
      } else {
        pending.fornecedorNome = resp;
      }
      break;
    }

    case 'confirming': {
      if (/^(sim|s|yes|confirmar|confirma|ok)$/.test(lower)) {
        return await confirmarSaida(pendingKey, senderName);
      }
      pendingSaidas.delete(pendingKey);
      return '❌ Lançamento cancelado.';
    }
  }

  // Avança para próxima etapa
  pending.step = getNextSaidaStep(pending);

  // Se o próximo step é lavador, carrega a lista de funcionários
  if (pending.step === 'lavador' && pending.lavadoresList.length === 0) {
    pending.lavadoresList = await prisma.lavador.findMany({
      where: { empresaId: pending.empresaId, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    });
  }

  pendingSaidas.set(pendingKey, pending);
  return promptForSaidaStep(pending);
}

/**
 * Cria o CaixaRegistro após confirmação final
 */
async function confirmarSaida(pendingKey: string, senderName: string): Promise<string> {
  const pending = pendingSaidas.get(pendingKey);
  if (!pending) return '❌ Sessão expirada. Tente novamente.';
  pendingSaidas.delete(pendingKey);

  try {
    const finalDescricao = `[${pending.categoria}] ${pending.descricao || 'Saída'}`;
    const formaFinal = (pending.formaPagamento || 'DINHEIRO') as any;

    // Lookup ou cria fornecedor se informado
    let fornecedorId: string | undefined;
    if (pending.fornecedorNome) {
      let fornecedor = await prisma.fornecedor.findFirst({
        where: { nome: pending.fornecedorNome, empresaId: pending.empresaId },
      });
      if (!fornecedor) {
        fornecedor = await prisma.fornecedor.create({
          data: { nome: pending.fornecedorNome, empresaId: pending.empresaId },
        });
      }
      fornecedorId = fornecedor.id;
    }

    const registro = await prisma.caixaRegistro.create({
      data: {
        empresaId: pending.empresaId,
        tipo: 'SAIDA',
        valor: pending.valor,
        formaPagamento: formaFinal,
        descricao: finalDescricao,
        ...(fornecedorId ? { fornecedorId } : {}),
        origem: 'WHATSAPP',
        lancadoPor: senderName,
      },
    });

    // Se for adiantamento com lavador vinculado, cria o registro de adiantamento
    if (pending.categoria === 'Adiantamento' && pending.lavadorId) {
      await prisma.adiantamento.create({
        data: {
          valor:          pending.valor,
          lavadorId:      pending.lavadorId,
          empresaId:      pending.empresaId,
          caixaRegistroId: registro.id,
          status:         'PENDENTE',
        },
      });
    }

    const formaLabel = FORMA_LABELS[pending.formaPagamento || 'DINHEIRO'] || pending.formaPagamento;
    const fornLine  = pending.fornecedorNome ? `\n  🏪 ${pending.fornecedorNome}` : '';
    const lavLine   = pending.lavadorNome    ? `\n  👤 Funcionário: ${pending.lavadorNome}` : '';

    return (
      `✅ *Saída registrada!*\n\n` +
      `  💰 R$ ${pending.valor.toFixed(2)}\n` +
      `  📝 ${pending.descricao || 'Saída'}\n` +
      `  💳 ${formaLabel}\n` +
      `  🏷️ ${pending.categoria}` +
      lavLine +
      fornLine +
      `\n  👤 ${senderName}`
    );
  } catch (error) {
    console.error('[WhatsApp] Erro ao criar saída:', error);
    return '❌ Erro ao registrar. Tente novamente.';
  }
}

// ==========================================
// COMANDOS PIX
// ==========================================

/**
 * Lista ordens ativas da empresa (admin: todas; lavador: só as suas)
 */
async function handleOrdensAtivas(empresaId: string, user: WhatsAppUser): Promise<string> {
  const statusAtivos = ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'];

  const where: Record<string, unknown> = { empresaId, status: { in: statusAtivos } };
  if (user.type === 'lavador') {
    where.OR = [
      { lavadorId: user.lavadorId },
      { ordemLavadores: { some: { lavadorId: user.lavadorId } } },
    ];
  }

  const ordens = await prisma.ordemServico.findMany({
    where: where as any,
    include: {
      veiculo: { select: { modelo: true, placa: true } },
      cliente: { select: { nome: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  if (ordens.length === 0) {
    return `📋 Nenhuma ordem ativa no momento.`;
  }

  const statusLabel: Record<string, string> = {
    PENDENTE: 'PENDENTE',
    EM_ANDAMENTO: 'EM ANDAMENTO',
    AGUARDANDO_PAGAMENTO: 'AGUARD. PAGAMENTO',
  };

  let r = `📋 *Ordens ativas agora (${ordens.length}):*\n\n`;
  for (const o of ordens) {
    const modelo = (o.veiculo.modelo ?? 'Veículo').toUpperCase();
    const placa = o.veiculo.placa ?? '';
    const status = statusLabel[o.status] ?? o.status;
    r += `#${o.numeroOrdem} · ${modelo} ${placa} · *R$ ${o.valorTotal.toFixed(2)}* · ${status}\n`;
  }

  r += `\n────────────────\n`;
  r += `Para gerar PIX: *pix [número]*\nEx: _pix ${ordens[0]?.numeroOrdem ?? '1'}_`;

  return r.trim();
}

/**
 * Gera ou reenvia QR Code PIX para uma ordem
 */
async function handlePixOrdem(
  numOrdem: number,
  empresaId: string,
  from: string,
  user: WhatsAppUser,
  reusar: boolean
): Promise<string> {
  // Buscar a ordem
  const ordem = await prisma.ordemServico.findFirst({
    where: { empresaId, numeroOrdem: numOrdem },
    include: {
      cliente: { select: { nome: true } },
      veiculo: { select: { modelo: true, placa: true } },
    },
  });

  if (!ordem) {
    return `❌ Ordem #${numOrdem} não encontrada.`;
  }

  // Lavador só pode gerar PIX das próprias ordens
  if (user.type === 'lavador') {
    const ehSua = ordem.lavadorId === user.lavadorId ||
      (await prisma.ordemServicoLavador.findFirst({
        where: { ordemId: ordem.id, lavadorId: user.lavadorId! },
      })) !== null;

    if (!ehSua) {
      return `❌ Você só pode gerar PIX para as suas próprias ordens.`;
    }
  }

  // Verificar status
  const statusAtivo = ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'];
  if (!statusAtivo.includes(ordem.status)) {
    return `❌ Ordem #${numOrdem} não está ativa (status: ${ordem.status}).`;
  }

  // Verificar integração bancária
  const bankIntegration = await prisma.bankIntegration.findUnique({
    where: { empresaId },
  });

  if (!bankIntegration || !bankIntegration.chavePix || !bankIntegration.ativo) {
    return `⚠️ Nenhuma integração bancária configurada.\n\nAcesse *Configurações → WhatsApp Bot → Integração PIX* para cadastrar sua chave PIX.`;
  }

  try {
    const { qrCodeBuffer, expiraEm, txId } = await gerarPixParaOrdem(ordem.id, empresaId, reusar);

    const cliente = ordem.cliente.nome;
    const modelo = (ordem.veiculo.modelo ?? 'Veículo').toUpperCase();
    const placa = ordem.veiculo.placa ?? '';
    const expMin = Math.round((expiraEm.getTime() - Date.now()) / 60000);

    const caption =
      `💳 *PIX gerado para Ordem #${numOrdem}*\n\n` +
      `👤 ${cliente} · ${modelo} ${placa}\n` +
      `💰 *R$ ${ordem.valorTotal.toFixed(2)}*\n` +
      `⏳ Válido por ${expMin} minuto(s)\n\n` +
      `Mostre este QR Code para o cliente escanear e pagar.`;

    // Enviar imagem diretamente (retornar string vazia para não duplicar msg)
    await sendImageBuffer(from, qrCodeBuffer, caption);
    return ''; // Baileys ignora string vazia

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[PIX] Erro ao gerar QR Code:', error);
    return `❌ Erro ao gerar PIX: ${msg}`;
  }
}
