"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDadosComissao = exports.deleteCaixaRegistro = exports.updateCaixaRegistro = exports.migrarPagamentosComissaoAntigos = exports.fecharComissao = exports.getHistoricoComissoes = exports.getFechamentoComissaoById = exports.getGanhosDoMes = exports.getFechamentoById = exports.getHistorico = exports.createSangria = exports.createSaida = exports.createFechamento = exports.getResumoDia = void 0;
const db_1 = __importDefault(require("../db"));
const getWorkdayRange = (date, horarioAbertura = '07:00') => {
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
const getResumoDia = async (req, res) => {
    const empresaId = req.empresaId;
    const empresa = await db_1.default.empresa.findUnique({ where: { id: empresaId } });
    const horarioAbertura = empresa?.horarioAbertura || '07:00';
    const today = new Date();
    const { start, end } = getWorkdayRange(today, horarioAbertura);
    try {
        const pagamentos = await db_1.default.pagamento.findMany({
            where: {
                empresaId,
                status: 'PAGO',
                pagoEm: { gte: start, lte: end },
            },
        });
        const faturamentoDia = pagamentos.reduce((acc, p) => acc + p.valor, 0);
        res.json({ faturamentoDia });
    }
    catch (error) {
        console.error('Erro ao buscar resumo do dia:', error);
        res.status(500).json({ error: 'Erro ao buscar resumo do dia.' });
    }
};
exports.getResumoDia = getResumoDia;
const createFechamento = async (req, res) => {
    const empresaId = req.empresaId;
    const { faturamentoDia, pix, dinheiro, cartao, observacao } = req.body;
    const totalInformado = pix + dinheiro + cartao;
    const diferenca = totalInformado - faturamentoDia;
    try {
        const [fechamento, _] = await db_1.default.$transaction([
            db_1.default.fechamentoCaixa.create({
                data: {
                    empresaId,
                    faturamentoDia: faturamentoDia,
                    pix: pix,
                    dinheiro: dinheiro,
                    cartao: cartao,
                    diferenca,
                    status: Math.abs(diferenca) < 0.01 ? 'CONFERIDO' : 'DIVERGENTE',
                    observacao,
                },
            }),
            db_1.default.caixaRegistro.create({
                data: {
                    empresaId,
                    tipo: 'FECHAMENTO',
                    valor: 0,
                    formaPagamento: 'NA',
                    descricao: `Fechamento do dia. Diferença: ${diferenca.toFixed(2)}`,
                }
            })
        ]);
        res.status(201).json({
            message: "Fechamento de caixa registrado com sucesso.",
            fechamento
        });
    }
    catch (error) {
        console.error('Erro ao criar fechamento de caixa:', error);
        res.status(500).json({ error: 'Erro ao criar fechamento de caixa.' });
    }
};
exports.createFechamento = createFechamento;
const createSaida = async (req, res) => {
    const empresaId = req.empresaId;
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
        const registro = await db_1.default.$transaction(async (tx) => {
            let fornecedorId;
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
                    formaPagamento: formaPagamento,
                    descricao: finalDescricao,
                    fornecedorId,
                    lavadorId,
                },
            });
        });
        if (tipo === 'Adiantamento' && lavadorId) {
            await db_1.default.adiantamento.create({
                data: {
                    valor: valor,
                    lavadorId,
                    empresaId,
                    caixaRegistroId: registro.id,
                }
            });
        }
        res.status(201).json(registro);
    }
    catch (error) {
        console.error('Erro ao registrar saída:', error);
        res.status(500).json({ error: 'Erro ao registrar saída.' });
    }
};
exports.createSaida = createSaida;
const createSangria = async (req, res) => {
    const empresaId = req.empresaId;
    const { valor, observacao } = req.body;
    if (!valor || valor <= 0) {
        return res.status(400).json({ error: 'Valor da sangria deve ser maior que zero.' });
    }
    try {
        const sangria = await db_1.default.caixaRegistro.create({
            data: {
                empresaId,
                tipo: 'SANGRIA',
                valor: valor,
                formaPagamento: 'DINHEIRO',
                descricao: observacao || 'Retirada de caixa (Sangria)',
            }
        });
        res.status(201).json(sangria);
    }
    catch (error) {
        console.error('Erro ao registrar sangria:', error);
        res.status(500).json({ error: 'Erro ao registrar sangria.' });
    }
};
exports.createSangria = createSangria;
const getHistorico = async (req, res) => {
    const empresaId = req.empresaId;
    const { dataInicio, dataFim, tipo } = req.query;
    const where = { empresaId };
    if (tipo) {
        where.tipo = tipo;
    }
    const empresa = await db_1.default.empresa.findUnique({ where: { id: empresaId } });
    const horarioAbertura = empresa?.horarioAbertura || '07:00';
    if (dataInicio && dataFim) {
        const startDateString = dataInicio.split('T')[0];
        const endDateString = dataFim.split('T')[0];
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
        let registrosPagamento = [];
        let outrosRegistros = [];
        if (!tipo || tipo === 'PAGAMENTO' || tipo === '') {
            registrosPagamento = await getPagamentosDoPeriodo(empresaId, where.data);
        }
        if (!tipo || tipo === 'SAIDA' || tipo === 'SANGRIA' || tipo === 'FECHAMENTO' || tipo === '') {
            outrosRegistros = await db_1.default.caixaRegistro.findMany({
                where,
                include: {
                    fornecedor: true,
                    lavador: true,
                },
            });
        }
        const todosRegistros = [...registrosPagamento, ...outrosRegistros].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
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
    }
    catch (error) {
        console.error('Erro ao buscar histórico de caixa:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de caixa.' });
    }
};
exports.getHistorico = getHistorico;
async function getPagamentosDoPeriodo(empresaId, dateFilter) {
    const pagamentos = await db_1.default.pagamento.findMany({
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
    return pagamentos.map((p) => ({
        id: p.id,
        tipo: p.status === 'PAGO' ? 'PAGAMENTO' : 'PENDENTE',
        data: p.status === 'PAGO' ? p.pagoEm : p.createdAt,
        valor: p.valor,
        formaPagamento: p.metodo,
        ordemId: p.ordem.id,
        descricao: `Pagamento OS: ${p.ordem.veiculo.modelo} (${p.ordem.veiculo.placa})`,
    }));
}
const getFechamentoById = async (req, res) => {
    const empresaId = req.empresaId;
    const { id } = req.params;
    try {
        const registroFechamento = await db_1.default.caixaRegistro.findFirst({
            where: { id, empresaId, tipo: 'FECHAMENTO' },
        });
        if (!registroFechamento) {
            return res.status(404).json({ error: 'Fechamento de caixa não encontrado.' });
        }
        const empresa = await db_1.default.empresa.findUnique({ where: { id: empresaId } });
        const horarioAbertura = empresa?.horarioAbertura || '07:00';
        const fechamento = await db_1.default.fechamentoCaixa.findFirst({
            where: { empresaId, data: { gte: getWorkdayRange(registroFechamento.data, horarioAbertura).start, lte: getWorkdayRange(registroFechamento.data, horarioAbertura).end } },
        });
        if (!fechamento)
            return res.status(404).json({ error: 'Detalhes do fechamento não encontrados para esta data.' });
        const { start, end } = getWorkdayRange(fechamento.data, horarioAbertura);
        const pagamentos = await db_1.default.pagamento.findMany({
            where: { empresaId, status: 'PAGO', pagoEm: { gte: start, lte: end } },
            select: { valor: true, metodo: true, pagoEm: true, ordem: { select: { veiculo: { select: { placa: true } } } } }
        });
        const registrosPagamento = pagamentos.map((p) => ({
            id: `pag-${p.pagoEm?.toISOString()}-${p.valor}`,
            tipo: 'PAGAMENTO',
            data: p.pagoEm,
            valor: p.valor,
            formaPagamento: p.metodo,
            descricao: `Pagamento OS (Placa: ${p.ordem.veiculo.placa})`,
            lavador: null,
            fornecedor: null
        }));
        const outrosRegistros = await db_1.default.caixaRegistro.findMany({
            where: { empresaId, data: { gte: start, lte: end } },
            include: { fornecedor: true, lavador: true },
        });
        const movimentacoesDoDia = [...registrosPagamento, ...outrosRegistros].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
        res.json({
            fechamento,
            movimentacoes: movimentacoesDoDia,
        });
    }
    catch (error) {
        console.error('Erro ao buscar detalhes do fechamento:', error);
        res.status(500).json({ error: 'Erro ao buscar detalhes do fechamento.' });
    }
};
exports.getFechamentoById = getFechamentoById;
const getGanhosDoMes = async (req, res) => {
    const empresaId = req.empresaId;
    const { ano, mes } = req.query;
    if (!ano || !mes) {
        return res.status(400).json({ error: 'Ano e mês são obrigatórios.' });
    }
    const anoNum = parseInt(ano);
    const mesNum = parseInt(mes);
    const dataInicio = new Date(anoNum, mesNum - 1, 1);
    const dataFim = new Date(anoNum, mesNum, 0, 23, 59, 59, 999);
    try {
        const pagamentos = await db_1.default.pagamento.findMany({
            where: {
                empresaId,
                status: 'PAGO',
                pagoEm: { gte: dataInicio, lte: dataFim },
            },
            select: { valor: true, pagoEm: true },
        });
        res.json(pagamentos);
    }
    catch (error) {
        console.error('Erro ao buscar ganhos do mês:', error);
        res.status(500).json({ error: 'Erro ao buscar ganhos do mês.' });
    }
};
exports.getGanhosDoMes = getGanhosDoMes;
const getFechamentoComissaoById = async (req, res) => {
    const empresaId = req.empresaId;
    const { id } = req.params;
    try {
        const fechamento = await db_1.default.fechamentoComissao.findFirst({
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
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao buscar detalhes do fechamento de comissão.' });
    }
};
exports.getFechamentoComissaoById = getFechamentoComissaoById;
const getHistoricoComissoes = async (req, res) => {
    const empresaId = req.empresaId;
    const { lavadorId } = req.query;
    const where = { empresaId };
    if (lavadorId) {
        where.lavadorId = lavadorId;
    }
    try {
        const historico = await db_1.default.fechamentoComissao.findMany({
            where,
            include: {
                lavador: { select: { nome: true } },
            },
            orderBy: { data: 'desc' },
        });
        res.json(historico);
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao buscar histórico de comissões.' });
    }
};
exports.getHistoricoComissoes = getHistoricoComissoes;
const fecharComissao = async (req, res) => {
    const empresaId = req.empresaId;
    const { lavadorId, comissaoIds, adiantamentoIds, valorPago, formaPagamento } = req.body;
    if (!lavadorId || !comissaoIds || !adiantamentoIds || valorPago === undefined) {
        return res.status(400).json({ error: 'Dados insuficientes para fechar a comissão.' });
    }
    if (valorPago > 0 && !formaPagamento) {
        return res.status(400).json({ error: 'A forma de pagamento é obrigatória quando há valor a pagar.' });
    }
    try {
        const resultado = await db_1.default.$transaction(async (tx) => {
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
                const uniqueOrdemIds = Array.from(new Set(comissaoIds));
                for (const ordemId of uniqueOrdemIds) {
                    const pendingLavadores = await tx.ordemServicoLavador.count({
                        where: {
                            ordemId,
                            comissaoPaga: false,
                        },
                    });
                    if (pendingLavadores === 0) {
                        await tx.ordemServico.update({
                            where: { id: ordemId, empresaId },
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
                const lavador = await tx.lavador.findUnique({ where: { id: lavadorId } });
                await tx.caixaRegistro.create({
                    data: {
                        empresaId,
                        tipo: 'SAIDA',
                        valor: valorPago,
                        formaPagamento: formaPagamento,
                        descricao: `Pagamento de comissão para ${lavador?.nome || 'Funcionário'}`,
                        lavadorId,
                    },
                });
            }
            return { message: 'Fechamento de comissão realizado com sucesso.' };
        });
        res.status(200).json(resultado);
    }
    catch (error) {
        console.error('Erro ao fechar comissão:', error);
        res.status(500).json({ error: 'Erro interno ao processar o pagamento da comissão.' });
    }
};
exports.fecharComissao = fecharComissao;
const migrarPagamentosComissaoAntigos = async (req, res) => {
    const empresaId = req.empresaId;
    try {
        const saidasComissao = await db_1.default.caixaRegistro.findMany({
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
            await db_1.default.fechamentoComissao.upsert({
                where: { id: `migrado-${saida.id}` },
                update: {},
                create: {
                    id: `migrado-${saida.id}`,
                    data: saida.data,
                    valorPago: saida.valor,
                    empresaId: empresaId,
                    lavadorId: saida.lavadorId,
                },
            });
        }
        res.status(200).json({ message: `${saidasComissao.length} pagamentos de comissão antigos foram migrados para o histórico.` });
    }
    catch (error) {
        console.error('Erro ao migrar pagamentos de comissão:', error);
        res.status(500).json({ error: 'Erro ao migrar dados.' });
    }
};
exports.migrarPagamentosComissaoAntigos = migrarPagamentosComissaoAntigos;
const updateCaixaRegistro = async (req, res) => {
    const empresaId = req.empresaId;
    const { id } = req.params;
    const { valor, formaPagamento, descricao, fornecedorNome, tipo, lavadorId } = req.body;
    try {
        let fornecedorId;
        if (tipo !== 'Adiantamento' && fornecedorNome) {
            let fornecedor = await db_1.default.fornecedor.findFirst({ where: { nome: fornecedorNome, empresaId } });
            if (!fornecedor) {
                fornecedor = await db_1.default.fornecedor.create({ data: { nome: fornecedorNome, empresaId } });
            }
            fornecedorId = fornecedor.id;
        }
        const finalDescricao = tipo === 'Adiantamento' ? `Adiantamento para funcionário` : `[${tipo}] ${descricao}`;
        const registroAtualizado = await db_1.default.caixaRegistro.update({
            where: { id, empresaId },
            data: {
                valor: valor,
                formaPagamento: formaPagamento,
                descricao: finalDescricao,
                fornecedorId,
                lavadorId: tipo === 'Adiantamento' ? lavadorId : null,
            },
        });
        if (tipo === 'Adiantamento' && lavadorId) {
            await db_1.default.adiantamento.updateMany({
                where: { caixaRegistroId: id },
                data: { valor: valor, lavadorId },
            });
        }
        res.json(registroAtualizado);
    }
    catch (error) {
        console.error('Erro ao atualizar registro de caixa:', error);
        res.status(500).json({ error: 'Erro ao atualizar registro de caixa.' });
    }
};
exports.updateCaixaRegistro = updateCaixaRegistro;
const deleteCaixaRegistro = async (req, res) => {
    const empresaId = req.empresaId;
    const { id } = req.params;
    try {
        await db_1.default.$transaction(async (tx) => {
            await tx.adiantamento.deleteMany({
                where: { caixaRegistroId: id },
            });
            await tx.caixaRegistro.delete({
                where: { id, empresaId },
            });
        });
        res.status(200).json({ message: 'Movimentação excluída com sucesso.' });
    }
    catch (error) {
        console.error('Erro ao excluir registro de caixa:', error);
        res.status(500).json({ error: 'Erro ao excluir registro de caixa.' });
    }
};
exports.deleteCaixaRegistro = deleteCaixaRegistro;
const getDadosComissao = async (req, res) => {
    const empresaId = req.empresaId;
    const { lavadorId, dataInicio, dataFim } = req.query;
    if (!lavadorId || !dataInicio || !dataFim) {
        return res.status(400).json({ error: 'Funcionário e período são obrigatórios.' });
    }
    const empresa = await db_1.default.empresa.findUnique({ where: { id: empresaId } });
    const horarioAbertura = empresa?.horarioAbertura || '07:00';
    const start = new Date(`${dataInicio}T${horarioAbertura}:00`);
    const end = new Date(`${dataFim}T${horarioAbertura}:00`);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);
    try {
        const comissoesPendentes = await db_1.default.ordemServico.findMany({
            where: {
                empresaId,
                dataFim: { gte: start, lte: end },
                OR: [
                    {
                        ordemLavadores: {
                            some: {
                                lavadorId: lavadorId,
                                comissaoPaga: false
                            }
                        }
                    },
                    {
                        lavadorId: lavadorId,
                        comissaoPaga: false
                    }
                ]
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
        const adiantamentosPendentes = await db_1.default.adiantamento.findMany({
            where: {
                empresaId,
                lavadorId: lavadorId,
                status: 'PENDENTE',
            },
        });
        const debitosPendentes = await db_1.default.ordemServico.findMany({
            where: {
                empresaId,
                dataFim: { gte: start, lte: end },
                pagamentos: {
                    some: {
                        metodo: 'DEBITO_FUNCIONARIO'
                    }
                },
                OR: [
                    {
                        ordemLavadores: {
                            some: {
                                lavadorId: lavadorId,
                                comissaoPaga: false
                            }
                        }
                    },
                    {
                        lavadorId: lavadorId,
                        comissaoPaga: false
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
        const normalizeOrderWashers = (ordem) => {
            const washers = (ordem.ordemLavadores || []).map((rel) => ({
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
        const formattedComissoes = comissoesPendentes.map(ordem => ({
            id: ordem.id,
            numeroOrdem: ordem.numeroOrdem,
            valorTotal: ordem.valorTotal,
            dataFim: ordem.dataFim,
            comissao: ordem.comissao,
            veiculo: ordem.veiculo,
            lavadorId: ordem.lavadorId,
            lavadores: normalizeOrderWashers(ordem)
        }));
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
    }
    catch (error) {
        res.status(500).json({ error: 'Erro ao buscar dados de comissão.' });
    }
};
exports.getDadosComissao = getDadosComissao;
//# sourceMappingURL=caixaController.js.map