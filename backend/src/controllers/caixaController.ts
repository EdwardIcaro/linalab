import { Request, Response } from 'express';
import prisma from '../db';
import { Prisma, CaixaRegistro, FechamentoCaixa, Adiantamento, Fornecedor, Lavador, OrdemServico, Veiculo, Pagamento } from '@prisma/client';
import { notifySaidaRegistrada, notifyComissaoFechada } from '../services/whatsappNotificationService';
import { getWorkdayRangeBRT } from '../utils/dateUtils';

interface EmpresaRequest extends Request {
    empresaId?: string;
    usuarioNome?: string;
}

// Define types for objects with relations
type PagamentoComOrdem = Pagamento & {
    ordem: {
        id: string;
        veiculo: {
            placa: string;
            modelo: string | null;
        };
    };
};

type PagamentoComVeiculo = Pagamento & {
    ordem: {
        veiculo: {
            placa: string;
        };
    };
};

type RegistroComDependencias = CaixaRegistro & {
    fornecedor: Fornecedor | null;
    lavador: Lavador | null;
};

type HistoricoItem = {
    id: string;
    tipo: string;
    data: Date | null;
    valor: number;
    formaPagamento: string | null;
    descricao: string;
    ordemId?: string;
    lavador?: Lavador | null;
    fornecedor?: Fornecedor | null;
};

// getWorkdayRangeBRT importado de dateUtils — timezone correto (BRT/UTC-3)

export const getStatusCaixa = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    try {
        const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
        const horarioAbertura = empresa?.horarioAbertura || '07:00';
        const { start, end } = getWorkdayRangeBRT(new Date(), horarioAbertura);

        const [abertura, fechamento] = await Promise.all([
            prisma.aberturaCaixa.findFirst({
                where: { empresaId, data: { gte: start, lte: end } },
                orderBy: { data: 'desc' },
            }),
            prisma.fechamentoCaixa.findFirst({
                where: { empresaId, data: { gte: start, lte: end } },
                orderBy: { data: 'desc' },
            }),
        ]);

        const isOpen = !!abertura && !fechamento;
        const notOpened = !abertura;

        // Parse paymentMethodsConfig
        let paymentMethodsConfig: Record<string, boolean> = { DINHEIRO: true, PIX: true, CARTAO: true, NFE: false };
        if (empresa?.paymentMethodsConfig) {
            try {
                const raw = typeof empresa.paymentMethodsConfig === 'string'
                    ? JSON.parse(empresa.paymentMethodsConfig)
                    : empresa.paymentMethodsConfig;
                paymentMethodsConfig = raw;
            } catch (_) {}
        }

        // Saldo físico em dinheiro (útil para o modal de sangria)
        let saldoDinheiro = 0;
        if (isOpen && abertura) {
            const [pagsDinheiro, saidasDinheiro] = await Promise.all([
                prisma.pagamento.aggregate({
                    where: { empresaId, status: 'PAGO', metodo: 'DINHEIRO', pagoEm: { gte: start, lte: end } },
                    _sum: { valor: true },
                }),
                prisma.caixaRegistro.aggregate({
                    where: { empresaId, tipo: { in: ['SAIDA', 'SANGRIA'] }, formaPagamento: 'DINHEIRO', data: { gte: start, lte: end } },
                    _sum: { valor: true },
                }),
            ]);
            saldoDinheiro = Math.max(0,
                (abertura.valorInicial || 0)
                + (pagsDinheiro._sum.valor || 0)
                - (saidasDinheiro._sum.valor || 0)
            );
        }

        return res.json({
            isOpen,
            notOpened,
            abertura: abertura || null,
            fechamento: fechamento || null,
            paymentMethodsConfig,
            currentUserNome: req.usuarioNome || '',
            saldoDinheiro,
        });
    } catch (error) {
        console.error('Erro ao buscar status do caixa:', error);
        return res.status(500).json({ error: 'Erro ao buscar status do caixa.' });
    }
};

export const abrirCaixa = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { valorInicial = 0, abertoPor } = req.body;
    try {
        const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
        const horarioAbertura = empresa?.horarioAbertura || '07:00';
        const { start, end } = getWorkdayRangeBRT(new Date(), horarioAbertura);

        // Validar: caixa já aberto hoje?
        const aberturaExistente = await prisma.aberturaCaixa.findFirst({
            where: { empresaId, data: { gte: start, lte: end } },
        });
        if (aberturaExistente) {
            return res.status(400).json({ error: 'O caixa já foi aberto hoje.' });
        }

        const responsavel = abertoPor || req.usuarioNome || 'Administrador';
        const abertura = await prisma.aberturaCaixa.create({
            data: { empresaId, valorInicial: Number(valorInicial) || 0, abertoPor: responsavel },
        });

        return res.status(201).json({ message: 'Caixa aberto com sucesso.', abertura });
    } catch (error) {
        console.error('Erro ao abrir caixa:', error);
        return res.status(500).json({ error: 'Erro ao abrir caixa.' });
    }
};

export const getResumoDia = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    const horarioAbertura = empresa?.horarioAbertura || '07:00';

    const today = new Date();
    const { start, end } = getWorkdayRangeBRT(today, horarioAbertura);

    try {
        // ✅ OTIMIZAÇÃO: Executar ambas as queries em paralelo com Promise.all()
        const [pagamentos, saidas] = await Promise.all([
            prisma.pagamento.findMany({
                where: {
                    empresaId,
                    status: 'PAGO',
                    pagoEm: { gte: start, lte: end },
                },
                select: { valor: true, metodo: true } // ✅ Select otimizado - só campos necessários
            }),
            prisma.caixaRegistro.findMany({
                where: {
                    empresaId,
                    tipo: { in: ['SAIDA', 'SANGRIA'] },
                    data: { gte: start, lte: end },
                },
                select: { valor: true, formaPagamento: true, descricao: true }
            })
        ]);

        const faturamentoDia = pagamentos.reduce((acc: number, p) => acc + p.valor, 0);

        // Calcular totais por forma de pagamento
        const totalDinheiro = pagamentos
            .filter(p => p.metodo === 'DINHEIRO')
            .reduce((acc: number, p) => acc + p.valor, 0);

        const totalCartao = pagamentos
            .filter(p => p.metodo === 'CARTAO')
            .reduce((acc: number, p) => acc + p.valor, 0);

        const totalPix = pagamentos
            .filter(p => p.metodo === 'PIX')
            .reduce((acc: number, p) => acc + p.valor, 0);

        const totalNfe = pagamentos
            .filter(p => (p.metodo as string) === 'NFE')
            .reduce((acc: number, p) => acc + p.valor, 0);

        const totalSaidas = saidas.reduce((acc: number, s) => acc + s.valor, 0);
        const totalAdiantamentos = saidas
            .filter(s => s.descricao?.includes('[Adiantamento]'))
            .reduce((acc: number, s) => acc + s.valor, 0);
        const totalSaidasOperacionais = totalSaidas - totalAdiantamentos;

        // Calcular saldo de dinheiro (entradas - saídas)
        const saldoDinheiro = totalDinheiro - saidas
            .filter(s => s.formaPagamento === 'DINHEIRO')
            .reduce((acc: number, s) => acc + s.valor, 0);

        res.json({
            faturamentoDia,
            totalDinheiro,
            totalCartao,
            totalPix,
            totalNfe,
            totalSaidas,
            totalAdiantamentos,
            totalSaidasOperacionais,
            saldoDinheiro
        });
    } catch (error) {
        console.error('Erro ao buscar resumo do dia:', error);
        res.status(500).json({ error: 'Erro ao buscar resumo do dia.' });
    }
};

export const getValoresEsperados = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    try {
        const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
        const horarioAbertura = empresa?.horarioAbertura || '07:00';
        const { start, end } = getWorkdayRangeBRT(new Date(), horarioAbertura);

        // Buscar pagamentos e abertura do dia
        const [pagamentos, abertura] = await Promise.all([
            prisma.pagamento.findMany({
                where: { empresaId, status: 'PAGO', pagoEm: { gte: start, lte: end } },
                select: { valor: true, metodo: true },
            }),
            prisma.aberturaCaixa.findFirst({
                where: { empresaId, data: { gte: start, lte: end } },
                select: { valorInicial: true },
            }),
        ]);

        // Valores esperados por método
        const esperado: Record<string, number> = {
            DINHEIRO: (abertura?.valorInicial || 0) + pagamentos.filter(p => p.metodo === 'DINHEIRO').reduce((a, p) => a + p.valor, 0),
            PIX:      pagamentos.filter(p => p.metodo === 'PIX').reduce((a, p) => a + p.valor, 0),
            CARTAO:   pagamentos.filter(p => p.metodo === 'CARTAO').reduce((a, p) => a + p.valor, 0),
            NFE:      pagamentos.filter(p => (p.metodo as string) === 'NFE').reduce((a, p) => a + p.valor, 0),
        };

        return res.json({
            esperado,
            valorInicial: abertura?.valorInicial || 0,
            pagamentosDinheiro: pagamentos.filter(p => p.metodo === 'DINHEIRO').reduce((a, p) => a + p.valor, 0),
        });
    } catch (error) {
        console.error('Erro ao buscar valores esperados:', error);
        res.status(500).json({ error: 'Erro ao buscar valores esperados.' });
    }
};

export const createFechamento = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { valoresDigitados, observacao } = req.body;
    // valoresDigitados: { DINHEIRO?: number, PIX?: number, CARTAO?: number, NFE?: number }

    try {
        const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
        const horarioAbertura = empresa?.horarioAbertura || '07:00';
        const { start, end } = getWorkdayRangeBRT(new Date(), horarioAbertura);

        // Buscar pagamentos, saídas e abertura do dia
        const [pagamentos, saidas, abertura] = await Promise.all([
            prisma.pagamento.findMany({
                where: { empresaId, status: 'PAGO', pagoEm: { gte: start, lte: end } },
                select: { valor: true, metodo: true },
            }),
            prisma.caixaRegistro.findMany({
                where: { empresaId, tipo: { in: ['SAIDA', 'SANGRIA'] }, data: { gte: start, lte: end } },
                select: { valor: true, formaPagamento: true },
            }),
            prisma.aberturaCaixa.findFirst({
                where: { empresaId, data: { gte: start, lte: end } },
                select: { valorInicial: true },
            }),
        ]);

        // Saídas físicas em dinheiro (SAIDA + SANGRIA com formaPagamento DINHEIRO)
        // reduzem o saldo físico esperado no caixa
        const saidasDinheiro = saidas
            .filter(s => s.formaPagamento === 'DINHEIRO')
            .reduce((a, s) => a + s.valor, 0);

        // Computado por método: quanto o sistema espera que tenha fisicamente
        // DINHEIRO = troco_inicial + pagamentos_dinheiro − saídas_em_dinheiro (sangrias + despesas)
        const computado: Record<string, number> = {
            DINHEIRO: Math.max(0, (abertura?.valorInicial || 0) + pagamentos.filter(p => p.metodo === 'DINHEIRO').reduce((a, p) => a + p.valor, 0) - saidasDinheiro),
            PIX:      pagamentos.filter(p => p.metodo === 'PIX').reduce((a, p) => a + p.valor, 0),
            CARTAO:   pagamentos.filter(p => p.metodo === 'CARTAO').reduce((a, p) => a + p.valor, 0),
            NFE:      pagamentos.filter(p => (p.metodo as string) === 'NFE').reduce((a, p) => a + p.valor, 0),
        };

        // Digitado (o que o operador informou; campo vazio = 0)
        const digitado: Record<string, number> = {
            DINHEIRO: Number(valoresDigitados?.DINHEIRO) || 0,
            PIX:      Number(valoresDigitados?.PIX)      || 0,
            CARTAO:   Number(valoresDigitados?.CARTAO)   || 0,
            NFE:      Number(valoresDigitados?.NFE)      || 0,
        };

        // Relatório por método
        const relatorio: Record<string, { digitado: number; computado: number; diferenca: number }> = {};
        for (const metodo of ['DINHEIRO', 'PIX', 'CARTAO', 'NFE']) {
            relatorio[metodo] = {
                digitado:  digitado[metodo],
                computado: computado[metodo],
                diferenca: digitado[metodo] - computado[metodo],
            };
        }

        const diferencaTotal = Object.values(relatorio).reduce((a, r) => a + Math.abs(r.diferenca), 0);
        // faturamentoDia = receita bruta de pagamentos (exclui valorInicial e sangrías)
        const faturamentoDia = pagamentos.reduce((a, p) => a + p.valor, 0);
        const totalSaidas = saidas.reduce((a, s) => a + s.valor, 0);
        const status = diferencaTotal < 0.01 ? 'CONFERIDO' : 'DIVERGENTE';
        const fechadoPor = req.usuarioNome || 'Administrador';

        const [fechamento] = await prisma.$transaction([
            prisma.fechamentoCaixa.create({
                data: {
                    empresaId,
                    faturamentoDia,
                    dinheiro: digitado.DINHEIRO,
                    pix:      digitado.PIX,
                    cartao:   digitado.CARTAO,
                    nfe:      digitado.NFE,
                    diferenca: diferencaTotal,
                    status: status as any,
                    observacao,
                    relatorio: JSON.stringify(relatorio),
                    fechadoPor,
                },
            }),
            prisma.caixaRegistro.create({
                data: {
                    empresaId,
                    tipo: 'FECHAMENTO' as any,
                    valor: 0,
                    formaPagamento: 'NA' as any,
                    descricao: `Fechamento do dia — ${status}. Diferença total: R$ ${diferencaTotal.toFixed(2)}`,
                },
            }),
        ]);

        return res.status(201).json({
            message: 'Fechamento de caixa registrado com sucesso.',
            fechamento,
            relatorio,
            totalSaidas,
            valorInicial: abertura?.valorInicial || 0,
        });
    } catch (error) {
        console.error('Erro ao criar fechamento de caixa:', error);
        return res.status(500).json({ error: 'Erro ao criar fechamento de caixa.' });
    }
};

export const createSaida = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { valor, formaPagamento, descricao, fornecedorNome, tipo, lavadorId, dataRetroativo, comprovante, origem, lancadoPor } = req.body;

    if (!valor || !formaPagamento || !tipo) {
        return res.status(400).json({ error: 'Valor, forma de pagamento e categoria são obrigatórios.' });
    }

    if (tipo === 'Adiantamento' && !lavadorId && !fornecedorNome) {
        return res.status(400).json({ error: 'Para adiantamentos, o funcionário é obrigatório.' });
    }

    if (tipo !== 'Adiantamento' && !descricao) {
        return res.status(400).json({ error: 'A descrição é obrigatória para este tipo de saída.' });
    }

    // Interpreta data-only como meio-dia UTC para evitar cair no turno do dia anterior
    // Ex: "2026-04-13" → new Date("2026-04-13") = T00:00:00Z (antes das 07:00 do turno) ← bug
    //                   → new Date("2026-04-13T12:00:00") = T12:00:00Z ← dentro do turno
    const dataRegistro = dataRetroativo
        ? new Date(`${String(dataRetroativo).slice(0, 10)}T12:00:00`)
        : new Date();

    try {
        const registro = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            let fornecedorId: string | undefined;
            if (tipo !== 'Adiantamento' && fornecedorNome) {
                let fornecedor = await tx.fornecedor.findFirst({
                    where: { nome: fornecedorNome, empresaId },
                });
                if (!fornecedor) {
                    fornecedor = await tx.fornecedor.create({
                        data: { nome: fornecedorNome, empresaId },
                    });
                }
                fornecedorId = fornecedor.id;
            }

            const finalDescricao = tipo === 'Adiantamento'
                ? `[Adiantamento] ${fornecedorNome || 'funcionário'}${descricao ? ` — ${descricao}` : ''}`
                : `[${tipo}] ${descricao}`;

            return await tx.caixaRegistro.create({
                data: {
                    empresaId,
                    tipo: 'SAIDA',
                    valor: valor,
                    formaPagamento: formaPagamento as any,
                    descricao: finalDescricao,
                    fornecedorId,
                    lavadorId: lavadorId || null,
                    data: dataRegistro,
                    comprovante: comprovante || null,
                    origem: origem || null,
                    lancadoPor: lancadoPor || null,
                },
            });
        });

        if (tipo === 'Adiantamento' && lavadorId) {
            await prisma.adiantamento.create({
                data: {
                    valor: valor,
                    lavadorId,
                    empresaId,
                    caixaRegistroId: registro.id,
                    data: dataRegistro,
                }
            });
        }

        // Notificar saída (exceto adiantamentos — esses têm fluxo próprio)
        if (tipo !== 'Adiantamento') {
            notifySaidaRegistrada(empresaId, {
                descricao: registro.descricao,
                valor: registro.valor,
                formaPagamento: registro.formaPagamento,
                lancadoPor: registro.lancadoPor ?? undefined,
            });
        }

        res.status(201).json(registro);
    } catch (error) {
        console.error('Erro ao registrar saída:', error);
        res.status(500).json({ error: 'Erro ao registrar saída.' });
    }
};

export const createSangria = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { valor, observacao } = req.body;

    if (!valor || valor <= 0) {
        return res.status(400).json({ error: 'Valor da sangria deve ser maior que zero.' });
    }

    try {
        const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
        const horarioAbertura = empresa?.horarioAbertura || '07:00';
        const { start, end } = getWorkdayRangeBRT(new Date(), horarioAbertura);

        // Calcular saldo físico disponível em dinheiro
        const [abertura, pagamentosDinheiro, saidasDinheiro] = await Promise.all([
            prisma.aberturaCaixa.findFirst({
                where: { empresaId, data: { gte: start, lte: end } },
                select: { valorInicial: true },
            }),
            prisma.pagamento.aggregate({
                where: { empresaId, status: 'PAGO', metodo: 'DINHEIRO', pagoEm: { gte: start, lte: end } },
                _sum: { valor: true },
            }),
            prisma.caixaRegistro.aggregate({
                where: { empresaId, tipo: { in: ['SAIDA', 'SANGRIA'] }, formaPagamento: 'DINHEIRO', data: { gte: start, lte: end } },
                _sum: { valor: true },
            }),
        ]);

        const saldoDisponivel = (abertura?.valorInicial || 0)
            + (pagamentosDinheiro._sum.valor || 0)
            - (saidasDinheiro._sum.valor || 0);

        if (valor > saldoDisponivel + 0.01) {
            return res.status(400).json({
                error: `Saldo insuficiente. Disponível em dinheiro: R$ ${saldoDisponivel.toFixed(2)}`,
                saldoDisponivel,
            });
        }

        const sangria = await prisma.caixaRegistro.create({
            data: {
                empresaId,
                tipo: 'SANGRIA',
                valor: valor,
                formaPagamento: 'DINHEIRO',
                descricao: observacao || 'Retirada de caixa (Sangria)',
            }
        });

        const saldoRestante = Math.max(0, saldoDisponivel - valor);
        res.status(201).json({ ...sangria, saldoDisponivel, saldoRestante });
    } catch (error) {
        console.error('Erro ao registrar sangria:', error);
        res.status(500).json({ error: 'Erro ao registrar sangria.' });
    }
};

// Função auxiliar: busca pagamentos do período, respeitando filtro de tipo
async function getPagamentosDoPeriodoOptimizado(
    empresaId: string,
    dateFilter: Prisma.DateTimeFilter | undefined,
    tipo?: string
) {
    const fetchPagos    = !tipo || tipo === 'PAGAMENTO';
    const fetchPendentes = !tipo || tipo === 'PENDENTE';

    const [pagos, pendentes] = await Promise.all([
        fetchPagos ? prisma.pagamento.findMany({
            where: {
                empresaId,
                status: 'PAGO',
                ...(dateFilter ? { pagoEm: dateFilter } : {}),
            },
            select: {
                id: true,
                valor: true,
                metodo: true,
                pagoEm: true,
                ordem: { select: { veiculo: { select: { placa: true, modelo: true } } } }
            },
        }) : Promise.resolve([]),

        fetchPendentes ? prisma.pagamento.findMany({
            where: {
                empresaId,
                status: 'PENDENTE',
                ...(dateFilter ? { createdAt: dateFilter } : {}),
            },
            select: {
                id: true,
                valor: true,
                metodo: true,
                createdAt: true,
                ordem: { select: { veiculo: { select: { placa: true, modelo: true } } } }
            },
        }) : Promise.resolve([]),
    ]);

    return [...pagos, ...pendentes].map((p: any) => ({
        id: p.id,
        tipo: p.pagoEm ? 'PAGAMENTO' : 'PENDENTE',
        data: p.pagoEm || p.createdAt,
        valor: p.valor,
        formaPagamento: p.metodo,
        descricao: `Pagamento OS: ${p.ordem.veiculo.modelo} (${p.ordem.veiculo.placa})`,
    }));
}

export const getHistorico = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { dataInicio, dataFim } = req.query;
    const lavadorIdFilter = req.query.lavadorId as string | undefined;
    const tipoRaw = req.query.tipo as string | string[] | undefined;
    const tipo = Array.isArray(tipoRaw) ? tipoRaw[0] : (tipoRaw || '');

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    const horarioAbertura = empresa?.horarioAbertura || '07:00';

    let dateRange: Prisma.DateTimeFilter | undefined;

    const dataInicioStr = dataInicio as string | undefined;
    const dataFimStr = dataFim as string | undefined;

    if (dataInicioStr && dataFimStr) {
        const startDateString = dataInicioStr.split('T')[0];
        const endDateString = dataFimStr.split('T')[0];

        const start = new Date(`${startDateString}T${horarioAbertura}:00`);
        const end = new Date(`${endDateString}T${horarioAbertura}:00`);
        end.setDate(end.getDate() + 1);
        end.setMilliseconds(end.getMilliseconds() - 1);

        dateRange = { gte: start, lte: end };
    }

    // PAGAMENTO e PENDENTE vêm da tabela Pagamento; SAIDA/SANGRIA/FECHAMENTO vêm de CaixaRegistro
    const fetchPayments     = !tipo || tipo === 'PAGAMENTO' || tipo === 'PENDENTE';
    const fetchCaixaRegistros = !tipo || (tipo !== 'PAGAMENTO' && tipo !== 'PENDENTE');

    try {
        const [registrosPagamento, outrosRegistros] = await Promise.all([
            fetchPayments
                ? getPagamentosDoPeriodoOptimizado(empresaId, dateRange, tipo)
                : Promise.resolve([]),
            fetchCaixaRegistros
                ? prisma.caixaRegistro.findMany({
                    where: {
                        empresaId,
                        ...(tipo ? { tipo: tipo as any } : {}),
                        ...(dateRange ? { data: dateRange } : {}),
                        ...(lavadorIdFilter ? { lavadorId: lavadorIdFilter } : {}),
                    },
                    select: {
                        id: true,
                        tipo: true,
                        data: true,
                        valor: true,
                        formaPagamento: true,
                        descricao: true,
                        origem: true,
                        lancadoPor: true,
                        fornecedor: { select: { nome: true } },
                        lavador: { select: { nome: true } },
                    },
                    orderBy: { data: 'desc' },
                  })
                : Promise.resolve([])
        ]);

        const todosRegistros = [...registrosPagamento, ...outrosRegistros].sort((a: { data: Date | null }, b: { data: Date | null }) =>
            new Date(b.data!).getTime() - new Date(a.data!).getTime()
        );

        const totalEntradas = registrosPagamento
            .filter(p => p.tipo === 'PAGAMENTO')
            .reduce((acc, p) => acc + p.valor, 0);
        const totalSaidas = outrosRegistros
            .filter(r => r.tipo === 'SAIDA' || r.tipo === 'SANGRIA')
            .reduce((acc, r) => acc + r.valor, 0);
        const totalAdiantamentos = outrosRegistros
            .filter(r => r.tipo === 'SAIDA' && r.descricao?.includes('[Adiantamento]'))
            .reduce((acc, r) => acc + r.valor, 0);

        const totais = {
            totalEntradas,
            totalSaidas,
            totalAdiantamentos,
            totalSaidasOperacionais: totalSaidas - totalAdiantamentos,
            detalheSaidas: {
                saidas: outrosRegistros.filter(r => r.tipo === 'SAIDA').reduce((acc, r) => acc + r.valor, 0),
                adiantamentos: totalAdiantamentos,
                saidasOperacionais: outrosRegistros
                    .filter(r => r.tipo === 'SAIDA' && !r.descricao?.includes('[Adiantamento]'))
                    .reduce((acc, r) => acc + r.valor, 0),
                sangrias: outrosRegistros.filter(r => r.tipo === 'SANGRIA').reduce((acc, r) => acc + r.valor, 0),
            }
        };

        res.json({ registros: todosRegistros, totais });
    } catch (error) {
        console.error('Erro ao buscar histórico de caixa:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de caixa.' });
    }
};

export const getFechamentoById = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    try {
        const registroFechamento = await prisma.caixaRegistro.findFirst({
            where: { id, empresaId, tipo: 'FECHAMENTO' as any },
        });

        if (!registroFechamento) {
            return res.status(404).json({ error: 'Fechamento de caixa não encontrado.' });
        }

        const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
        const horarioAbertura = empresa?.horarioAbertura || '07:00';

        const fechamento = await prisma.fechamentoCaixa.findFirst({
            where: { empresaId, data: { gte: getWorkdayRangeBRT(registroFechamento.data, horarioAbertura).start, lte: getWorkdayRangeBRT(registroFechamento.data, horarioAbertura).end } },
        });

        if (!fechamento) return res.status(404).json({ error: 'Detalhes do fechamento não encontrados para esta data.' });

        const { start, end } = getWorkdayRangeBRT(fechamento.data, horarioAbertura);

        const pagamentos = await prisma.pagamento.findMany({
            where: { empresaId, status: 'PAGO', pagoEm: { gte: start, lte: end } },
            select: { valor: true, metodo: true, pagoEm: true, ordem: { select: { veiculo: { select: { placa: true } } } } }
        });

        const registrosPagamento = pagamentos.map((p: any) => ({
            id: `pag-${p.pagoEm?.toISOString()}-${p.valor}`,
            tipo: 'PAGAMENTO',
            data: p.pagoEm,
            valor: p.valor,
            formaPagamento: p.metodo,
            descricao: `Pagamento OS (Placa: ${p.ordem.veiculo.placa})`,
            lavador: null,
            fornecedor: null
        }));

        const outrosRegistros = await prisma.caixaRegistro.findMany({
            where: { empresaId, data: { gte: start, lte: end } },
            include: { fornecedor: true, lavador: true },
        });

        const movimentacoesDoDia = [...registrosPagamento, ...outrosRegistros].sort((a: { data: Date | null }, b: { data: Date | null }) =>
            new Date(b.data!).getTime() - new Date(a.data!).getTime()
        );

        res.json({
            fechamento,
            movimentacoes: movimentacoesDoDia,
        });

    } catch (error) {
        console.error('Erro ao buscar detalhes do fechamento:', error);
        res.status(500).json({ error: 'Erro ao buscar detalhes do fechamento.' });
    }
};

export const getGanhosDoMes = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { ano, mes } = req.query;

    if (!ano || !mes) {
        return res.status(400).json({ error: 'Ano e mês são obrigatórios.' });
    }

    const anoNum = parseInt(ano as string);
    const mesNum = parseInt(mes as string);

    const dataInicio = new Date(anoNum, mesNum - 1, 1);
    const dataFim = new Date(anoNum, mesNum, 0, 23, 59, 59, 999);

    try {
        const pagamentos = await prisma.pagamento.findMany({
            where: {
                empresaId,
                status: 'PAGO',
                pagoEm: { gte: dataInicio, lte: dataFim },
            },
            select: { valor: true, pagoEm: true },
        });

        res.json(pagamentos);

    } catch (error) {
        console.error('Erro ao buscar ganhos do mês:', error);
        res.status(500).json({ error: 'Erro ao buscar ganhos do mês.' });
    }
};

export const getFechamentoComissaoById = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    try {
        const fechamento = await prisma.fechamentoComissao.findFirst({
            where: { id, empresaId },
            include: {
                lavador: { select: { nome: true } },
                ordensPagas: {
                    include: {
                        veiculo: { select: { placa: true, modelo: true } },
                    },
                },
                ordemLavadoresPagos: {
                    include: {
                        ordem: {
                            include: {
                                veiculo: { select: { placa: true, modelo: true } },
                            },
                        },
                        lavador: { select: { id: true, nome: true } },
                    },
                },
                adiantamentosQuitados: true,
            },
        });

        if (!fechamento) {
            return res.status(404).json({ error: 'Fechamento de comissão não encontrado.' });
        }
        res.json(fechamento);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar detalhes do fechamento de comissão.' });
    }
};

export const getHistoricoComissoes = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { lavadorId } = req.query;

    const where: Prisma.FechamentoComissaoWhereInput = { empresaId };
    if (lavadorId) {
        where.lavadorId = lavadorId as string;
    }

    try {
        const historico = await prisma.fechamentoComissao.findMany({
            where,
            include: {
                lavador: { select: { nome: true } },
            },
            orderBy: { data: 'desc' },
        });
        res.json(historico);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar histórico de comissões.' });
    }
};

interface FecharComissaoBody {
    lavadorId: string;
    comissaoIds: string[];
    adiantamentoIds: string[];
    valorPago: number;
    formaPagamento?: string;
    observacao?: string;
}

export const fecharComissao = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { lavadorId, comissaoIds, adiantamentoIds, valorPago, formaPagamento, observacao } = req.body as FecharComissaoBody;

    if (!lavadorId || !Array.isArray(comissaoIds) || !Array.isArray(adiantamentoIds) || valorPago === undefined) {
        return res.status(400).json({ error: 'Dados insuficientes para fechar a comissão.' });
    }

    if (comissaoIds.length === 0 && adiantamentoIds.length === 0) {
        return res.status(400).json({ error: 'Selecione pelo menos uma comissão ou adiantamento para fechar.' });
    }

    if (valorPago > 0 && !formaPagamento) {
        return res.status(400).json({ error: 'A forma de pagamento é obrigatória quando há valor a pagar.' });
    }

    try {
        // Validar que o lavador existe
        const lavador = await prisma.lavador.findUnique({ where: { id: lavadorId } });
        if (!lavador) {
            return res.status(404).json({ error: 'Funcionário não encontrado.' });
        }

        // ✅ Aumentar timeout para 30 segundos - transação tem múltiplas queries
        const resultado = await prisma.$transaction(
            async (tx: Prisma.TransactionClient) => {
            const fechamento = await tx.fechamentoComissao.create({
                data: {
                    valorPago: valorPago > 0 ? valorPago : 0,
                    empresaId,
                    lavadorId,
                }
            });

            if (comissaoIds.length > 0) {
                await tx.ordemServicoLavador.updateMany({
                    where: {
                        ordemId: { in: comissaoIds },
                        lavadorId,
                        comissaoPaga: false,
                    },
                    data: {
                        comissaoPaga: true,
                        fechamentoComissaoId: fechamento.id,
                    },
                });

                const uniqueOrdemIds = Array.from(new Set(comissaoIds)) as string[];
                for (const ordemId of uniqueOrdemIds) {
                    const pendingLavadores = await tx.ordemServicoLavador.count({
                        where: {
                            ordemId,
                            comissaoPaga: false,
                        },
                    });
                    if (pendingLavadores === 0) {
                        await tx.ordemServico.update({
                            where: { id: ordemId },
                            data: {
                                comissaoPaga: true,
                                fechamentoComissaoId: fechamento.id,
                            },
                        });
                    }
                }
            }

            if (adiantamentoIds.length > 0) {
                await tx.adiantamento.updateMany({
                    where: {
                        id: { in: adiantamentoIds },
                        empresaId,
                        lavadorId,
                    },
                    data: {
                        status: "QUITADO",
                        fechamentoComissaoId: fechamento.id
                    },
                });
            }

            if (valorPago > 0) {
                const descricao = observacao
                    ? `Pagamento de comissão para ${lavador.nome}: ${observacao}`
                    : `Pagamento de comissão para ${lavador.nome}`;

                await tx.caixaRegistro.create({
                    data: {
                        empresaId,
                        tipo: 'SAIDA',
                        valor: valorPago,
                        formaPagamento: formaPagamento as any,
                        descricao: descricao,
                        lavadorId,
                    },
                });
            }

            return {
                message: 'Fechamento de comissão realizado com sucesso.',
                fechamentoId: fechamento.id,
            };
            },
            {
                timeout: 30000  // 30 segundos
            }
        );

        notifyComissaoFechada(empresaId, {
            lavadorNome: lavador.nome,
            valorPago: valorPago > 0 ? valorPago : 0,
            ordensCount: comissaoIds.length,
        });

        res.status(200).json(resultado);

    } catch (error) {
        console.error('Erro ao fechar comissão:', error);

        // Melhor logging do erro real
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).json({
            error: 'Erro interno ao processar o pagamento da comissão.',
            details: errorMessage, // Remover em produção se necessário
        });
    }
};

export const migrarPagamentosComissaoAntigos = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;

    try {
        const saidasComissao = await prisma.caixaRegistro.findMany({
            where: {
                empresaId,
                tipo: 'SAIDA',
                descricao: {
                    startsWith: 'Pagamento de comissão para',
                },
                lavadorId: {
                    not: null,
                },
            },
        });

        for (const saida of saidasComissao) {
            await prisma.fechamentoComissao.upsert({
                where: { id: `migrado-${saida.id}` },
                update: {},
                create: {
                    id: `migrado-${saida.id}`,
                    data: saida.data,
                    valorPago: saida.valor,
                    empresaId: empresaId,
                    lavadorId: saida.lavadorId!,
                },
            });
        }

        res.status(200).json({ message: `${saidasComissao.length} pagamentos de comissão antigos foram migrados para o histórico.` });

    } catch (error) {
        console.error('Erro ao migrar pagamentos de comissão:', error);
        res.status(500).json({ error: 'Erro ao migrar dados.' });
    }
};

export const updateCaixaRegistro = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { valor, formaPagamento, descricao, fornecedorNome, tipo, lavadorId, dataRetroativo, comprovante } = req.body;

    try {
        let fornecedorId: string | undefined;
        if (tipo !== 'Adiantamento' && fornecedorNome) {
            let fornecedor = await prisma.fornecedor.findFirst({ where: { nome: fornecedorNome, empresaId } });
            if (!fornecedor) {
                fornecedor = await prisma.fornecedor.create({ data: { nome: fornecedorNome, empresaId } });
            }
            fornecedorId = fornecedor.id;
        }

        const finalDescricao = tipo === 'Adiantamento'
            ? `[Adiantamento] ${fornecedorNome || 'funcionário'}`
            : `[${tipo}] ${descricao}`;

        const updateData: any = {
            valor: valor,
            formaPagamento: formaPagamento as any,
            descricao: finalDescricao,
            fornecedorId,
            lavadorId: tipo === 'Adiantamento' ? (lavadorId || null) : null,
        };

        if (dataRetroativo) updateData.data = new Date(`${String(dataRetroativo).slice(0, 10)}T12:00:00`);
        if (comprovante !== undefined) updateData.comprovante = comprovante || null;

        const registroAtualizado = await prisma.caixaRegistro.update({
            where: { id, empresaId },
            data: updateData,
        });

        if (tipo === 'Adiantamento' && lavadorId) {
            await prisma.adiantamento.updateMany({
                where: { caixaRegistroId: id },
                data: { valor: valor, lavadorId },
            });
        }

        res.json(registroAtualizado);
    } catch (error) {
        console.error('Erro ao atualizar registro de caixa:', error);
        res.status(500).json({ error: 'Erro ao atualizar registro de caixa.' });
    }
};

export const deleteCaixaRegistro = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    try {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.adiantamento.deleteMany({
                where: { caixaRegistroId: id },
            });

            await tx.caixaRegistro.delete({
                where: { id, empresaId },
            });
        });

        res.status(200).json({ message: 'Movimentação excluída com sucesso.' });
    } catch (error) {
        console.error('Erro ao excluir registro de caixa:', error);
        res.status(500).json({ error: 'Erro ao excluir registro de caixa.' });
    }
};

export const deleteAdiantamento = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { id } = req.params;

    try {
        const adiantamento = await prisma.adiantamento.findFirst({
            where: { id, empresaId, status: 'PENDENTE' },
        });
        if (!adiantamento) return res.status(404).json({ error: 'Adiantamento não encontrado ou já quitado.' });

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            if (adiantamento.caixaRegistroId) {
                await tx.adiantamento.deleteMany({ where: { caixaRegistroId: adiantamento.caixaRegistroId! } });
                await tx.caixaRegistro.delete({ where: { id: adiantamento.caixaRegistroId! } });
            } else {
                await tx.adiantamento.delete({ where: { id } });
            }
        });

        return res.json({ success: true });
    } catch (e) {
        console.error('[Comissao] deleteAdiantamento:', e);
        return res.status(500).json({ error: 'Erro ao excluir adiantamento.' });
    }
};

export const getDadosComissao = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { lavadorId, dataInicio, dataFim } = req.query;

    // ✅ MODIFICADO: Apenas lavadorId é obrigatório; datas são opcionais (para "Em aberto")
    if (!lavadorId) {
        return res.status(400).json({ error: 'Funcionário é obrigatório.' });
    }

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    const horarioAbertura = empresa?.horarioAbertura || '07:00';

    // ✅ NOVO: Se datas não forem fornecidas, usar últimos 30 dias (padrão do lavador-publico)
    let dateFilter: any = undefined;
    if (dataInicio && dataFim) {
        const start = new Date(`${dataInicio}T${horarioAbertura}:00`);
        const end = new Date(`${dataFim}T${horarioAbertura}:00`);
        end.setDate(end.getDate() + 1);
        end.setMilliseconds(end.getMilliseconds() - 1);
        dateFilter = { gte: start, lte: end };
    } else {
        // ✅ NOVO: Padrão = últimos 30 dias (igual a lavador-publico)
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        const start = new Date();
        start.setDate(start.getDate() - 30);
        start.setHours(0, 0, 0, 0);
        dateFilter = { gte: start, lte: end };
    }

    try {
        // Apenas ordens FINALIZADAS com comissão não paga para este lavador.
        // Usar status:'FINALIZADO' evita incluir ordens em andamento/aguardando pagamento.
        // O OR verifica o comissaoPaga no nível correto: ordemLavadores para multi-lavador,
        // OrdemServico para lavador único — evita double-count em fechamentos parciais.
        const comissoesPendentes = await prisma.ordemServico.findMany({
            where: {
                empresaId,
                status: 'FINALIZADO' as any,
                ...(dateFilter && { createdAt: dateFilter }),
                OR: [
                    {
                        // Multi-lavador: entrada específica deste lavador ainda não paga
                        ordemLavadores: {
                            some: {
                                lavadorId: lavadorId as string,
                                comissaoPaga: false,
                            }
                        }
                    },
                    {
                        // Lavador único: comissão do registro principal não paga
                        lavadorId: lavadorId as string,
                        comissaoPaga: false,
                        ordemLavadores: { none: {} },
                    }
                ]
            },
            include: {
                veiculo: true,
                lavador: true,
                cliente: { select: { nome: true } },
                items: { include: { servico: { select: { nome: true } } } },
                ordemLavadores: {
                    include: {
                        lavador: true
                    }
                }
            },
        });

        const adiantamentosPendentes = await prisma.adiantamento.findMany({
            where: {
                empresaId,
                lavadorId: lavadorId as string,
                status: 'PENDENTE',
            },
            include: {
                caixaRegistro: { select: { descricao: true } }
            },
        });

        const debitosPendentes = await prisma.ordemServico.findMany({
            where: {
                empresaId,
                status: 'FINALIZADO' as any,
                ...(dateFilter && { createdAt: dateFilter }),
                pagamentos: { some: { metodo: 'DEBITO_FUNCIONARIO' } },
                OR: [
                    {
                        ordemLavadores: {
                            some: { lavadorId: lavadorId as string, comissaoPaga: false }
                        }
                    },
                    {
                        lavadorId: lavadorId as string,
                        comissaoPaga: false,
                        ordemLavadores: { none: {} },
                    }
                ]
            },
            include: {
                veiculo: true,
                lavador: true,
                ordemLavadores: {
                    include: { lavador: true }
                },
                pagamentos: {
                    where: { metodo: 'DEBITO_FUNCIONARIO' },
                    select: { id: true, valor: true, pagoEm: true },
                }
            },
        });

        const normalizeOrderWashers = (ordem: any) => {
            const washers = (ordem.ordemLavadores || []).map((rel: any) => ({
                id: rel.lavadorId,
                nome: rel.lavador?.nome || null
            }));
            if (!washers.length && ordem.lavadorId) {
                washers.push({
                    id: ordem.lavadorId,
                    nome: ordem.lavador?.nome || null
                });
            }
            return washers;
        };

        const formattedComissoes = comissoesPendentes.map(ordem => {
            // Buscar o ganho individual deste lavador nesta ordem
            const relLavador = (ordem.ordemLavadores || []).find((rel: any) => rel.lavadorId === lavadorId);
            // Se encontrou na tabela OrdemServicoLavador usa o ganho salvo; senão fallback para comissao da ordem
            const ganhoDoLavador = relLavador
                ? (relLavador.ganho > 0 ? relLavador.ganho : ordem.comissao)
                : ordem.comissao;
            return {
                id: ordem.id,
                numeroOrdem: ordem.numeroOrdem,
                valorTotal: ordem.valorTotal,
                status: ordem.status,
                createdAt: ordem.createdAt,
                dataFim: ordem.dataFim,
                comissao: ganhoDoLavador,
                veiculo: ordem.veiculo,
                cliente: ordem.cliente,
                servico: ordem.items?.[0]?.servico ?? null,
                lavadorId: ordem.lavadorId,
                lavador: ordem.lavador,
                ordemLavadores: ordem.ordemLavadores,
                lavadores: normalizeOrderWashers(ordem)
            };
        });

        const formattedDebitos = debitosPendentes.map(ordem => ({
            id: ordem.id,
            numeroOrdem: ordem.numeroOrdem,
            valorTotal: ordem.valorTotal,
            dataFim: ordem.dataFim,
            comissao: ordem.comissao,
            veiculo: ordem.veiculo,
            lavadorId: ordem.lavadorId,
            lavadores: normalizeOrderWashers(ordem),
            pagamentos: ordem.pagamentos || [],
            debitoTotal: (ordem.pagamentos || []).reduce((sum, p) => sum + p.valor, 0)
        }));

        res.json({
            comissoes: formattedComissoes,
            adiantamentos: adiantamentosPendentes,
            debitosOS: formattedDebitos
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar dados de comissão.' });
    }
};
