import { Request, Response } from 'express';
import prisma from '../db';
import { Prisma, CaixaRegistro, FechamentoCaixa, Adiantamento, Fornecedor, Lavador, OrdemServico, Veiculo, Pagamento } from '@prisma/client';

interface EmpresaRequest extends Request {
    empresaId?: string;
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

const getWorkdayRange = (date: Date, horarioAbertura: string = '07:00') => {
    const [hours, minutes] = horarioAbertura.split(':').map(Number);

    const start = new Date(date);
    start.setHours(hours, minutes, 0, 0);

    if (new Date() < start && date.toDateString() === new Date().toDateString()) {
        start.setDate(start.getDate() - 1);
    }

    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);
    return { start, end };
};

export const getResumoDia = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    const horarioAbertura = empresa?.horarioAbertura || '07:00';

    const today = new Date();
    const { start, end } = getWorkdayRange(today, horarioAbertura);

    try {
        const pagamentos = await prisma.pagamento.findMany({
            where: {
                empresaId,
                status: 'PAGO',
                pagoEm: { gte: start, lte: end },
            },
        });

        const faturamentoDia = pagamentos.reduce((acc: number, p: Pagamento) => acc + p.valor, 0);

        res.json({ faturamentoDia });
    } catch (error) {
        console.error('Erro ao buscar resumo do dia:', error);
        res.status(500).json({ error: 'Erro ao buscar resumo do dia.' });
    }
};

export const createFechamento = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { faturamentoDia, pix, dinheiro, cartao, observacao } = req.body;

    const totalInformado = pix + dinheiro + cartao;
    const diferenca = totalInformado - faturamentoDia;

    try {
        const [fechamento, _] = await prisma.$transaction([
            prisma.fechamentoCaixa.create({
                data: {
                    empresaId,
                    faturamentoDia: faturamentoDia,
                    pix: pix,
                    dinheiro: dinheiro,
                    cartao: cartao,
                    diferenca,
                    status: Math.abs(diferenca) < 0.01 ? 'CONFERIDO' as any : 'DIVERGENTE' as any,
                    observacao,
                },
            }),
            prisma.caixaRegistro.create({
                data: {
                    empresaId,
                    tipo: 'FECHAMENTO' as any,
                    valor: 0,
                    formaPagamento: 'NA' as any,
                    descricao: `Fechamento do dia. Diferença: ${diferenca.toFixed(2)}`,
                }
            })
        ]);

        res.status(201).json({
            message: "Fechamento de caixa registrado com sucesso.",
            fechamento
        });
    } catch (error) {
        console.error('Erro ao criar fechamento de caixa:', error);
        res.status(500).json({ error: 'Erro ao criar fechamento de caixa.' });
    }
};

export const createSaida = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { valor, formaPagamento, descricao, fornecedorNome, tipo, lavadorId } = req.body;

    if (!valor || !formaPagamento || !tipo) {
        return res.status(400).json({ error: 'Valor, forma de pagamento e categoria são obrigatórios.' });
    }

    if (tipo === 'Adiantamento' && !lavadorId) {
        return res.status(400).json({ error: 'Para adiantamentos, o funcionário é obrigatório.' });
    }

    if (tipo !== 'Adiantamento' && !descricao) {
        return res.status(400).json({ error: 'A descrição é obrigatória para este tipo de saída.' });
    }

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
                ? `Adiantamento para funcionário`
                : `[${tipo}] ${descricao}`;

            return await tx.caixaRegistro.create({
                data: {
                    empresaId,
                    tipo: 'SAIDA',
                    valor: valor,
                    formaPagamento: formaPagamento as any,
                    descricao: finalDescricao,
                    fornecedorId,
                    lavadorId,
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
                }
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
        const sangria = await prisma.caixaRegistro.create({
            data: {
                empresaId,
                tipo: 'SANGRIA',
                valor: valor,
                formaPagamento: 'DINHEIRO',
                descricao: observacao || 'Retirada de caixa (Sangria)',
            }
        });
        res.status(201).json(sangria);
    } catch (error) {
        console.error('Erro ao registrar sangria:', error);
        res.status(500).json({ error: 'Erro ao registrar sangria.' });
    }
};

export const getHistorico = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { dataInicio, dataFim, tipo } = req.query;

    const where: Prisma.CaixaRegistroWhereInput = { empresaId };

    if (tipo) {
        where.tipo = tipo as any;
    }

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    const horarioAbertura = empresa?.horarioAbertura || '07:00';

    if (dataInicio && dataFim) {
        const startDateString = (dataInicio as string).split('T')[0];
        const endDateString = (dataFim as string).split('T')[0];

        const start = new Date(`${startDateString}T${horarioAbertura}:00`);
        const end = new Date(`${endDateString}T${horarioAbertura}:00`);
        end.setDate(end.getDate() + 1);
        end.setMilliseconds(end.getMilliseconds() - 1);

        where.data = {
            gte: start,
            lte: end,
        };
    }

    try {
        let registrosPagamento: any[] = [];
        let outrosRegistros: RegistroComDependencias[] = [];

        if (!tipo || tipo === 'PAGAMENTO' || tipo === '') {
            registrosPagamento = await getPagamentosDoPeriodo(empresaId, where.data as Prisma.DateTimeFilter);
        }

        if (!tipo || tipo === 'SAIDA' || tipo === 'SANGRIA' || tipo === 'FECHAMENTO' || tipo === '') {
            outrosRegistros = await prisma.caixaRegistro.findMany({
                where,
                include: {
                    fornecedor: true,
                    lavador: true,
                },
            });
        }

        const todosRegistros = [...registrosPagamento, ...outrosRegistros].sort((a: { data: Date | null }, b: { data: Date | null }) =>
            new Date(b.data!).getTime() - new Date(a.data!).getTime()
        );

        // Calcular totais com base nos registros filtrados
        const totalEntradas = registrosPagamento.reduce((acc, p) => acc + p.valor, 0);
        const totalSaidas = outrosRegistros
            .filter(r => r.tipo === 'SAIDA' || r.tipo === 'SANGRIA')
            .reduce((acc, r) => acc + r.valor, 0);

        const totais = {
            totalEntradas,
            totalSaidas,
            detalheSaidas: {
                saidas: outrosRegistros.filter(r => r.tipo === 'SAIDA').reduce((acc, r) => acc + r.valor, 0),
                sangrias: outrosRegistros.filter(r => r.tipo === 'SANGRIA').reduce((acc, r) => acc + r.valor, 0),
            }
        };

        res.json({
            registros: todosRegistros,
            totais: totais
        });
    } catch (error) {
        console.error('Erro ao buscar histórico de caixa:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de caixa.' });
    }
};

async function getPagamentosDoPeriodo(empresaId: string, dateFilter: Prisma.DateTimeFilter | undefined) {
    const pagamentos = await prisma.pagamento.findMany({
        where: {
            empresaId,
            OR: [
                { status: 'PAGO', pagoEm: dateFilter },
                { status: 'PENDENTE', createdAt: dateFilter }
            ]
        },
        select: {
            id: true, valor: true, metodo: true, status: true, pagoEm: true, createdAt: true,
            ordem: { select: { id: true, veiculo: { select: { placa: true, modelo: true } } } }
        }
    });

    return pagamentos.map((p: any) => ({
        id: p.id,
        tipo: p.status === 'PAGO' ? 'PAGAMENTO' : 'PENDENTE',
        data: p.status === 'PAGO' ? p.pagoEm : p.createdAt,
        valor: p.valor,
        formaPagamento: p.metodo,
        ordemId: p.ordem.id,
        descricao: `Pagamento OS: ${p.ordem.veiculo.modelo} (${p.ordem.veiculo.placa})`,
    }));
}

export const getFechamentoById = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { id } = req.params;

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
            where: { empresaId, data: { gte: getWorkdayRange(registroFechamento.data, horarioAbertura).start, lte: getWorkdayRange(registroFechamento.data, horarioAbertura).end } },
        }); 

        if (!fechamento) return res.status(404).json({ error: 'Detalhes do fechamento não encontrados para esta data.' });

        const { start, end } = getWorkdayRange(fechamento.data, horarioAbertura);

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

export const fecharComissao = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { lavadorId, comissaoIds, adiantamentoIds, valorPago, formaPagamento } = req.body;

    if (!lavadorId || !comissaoIds || !adiantamentoIds || valorPago === undefined) {
        return res.status(400).json({ error: 'Dados insuficientes para fechar a comissão.' });
    }

    if (valorPago > 0 && !formaPagamento) {
        return res.status(400).json({ error: 'A forma de pagamento é obrigatória quando há valor a pagar.' });
    }

    try {
        const resultado = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const fechamento = await tx.fechamentoComissao.create({
                data: {
                    valorPago: valorPago > 0 ? valorPago : 0,
                    empresaId,
                    lavadorId,
                }
            });

            if (comissaoIds.length > 0) {
                await tx.ordemServico.updateMany({
                    where: {
                        id: { in: comissaoIds },
                        empresaId,
                        lavadorId,
                    },
                    data: {
                        comissaoPaga: true,
                        fechamentoComissaoId: fechamento.id
                    },
                });
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
                const lavador = await tx.lavador.findUnique({ where: { id: lavadorId } });
                await tx.caixaRegistro.create({
                    data: {
                        empresaId,
                        tipo: 'SAIDA',
                        valor: valorPago,
                        formaPagamento: formaPagamento as any,
                        descricao: `Pagamento de comissão para ${lavador?.nome || 'Funcionário'}`,
                        lavadorId,
                    },
                });
            }

            return { message: 'Fechamento de comissão realizado com sucesso.' };
        });

        res.status(200).json(resultado);

    } catch (error) {
        console.error('Erro ao fechar comissão:', error);
        res.status(500).json({ error: 'Erro interno ao processar o pagamento da comissão.' });
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
    const { valor, formaPagamento, descricao, fornecedorNome, tipo, lavadorId } = req.body;

    try {
        let fornecedorId: string | undefined;
        if (tipo !== 'Adiantamento' && fornecedorNome) {
            let fornecedor = await prisma.fornecedor.findFirst({ where: { nome: fornecedorNome, empresaId } });
            if (!fornecedor) {
                fornecedor = await prisma.fornecedor.create({ data: { nome: fornecedorNome, empresaId } });
            }
            fornecedorId = fornecedor.id;
        }

        const finalDescricao = tipo === 'Adiantamento' ? `Adiantamento para funcionário` : `[${tipo}] ${descricao}`;

        const registroAtualizado = await prisma.caixaRegistro.update({
            where: { id, empresaId },
            data: {
                valor: valor,
                formaPagamento: formaPagamento as any,
                descricao: finalDescricao,
                fornecedorId,
                lavadorId: tipo === 'Adiantamento' ? lavadorId : null,
            },
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

export const getDadosComissao = async (req: EmpresaRequest, res: Response) => {
    const empresaId = req.empresaId!;
    const { lavadorId, dataInicio, dataFim } = req.query;

    if (!lavadorId || !dataInicio || !dataFim) {
        return res.status(400).json({ error: 'Funcionário e período são obrigatórios.' });
    }

    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
    const horarioAbertura = empresa?.horarioAbertura || '07:00';

    const start = new Date(`${dataInicio}T${horarioAbertura}:00`);

    const end = new Date(`${dataFim}T${horarioAbertura}:00`);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);

    try {
        const comissoesPendentes = await prisma.ordemServico.findMany({
            where: {
                empresaId,
                ordemLavadores: {
                    some: {
                        lavadorId: lavadorId as string
                    }
                },
                comissaoPaga: false,
                dataFim: { gte: start, lte: end },
            },
            include: {
                veiculo: true,
                lavador: true,
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
        });

        const formattedComissoes = comissoesPendentes.map(ordem => ({
            id: ordem.id,
            numeroOrdem: ordem.numeroOrdem,
            valorTotal: ordem.valorTotal,
            dataFim: ordem.dataFim,
            comissao: ordem.comissao,
            lavadorId: ordem.lavadorId,
            lavadores: (ordem.ordemLavadores || []).map(rel => ({
                id: rel.lavadorId,
                nome: rel.lavador?.nome || null
            }))
        }));

        res.json({ comissoes: formattedComissoes, adiantamentos: adiantamentosPendentes });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar dados de comissão.' });
    }
};
