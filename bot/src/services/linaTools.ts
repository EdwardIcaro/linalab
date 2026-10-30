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
import { consultarManual } from './linaManual';
import { getDateRangeBRT } from '../utils/dateUtils';

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
      description: 'Busca ordens de serviço da empresa combinando filtros (cliente, lavador, valor, placa, status, período) e lista uma por uma (número, cliente, veículo, valor, lavadores, status, pagamento) com o total. Use pra qualquer pergunta sobre ordens específicas: "ordens do Lucas hoje", "carros da Localiza de R$ 30", "o que tá no pátio", "ordens canceladas da semana". Combine os filtros que a pessoa citou.',
      parameters: {
        type: 'object',
        properties: {
          situacao: { type: 'string', enum: ['finalizadas', 'abertas', 'canceladas', 'todas'], description: 'finalizadas (padrão, data = conclusão) · abertas = na fila, em andamento e aguardando pagamento (o pátio) · canceladas · todas (qualquer status, data = criação)' },
          inicio: { type: 'string', description: 'Data inicial YYYY-MM-DD. Obrigatória para finalizadas, canceladas e todas (exceto quando buscar por placa); para abertas, deixe vazio' },
          fim: { type: 'string', description: 'Data final YYYY-MM-DD (padrão = inicio)' },
          cliente: { type: 'string', description: 'Nome (parcial) do cliente — opcional' },
          lavador: { type: 'string', description: 'Nome (parcial) do lavador — opcional' },
          valor: { type: 'number', description: 'Valor exato da ordem em reais — opcional' },
          placa: { type: 'string', description: 'Placa do veículo — opcional' },
          tipoVeiculo: { type: 'string', description: 'Ex: CARRO, MOTO — opcional' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detalheOrdem',
      description: 'Tudo sobre UMA ordem pelo número: cliente, veículo, serviços com preço, lavadores e comissão de cada um (paga ou não), status, horários (criada, início, fim), pagamentos, desconto, observações e se veio da fila da Localiza. Use quando citarem "ordem 1466", "#940", "a OS 12".',
      parameters: {
        type: 'object',
        properties: { numero: { type: 'number', description: 'Número da ordem' } },
        required: ['numero'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultarPlaca',
      description: 'Ficha de um veículo pela placa: modelo, cor, cliente dono, histórico de ordens (data, serviços, lavador, valor, pagamento) e pedidos da Localiza com essa placa. Use SEMPRE que a mensagem citar uma placa (ex.: TZG6D10, ABC-1234), mesmo que venha só a placa.',
      parameters: {
        type: 'object',
        properties: {
          placa: { type: 'string', description: 'Placa do veículo, com ou sem hífen' },
        },
        required: ['placa'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explicarSistema',
      description: 'Manual do próprio sistema Lina X — como algo funciona ou onde fica: status de ordem, nova ordem/fila de entrada, pagamento e NFE, comissão e fechamento, caixa, histórico x financeiro, fila da Localiza, contas a pagar, portal do lavador, subcontas e cargos, o que a Lina faz no WhatsApp, planos, Data Point, Lina Center, PIX. Não usa dado da empresa.',
      parameters: {
        type: 'object',
        properties: {
          topico: { type: 'string', description: 'A dúvida, com as palavras da pessoa (ex.: "como funciona o fechamento de comissão")' },
        },
        required: ['topico'],
      },
    },
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
      if (!podeConsultarPlaca(ctx.user)) return 'O usuário não tem permissão pra ver ordens.';
      return buscarOrdensImpl(args, ctx.empresaId, hasPermission(ctx.user, 'ver_financeiro'));

    case 'detalheOrdem':
      if (!podeConsultarPlaca(ctx.user)) return 'O usuário não tem permissão pra ver ordens.';
      return detalheOrdemImpl(Number(args.numero), ctx.empresaId, hasPermission(ctx.user, 'ver_financeiro'));

    case 'consultarPlaca':
      if (!podeConsultarPlaca(ctx.user)) return 'O usuário não tem permissão pra consultar veículos.';
      return consultarPlacaImpl(String(args.placa ?? ''), ctx.empresaId, hasPermission(ctx.user, 'ver_financeiro'));

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

const LISTA_MAX = 25; // acima disso só o resumo — o limite de tokens da Groq é apertado

const STATUS_LEGIVEL: Record<string, string> = {
  PENDENTE: 'na fila', EM_ANDAMENTO: 'em andamento', AGUARDANDO_PAGAMENTO: 'aguardando pagamento', FINALIZADO: 'finalizada', CANCELADO: 'cancelada',
};

const STATUS_POR_SITUACAO: Record<string, string[]> = {
  finalizadas: ['FINALIZADO'],
  abertas: ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'],
  canceladas: ['CANCELADO'],
  todas: ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO', 'FINALIZADO', 'CANCELADO'],
};

async function buscarOrdensImpl(args: any, empresaId: string, comValores: boolean): Promise<string> {
  const situacao = STATUS_POR_SITUACAO[args.situacao] ? String(args.situacao) : 'finalizadas';
  const inicio = String(args.inicio ?? '');
  const fim = String(args.fim || inicio);
  const cliente = String(args.cliente ?? '').trim();
  const lavador = String(args.lavador ?? '').trim();
  const valor = args.valor != null && args.valor !== '' && !isNaN(Number(args.valor)) ? Number(args.valor) : null;
  const placa = args.placa ? extrairPlaca(String(args.placa)) ?? String(args.placa).replace(/[^a-z0-9]/gi, '').toUpperCase() : '';
  const tipoVeiculo: string | undefined = args.tipoVeiculo || undefined;

  let periodo: { gte: Date; lte: Date } | undefined;
  if (inicio) {
    const ini = /^\d{4}-\d{2}-\d{2}$/.test(inicio) ? getDateRangeBRT(inicio) : null;
    const fi = /^\d{4}-\d{2}-\d{2}$/.test(fim) ? getDateRangeBRT(fim) : null;
    if (!ini || !fi) return 'Não consegui entender o período pedido.';
    periodo = { gte: ini.start, lte: fi.end };
  } else if (situacao !== 'abertas' && !placa) {
    return `Preciso do período (inicio) pra buscar ordens ${situacao}.`;
  }

  // Finalizada pertence ao dia em que foi concluída; o resto, ao dia em que foi criada
  const campoData = situacao === 'finalizadas' ? 'dataFim' : 'createdAt';
  const ordens = await prisma.ordemServico.findMany({
    where: {
      empresaId,
      status: { in: STATUS_POR_SITUACAO[situacao] as any },
      ...(periodo ? { [campoData]: periodo } : {}),
      ...(cliente ? { cliente: { nome: { contains: cliente, mode: 'insensitive' } } } : {}),
      ...(lavador ? { OR: [
        { lavador: { nome: { contains: lavador, mode: 'insensitive' } } },
        { ordemLavadores: { some: { lavador: { nome: { contains: lavador, mode: 'insensitive' } } } } },
      ] } : {}),
      ...(valor != null ? { valorTotal: valor } : {}),
      ...(placa || tipoVeiculo ? { veiculo: {
        ...(placa ? { placa: { contains: placa, mode: 'insensitive' } } : {}),
        ...(tipoVeiculo ? { tipoVeiculo: { equals: tipoVeiculo, mode: 'insensitive' } } : {}),
      } } : {}),
    },
    include: {
      cliente: { select: { nome: true } },
      veiculo: { select: { modelo: true, placa: true, tipoVeiculo: true } },
      ordemLavadores: { select: { lavador: { select: { nome: true } } } },
      lavador: { select: { nome: true } },
      pagamentos: { where: { status: 'PAGO' }, select: { metodo: true } },
    },
    orderBy: situacao === 'finalizadas' ? { dataFim: 'desc' } : { createdAt: 'asc' },
    take: 200,
  });

  const filtro = [
    cliente && `cliente "${cliente}"`, lavador && `lavador "${lavador}"`, valor != null && `R$ ${valor.toFixed(2)}`,
    placa && `placa ${placa}`, tipoVeiculo,
  ].filter(Boolean).join(', ');
  const quando = periodo ? ` de ${inicio}${fim !== inicio ? ` a ${fim}` : ''}` : '';
  const rotulo = `ordens ${situacao}${quando}`;
  if (ordens.length === 0) return `Nenhuma das ${rotulo}${filtro ? ` (${filtro})` : ''}.`;

  const total = ordens.reduce((s, o) => s + o.valorTotal, 0);
  const linhas = ordens.slice(0, LISTA_MAX).map(o => {
    const item = o.veiculo ? `${o.veiculo.modelo ?? 'veículo'} ${o.veiculo.placa}` : (o.itemAvulso ?? 'item avulso');
    const nomes = o.ordemLavadores.map(l => l.lavador.nome);
    const lavadores = (nomes.length ? nomes : o.lavador ? [o.lavador.nome] : []).join(' e ') || 'sem lavador';
    const status = situacao !== 'finalizadas' ? ` · ${STATUS_LEGIVEL[o.status] ?? o.status}` : '';
    const pago = comValores && o.pagamentos.length ? ` · ${[...new Set(o.pagamentos.map(p => p.metodo))].join('/')}` : '';
    return `#${o.numeroOrdem} · ${o.cliente.nome} · ${item}${comValores ? ` · R$ ${o.valorTotal.toFixed(2)}` : ''} · ${lavadores}${status}${pago}`;
  });
  const resto = ordens.length > LISTA_MAX ? `\n(+${ordens.length - LISTA_MAX} ordens não listadas)` : '';

  return `${ordens.length} ${rotulo}${filtro ? ` (${filtro})` : ''}${comValores ? `. Total: R$ ${total.toFixed(2)}` : ''}.\n${linhas.join('\n')}${resto}`;
}

const fmtHora = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function detalheOrdemImpl(numero: number, empresaId: string, comValores: boolean): Promise<string> {
  if (!Number.isInteger(numero) || numero <= 0) return 'Preciso do número da ordem.';
  const o = await prisma.ordemServico.findFirst({
    where: { empresaId, numeroOrdem: numero },
    include: {
      cliente: { select: { nome: true, telefone: true } },
      veiculo: { select: { modelo: true, placa: true, cor: true } },
      items: { select: { quantidade: true, subtotal: true, nomeCustom: true, servico: { select: { nome: true } }, adicional: { select: { nome: true } } } },
      ordemLavadores: { select: { ganho: true, comissaoPaga: true, lavador: { select: { nome: true } } } },
      lavador: { select: { nome: true } },
      pagamentos: { select: { metodo: true, valor: true, status: true, pagoEm: true } },
    },
  });
  if (!o) return `Não existe ordem #${numero} nesta empresa.`;
  const emp = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { usuarioId: true } });
  const sol = emp ? await prisma.solicitacaoLavagem.findFirst({ where: { usuarioId: emp.usuarioId, ordemId: o.id }, select: { numero: true, aceitaPorNome: true } }) : null;

  const r = (v: number) => `R$ ${v.toFixed(2)}`;
  const item = o.veiculo ? `${[o.veiculo.modelo, o.veiculo.cor].filter(Boolean).join(' ')} ${o.veiculo.placa}` : (o.itemAvulso ?? 'item avulso');
  const servicos = o.items.map(i => {
    const nome = i.servico?.nome ?? i.adicional?.nome ?? i.nomeCustom ?? 'serviço';
    return `${i.quantidade > 1 ? `${i.quantidade}x ` : ''}${nome}${comValores ? ` (${r(i.subtotal)})` : ''}`;
  }).join(', ') || 'sem serviços';
  const lavs = o.ordemLavadores.length
    ? o.ordemLavadores.map(l => `${l.lavador.nome}${comValores ? ` ${r(l.ganho)} ${l.comissaoPaga ? '(paga)' : '(em aberto)'}` : ''}`).join(', ')
    : o.lavador?.nome ?? 'sem lavador';
  const linhas = [
    `Ordem #${o.numeroOrdem} · ${STATUS_LEGIVEL[o.status] ?? o.status}`,
    `Cliente: ${o.cliente.nome}${o.cliente.telefone ? ` · ${o.cliente.telefone}` : ''} · ${item}`,
    `Serviços: ${servicos}`,
    `Lavador(es): ${lavs}`,
    `Criada ${fmtHora(o.createdAt)}${o.dataInicio ? ` · início ${fmtHora(o.dataInicio)}` : ''}${o.dataFim ? ` · fim ${fmtHora(o.dataFim)}` : ''}`,
  ];
  if (comValores) {
    linhas.push(`Valor: ${r(o.valorTotal)}${o.desconto ? ` · desconto ${r(o.desconto)}` : ''} · ${o.pago ? 'pago' : 'NÃO pago'}`);
    if (o.pagamentos.length) linhas.push(`Pagamentos: ${o.pagamentos.map(p => `${p.metodo} ${r(p.valor)} ${p.status.toLowerCase()}${p.pagoEm ? ` em ${fmtHora(p.pagoEm)}` : ''}`).join(' · ')}`);
  }
  if (o.observacoes) linhas.push(`Observações: ${o.observacoes}`);
  if (sol) linhas.push(`Veio da fila da Localiza (pedido Nº ${sol.numero}${sol.aceitaPorNome ? `, aceito por ${sol.aceitaPorNome}` : ''})`);
  return linhas.join('\n');
}

// ── Placa ───────────────────────────────────────────────────────────────────
// Padrão antigo (ABC1234) e Mercosul (ABC1D23), com ou sem hífen/espaço.
const PLACA_RE = /\b([A-Z]{3})[-\s]?(\d[A-Z0-9]\d{2})\b/i;

/** Placa citada na mensagem, normalizada (TZG6D10), ou null. */
export function extrairPlaca(texto: string): string | null {
  const m = texto.match(PLACA_RE);
  return m ? (m[1] + m[2]).toUpperCase() : null;
}

export function podeConsultarPlaca(user: WhatsAppUser): boolean {
  return hasPermission(user, 'gerenciar_ordens') || hasPermission(user, 'gerenciar_clientes') || hasPermission(user, 'ver_financeiro');
}

const PLACA_HISTORICO_MAX = 10;
const fmtDia = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/** Só enxerga o que é da empresa ativa — placa é única no banco todo, mas o dono pode ser de outra empresa. */
export async function consultarPlacaImpl(placaBruta: string, empresaId: string, comValores: boolean): Promise<string> {
  const placa = extrairPlaca(placaBruta) ?? placaBruta.replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) return `"${placaBruta}" não parece uma placa válida.`;
  const variantes = [placa, `${placa.slice(0, 3)}-${placa.slice(3)}`];
  const placaWhere = { OR: variantes.map(v => ({ placa: { equals: v, mode: 'insensitive' as const } })) };

  const emp = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { usuarioId: true } });
  const [veiculo, ordens, totais, lcVeiculo, solicitacoes] = await Promise.all([
    prisma.veiculo.findFirst({ where: placaWhere, include: { cliente: { select: { nome: true, telefone: true, empresaId: true } } } }),
    prisma.ordemServico.findMany({
      where: { empresaId, veiculo: placaWhere },
      include: {
        items: { select: { quantidade: true, nomeCustom: true, servico: { select: { nome: true } }, adicional: { select: { nome: true } } } },
        ordemLavadores: { select: { lavador: { select: { nome: true } } } },
        lavador: { select: { nome: true } },
        pagamentos: { where: { status: 'PAGO' }, select: { metodo: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: PLACA_HISTORICO_MAX,
    }),
    prisma.ordemServico.aggregate({ where: { empresaId, veiculo: placaWhere }, _count: true, _sum: { valorTotal: true } }),
    prisma.lcVeiculo.findFirst({
      where: { ...placaWhere, cliente: { empresaId } },
      include: {
        cliente: { select: { nome: true } },
        ordens: { where: { empresaId }, orderBy: { createdAt: 'desc' }, take: 5, select: { numeroOrdem: true, status: true, valorTotal: true, createdAt: true } },
      },
    }),
    emp ? prisma.solicitacaoLavagem.findMany({
      where: { usuarioId: emp.usuarioId, ...placaWhere }, orderBy: { createdAt: 'desc' }, take: 5,
    }) : Promise.resolve([]),
  ]);

  const veiculoDaEmpresa = veiculo && (veiculo.cliente.empresaId === empresaId || ordens.length > 0);
  if (!veiculoDaEmpresa && !lcVeiculo && solicitacoes.length === 0) {
    return `A placa ${placa} não tem cadastro, ordem nem pedido da Localiza nesta empresa.`;
  }

  const partes: string[] = [];
  const valor = (v: number) => comValores ? ` · R$ ${v.toFixed(2)}` : '';

  if (veiculoDaEmpresa) {
    const desc = [veiculo.modelo, veiculo.cor, veiculo.ano, veiculo.subtipoVeiculo ?? veiculo.tipoVeiculo].filter(Boolean).join(' · ');
    partes.push(`Veículo ${placa}: ${desc || 'sem detalhes'}\nCliente: ${veiculo.cliente.nome}${veiculo.cliente.telefone ? ` · ${veiculo.cliente.telefone}` : ''}\nCadastrado em ${fmtDia(veiculo.createdAt)}`);

    if (ordens.length === 0) {
      partes.push('Nenhuma ordem desta empresa com essa placa.');
    } else {
      const total = comValores ? ` · total R$ ${(totais._sum.valorTotal ?? 0).toFixed(2)}` : '';
      const linhas = ordens.map(o => {
        const servicos = o.items.map(i => {
          const nome = i.servico?.nome ?? i.adicional?.nome ?? i.nomeCustom ?? 'serviço';
          return i.quantidade > 1 ? `${i.quantidade}x ${nome}` : nome;
        }).join(', ') || 'sem serviços';
        const nomes = o.ordemLavadores.map(l => l.lavador.nome);
        const lavadores = (nomes.length ? nomes : o.lavador ? [o.lavador.nome] : []).join(' e ') || 'sem lavador';
        const quando = o.dataFim ? `finalizada ${fmtDia(o.dataFim)}` : `aberta ${fmtDia(o.createdAt)} · ${STATUS_LEGIVEL[o.status] ?? o.status}`;
        const pago = comValores ? (o.pago ? ` · pago${o.pagamentos.length ? ` (${[...new Set(o.pagamentos.map(p => p.metodo))].join('/')})` : ''}` : ' · NÃO pago') : '';
        return `#${o.numeroOrdem} · ${quando} · ${servicos} · ${lavadores}${valor(o.valorTotal)}${pago}`;
      });
      const resto = totais._count > ordens.length ? `\n(mostrando as ${ordens.length} mais recentes)` : '';
      partes.push(`${totais._count} ordem(ns) desta empresa${total}:\n${linhas.join('\n')}${resto}`);
    }
  }

  if (lcVeiculo) {
    const linhas = lcVeiculo.ordens.map(o => `#${o.numeroOrdem} · ${fmtDia(o.createdAt)} · ${STATUS_LEGIVEL[o.status] ?? o.status}${valor(o.valorTotal)}`);
    partes.push(`Lina Center (oficina): ${lcVeiculo.modelo} · cliente ${lcVeiculo.cliente.nome}\n${linhas.join('\n') || 'Nenhuma ordem na oficina.'}`);
  }

  if (solicitacoes.length) {
    partes.push(`Pedidos da Localiza com essa placa:\n` + solicitacoes.map(s =>
      `• Nº ${s.numero} · ${fmtDia(s.createdAt)} · ${s.status.toLowerCase()}${s.aceitaPorNome ? ` por ${s.aceitaPorNome}` : ''}${s.agencia ? ` · ${s.agencia}` : ''}`
    ).join('\n'));
  }

  return partes.join('\n\n');
}

function explicarSistemaImpl(topico: string): string {
  return consultarManual(topico);
}

// ── Lavador ─────────────────────────────────────────────────────────────────
// Só enxerga as PRÓPRIAS ordens: lavadorId/empresaId vêm da identificação do número.

export const FERRAMENTAS_LAVADOR: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'minhasOrdens',
      description: 'Ordens finalizadas em que o próprio lavador trabalhou num período: quantidade de carros, modelos/placas e comissão ganha. Use SEMPRE que a pergunta for sobre um período que não seja hoje ou o mês atual — inclusive continuações curtas como "e em agosto?" ou "e semana passada?".',
      parameters: {
        type: 'object',
        properties: {
          inicio: { type: 'string', description: 'Data inicial, formato YYYY-MM-DD' },
          fim: { type: 'string', description: 'Data final, formato YYYY-MM-DD' },
        },
        required: ['inicio', 'fim'],
      },
    },
  },
];

export async function executarFerramentaLavador(
  nome: string,
  args: any,
  ctx: { empresaId: string; lavadorId: string },
): Promise<string> {
  if (nome !== 'minhasOrdens') return 'Ferramenta desconhecida.';
  const inicio = String(args.inicio ?? '');
  const fim = String(args.fim ?? '');
  // Datas em horário de Brasília (UTC-3), igual o resto do bot
  const dataInicio = new Date(`${inicio}T00:00:00-03:00`);
  const dataFim = new Date(`${fim}T23:59:59.999-03:00`);
  if (isNaN(dataInicio.getTime()) || isNaN(dataFim.getTime())) return 'Não consegui entender o período pedido.';

  const lavador = await prisma.lavador.findUnique({ where: { id: ctx.lavadorId }, select: { comissao: true } });
  const ordens = await prisma.ordemServico.findMany({
    where: {
      empresaId: ctx.empresaId,
      status: 'FINALIZADO',
      OR: [{ lavadorId: ctx.lavadorId }, { ordemLavadores: { some: { lavadorId: ctx.lavadorId } } }],
      dataFim: { gte: dataInicio, lte: dataFim },
    },
    include: {
      veiculo: { select: { modelo: true, placa: true } },
      ordemLavadores: { where: { lavadorId: ctx.lavadorId }, select: { ganho: true, comissaoPaga: true } },
    },
    orderBy: { dataFim: 'desc' },
    take: 300,
  });
  if (ordens.length === 0) return `Nenhuma ordem finalizada de ${inicio} a ${fim}.`;

  let ganho = 0, aReceber = 0;
  for (const o of ordens) {
    const e = o.ordemLavadores[0];
    const g = e ? e.ganho : o.valorTotal * ((lavador?.comissao ?? 0) / 100);
    ganho += g;
    if (e && !e.comissaoPaga) aReceber += g;
  }
  const carros = ordens.slice(0, 40).map(o => {
    const dia = o.dataFim ? new Date(o.dataFim).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : '';
    return `${dia} ${o.veiculo?.modelo ?? 'item avulso'}${o.veiculo?.placa ? ` (${o.veiculo.placa})` : ''}`;
  });
  return `${ordens.length} ordens finalizadas de ${inicio} a ${fim}. Comissão nesse período: R$ ${ganho.toFixed(2)} (ainda a receber: R$ ${aReceber.toFixed(2)}).\n` +
    `Carros${ordens.length > 40 ? ' (os 40 mais recentes)' : ''}: ${carros.join('; ')}`;
}
