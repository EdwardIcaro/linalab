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
 * Constrói contexto com dados do dia
 */
async function buildDailyContext(empresaId: string): Promise<string> {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);

    // 1. Buscar empresa
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId }
    });

    if (!empresa) return 'Empresa não encontrada.';

    // 2. Ordens do dia
    const ordens = await prisma.ordemServico.findMany({
      where: {
        empresaId,
        createdAt: {
          gte: hoje,
          lt: amanha
        }
      },
      include: {
        cliente: { select: { nome: true, telefone: true } },
        veiculo: { select: { placa: true, modelo: true } },
        lavador: { select: { nome: true } },
        items: {
          include: {
            servico: { select: { nome: true } },
            adicional: { select: { nome: true } }
          }
        }
      }
    });

    // 3. Caixa do dia
    const caixa = await prisma.caixaRegistro.findMany({
      where: {
        empresaId,
        data: {
          gte: hoje,
          lt: amanha
        }
      }
    });

    const entradas = caixa
      .filter(c => c.tipo === 'ENTRADA')
      .reduce((sum, c) => sum + c.valor, 0);

    const saidas = caixa
      .filter(c => c.tipo === 'SAIDA')
      .reduce((sum, c) => sum + c.valor, 0);

    // 4. Lavadores e comissões
    const lavadores = await prisma.lavador.findMany({
      where: { empresaId, ativo: true }
    });

    let lavadoresInfo = '';
    for (const lavador of lavadores) {
      const ordensLavador = ordens.filter(
        o => o.lavadorId === lavador.id
      );
      const faturamentoLavador = ordensLavador.reduce((sum, o) => sum + o.valorTotal, 0);

      lavadoresInfo += `\n• ${lavador.nome}: ${ordensLavador.length} ordem(ns), R$ ${faturamentoLavador.toFixed(2)}`;
    }

    // 5. Adiantamentos pendentes
    const adiantamentos = await prisma.adiantamento.findMany({
      where: {
        empresaId,
        status: 'PENDENTE'
      },
      include: {
        lavador: { select: { nome: true } }
      }
    });

    const adiantamentosInfo = adiantamentos
      .map(a => `\n  - ${a.lavador.nome}: R$ ${a.valor.toFixed(2)}`)
      .join('');

    // Montar contexto
    let context = `CONTEXTO DO DIA - ${empresa.nome}\n`;
    context += `Data: ${hoje.toLocaleDateString('pt-BR')}\n\n`;

    context += `ORDENS DO DIA:\n`;
    context += `Total: ${ordens.length} ordem(ns)\n`;
    context += `Faturamento: R$ ${ordens.reduce((sum, o) => sum + o.valorTotal, 0).toFixed(2)}\n`;
    context += `Status: ${ordens.filter(o => o.status === 'FINALIZADO').length} finalizadas, ${ordens.filter(o => o.status === 'PENDENTE').length} pendentes, ${ordens.filter(o => o.status === 'EM_ANDAMENTO').length} em andamento\n\n`;

    context += `CAIXA:\n`;
    context += `Entradas: R$ ${entradas.toFixed(2)}\n`;
    context += `Saídas: R$ ${saidas.toFixed(2)}\n`;
    context += `Saldo: R$ ${(entradas - saidas).toFixed(2)}\n\n`;

    context += `LAVADORES:${lavadoresInfo}\n\n`;

    if (adiantamentos.length > 0) {
      context += `ADIANTAMENTOS PENDENTES:${adiantamentosInfo}\n\n`;
    }

    return context;
  } catch (error) {
    console.error('[WhatsApp Context] Erro:', error);
    return 'Erro ao carregar contexto do dia.';
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
 * Busca lavador específico por nome (parcial)
 */
async function handleLavadorEspecifico(
  message: string,
  empresaId: string,
  context: string
): Promise<string | null> {
  try {
    // Buscar lavador com nome similar
    const lavadores = await prisma.lavador.findMany({
      where: { empresaId, ativo: true }
    });

    const messageLower = message.toLowerCase().trim();
    const lavador = lavadores.find(l =>
      l.nome.toLowerCase().includes(messageLower) ||
      messageLower.includes(l.nome.toLowerCase())
    );

    if (!lavador) return null;

    // Buscar ordens do lavador hoje
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);

    const ordens = await prisma.ordemServico.findMany({
      where: {
        empresaId,
        lavadorId: lavador.id,
        createdAt: {
          gte: hoje,
          lt: amanha
        }
      }
    });

    const adiantamentos = await prisma.adiantamento.findMany({
      where: {
        lavadorId: lavador.id,
        status: 'PENDENTE'
      }
    });

    const faturamento = ordens.reduce((sum, o) => sum + o.valorTotal, 0);
    const comissao = faturamento * (lavador.comissao / 100);
    const dvidaAdiantamento = adiantamentos.reduce((sum, a) => sum + a.valor, 0);

    return `👤 ${lavador.nome.toUpperCase()}\n\n` +
      `Ordens hoje: ${ordens.length}\n` +
      `Faturamento: R$ ${faturamento.toFixed(2)}\n` +
      `Comissão (${lavador.comissao}%): R$ ${comissao.toFixed(2)}\n` +
      `Adiantamentos pendentes: R$ ${dvidaAdiantamento.toFixed(2)}`;
  } catch (error) {
    console.error('[WhatsApp] Erro ao buscar lavador:', error);
    return null;
  }
}
