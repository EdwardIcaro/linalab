/**
 * Relatório mensal de "Saúde Financeira" — gerado automaticamente todo dia 1
 * (cron em src/cron/relatorioFinanceiroMensal.ts) para o mês recém-fechado.
 * Dados congelados no momento da geração (o mês já terminou, não precisa
 * recalcular ao vivo) e servidos depois via link público pelo backend.
 */

import prisma from '../db';
import { gerarTokenCurto } from '../utils/tokenUtils';
import { chatCompletion } from './groqService';
import { getMonthRangeBRT } from '../utils/dateUtils';

const CATEGORIAS_SAIDA = ['Produtos', 'Contas', 'Manutenção', 'Vale/Adiantamento', 'Outros'];
const LINK_EXPIRA_DIAS = 7;

interface ResultadoGeracao {
  token: string;
  empresaNome: string;
  hp: number;
}

/**
 * Gera (ou regenera) o relatório de um mês específico para uma empresa.
 * Retorna null se não houve nenhuma movimentação financeira no período.
 */
export async function gerarRelatorioMensal(empresaId: string, ano: number, mes: number): Promise<ResultadoGeracao | null> {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true } });
  if (!empresa) return null;

  const { start, end } = getMonthRangeBRT(ano, mes);
  const mesAnt = mes === 1 ? 12 : mes - 1;
  const anoAnt = mes === 1 ? ano - 1 : ano;
  const { start: startAnt, end: endAnt } = getMonthRangeBRT(anoAnt, mesAnt);

  const [pagamentos, pagamentosAnt, saidasRegistros, saidasRegistrosAnt] = await Promise.all([
    prisma.pagamento.findMany({ where: { empresaId, status: 'PAGO', pagoEm: { gte: start, lte: end } }, select: { valor: true } }),
    prisma.pagamento.findMany({ where: { empresaId, status: 'PAGO', pagoEm: { gte: startAnt, lte: endAnt } }, select: { valor: true } }),
    prisma.caixaRegistro.findMany({
      where: { empresaId, tipo: 'SAIDA', data: { gte: start, lte: end } },
      select: { data: true, descricao: true, categoriaGasto: true, valor: true },
      orderBy: { data: 'asc' },
    }),
    prisma.caixaRegistro.findMany({ where: { empresaId, tipo: 'SAIDA', data: { gte: startAnt, lte: endAnt } }, select: { valor: true } }),
  ]);

  const entradas = arred(pagamentos.reduce((s, p) => s + p.valor, 0));
  const entradasMesAnt = arred(pagamentosAnt.reduce((s, p) => s + p.valor, 0));
  const saidas = arred(saidasRegistros.reduce((s, r) => s + r.valor, 0));
  const saidasMesAnt = arred(saidasRegistrosAnt.reduce((s, r) => s + r.valor, 0));

  if (entradas === 0 && saidas === 0) return null;

  const saldo = arred(entradas - saidas);
  const margem = entradas > 0 ? saldo / entradas : -1;
  const hp = Math.max(0, Math.min(100, Math.round(50 + margem * 100)));

  const categoriasMap = new Map<string, number>();
  for (const cat of CATEGORIAS_SAIDA) categoriasMap.set(cat, 0);
  for (const r of saidasRegistros) {
    const cat = CATEGORIAS_SAIDA.includes(r.categoriaGasto || '') ? (r.categoriaGasto as string) : 'Outros';
    categoriasMap.set(cat, (categoriasMap.get(cat) || 0) + r.valor);
  }
  const categorias = CATEGORIAS_SAIDA
    .map(nome => ({ nome, valor: arred(categoriasMap.get(nome) || 0) }))
    .filter(c => c.valor > 0);

  const lancamentos = saidasRegistros.map(r => ({
    data: r.data.toISOString().slice(0, 10),
    descricao: r.descricao.replace(/^\[[^\]]+\]\s*/, ''), // remove o prefixo [Despesa]/[Adiantamento]
    categoria: CATEGORIAS_SAIDA.includes(r.categoriaGasto || '') ? r.categoriaGasto : 'Outros',
    valor: r.valor,
  }));

  const insightIA = await gerarInsightIA({ entradas, saidas, saldo, entradasMesAnt, saidasMesAnt, categorias, hp });

  const token = gerarTokenCurto(8);
  const expiraEm = new Date(Date.now() + LINK_EXPIRA_DIAS * 24 * 60 * 60 * 1000);
  const mesReferencia = `${ano}-${String(mes).padStart(2, '0')}`;

  // Regenerar substitui um relatório anterior do mesmo mês (evita acumular duplicatas)
  await prisma.relatorioFinanceiroLink.deleteMany({ where: { empresaId, mesReferencia } });
  await prisma.relatorioFinanceiroLink.create({
    data: { token, empresaId, mesReferencia, entradas, saidas, saldo, entradasMesAnt, saidasMesAnt, hp, categorias, lancamentos, insightIA, expiraEm },
  });

  return { token, empresaNome: empresa.nome, hp };
}

function arred(n: number): number {
  return Math.round(n * 100) / 100;
}

async function gerarInsightIA(dados: {
  entradas: number; saidas: number; saldo: number;
  entradasMesAnt: number; saidasMesAnt: number;
  categorias: Array<{ nome: string; valor: number }>;
  hp: number;
}): Promise<string> {
  const categoriasTexto = dados.categorias
    .slice().sort((a, b) => b.valor - a.valor)
    .map(c => `${c.nome}: R$ ${c.valor.toFixed(2)}`).join(', ');

  const prompt = `Analise a saúde financeira do mês de uma empresa e escreva uma observação curta (2-3 frases, direto ao ponto, sem saudação).
Dados:
- Entradas: R$ ${dados.entradas.toFixed(2)} (mês anterior: R$ ${dados.entradasMesAnt.toFixed(2)})
- Saídas: R$ ${dados.saidas.toFixed(2)} (mês anterior: R$ ${dados.saidasMesAnt.toFixed(2)})
- Saldo: R$ ${dados.saldo.toFixed(2)}
- Saídas por categoria: ${categoriasTexto || 'sem dados'}
- Índice de saúde financeira (HP, 0-100): ${dados.hp}

Destaque o que mais chamou atenção: a categoria que mais cresceu, se o saldo melhorou ou piorou, algo fora do padrão. Seja específico com números e percentuais quando der pra calcular. Não repita os números crus sem contexto — interprete.`;

  try {
    return await chatCompletion(prompt, '', 'Responda só com a análise, sem markdown de título, sem saudação, tom direto.');
  } catch (e) {
    console.error('[RelatorioFinanceiro] Erro ao gerar insight IA:', e);
    return 'Não consegui gerar uma análise mais detalhada desse mês — mas os números completos estão logo abaixo.';
  }
}
