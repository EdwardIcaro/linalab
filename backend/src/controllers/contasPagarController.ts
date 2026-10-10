import { Request, Response } from 'express';
import prisma from '../db';
import { getTodayStrBRT } from '../utils/dateUtils';
import { sistemaPrincipalDaEmpresa } from '../utils/sistemaEmpresa';
import {
  TIPOS_CONTA, TipoConta, diaParaDate, dateParaDia, somarDias, diasAteVencimento,
  vencimentoMensal, proximoVencimentoMensal,
} from '../services/contasPagarService';

/**
 * CONTAS A PAGAR — mesma API para Lina Wash e Lina Center (escopo = empresa do token).
 * Rotas protegidas por ver_financeiro (dono sempre passa).
 */

interface EmpresaRequest extends Request {
  empresaId?: string;
}

const FORMAS = ['PIX', 'DINHEIRO', 'CARTAO', 'BOLETO', 'TRANSFERENCIA'];
// FormaPagamento do caixa do Lina Wash só tem DINHEIRO | PIX | CARTAO | NFE | NA
const FORMA_NO_CAIXA: Record<string, 'PIX' | 'DINHEIRO' | 'CARTAO' | 'NA'> = {
  PIX: 'PIX', DINHEIRO: 'DINHEIRO', CARTAO: 'CARTAO', BOLETO: 'NA', TRANSFERENCIA: 'PIX',
};

const diaValido = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function formatar(c: any, hoje: string) {
  const dias = diasAteVencimento(c.vencimento, hoje);
  return {
    ...c,
    vencimento: dateParaDia(c.vencimento),
    pagaEm: c.pagaEm ? dateParaDia(c.pagaEm) : null,
    diasParaVencer: dias,
    situacao: c.status === 'PAGA' ? 'PAGA' : dias < 0 ? 'VENCIDA' : dias <= 3 ? 'VENCE_EM_BREVE' : 'EM_DIA',
  };
}

/**
 * Monta o vencimento conforme o tipo:
 * AVULSA → vencimento informado; MENSAL → diaMensal no mês de inicio (YYYY-MM);
 * A_PRAZO → dataCompra + prazoDias
 */
function calcularVencimento(body: any): { venc?: string; erro?: string } {
  const tipo = body.tipo as TipoConta;
  if (tipo === 'AVULSA') {
    if (!diaValido(body.vencimento)) return { erro: 'Informe a data de vencimento.' };
    return { venc: body.vencimento };
  }
  if (tipo === 'MENSAL') {
    const dia = Number(body.diaMensal);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) return { erro: 'Informe o dia do mês (1 a 31).' };
    const inicio = typeof body.inicio === 'string' && /^\d{4}-\d{2}$/.test(body.inicio) ? body.inicio : getTodayStrBRT().slice(0, 7);
    const [ano, mes] = inicio.split('-').map(Number);
    let venc = vencimentoMensal(ano, mes, dia);
    // Se o dia do mês de início já passou, a primeira é a do mês seguinte
    if (venc < getTodayStrBRT()) venc = proximoVencimentoMensal(diaParaDate(venc), dia);
    return { venc };
  }
  const prazo = Number(body.prazoDias);
  if (!Number.isInteger(prazo) || prazo < 1 || prazo > 365) return { erro: 'Informe o prazo em dias (1 a 365).' };
  const compra = diaValido(body.dataCompra) ? body.dataCompra : getTodayStrBRT();
  return { venc: somarDias(compra, prazo) };
}

/** GET /api/contas-pagar — contas (abertas + pagas nos últimos 60 dias), resumo e itens frequentes */
export const listarContasPagar = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId!;
    const hoje = getTodayStrBRT();
    const [abertas, pagas, frequentes, sistema] = await Promise.all([
      prisma.contaPagar.findMany({ where: { empresaId, status: 'PENDENTE' }, orderBy: { vencimento: 'asc' } }),
      prisma.contaPagar.findMany({
        where: { empresaId, status: 'PAGA', pagaEm: { gte: diaParaDate(somarDias(hoje, -60)) } },
        orderBy: { pagaEm: 'desc' },
      }),
      prisma.contaPagarFrequente.findMany({ where: { empresaId }, orderBy: { descricao: 'asc' } }),
      sistemaPrincipalDaEmpresa(empresaId),
    ]);

    const lista = [...abertas, ...pagas].map(c => formatar(c, hoje));
    const abertasF = lista.filter(c => c.status === 'PENDENTE');
    const soma = (l: any[], campo = 'valor') => Math.round(l.reduce((s, c) => s + (c[campo] || 0), 0) * 100) / 100;
    const mesAtual = hoje.slice(0, 7);
    const vencidas = abertasF.filter(c => c.diasParaVencer < 0);
    const semana = abertasF.filter(c => c.diasParaVencer >= 0 && c.diasParaVencer <= 7);
    const pagasMes = lista.filter(c => c.status === 'PAGA' && (c.pagaEm || '').startsWith(mesAtual));

    res.json({
      contas: lista,
      frequentes,
      // Lina Center não tem caixa de despesas → front esconde "lançar saída no caixa"
      temCaixa: sistema === 'lina-wash',
      resumo: {
        vencidas: { total: soma(vencidas), qtd: vencidas.length },
        hoje: { qtd: abertasF.filter(c => c.diasParaVencer === 0).length },
        proximos7: { total: soma(semana), qtd: semana.length },
        abertas: { total: soma(abertasF), qtd: abertasF.length },
        pagasMes: { total: soma(pagasMes, 'valorPago'), qtd: pagasMes.length },
      },
    });
  } catch (error) {
    console.error('[ContasPagar] listar:', error);
    res.status(500).json({ error: 'Erro ao carregar contas a pagar' });
  }
};

/** GET /api/contas-pagar/resumo — cartão do dashboard (vencidas + próximas 3) */
export const resumoContasPagar = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId!;
    const hoje = getTodayStrBRT();
    const abertas = await prisma.contaPagar.findMany({
      where: { empresaId, status: 'PENDENTE', vencimento: { lte: diaParaDate(somarDias(hoje, 30)) } },
      orderBy: { vencimento: 'asc' },
      select: { id: true, descricao: true, valor: true, vencimento: true, status: true, tipo: true },
    });
    const lista = abertas.map(c => formatar(c, hoje));
    const vencidas = lista.filter(c => c.diasParaVencer < 0);
    res.json({
      vencidas: { total: Math.round(vencidas.reduce((s, c) => s + c.valor, 0) * 100) / 100, qtd: vencidas.length },
      hoje: lista.filter(c => c.diasParaVencer === 0).length,
      proximas: lista.filter(c => c.diasParaVencer >= 0).slice(0, 3),
    });
  } catch (error) {
    console.error('[ContasPagar] resumo:', error);
    res.status(500).json({ error: 'Erro ao carregar resumo' });
  }
};

/** POST /api/contas-pagar */
export const criarContaPagar = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId!;
    const b = req.body || {};
    const descricao = String(b.descricao || '').trim();
    const valor = Number(b.valor);
    const tipo = b.tipo as TipoConta;

    if (!descricao) return res.status(400).json({ error: 'Informe o que vai ser pago.' });
    if (!isFinite(valor) || valor <= 0) return res.status(400).json({ error: 'Informe um valor maior que zero.' });
    if (!TIPOS_CONTA.includes(tipo)) return res.status(400).json({ error: 'Tipo de conta inválido.' });
    const { venc, erro } = calcularVencimento(b);
    if (erro) return res.status(400).json({ error: erro });

    const lembrar = Math.min(30, Math.max(0, Number.isInteger(Number(b.lembrarDiasAntes)) ? Number(b.lembrarDiasAntes) : 3));
    const fornecedorNome = b.fornecedorNome ? String(b.fornecedorNome).trim().slice(0, 120) || null : null;

    const conta = await prisma.contaPagar.create({
      data: {
        empresaId,
        descricao: descricao.slice(0, 200),
        valor: Math.round(valor * 100) / 100,
        vencimento: diaParaDate(venc!),
        tipo,
        diaMensal: tipo === 'MENSAL' ? Number(b.diaMensal) : null,
        prazoDias: tipo === 'A_PRAZO' ? Number(b.prazoDias) : null,
        fornecedorNome,
        lembrarDiasAntes: lembrar,
        criadoPor: (req as any).usuarioNome || null,
      },
    });

    // A prazo pode virar item frequente (relançar com o mesmo prazo/valor)
    if (tipo === 'A_PRAZO' && b.salvarFrequente) {
      await prisma.contaPagarFrequente.upsert({
        where: { empresaId_descricao: { empresaId, descricao: conta.descricao } },
        update: { valor: conta.valor, prazoDias: conta.prazoDias!, fornecedorNome },
        create: { empresaId, descricao: conta.descricao, valor: conta.valor, prazoDias: conta.prazoDias!, fornecedorNome },
      });
    }

    res.status(201).json({ conta: formatar(conta, getTodayStrBRT()) });
  } catch (error) {
    console.error('[ContasPagar] criar:', error);
    res.status(500).json({ error: 'Erro ao salvar a conta' });
  }
};

/** PUT /api/contas-pagar/:id — edita descrição, valor, vencimento, fornecedor e lembrete */
export const editarContaPagar = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId!;
    const conta = await prisma.contaPagar.findFirst({ where: { id: req.params.id as string, empresaId } });
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
    if (conta.status === 'PAGA') return res.status(400).json({ error: 'Conta já paga não pode ser editada.' });

    const b = req.body || {};
    const data: any = {};
    if (b.descricao !== undefined) {
      const d = String(b.descricao).trim();
      if (!d) return res.status(400).json({ error: 'Informe o que vai ser pago.' });
      data.descricao = d.slice(0, 200);
    }
    if (b.valor !== undefined) {
      const v = Number(b.valor);
      if (!isFinite(v) || v <= 0) return res.status(400).json({ error: 'Informe um valor maior que zero.' });
      data.valor = Math.round(v * 100) / 100;
    }
    if (b.vencimento !== undefined) {
      if (!diaValido(b.vencimento)) return res.status(400).json({ error: 'Data de vencimento inválida.' });
      data.vencimento = diaParaDate(b.vencimento);
    }
    if (b.fornecedorNome !== undefined) data.fornecedorNome = String(b.fornecedorNome || '').trim().slice(0, 120) || null;
    if (b.lembrarDiasAntes !== undefined) data.lembrarDiasAntes = Math.min(30, Math.max(0, Number(b.lembrarDiasAntes) || 0));

    const atualizada = await prisma.contaPagar.update({ where: { id: conta.id }, data });
    res.json({ conta: formatar(atualizada, getTodayStrBRT()) });
  } catch (error) {
    console.error('[ContasPagar] editar:', error);
    res.status(500).json({ error: 'Erro ao editar a conta' });
  }
};

/** DELETE /api/contas-pagar/:id — remove conta em aberto (paga fica no histórico) */
export const excluirContaPagar = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId!;
    const r = await prisma.contaPagar.deleteMany({ where: { id: req.params.id as string, empresaId, status: 'PENDENTE' } });
    if (r.count === 0) return res.status(404).json({ error: 'Conta não encontrada ou já paga.' });
    res.json({ ok: true });
  } catch (error) {
    console.error('[ContasPagar] excluir:', error);
    res.status(500).json({ error: 'Erro ao excluir a conta' });
  }
};

/**
 * POST /api/contas-pagar/:id/pagar  body: { valorPago, pagaEm, formaPagamento, lancarCaixa }
 * Mensal → cria a do mês seguinte. Lina Wash + lancarCaixa → saída no caixa
 * (mesmo lançamento de /caixa/saida: fornecedor por nome, categoria "Contas").
 */
export const pagarContaPagar = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId!;
    const b = req.body || {};
    const conta = await prisma.contaPagar.findFirst({ where: { id: req.params.id as string, empresaId } });
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
    if (conta.status === 'PAGA') return res.status(409).json({ error: 'Essa conta já foi paga.' });

    const valorPago = b.valorPago !== undefined ? Number(b.valorPago) : conta.valor;
    if (!isFinite(valorPago) || valorPago < 0) return res.status(400).json({ error: 'Valor pago inválido.' });
    const forma = FORMAS.includes(b.formaPagamento) ? b.formaPagamento : 'PIX';
    const pagaEm = diaValido(b.pagaEm) ? b.pagaEm : getTodayStrBRT();

    const sistema = await sistemaPrincipalDaEmpresa(empresaId);
    const lancarCaixa = !!b.lancarCaixa && sistema === 'lina-wash' && valorPago > 0;
    const usuarioNome = (req as any).usuarioNome as string | undefined;

    const resultado = await prisma.$transaction(async (tx) => {
      let caixaRegistroId: string | null = null;
      if (lancarCaixa) {
        let fornecedorId: string | undefined;
        if (conta.fornecedorNome) {
          const f = await tx.fornecedor.findFirst({ where: { nome: conta.fornecedorNome, empresaId } })
            || await tx.fornecedor.create({ data: { nome: conta.fornecedorNome, empresaId } });
          fornecedorId = f.id;
        }
        const reg = await tx.caixaRegistro.create({
          data: {
            empresaId,
            tipo: 'SAIDA',
            valor: Math.round(valorPago * 100) / 100,
            formaPagamento: FORMA_NO_CAIXA[forma],
            descricao: `[Contas] ${conta.descricao}`,
            categoriaGasto: 'Contas',
            fornecedorId,
            origem: 'contas-pagar',
            lancadoPor: usuarioNome || null,
            data: pagaEm === getTodayStrBRT() ? new Date() : diaParaDate(pagaEm),
          },
        });
        caixaRegistroId = reg.id;
      }

      // Marca só se ainda estiver pendente (duas abas pagando ao mesmo tempo)
      const marcada = await tx.contaPagar.updateMany({
        where: { id: conta.id, status: 'PENDENTE' },
        data: { status: 'PAGA', pagaEm: diaParaDate(pagaEm), valorPago: Math.round(valorPago * 100) / 100, formaPagamento: forma, caixaRegistroId },
      });
      if (marcada.count === 0) throw new Error('JA_PAGA');

      let proxima = null;
      if (conta.tipo === 'MENSAL' && conta.diaMensal) {
        proxima = await tx.contaPagar.create({
          data: {
            empresaId,
            descricao: conta.descricao,
            valor: conta.valor,
            vencimento: diaParaDate(proximoVencimentoMensal(conta.vencimento, conta.diaMensal)),
            tipo: 'MENSAL',
            diaMensal: conta.diaMensal,
            fornecedorNome: conta.fornecedorNome,
            lembrarDiasAntes: conta.lembrarDiasAntes,
            criadoPor: conta.criadoPor,
          },
        });
      }
      return { caixaLancado: !!caixaRegistroId, proximaVencimento: proxima ? dateParaDia(proxima.vencimento) : null };
    }, { timeout: 30000 });

    res.json({ ok: true, ...resultado });
  } catch (error: any) {
    if (error?.message === 'JA_PAGA') return res.status(409).json({ error: 'Essa conta já foi paga.' });
    console.error('[ContasPagar] pagar:', error);
    res.status(500).json({ error: 'Erro ao registrar o pagamento' });
  }
};

/** DELETE /api/contas-pagar/frequentes/:id */
export const excluirFrequente = async (req: EmpresaRequest, res: Response) => {
  try {
    const r = await prisma.contaPagarFrequente.deleteMany({ where: { id: req.params.id as string, empresaId: req.empresaId } });
    if (r.count === 0) return res.status(404).json({ error: 'Item não encontrado' });
    res.json({ ok: true });
  } catch (error) {
    console.error('[ContasPagar] excluirFrequente:', error);
    res.status(500).json({ error: 'Erro ao remover o item' });
  }
};
