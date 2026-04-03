/**
 * Parser de comandos WhatsApp e construtor de contexto
 * Identifica comandos específicos e passa para Groq quando não encontra match
 */

import prisma from '../db';
import { chatCompletion } from './groqService';

/**
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
    const command = message.trim().toLowerCase().replace(/\//g, '');

    // ── Relatório de data específica ─────────────────────────────────────────
    // Detecta: "resumo de ontem", "resumo dia 02/03", "relatorio 01/04", etc.
    const isRelatorioRequest = /resumo|relat[oó]rio|detalhe/.test(command);
    if (isRelatorioRequest || /^ontem$/.test(command)) {
      const date = parseDateFromMessage(message);
      if (date) {
        return handleRelatorioData(date, empresaId);
      }
    }

    // ── Comissões em aberto ──────────────────────────────────────────────────
    // Detecta: "comissoes em aberto", "comissao em aberto do carlos", etc.
    const isComissaoAberto = /comiss[aã][eo]s?\s*(em aberto|abertas?|pendentes?)/i.test(message) ||
      /(em aberto|abertas?|pendentes?)\s*(comiss[aã][eo]s?|comiss[oõ]es)/i.test(message);
    if (isComissaoAberto) {
      const nomeLavador = extrairNomeLavador(message);
      return handleComissoesEmAberto(nomeLavador, empresaId);
    }

    // ── Comandos fixos ───────────────────────────────────────────────────────
    const dailyContext = await buildDailyContext(empresaId);

    if (command === 'resumo') return handleResumoCommand(dailyContext);
    if (command === 'lavadores') return handleLavadoresCommand(dailyContext);
    if (command === 'caixa') return handleCaixaCommand(dailyContext);
    if (command === 'pendentes') return handlePendentesCommand(dailyContext);
    if (command === 'ajuda') return handleAjudaCommand();

    // ── Lavador por nome ─────────────────────────────────────────────────────
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
    linhas += `${modelo.toUpperCase()}: [${o.valorTotal.toFixed(2)}] : ${pagMethods}\n`;
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
    .map(([m, v]) => `${m}: R$ ${v.toFixed(2)}`)
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
        `${(o.veiculo.modelo ?? 'Veículo').toUpperCase()}: ${comValor.toFixed(2)}`
      );
    }
  }

  let comissoesFmt = '';
  for (const [nome, dados] of Object.entries(comissoesPorLavador)) {
    comissoesFmt += `\n${nome.toUpperCase()}: R$ ${dados.total.toFixed(2)}\n`;
    comissoesFmt += `(${dados.itens.join(' + ')})\n`;
  }

  return `📋 RELATÓRIO DE SERVIÇOS\n` +
    `${dataFmt} - ${diaSemana}\n\n` +
    `${linhas}\n` +
    `TOTAL: R$ ${total.toFixed(2)} | ${ordens.length} lavagem(ns)\n\n` +
    `📊 PAGAMENTOS:\n${pagamentosFmt}\n\n` +
    `👷 COMISSÕES (por serviço):\n${comissoesFmt}`;
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
      resultado += `✅ ${lav.nome.toUpperCase()}: sem comissões em aberto.\n\n`;
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
      .map(([m, v]) => `  ${m}: R$ ${v.toFixed(2)}`)
      .join('\n');

    resultado += `👤 ${lav.nome.toUpperCase()} (${lav.comissao}%)\n` +
      `Ordens em aberto: ${ordens.length}\n` +
      `Faturamento: R$ ${totalFat.toFixed(2)}\n` +
      `Comissão bruta: R$ ${totalCom.toFixed(2)}\n` +
      `Adiantamentos a descontar: R$ ${totalAdiant.toFixed(2)}\n` +
      `Comissão líquida a pagar: R$ ${comLiquida.toFixed(2)}\n` +
      `Por mês:\n${porMesFmt}\n\n`;
  }

  return resultado.trim();
}

// ==========================================
// CONTEXTO COMPLETO PARA IA
// ==========================================

/**
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
    ctx += `Ordens: ${ordensDia.length} | Faturamento: R$ ${ordensDia.reduce((s, o) => s + o.valorTotal, 0).toFixed(2)}\n`;
    ctx += `Status: ${ordensDia.filter(o => o.status === 'FINALIZADO').length} finalizadas, `;
    ctx += `${ordensDia.filter(o => o.status === 'EM_ANDAMENTO').length} em andamento, `;
    ctx += `${ordensDia.filter(o => o.status === 'PENDENTE').length} pendentes, `;
    ctx += `${ordensDia.filter(o => o.status === 'AGUARDANDO_PAGAMENTO').length} aguardando pagamento\n`;
    ctx += `Caixa: Entradas R$ ${entradasDia.toFixed(2)} | Saídas R$ ${saidasDia.toFixed(2)} | Saldo R$ ${(entradasDia - saidasDia).toFixed(2)}\n\n`;

    // Lavadores hoje
    ctx += `Lavadores hoje:\n`;
    for (const lav of lavadores) {
      const ords = ordensDia.filter(o => o.lavadorId === lav.id);
      const fat = ords.reduce((s, o) => s + o.valorTotal, 0);
      const com = fat * (lav.comissao / 100);
      ctx += `• ${lav.nome}: ${ords.length} ordem(ns), faturamento R$ ${fat.toFixed(2)}, comissão hoje R$ ${com.toFixed(2)}\n`;
    }
    ctx += '\n';

    // --- MÊS ---
    ctx += `=== MÊS ATUAL ===\n`;
    ctx += `Ordens: ${ordensMes.length} | Faturamento total: R$ ${ordensMes.reduce((s, o) => s + o.valorTotal, 0).toFixed(2)}\n`;
    ctx += `Caixa mês: Entradas R$ ${entradasMes.toFixed(2)} | Saídas R$ ${saidasMes.toFixed(2)} | Saldo R$ ${(entradasMes - saidasMes).toFixed(2)}\n\n`;

    // Comissões do mês por lavador
    ctx += `Comissões do mês por lavador:\n`;
    for (const lav of lavadores) {
      const ordsMes = ordensMes.filter(o => o.lavadorId === lav.id);
      const fatMes = ordsMes.reduce((s, o) => s + o.valorTotal, 0);
      const comMes = fatMes * (lav.comissao / 100);
      const adiant = adiantamentos.filter(a => a.lavadorId === lav.id).reduce((s, a) => s + a.valor, 0);
      const comLiquida = comMes - adiant;
      ctx += `• ${lav.nome}: ${ordsMes.length} ordem(ns), faturamento R$ ${fatMes.toFixed(2)}, comissão bruta R$ ${comMes.toFixed(2)}, adiantamentos em aberto R$ ${adiant.toFixed(2)}, comissão líquida R$ ${comLiquida.toFixed(2)}\n`;
    }
    ctx += '\n';

    // --- MÊS ANTERIOR ---
    const entradasMesAnt = caixaMesAnterior.filter(c => c.tipo === 'ENTRADA').reduce((s, c) => s + c.valor, 0);
    const saidasMesAnt = caixaMesAnterior.filter(c => c.tipo === 'SAIDA').reduce((s, c) => s + c.valor, 0);
    ctx += `=== MÊS ANTERIOR (${inicioMesAnterior.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}) ===\n`;
    ctx += `Ordens: ${ordensMesAnterior.length} | Faturamento: R$ ${ordensMesAnterior.reduce((s, o) => s + o.valorTotal, 0).toFixed(2)}\n`;
    ctx += `Caixa: Entradas R$ ${entradasMesAnt.toFixed(2)} | Saídas R$ ${saidasMesAnt.toFixed(2)} | Saldo R$ ${(entradasMesAnt - saidasMesAnt).toFixed(2)}\n`;

    ctx += `Comissões do mês anterior por lavador:\n`;
    for (const lav of lavadores) {
      const ords = ordensMesAnterior.filter(o => o.lavadorId === lav.id);
      const fat = ords.reduce((s, o) => s + o.valorTotal, 0);
      const com = fat * (lav.comissao / 100);
      ctx += `• ${lav.nome}: ${ords.length} ordem(ns), faturamento R$ ${fat.toFixed(2)}, comissão R$ ${com.toFixed(2)}\n`;
    }
    ctx += '\n';

    // Adiantamentos pendentes
    if (adiantamentos.length > 0) {
      ctx += `Adiantamentos pendentes (total):\n`;
      for (const a of adiantamentos) {
        ctx += `• ${a.lavador.nome}: R$ ${a.valor.toFixed(2)}\n`;
      }
      ctx += '\n';
    }

    // Fechamentos de comissão do mês (se houver)
    if (fechamentosMes.length > 0) {
      ctx += `Fechamentos de comissão no mês:\n`;
      for (const f of fechamentosMes) {
        ctx += `• ${f.lavador.nome}: R$ ${f.valorPago.toFixed(2)} em ${f.data.toLocaleDateString('pt-BR')}\n`;
      }
      ctx += '\n';
    }

    return ctx;
  } catch (error) {
    console.error('[WhatsApp Context] Erro:', error);
    return 'Erro ao carregar contexto.';
  }
}

/**
 * Handler: /resumo
 */
function handleResumoCommand(context: string): string {
  const linhas = context.split('\n');
  const resumo = linhas.slice(0, 10).join('\n');

  return `📊 RESUMO DO DIA\n\n${resumo}\n\nPara mais detalhes, acesse o painel.`;
}

/**
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

/**
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

/**
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

/**
 * Handler: /ajuda
 */
function handleAjudaCommand(): string {
  return `📚 COMANDOS DISPONÍVEIS\n\n` +
    `*Dia a dia:*\n` +
    `/resumo - Resumo de hoje\n` +
    `/lavadores - Lavadores e comissões de hoje\n` +
    `/caixa - Caixa do dia\n` +
    `/pendentes - Ordens em andamento\n\n` +
    `*Relatórios:*\n` +
    `resumo de ontem - Relatório detalhado de ontem\n` +
    `resumo dia 02/04 - Relatório de qualquer dia\n` +
    `ontem - Atalho para relatório de ontem\n\n` +
    `*Comissões:*\n` +
    `comissões em aberto - Todas as comissões pendentes\n` +
    `comissão em aberto do [nome] - Comissões de um lavador\n\n` +
    `*Busca:*\n` +
    `[nome do lavador] - Detalhes do mês do lavador\n` +
    `[qualquer pergunta] - IA com contexto do negócio\n\n` +
    `/ajuda - Este menu`;
}

/**
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

    return `👤 ${lavador.nome.toUpperCase()}\n\n` +
      `📅 HOJE:\n` +
      `  Ordens: ${ordensDia.length} | Faturamento: R$ ${fatDia.toFixed(2)}\n` +
      `  Comissão: R$ ${comDia.toFixed(2)}\n\n` +
      `📆 MÊS ATUAL:\n` +
      `  Ordens: ${ordensMes.length} | Faturamento: R$ ${fatMes.toFixed(2)}\n` +
      `  Comissão bruta (${lavador.comissao}%): R$ ${comBrutaMes.toFixed(2)}\n` +
      `  Adiantamentos em aberto: R$ ${totalAdiant.toFixed(2)}\n` +
      `  Comissão líquida a receber: R$ ${comLiquidaMes.toFixed(2)}`;
  } catch (error) {
    console.error('[WhatsApp] Erro ao buscar lavador:', error);
    return null;
  }
}
