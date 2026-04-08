/*
 * Parser de comandos WhatsApp e construtor de contexto
 * Identifica comandos específicos e passa para Groq quando não encontra match
 */

import prisma from '../db';
import { chatCompletion } from './groqService';
import { identifyWhatsAppUser, hasPermission, getDeniedAccessMessage, type WhatsAppUser } from './whatsappAuthService';

// ==========================================
// ESTADO DE CONFIRMAÇÃO DE SAÍDAS PENDENTES
// ==========================================
interface PendingSaida {
  valor: number;
  descricao: string;
  formaPagamento: string;
  categoria: string;
  empresaId: string;
  userName: string;
  expiresAt: number;
}
const pendingSaidas = new Map<string, PendingSaida>();

// Limpa confirmações expiradas a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingSaidas.entries()) {
    if (val.expiresAt < now) pendingSaidas.delete(key);
  }
}, 5 * 60 * 1000);

/*
 * Processa mensagem recebida do WhatsApp
 */
export async function handleIncomingMessage(
  instanceId: string,
  from: string,
  senderName: string,
  message: string,
  empresaId: string
): Promise<string> {
  try {
    // ── AUTENTICAÇÃO: Identificar usuário ────────────────────────────────────
    const user = await identifyWhatsAppUser(from, empresaId);

    // Se não cadastrado, verificar configuração
    if (user.type === 'unknown') {
      let blockUnknown = true;
      try {
        const empresa = await prisma.empresa.findUnique({
          where: { id: empresaId },
          select: { whatsappBlockUnknown: true },
        });
        if (empresa?.whatsappBlockUnknown !== undefined && empresa?.whatsappBlockUnknown !== null) {
          blockUnknown = empresa.whatsappBlockUnknown;
        }
      } catch (error) {
        // Se o campo não existir, usar padrão (true)
        console.warn('[WhatsApp] Erro ao carregar whatsappBlockUnknown:', error);
      }

      // Se blockUnknown é false, apenas ignorar (retornar string vazia)
      if (blockUnknown === false) {
        return ''; // Ignorar silenciosamente
      }

      // Caso contrário, enviar mensagem de acesso negado
      return getDeniedAccessMessage(user);
    }

    const command = message.trim().toLowerCase().replace(/\//g, '');

    // ── Relatório de período / semanal / data específica (ADMIN ONLY) ─────────
    const isRelatorioRequest = /resumo|relat[oó]rio|detalhe|semanal|semana/.test(command);
    if ((isRelatorioRequest || /^ontem$/.test(command)) && user.type === 'lavador') {
      return getDeniedAccessMessage(user);
    }
    if (isRelatorioRequest || /^ontem$/.test(command)) {
      // Período tem prioridade sobre data única (detectar ANTES)
      const range = parseDateRangeFromMessage(message);
      if (range) {
        return handleRelatorioPeriodo(range.inicio, range.fim, empresaId);
      }
      const date = parseDateFromMessage(message);
      if (date) {
        return handleRelatorioData(date, empresaId);
      }
    }

    // ── Comissões em aberto ──────────────────────────────────────────────────
    const isComissaoAberto = /comiss[aã][eo]s?\s*(em aberto|abertas?|pendentes?)/i.test(message) ||
      /(em aberto|abertas?|pendentes?)\s*(comiss[aã][eo]s?|comiss[oõ]es)/i.test(message);
    if (isComissaoAberto) {
      // Lavador: apenas suas comissões
      if (user.type === 'lavador') {
        return handleComissoesLavador(user.lavadorId!, empresaId);
      }
      // Admin: todas as comissões
      const nomeLavador = extrairNomeLavador(message);
      return handleComissoesEmAberto(nomeLavador, empresaId);
    }

    // ── Comandos fixos ───────────────────────────────────────────────────────
    const dailyContext = await buildDailyContext(empresaId);

    // ── Confirmação de saída pendente ────────────────────────────────────────
    const pendingKey = `${empresaId}:${from}`;
    if (pendingSaidas.has(pendingKey)) {
      const resp = command.trim();
      if (/^sim$|^s$|^yes$|^confirmar$|^confirma$/.test(resp)) {
        return await confirmarSaida(pendingKey, senderName);
      } else {
        pendingSaidas.delete(pendingKey);
        return '❌ Lançamento cancelado.';
      }
    }

    // ── Detecção de intenção de saída (não-lavador) ───────────────────────
    if (user.type !== 'lavador') {
      const isSaida = /\b(sa[íi]da|despesa|gasto|gastei|paguei|comprei|lancei|lan[çc]ar)\b/i.test(message);
      if (isSaida) {
        return await handleSaidaWhatsapp(message, from, senderName, empresaId);
      }
    }

    // ── Comandos fixos ───────────────────────────────────────────────────────
    const dailyContext = await buildDailyContext(empresaId);

    // Admin do bot: acesso completo (igual ao admin da empresa)
    if (user.type === 'admin') {
      if (command === 'resumo') return handleResumoCommand(dailyContext);
      if (command === 'lavadores') return handleLavadoresCommand(dailyContext);
      if (command === 'caixa') return handleCaixaCommand(dailyContext);
      if (command === 'pendentes') return handlePendentesCommand(dailyContext);
      if (command === 'patio' || command === 'pátio') return handlePatioCommand(empresaId);
      if (command === 'ajuda') return handleAjudaCommand();

      const lavadorResponse = await handleLavadorEspecifico(message, empresaId, dailyContext);
      if (lavadorResponse) return lavadorResponse;

      return await chatCompletion(message, dailyContext);
    }

    // Lavador: apenas resumo e comissões pessoais
    if (user.type === 'lavador') {
      if (command === 'resumo') return handleResumoLavador(user.lavadorId!, empresaId);
      if (command === 'ajuda') return handleAjudaLavador();
      if (command === 'status' || command === 'minhas-comissoes' || command === 'meu-status') {
        return await handleStatusLavador(user.lavadorId!, empresaId);
      }
      if (command === 'comissoes' || command === 'comissão' || command === 'minhas-comissoes') {
        return await handleComissoesLavador(user.lavadorId!, empresaId);
      }
      return getDeniedAccessMessage(user);
    }

    // Admin: acesso completo
    if (command === 'resumo') return handleResumoCommand(dailyContext);
    if (command === 'lavadores') return handleLavadoresCommand(dailyContext);
    if (command === 'caixa') return handleCaixaCommand(dailyContext);
    if (command === 'pendentes') return handlePendentesCommand(dailyContext);
    if (command === 'patio' || command === 'pátio') return handlePatioCommand(empresaId);
    if (command === 'ajuda') return handleAjudaCommand();

    // ── Lavador por nome (ADMIN ONLY) ────────────────────────────────────────
    const lavadorResponse = await handleLavadorEspecifico(message, empresaId, dailyContext);
    if (lavadorResponse) return lavadorResponse;

    // ── Fallback: IA com contexto ────────────────────────────────────────────
    return await chatCompletion(message, dailyContext);
  } catch (error) {
    console.error('[WhatsApp] Erro ao processar mensagem:', error);
    return '❌ Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.';
  }
}

// ==========================================
// PARSING DE DATA
// ==========================================

const DIAS_SEMANA = ['domingo','segunda','terça','quarta','quinta','sexta','sábado','sabado','terca'];

function parseDateFromMessage(message: string): Date | null {
  const msg = message.toLowerCase();

  if (/\bontem\b/.test(msg)) {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0); return d;
  }
  if (/\bhoje\b/.test(msg)) {
    const d = new Date(); d.setHours(0,0,0,0); return d;
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
  const inicio = new Date(date); inicio.setHours(0,0,0,0);
  const fim    = new Date(date); fim.setHours(23,59,59,999);

  const ordens = await prisma.ordemServico.findMany({
    where: { empresaId, createdAt: { gte: inicio, lte: fim } },
    include: {
      veiculo:  { select: { modelo: true } },
      lavador:  { select: { nome: true, comissao: true } },
      ordemLavadores: { include: { lavador: { select: { nome: true, comissao: true } } } },
      pagamentos: { select: { metodo: true, valor: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
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
    linhas += `${modelo.toUpperCase()}: [*R$ ${o.valorTotal.toFixed(2)}*] : *${pagMethods}*\n`;
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

  return `📋 RELATÓRIO DE SERVIÇOS\n` +
    `*${dataFmt}* - *${diaSemana}*\n\n` +
    `${linhas}\n` +
    `TOTAL: *R$ ${total.toFixed(2)}* | *${ordens.length}* lavagem(ns)\n\n` +
    `📊 PAGAMENTOS:\n${pagamentosFmt}\n\n` +
    `👷 COMISSÕES (por serviço):\n${comissoesFmt}`;
}

// ==========================================
// RELATÓRIO DE PERÍODO (vários dias)
// ==========================================

async function handleRelatorioPeriodo(inicio: Date, fim: Date, empresaId: string): Promise<string> {
  const ordens = await prisma.ordemServico.findMany({
    where: { empresaId, createdAt: { gte: inicio, lte: fim } },
    include: {
      veiculo:  { select: { modelo: true } },
      lavador:  { select: { nome: true, comissao: true } },
      ordemLavadores: { include: { lavador: { select: { nome: true, comissao: true } } } },
      pagamentos: { select: { metodo: true, valor: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const iniciofmt = inicio.toLocaleDateString('pt-BR');
  const fimfmt    = fim.toLocaleDateString('pt-BR');
  const diasCount = Math.round((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const titulo    = iniciofmt === fimfmt ? `*${iniciofmt}*` : `*${iniciofmt} a ${fimfmt}* (${diasCount} dias)`;

  if (ordens.length === 0) {
    return `📋 Sem ordens registradas de ${iniciofmt} a ${fimfmt}.`;
  }

  // Agrupamento por dia (chave: "dd/mm/yyyy")
  const porDia = new Map<string, { date: Date; ordens: typeof ordens; total: number }>();
  for (const o of ordens) {
    const chave = o.createdAt.toLocaleDateString('pt-BR');
    if (!porDia.has(chave)) porDia.set(chave, { date: o.createdAt, ordens: [], total: 0 });
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
      orderBy: { createdAt: 'asc' },
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

    resultado += `👤 *${lav.nome.toUpperCase()}* (${lav.comissao}%)\n` +
      `Ordens em aberto: *${ordens.length}*\n` +
      `Faturamento: *R$ ${totalFat.toFixed(2)}*\n` +
      `Comissão bruta: *R$ ${totalCom.toFixed(2)}*\n` +
      `Adiantamentos a descontar: *R$ ${totalAdiant.toFixed(2)}*\n` +
      `Comissão líquida a pagar: *R$ ${comLiquida.toFixed(2)}*\n` +
      `Por mês:\n${porMesFmt}\n\n`;
  }

  return resultado.trim();
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

/*
 * Resumo do dia apenas do lavador
 */
function handleResumoLavador(lavadorId: string, empresaId: string): string {
  // Por enquanto, retorna mensagem informativa
  // Implementar busca do resumo do dia desse lavador
  return `👤 Seu Resumo do Dia\n\nUse o comando */status* para ver suas comissões e faturamento de hoje.`;
}

/*
 * Status e comissões do lavador
 */
async function handleStatusLavador(lavadorId: string, empresaId: string): Promise<string> {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const amanha = new Date(hoje);
  amanha.setDate(amanha.getDate() + 1);
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

  const lavador = await prisma.lavador.findUnique({
    where: { id: lavadorId },
  });

  if (!lavador) return '❌ Erro ao buscar dados do lavador.';

  const [ordensDia, ordensMes, adiantamentos] = await Promise.all([
    prisma.ordemServico.findMany({
      where: { empresaId, lavadorId, createdAt: { gte: hoje, lt: amanha } },
    }),
    prisma.ordemServico.findMany({
      where: { empresaId, lavadorId, createdAt: { gte: inicioMes, lte: fimMes } },
    }),
    prisma.adiantamento.findMany({
      where: { lavadorId, status: 'PENDENTE' },
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

/*
 * Menu reduzido para lavador
 */
function handleAjudaLavador(): string {
  return `📚 SEUS COMANDOS\n\n` +
    `/status - Seu faturamento e comissão do dia e mês\n` +
    `/comissoes - Comissões em aberto a receber\n` +
    `/ajuda - Este menu\n\n` +
    `Acesso limitado: você só pode ver seus dados.\n` +
    `Para outras informações, contate o gerente.`;
}

// ==========================================
// CONTEXTO COMPLETO PARA IA
// ==========================================

/*
 * Constrói contexto com dados do dia E do mês para a IA responder qualquer período
 */
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
      where: { empresaId, createdAt: { gte: hoje, lt: amanha } },
      include: {
        cliente: { select: { nome: true } },
        veiculo: { select: { placa: true, modelo: true } },
        lavador: { select: { nome: true } },
      }
    });

    // 4. Ordens do MÊS
    const ordensMes = await prisma.ordemServico.findMany({
      where: { empresaId, createdAt: { gte: inicioMes, lte: fimMes } },
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
        where: { empresaId, createdAt: { gte: inicioMesAnterior, lte: fimMesAnterior } },
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
 * Handler: /resumo
 */
function handleResumoCommand(context: string): string {
  const linhas = context.split('\n');
  const resumo = linhas.slice(0, 10).join('\n');

  return `📊 RESUMO DO DIA\n\n${resumo}\n\nPara mais detalhes, acesse o painel.`;
}

/*
 * Handler: /lavadores
 */
function handleLavadoresCommand(context: string): string {
  const lines = context.split('\n');
  const lavadoresStart = lines.findIndex(l => l.includes('LAVADORES:'));

  if (lavadoresStart === -1) {
    return '❌ Nenhum lavador encontrado hoje.';
  }

  let lavadoresSection = lines[lavadoresStart];
  for (let i = lavadoresStart + 1; i < lines.length; i++) {
    if (lines[i].startsWith('•')) {
      lavadoresSection += '\n' + lines[i];
    } else if (lines[i].trim() === '') {
      continue;
    } else {
      break;
    }
  }

  return `👷 LAVADORES DO DIA\n\n${lavadoresSection}\n\nDigite o nome do lavador para detalhes específicos.`;
}

/*
 * Handler: /caixa
 */
function handleCaixaCommand(context: string): string {
  const lines = context.split('\n');
  const caixaStart = lines.findIndex(l => l.includes('CAIXA:'));

  if (caixaStart === -1) {
    return '❌ Dados de caixa não encontrados.';
  }

  let caixaSection = lines[caixaStart];
  for (let i = caixaStart + 1; i < Math.min(caixaStart + 4, lines.length); i++) {
    if (lines[i].includes('R$')) {
      caixaSection += '\n' + lines[i];
    }
  }

  return `💰 CAIXA DO DIA\n\n${caixaSection}`;
}

/*
 * Handler: /pendentes
 */
function handlePendentesCommand(context: string): string {
  const lines = context.split('\n');
  const pendentesLine = lines.find(l => l.includes('pendentes'));

  if (!pendentesLine) {
    return '✅ Nenhuma ordem pendente!';
  }

  return `⏳ ORDENS PENDENTES\n\n${pendentesLine}\n\nAbra o painel para mais detalhes.`;
}

/*
 * Handler: /ajuda
 */
function handleAjudaCommand(): string {
  return `📚 COMANDOS DISPONÍVEIS\n\n` +
    `*Dia a dia:*\n` +
    `/resumo - Resumo de hoje\n` +
    `/lavadores - Lavadores e comissões de hoje\n` +
    `/caixa - Caixa do dia\n` +
    `/pendentes - Ordens em andamento\n\n` +
    `*Relatórios por data:*\n` +
    `relatório de ontem\n` +
    `relatório dia 02/04\n` +
    `relatório semanal _(últimos 7 dias)_\n` +
    `relatório do dia 01/04 ao dia 07/04\n` +
    `relatório de 01/04 a 07/04\n` +
    `relatório dos últimos 15 dias\n\n` +
    `*Comissões:*\n` +
    `comissões em aberto - Todas as comissões pendentes\n` +
    `comissão em aberto do [nome] - Comissões de um lavador\n\n` +
    `*Busca:*\n` +
    `[nome do lavador] - Detalhes do mês do lavador\n` +
    `[qualquer pergunta] - IA com contexto do negócio\n\n` +
    `/ajuda - Este menu`;
}

/*
 * Busca lavador específico por nome (parcial) — retorna dados do dia E do mês
 */
async function handleLavadorEspecifico(
  message: string,
  empresaId: string,
  _context: string
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
        where: { empresaId, lavadorId: lavador.id, createdAt: { gte: hoje, lt: amanha } }
      }),
      prisma.ordemServico.findMany({
        where: { empresaId, lavadorId: lavador.id, createdAt: { gte: inicioMes, lte: fimMes } }
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

/**
 * Extrai dados de saída da mensagem usando Groq
 */
async function extrairDadosSaida(message: string): Promise<{ valor: number; descricao: string; formaPagamento: string; categoria: string } | null> {
  const prompt = `Extraia os dados de uma saída financeira desta mensagem. Retorne APENAS um JSON válido sem markdown, com os campos:
- valor: número (obrigatório)
- descricao: string descrevendo o que foi pago (obrigatório)
- formaPagamento: "PIX" | "DINHEIRO" | "CARTAO" | "NFE" (padrão: "DINHEIRO")
- categoria: "Despesa" | "Adiantamento" (padrão: "Despesa")

Exemplos:
"saida 50 material de limpeza pix" → {"valor":50,"descricao":"Material de limpeza","formaPagamento":"PIX","categoria":"Despesa"}
"gastei 120 conta de luz" → {"valor":120,"descricao":"Conta de luz","formaPagamento":"DINHEIRO","categoria":"Despesa"}
"despesa 80 produto químico cartão" → {"valor":80,"descricao":"Produto químico","formaPagamento":"CARTAO","categoria":"Despesa"}

Mensagem: "${message}"`;

  try {
    const resposta = await chatCompletion(prompt, '', 'Você é um extrator de dados JSON. Retorne APENAS o JSON, sem texto adicional, sem markdown.');
    const json = resposta.replace(/```json?|```/g, '').trim();
    const dados = JSON.parse(json);
    if (!dados.valor || isNaN(Number(dados.valor))) return null;
    return {
      valor: Number(dados.valor),
      descricao: dados.descricao || 'Despesa',
      formaPagamento: dados.formaPagamento || 'DINHEIRO',
      categoria: dados.categoria || 'Despesa',
    };
  } catch {
    return null;
  }
}

/**
 * Processa intenção de lançar saída e pede confirmação
 */
async function handleSaidaWhatsapp(message: string, from: string, senderName: string, empresaId: string): Promise<string> {
  const dados = await extrairDadosSaida(message);

  if (!dados) {
    return '❓ Não consegui identificar os dados da saída. Tente: *saída [valor] [descrição] [pix/dinheiro/cartão]*\nEx: _saída 50 material de limpeza pix_';
  }

  const formaLabel: Record<string, string> = { PIX: 'PIX', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão', NFE: 'NFe' };
  const pendingKey = `${empresaId}:${from}`;

  pendingSaidas.set(pendingKey, {
    ...dados,
    empresaId,
    userName: senderName,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutos
  });

  return `💸 *Confirmar lançamento?*\n\n` +
    `  Valor: *R$ ${dados.valor.toFixed(2)}*\n` +
    `  Descrição: ${dados.descricao}\n` +
    `  Pagamento: ${formaLabel[dados.formaPagamento] || dados.formaPagamento}\n` +
    `  Categoria: ${dados.categoria}\n\n` +
    `Responda *sim* para confirmar ou *não* para cancelar.`;
}

/**
 * Confirma e cria a saída no banco
 */
async function confirmarSaida(pendingKey: string, senderName: string): Promise<string> {
  const pending = pendingSaidas.get(pendingKey);
  if (!pending) return '❌ Confirmação expirada. Tente novamente.';
  pendingSaidas.delete(pendingKey);

  try {
    const finalDescricao = `[${pending.categoria}] ${pending.descricao}`;

    await prisma.caixaRegistro.create({
      data: {
        empresaId: pending.empresaId,
        tipo: 'SAIDA',
        valor: pending.valor,
        formaPagamento: pending.formaPagamento as any,
        descricao: finalDescricao,
        origem: 'WHATSAPP',
        lancadoPor: senderName,
      },
    });

    return `✅ *Saída registrada com sucesso!*\n\n` +
      `  💸 R$ ${pending.valor.toFixed(2)}\n` +
      `  📝 ${pending.descricao}\n` +
      `  💳 ${pending.formaPagamento}\n` +
      `  👤 Lançado por: ${senderName}`;
  } catch (error) {
    console.error('[WhatsApp] Erro ao criar saída:', error);
    return '❌ Erro ao registrar a saída. Tente novamente.';
  }
}
