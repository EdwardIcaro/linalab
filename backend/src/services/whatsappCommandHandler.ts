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
    // Extrair comando (ignora maiúsculas/minúsculas, remove espaços)
    const command = message.trim().toLowerCase().replace(/\//g, '');

    // Construir contexto do dia
    const dailyContext = await buildDailyContext(empresaId);

    // Verificar comandos específicos
    if (command === 'resumo') {
      return handleResumoCommand(dailyContext);
    }

    if (command === 'lavadores') {
      return handleLavadoresCommand(dailyContext);
    }

    if (command === 'caixa') {
      return handleCaixaCommand(dailyContext);
    }

    if (command === 'pendentes') {
      return handlePendentesCommand(dailyContext);
    }

    if (command === 'ajuda') {
      return handleAjudaCommand();
    }

    // Verificar se é nome de um lavador específico
    const lavadorResponse = await handleLavadorEspecifico(message, empresaId, dailyContext);
    if (lavadorResponse) {
      return lavadorResponse;
    }

    // Se não é comando específico, deixar Groq interpretar com contexto
    return await chatCompletion(message, dailyContext);
  } catch (error) {
    console.error('[WhatsApp] Erro ao processar mensagem:', error);
    return '❌ Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.';
  }
}

/**
 * Constrói contexto com dados do dia E do mês para a IA responder qualquer período
 */
async function buildDailyContext(empresaId: string): Promise<string> {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);

    // Início e fim do mês atual
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

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

    // 7. Adiantamentos pendentes (todos, sem filtro de data)
    const adiantamentos = await prisma.adiantamento.findMany({
      where: { empresaId, status: 'PENDENTE' },
      include: { lavador: { select: { nome: true } } }
    });

    // 8. Comissões fechadas do mês (FechamentoComissao)
    const fechamentosMes = await prisma.fechamentoComissao.findMany({
      where: {
        empresaId,
        createdAt: { gte: inicioMes, lte: fimMes }
      },
      include: { lavador: { select: { nome: true } } }
    }).catch(() => []); // tabela pode não existir em todas as versões

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
        ctx += `• ${f.lavador.nome}: R$ ${(f as any).valorFinal?.toFixed(2) ?? '?'} em ${new Date((f as any).createdAt).toLocaleDateString('pt-BR')}\n`;
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
    `/resumo - Resumo do dia\n` +
    `/lavadores - Lista de lavadores e comissões\n` +
    `/caixa - Entradas e saídas do dia\n` +
    `/pendentes - Ordens em andamento\n` +
    `/ajuda - Este menu\n\n` +
    `Ou digite o nome de um lavador para detalhes específicos.\n` +
    `Envie qualquer outra mensagem para perguntas em linguagem natural.`;
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
