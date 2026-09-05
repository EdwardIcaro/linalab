import { Request, Response } from 'express';
import prisma from '../db';
import { botGerarRelatorioFinanceiro } from '../services/botServiceClient';

interface EmpresaRequest extends Request {
  empresaId?: string;
}

/**
 * GET /api/relatorio-financeiro/:token — público, sem autenticação.
 * Serve o relatório congelado gerado pelo bot (dados já computados no
 * momento da geração, não recalcula nada aqui).
 */
export const getRelatorioFinanceiroPublico = async (req: Request, res: Response) => {
  const { token } = req.params;
  if (Array.isArray(token)) return res.status(400).json({ error: 'Token inválido' });

  try {
    const relatorio = await prisma.relatorioFinanceiroLink.findUnique({
      where: { token },
      include: { empresa: { select: { nome: true } } },
    });

    if (!relatorio) return res.status(404).json({ error: 'Relatório não encontrado.', code: 'LINK_NAO_ENCONTRADO' });
    if (relatorio.expiraEm < new Date()) return res.status(410).json({ error: 'Este link expirou. Gere um novo pelo painel.', code: 'LINK_EXPIRADO' });

    res.json({
      empresaNome: relatorio.empresa.nome,
      mesReferencia: relatorio.mesReferencia,
      entradas: relatorio.entradas,
      saidas: relatorio.saidas,
      saldo: relatorio.saldo,
      entradasMesAnt: relatorio.entradasMesAnt,
      saidasMesAnt: relatorio.saidasMesAnt,
      hp: relatorio.hp,
      categorias: relatorio.categorias,
      lancamentos: relatorio.lancamentos,
      insightIA: relatorio.insightIA,
      criadoEm: relatorio.criadoEm,
      expiraEm: relatorio.expiraEm,
    });
  } catch (error) {
    console.error('[RelatorioFinanceiro] Erro ao buscar relatório público:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * POST /api/relatorio-financeiro/gerar — autenticado. Aciona o bot (só ele
 * tem acesso ao Groq e ao motor de cálculo) pra gerar/regenerar o relatório
 * de um mês específico. Default: último mês fechado.
 */
export const gerarRelatorioFinanceiro = async (req: EmpresaRequest, res: Response) => {
  const empresaId = req.empresaId!;
  let { ano, mes } = req.body as { ano?: number; mes?: number };

  if (!ano || !mes) {
    const hoje = new Date();
    mes = hoje.getMonth() === 0 ? 12 : hoje.getMonth();
    ano = hoje.getMonth() === 0 ? hoje.getFullYear() - 1 : hoje.getFullYear();
  }

  try {
    const resultado = await botGerarRelatorioFinanceiro(empresaId, ano, mes);
    res.json({ message: 'Relatório gerado com sucesso', ...resultado });
  } catch (error: any) {
    console.error('[RelatorioFinanceiro] Erro ao gerar relatório:', error);
    if (String(error?.message).includes('422')) {
      return res.status(422).json({ error: 'Sem movimentação financeira nesse período.' });
    }
    res.status(500).json({ error: 'Não foi possível gerar o relatório agora. O bot pode estar offline.' });
  }
};
