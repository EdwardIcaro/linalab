/**
 * Ferramentas (tool calling) que a Lina pode chamar quando a pergunta do
 * usuário não bate com nenhum comando fixo. Cada ferramenta:
 *  - recebe o empresaId já resolvido pelo servidor (nunca vindo da IA)
 *  - checa hasPermission antes de rodar, igual os comandos fixos já fazem
 *  - devolve texto pronto pro Groq compor a resposta final
 */

import type { ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import prisma from '../db';
import { hasPermission, type WhatsAppUser } from './whatsappAuthService';

export const FERRAMENTAS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'buscarCliente',
      description: 'Busca um cliente da empresa pelo nome ou telefone: veículos, total gasto, última visita, número de ordens.',
      parameters: {
        type: 'object',
        properties: {
          termo: { type: 'string', description: 'Nome (parcial ou completo) ou telefone do cliente' },
        },
        required: ['termo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscarOrdens',
      description: 'Busca ordens de serviço finalizadas da empresa num período livre (não só hoje/mês atual), com filtro opcional de tipo de veículo.',
      parameters: {
        type: 'object',
        properties: {
          inicio: { type: 'string', description: 'Data inicial, formato YYYY-MM-DD' },
          fim: { type: 'string', description: 'Data final, formato YYYY-MM-DD' },
          tipoVeiculo: { type: 'string', description: 'Ex: CARRO, MOTO — opcional' },
        },
        required: ['inicio', 'fim'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explicarSistema',
      description: 'Explica um conceito do próprio sistema Lina X (planos, comissão, PIX, ecossistema) — não usa dado nenhum da empresa do usuário.',
      parameters: {
        type: 'object',
        properties: {
          topico: { type: 'string', description: 'O que o usuário quer entender sobre o sistema' },
        },
        required: ['topico'],
      },
    },
  },
];

// Base curada — de propósito NÃO deixamos a IA improvisar sobre preço/plano
// (risco de inventar valor errado). Só responde o que está mapeado aqui.
const BASE_CONHECIMENTO: Array<{ chaves: string[]; texto: string }> = [
  {
    chaves: ['plano', 'planos', 'assinatura', 'preço', 'preco', 'valor do sistema'],
    texto: 'A Lina X tem 3 planos: *Basic* (R$89/mês, 1 empresa), *Pro* (R$169/mês, 2 empresas + Painel Vitrine) e *Premium* (R$279/mês, 5 empresas + Lina WhatsApp). Todo cadastro novo tem 7 dias de teste grátis.',
  },
  {
    chaves: ['data point', 'ponto', 'controle de ponto'],
    texto: 'Data Point é o módulo de controle de ponto CLT do ecossistema Lina — bate ponto com GPS ou QR code, calcula horas trabalhadas e afastamentos. É um sistema separado, ativado por empresa.',
  },
  {
    chaves: ['comissão', 'comissao', 'comissões', 'comissoes'],
    texto: 'A comissão de cada lavador é calculada por serviço. Quando mais de um lavador participa da mesma ordem, o percentual de cada um é dividido pelo número de lavadores envolvidos.',
  },
  {
    chaves: ['pix'],
    texto: 'O PIX gerado pelo bot é um QR Code estático, feito com a chave PIX cadastrada da empresa — serve pra qualquer valor e não expira.',
  },
];

export async function executarFerramenta(
  nome: string,
  args: any,
  ctx: { empresaId: string; user: WhatsAppUser }
): Promise<string> {
  switch (nome) {
    case 'buscarCliente':
      if (!hasPermission(ctx.user, 'gerenciar_clientes')) return 'O usuário não tem permissão pra ver dados de clientes.';
      return buscarClienteImpl(String(args.termo ?? ''), ctx.empresaId);

    case 'buscarOrdens':
      if (!hasPermission(ctx.user, 'ver_financeiro')) return 'O usuário não tem permissão pra ver ordens/financeiro.';
      return buscarOrdensImpl(String(args.inicio ?? ''), String(args.fim ?? ''), args.tipoVeiculo, ctx.empresaId);

    case 'explicarSistema':
      return explicarSistemaImpl(String(args.topico ?? ''));

    default:
      return 'Ferramenta desconhecida.';
  }
}

async function buscarClienteImpl(termo: string, empresaId: string): Promise<string> {
  if (!termo.trim()) return 'Preciso de um nome ou telefone pra buscar.';

  const clientes = await prisma.cliente.findMany({
    where: {
      empresaId,
      OR: [
        { nome: { contains: termo, mode: 'insensitive' } },
        { telefone: { contains: termo.replace(/\D/g, '') || termo } },
      ],
    },
    include: {
      veiculos: { select: { placa: true, modelo: true } },
      ordens: {
        where: { status: 'FINALIZADO' },
        select: { valorTotal: true, dataFim: true },
        orderBy: { dataFim: 'desc' },
      },
    },
    take: 5,
  });

  if (clientes.length === 0) return `Nenhum cliente encontrado com "${termo}".`;

  return clientes.map(c => {
    const totalGasto = c.ordens.reduce((s, o) => s + o.valorTotal, 0);
    const ultimaVisita = c.ordens[0]?.dataFim
      ? new Date(c.ordens[0].dataFim).toLocaleDateString('pt-BR')
      : 'sem visitas registradas';
    const veiculos = c.veiculos.map(v => `${v.modelo ?? 'veículo'} (${v.placa})`).join(', ') || 'nenhum veículo cadastrado';
    return `Cliente: ${c.nome} · Telefone: ${c.telefone ?? 'não informado'}\n` +
      `Veículos: ${veiculos}\n` +
      `Total de ordens finalizadas: ${c.ordens.length} · Total gasto: R$ ${totalGasto.toFixed(2)}\n` +
      `Última visita: ${ultimaVisita}`;
  }).join('\n---\n');
}

async function buscarOrdensImpl(inicio: string, fim: string, tipoVeiculo: string | undefined, empresaId: string): Promise<string> {
  const dataInicio = new Date(`${inicio}T00:00:00`);
  const dataFim = new Date(`${fim}T23:59:59`);
  if (isNaN(dataInicio.getTime()) || isNaN(dataFim.getTime())) {
    return 'Não consegui entender o período pedido.';
  }

  const ordens = await prisma.ordemServico.findMany({
    where: {
      empresaId,
      status: 'FINALIZADO',
      dataFim: { gte: dataInicio, lte: dataFim },
      ...(tipoVeiculo ? { veiculo: { tipoVeiculo: { equals: tipoVeiculo, mode: 'insensitive' } } } : {}),
    },
    include: { veiculo: { select: { modelo: true, tipoVeiculo: true } } },
    orderBy: { dataFim: 'desc' },
    take: 200,
  });

  if (ordens.length === 0) return `Nenhuma ordem finalizada encontrada nesse período${tipoVeiculo ? ` (${tipoVeiculo})` : ''}.`;

  const total = ordens.reduce((s, o) => s + o.valorTotal, 0);
  const porTipo: Record<string, number> = {};
  for (const o of ordens) {
    const t = o.veiculo?.tipoVeiculo ?? 'ITEM AVULSO';
    porTipo[t] = (porTipo[t] ?? 0) + 1;
  }
  const resumoTipos = Object.entries(porTipo).map(([t, n]) => `${t}: ${n}`).join(', ');

  return `${ordens.length} ordens finalizadas de ${inicio} a ${fim}. Faturamento total: R$ ${total.toFixed(2)}. Por tipo: ${resumoTipos}.`;
}

function explicarSistemaImpl(topico: string): string {
  const t = topico.toLowerCase();
  const item = BASE_CONHECIMENTO.find(b => b.chaves.some(k => t.includes(k)));
  return item?.texto ?? 'Ainda não tenho uma explicação pronta sobre isso.';
}
