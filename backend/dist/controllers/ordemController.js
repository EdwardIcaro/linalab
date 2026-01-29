"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processarFinalizacoesAutomaticas = exports.finalizarOrdem = exports.deleteOrdem = exports.getOrdensStats = exports.cancelOrdem = exports.updateOrdem = exports.getOrdemById = exports.getOrdens = exports.createOrdem = void 0;
const db_1 = __importDefault(require("../db"));
const notificationService_1 = require("../services/notificationService");
const validate_1 = require("../utils/validate");
function formatOrderWithLavadores(order) {
    if (!order)
        return order;
    const ordemLavadores = order.ordemLavadores || [];
    const lavadores = ordemLavadores.map((relation) => ({
        id: relation.lavadorId,
        nome: relation.lavador?.nome || null
    }));
    const lavadorIds = lavadores.map((l) => l.id);
    const formatted = {
        ...order,
        lavadores,
        lavadorIds
    };
    delete formatted.ordemLavadores;
    return formatted;
}
/**
 * Criar nova ordem de serviço
 * Agora, esta função também pode criar um cliente e/ou veículo se eles não existirem.
 */
const createOrdem = async (req, res) => {
    const empresaId = req.empresaId;
    if (!empresaId) {
        return res.status(401).json({ error: 'Empresa não autenticada' });
    }
    // SECURITY: Validate and sanitize input data
    const validation = (0, validate_1.validateCreateOrder)(req.body);
    if (!validation.isValid) {
        return res.status(400).json({
            error: 'Dados inválidos para criar ordem',
            details: validation.errors,
            code: 'VALIDATION_ERROR'
        });
    }
    // Use sanitized data instead of raw req.body
    const { clienteId, novoCliente, veiculoId, novoVeiculo, lavadorId, lavadorIds, itens, forcarCriacao, observacoes } = validation.sanitizedData;
    const extraLavadores = Array.from(new Set((lavadorIds || []).filter((id) => !!id && id !== lavadorId)));
    const normalizedLavadorIds = lavadorId ? [lavadorId, ...extraLavadores] : extraLavadores;
    const primaryLavadorId = normalizedLavadorIds[0] || null;
    try {
        // Utiliza uma transação para garantir a atomicidade da operação
        const ordem = await db_1.default.$transaction(async (tx) => {
            let finalClienteId = clienteId;
            let finalVeiculoId = veiculoId;
            // 1. Determina o ID do cliente: usa o existente ou cria um novo.
            if (!finalClienteId && novoCliente && novoCliente.nome) {
                // Primeiro, tenta encontrar um cliente existente com o mesmo nome e telefone
                let clienteExistente = await tx.cliente.findFirst({
                    where: {
                        nome: novoCliente.nome,
                        telefone: novoCliente.telefone || null,
                        empresaId: empresaId,
                    },
                });
                if (clienteExistente) {
                    finalClienteId = clienteExistente.id;
                }
                else {
                    // Se não encontrar, cria um novo cliente
                    const clienteCriado = await tx.cliente.create({
                        data: {
                            nome: novoCliente.nome,
                            telefone: novoCliente.telefone,
                            empresaId,
                        },
                    });
                    finalClienteId = clienteCriado.id;
                }
            }
            // 2. Cria o veículo se for novo
            if (novoVeiculo && novoVeiculo.placa) {
                // Primeiro, tenta encontrar um veículo com a mesma placa
                let veiculoExistente = await tx.veiculo.findUnique({
                    where: { placa: novoVeiculo.placa },
                });
                if (veiculoExistente) {
                    finalVeiculoId = veiculoExistente.id;
                }
                else {
                    // Se não encontrar, cria um novo veículo
                    const veiculoCriado = await tx.veiculo.create({
                        data: {
                            placa: novoVeiculo.placa,
                            modelo: novoVeiculo.modelo,
                            cor: novoVeiculo.cor,
                            clienteId: finalClienteId,
                        },
                        include: {
                            // Inclui o cliente para garantir que os dados retornados estejam completos
                            cliente: true
                        }
                    });
                    finalVeiculoId = veiculoCriado.id;
                }
            }
            // 3. Verifica se já existe uma ordem ativa para o veículo
            if (!forcarCriacao) {
                const ordemAtiva = await tx.ordemServico.findFirst({
                    where: {
                        veiculoId: finalVeiculoId,
                        empresaId,
                        status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] },
                    },
                });
                if (ordemAtiva) {
                    // Lança um erro para abortar a transação
                    throw { code: 'ACTIVE_ORDER_EXISTS' };
                }
            }
            // 4. Calcula o valor total e prepara os itens da ordem
            let calculatedValorTotal = 0;
            const ordemItemsData = await Promise.all(itens.map(async (item) => {
                let precoUnit = 0;
                let itemData;
                if (item.tipo === 'SERVICO') {
                    const servico = await tx.servico.findUnique({ where: { id: item.itemId } });
                    if (servico) {
                        precoUnit = servico.preco;
                    }
                    else {
                        // Lançar um erro se o serviço não for encontrado pode ajudar a debugar
                        throw new Error(`Serviço com ID ${item.itemId} não encontrado.`);
                    }
                    const subtotal = precoUnit * item.quantidade;
                    calculatedValorTotal += subtotal;
                    itemData = {
                        tipo: 'SERVICO',
                        quantidade: item.quantidade,
                        precoUnit,
                        subtotal,
                        servicoId: item.itemId
                    };
                }
                else if (item.tipo === 'ADICIONAL') {
                    const adicional = await tx.adicional.findUnique({ where: { id: item.itemId } });
                    if (adicional) {
                        precoUnit = adicional.preco;
                    }
                    else {
                        // Lançar um erro se o adicional não for encontrado
                        throw new Error(`Adicional com ID ${item.itemId} não encontrado.`);
                    }
                    const subtotal = precoUnit * item.quantidade;
                    calculatedValorTotal += subtotal;
                    itemData = {
                        tipo: 'ADICIONAL',
                        quantidade: item.quantidade,
                        precoUnit,
                        subtotal,
                        adicionalId: item.itemId
                    };
                }
                else {
                    // Se o tipo não for nem SERVICO nem ADICIONAL, lança um erro.
                    throw new Error(`Tipo de item desconhecido: ${item.tipo}`);
                }
                return itemData;
            }));
            // Add a final validation check before creating the order
            if (!finalClienteId || !finalVeiculoId) {
                throw new Error("ID do cliente ou do veículo não pôde ser determinado.");
            }
            // 5. Calcular comissão
            let comissaoCalculada = 0;
            if (lavadorId) {
                const lavador = await tx.lavador.findUnique({ where: { id: lavadorId } });
                if (lavador && lavador.comissao > 0) {
                    // A comissão é uma porcentagem do valor total da ordem
                    comissaoCalculada = calculatedValorTotal * (lavador.comissao / 100);
                }
            }
            // 6. Gerar o número da ordem
            const ultimaOrdem = await tx.ordemServico.findFirst({
                where: { empresaId },
                orderBy: { numeroOrdem: 'desc' },
                select: { numeroOrdem: true },
            });
            const proximoNumeroOrdem = (ultimaOrdem?.numeroOrdem || 0) + 1;
            // 7. Cria a ordem de serviço
            const novaOrdem = await tx.ordemServico.create({
                data: {
                    numeroOrdem: proximoNumeroOrdem,
                    empresaId,
                    clienteId: finalClienteId,
                    veiculoId: finalVeiculoId,
                    lavadorId: primaryLavadorId,
                    valorTotal: calculatedValorTotal,
                    comissao: comissaoCalculada, // A comissão é calculada, mas só é "devida" ao finalizar
                    status: primaryLavadorId ? 'EM_ANDAMENTO' : 'PENDENTE',
                    observacoes: observacoes,
                    items: { create: ordemItemsData.filter(Boolean) },
                },
            });
            if (normalizedLavadorIds.length > 0) {
                await tx.ordemServicoLavador.createMany({
                    data: normalizedLavadorIds.map(lavadorIdValue => ({
                        ordemId: novaOrdem.id,
                        lavadorId: lavadorIdValue
                    }))
                });
            }
            const ordemComLavadores = await tx.ordemServico.findUnique({
                where: { id: novaOrdem.id },
                include: {
                    cliente: true,
                    veiculo: true,
                    lavador: true,
                    items: { include: { servico: true, adicional: true } },
                    ordemLavadores: { include: { lavador: true } }
                }
            });
            return ordemComLavadores;
        });
        const ordemFinal = formatOrderWithLavadores(ordem);
        // Enviar notificação APÓS a transação para garantir que os dados estão corretos
        await (0, notificationService_1.createNotification)({
            empresaId: empresaId,
            mensagem: `Nova ordem #${ordem.numeroOrdem} (${ordemFinal.cliente.nome}) foi criada.`,
            link: `ordens.html?id=${ordem.id}`,
            type: 'ordemCriada'
        });
        res.status(201).json({ message: 'Ordem de serviço criada com sucesso!', ordem: ordemFinal });
    }
    catch (error) {
        if (error.code === 'ACTIVE_ORDER_EXISTS') {
            return res.status(409).json({
                error: 'Já existe uma ordem de serviço ativa para este veículo.',
                code: 'ACTIVE_ORDER_EXISTS',
            });
        }
        console.error('Erro detalhado ao criar ordem de serviço:', error);
        res.status(500).json({
            error: 'Erro interno do servidor ao criar ordem.',
            details: error.message || 'Nenhuma mensagem de erro específica.'
        });
    }
};
exports.createOrdem = createOrdem;
/**
 * Listar ordens de serviço da empresa
 */
const getOrdens = async (req, res) => {
    try {
        const { page: pageQuery, limit: limitQuery, search, status, clienteId, lavadorId, dataInicio, dataFim, metodoPagamento, } = req.query;
        const page = Number(pageQuery) || 1;
        const limit = Number(limitQuery) || 10;
        const skip = (page - 1) * limit;
        const where = {
            empresaId: req.empresaId,
        };
        if (search) {
            where.OR = [
                {
                    cliente: {
                        nome: { contains: search, mode: 'insensitive' }
                    }
                },
                {
                    veiculo: {
                        placa: { contains: search, mode: 'insensitive' }
                    }
                }
            ];
        }
        if (status) {
            const statusString = status;
            if (statusString === 'ACTIVE') {
                where.status = { in: ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] };
            }
            else if (statusString.includes(',')) {
                where.status = { in: statusString.split(',') };
            }
            else {
                where.status = statusString;
            }
        }
        if (clienteId) {
            where.clienteId = clienteId;
        }
        if (lavadorId) {
            const washerFilterId = lavadorId;
            const washerFilterCondition = {
                OR: [
                    { lavadorId: washerFilterId },
                    { ordemLavadores: { some: { lavadorId: washerFilterId } } }
                ]
            };
            const existingAnd = Array.isArray(where.AND)
                ? [...where.AND]
                : where.AND
                    ? [where.AND]
                    : [];
            where.AND = [...existingAnd, washerFilterCondition];
        }
        if (dataInicio && dataFim && dataInicio !== 'null' && dataFim !== 'null') {
            // As datas já chegam no formato YYYY-MM-DD
            const start = new Date(dataInicio);
            start.setUTCHours(0, 0, 0, 0);
            const end = new Date(dataFim);
            end.setUTCHours(23, 59, 59, 999);
            end.setDate(end.getDate() + 1);
            where.createdAt = {
                gte: start,
                lte: end,
            };
        }
        if (metodoPagamento) {
            where.pagamentos = {
                some: {
                    metodo: metodoPagamento
                }
            };
        }
        const [ordens, total] = await Promise.all([
            db_1.default.ordemServico.findMany({
                where,
                include: {
                    cliente: {
                        select: {
                            id: true,
                            nome: true,
                            telefone: true
                        }
                    },
                    veiculo: {
                        select: {
                            id: true,
                            placa: true,
                            modelo: true,
                            cor: true
                        }
                    },
                    lavador: {
                        select: {
                            id: true,
                            nome: true,
                            comissao: true
                        }
                    },
                    items: {
                        include: {
                            servico: {
                                select: {
                                    id: true,
                                    nome: true
                                }
                            },
                            adicional: {
                                select: {
                                    id: true,
                                    nome: true
                                }
                            }
                        }
                    },
                    ordemLavadores: {
                        include: {
                            lavador: {
                                select: {
                                    id: true,
                                    nome: true
                                }
                            }
                        }
                    },
                    pagamentos: {
                        orderBy: {
                            createdAt: 'asc'
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                skip,
                take: Number(limit)
            }),
            db_1.default.ordemServico.count({ where })
        ]);
        const enrichedOrders = ordens.map(order => formatOrderWithLavadores(order));
        res.json({
            ordens: enrichedOrders,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / Number(limit))
            }
        });
    }
    catch (error) {
        console.error('Erro ao listar ordens de serviço:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.getOrdens = getOrdens;
/**
 * Buscar ordem de serviço por ID
 */
const getOrdemById = async (req, res) => {
    try {
        const { id } = req.params;
        const ordem = await db_1.default.ordemServico.findFirst({
            where: {
                id,
                empresaId: req.empresaId
            },
            include: {
                cliente: {
                    select: {
                        id: true,
                        nome: true,
                        telefone: true,
                        email: true
                    }
                },
                veiculo: {
                    select: {
                        id: true,
                        placa: true,
                        modelo: true,
                        cor: true,
                        ano: true
                    }
                },
                lavador: {
                    select: {
                        id: true,
                        nome: true,
                        comissao: true
                    }
                },
                items: {
                    include: {
                        servico: {
                            select: {
                                id: true,
                                nome: true
                            }
                        },
                        adicional: {
                            select: {
                                id: true,
                                nome: true
                            }
                        }
                    }
                },
                ordemLavadores: {
                    include: {
                        lavador: {
                            select: {
                                id: true,
                                nome: true
                            }
                        }
                    }
                },
                pagamentos: {
                    orderBy: {
                        createdAt: 'asc'
                    }
                }
            }
        });
        if (!ordem) {
            return res.status(404).json({ error: 'Ordem de serviço não encontrada' });
        }
        res.json(formatOrderWithLavadores(ordem));
    }
    catch (error) {
        console.error('Erro ao buscar ordem de serviço:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.getOrdemById = getOrdemById;
/**
 * Atualizar ordem de serviço
 */
const updateOrdem = async (req, res) => {
    const validation = (0, validate_1.validateUpdateOrder)(req.body);
    if (!validation.isValid) {
        return res.status(400).json({
            error: 'Dados inválidos para atualizar ordem',
            details: validation.errors,
            code: 'VALIDATION_ERROR'
        });
    }
    try {
        const updatedOrdemResult = await db_1.default.$transaction(async (tx) => {
            const { id } = req.params;
            const { status, lavadorId, lavadorIds, observacoes, itens } = validation.sanitizedData;
            const existingOrdem = await tx.ordemServico.findFirst({
                where: { id, empresaId: req.empresaId },
            });
            if (!existingOrdem) {
                throw new Error('Ordem de serviço não encontrada'); // Lança um erro para ser pego pelo catch
            }
            const extraLavadores = Array.from(new Set((lavadorIds || []).filter((id) => !!id && id !== lavadorId)));
            const normalizedLavadorIds = lavadorId ? [lavadorId, ...extraLavadores] : extraLavadores;
            const primaryLavadorId = normalizedLavadorIds[0] || null;
            let valorTotal = existingOrdem.valorTotal;
            const dataToUpdate = {
                observacoes,
                status,
                lavador: primaryLavadorId ? { connect: { id: primaryLavadorId } } : undefined,
            };
            if (itens && Array.isArray(itens)) {
                await tx.ordemServicoItem.deleteMany({ where: { ordemId: id } });
                valorTotal = 0;
                const itensData = [];
                for (const item of itens) {
                    const { tipo, itemId, quantidade } = item;
                    if (!tipo || !itemId || !quantidade || quantidade <= 0) {
                        throw new Error('Cada item deve ter tipo, ID e quantidade válida');
                    }
                    let itemData;
                    let precoUnitario = 0;
                    if (tipo === 'SERVICO') {
                        const servico = await tx.servico.findUnique({ where: { id: itemId, empresaId: req.empresaId } });
                        if (!servico)
                            throw new Error(`Serviço com ID ${itemId} não encontrado`);
                        precoUnitario = servico.preco;
                        itemData = { tipo: 'SERVICO', servico: { connect: { id: itemId } }, quantidade, precoUnit: precoUnitario, subtotal: precoUnitario * quantidade };
                    }
                    else if (tipo === 'ADICIONAL') {
                        const adicional = await tx.adicional.findUnique({ where: { id: itemId, empresaId: req.empresaId } });
                        if (!adicional)
                            throw new Error(`Adicional com ID ${itemId} não encontrado`);
                        precoUnitario = adicional.preco;
                        itemData = { tipo: 'ADICIONAL', adicional: { connect: { id: itemId } }, quantidade, precoUnit: precoUnitario, subtotal: precoUnitario * quantidade };
                    }
                    else {
                        throw new Error('Tipo de item inválido. Use SERVICO ou ADICIONAL');
                    }
                    itensData.push(itemData);
                    valorTotal += itemData.subtotal;
                }
                dataToUpdate.items = { create: itensData };
                dataToUpdate.valorTotal = valorTotal;
            }
            // Recalcular comissão se o lavador ou o valor total mudou
            if (itens || lavadorId !== existingOrdem.lavadorId) {
                let comissaoCalculada = 0;
                const valorParaCalculo = Number(dataToUpdate.valorTotal?.toString() || existingOrdem.valorTotal.toString());
                if (lavadorId) {
                    const lavador = await tx.lavador.findUnique({ where: { id: lavadorId } });
                    if (lavador && lavador.comissao > 0) {
                        comissaoCalculada = valorParaCalculo * (lavador.comissao / 100);
                    }
                }
                dataToUpdate.comissao = comissaoCalculada;
            }
            // Se o status está sendo mudado para FINALIZADO, recalcula a comissão final
            // para garantir que está correta, mesmo que o lavador não tenha sido alterado.
            if (status === 'FINALIZADO' && existingOrdem.status !== 'FINALIZADO') {
                const valorFinal = Number(dataToUpdate.valorTotal?.toString() || existingOrdem.valorTotal.toString());
                const lavadorFinalId = lavadorId || existingOrdem.lavadorId;
                if (lavadorFinalId) {
                    const lavador = await tx.lavador.findUnique({ where: { id: lavadorFinalId } });
                    if (lavador && lavador.comissao > 0) {
                        dataToUpdate.comissao = valorFinal * (lavador.comissao / 100);
                    }
                }
            }
            if (status && status === 'FINALIZADO' && !existingOrdem.dataFim) {
                dataToUpdate.dataFim = new Date();
            }
            const ordemAtualizada = await tx.ordemServico.update({
                where: { id },
                data: dataToUpdate,
                include: {
                    cliente: { select: { id: true, nome: true, telefone: true } },
                    veiculo: { select: { id: true, placa: true, modelo: true, cor: true } },
                    lavador: { select: { id: true, nome: true, comissao: true } },
                    items: { include: { servico: { select: { id: true, nome: true } }, adicional: { select: { id: true, nome: true } } } }
                },
            });
            await tx.ordemServicoLavador.deleteMany({ where: { ordemId: id } });
            if (normalizedLavadorIds.length > 0) {
                await tx.ordemServicoLavador.createMany({
                    data: normalizedLavadorIds.map(lavadorIdValue => ({
                        ordemId: id,
                        lavadorId: lavadorIdValue
                    }))
                });
            }
            const ordemComLavadores = await tx.ordemServico.findUnique({
                where: { id },
                include: {
                    cliente: { select: { id: true, nome: true, telefone: true } },
                    veiculo: { select: { id: true, placa: true, modelo: true, cor: true } },
                    lavador: { select: { id: true, nome: true, comissao: true } },
                    items: { include: { servico: { select: { id: true, nome: true } }, adicional: { select: { id: true, nome: true } } } },
                    ordemLavadores: { include: { lavador: true } }
                }
            });
            return ordemComLavadores;
        });
        // Enviar notificação após a transação ser bem-sucedida
        const ordemFinal = formatOrderWithLavadores(updatedOrdemResult);
        await (0, notificationService_1.createNotification)({
            empresaId: req.empresaId,
            mensagem: `A ordem #${ordemFinal.numeroOrdem} (${ordemFinal.cliente.nome}) foi atualizada.`,
            link: `ordens.html?id=${ordemFinal.id}`,
            type: 'ordemEditada'
        });
        res.json({ message: 'Ordem de serviço atualizada com sucesso', ordem: ordemFinal });
    }
    catch (error) {
        console.error('Erro ao atualizar ordem de serviço:', error);
        res.status(error.message === 'Ordem de serviço não encontrada' ? 404 : 500).json({ error: error.message || 'Erro interno do servidor' });
    }
};
exports.updateOrdem = updateOrdem;
/**
 * Cancelar ordem de serviço
 */
const cancelOrdem = async (req, res) => {
    try {
        const { id } = req.params;
        // Verificar se ordem existe e pertence à empresa
        const ordem = await db_1.default.ordemServico.findFirst({
            where: {
                id,
                empresaId: req.empresaId
            }
        });
        if (!ordem) {
            return res.status(404).json({ error: 'Ordem de serviço não encontrada' });
        }
        // Não permitir cancelar ordem já finalizada ou cancelada
        if (ordem.status === 'FINALIZADO' || ordem.status === 'CANCELADO') {
            return res.status(400).json({
                error: 'Não é possível cancelar ordem já finalizada ou cancelada'
            });
        }
        const updatedOrdem = await db_1.default.ordemServico.update({
            where: { id },
            data: {
                status: 'CANCELADO'
            },
            include: {
                cliente: {
                    select: {
                        id: true,
                        nome: true,
                        telefone: true
                    }
                },
                veiculo: {
                    select: {
                        id: true,
                        placa: true,
                        modelo: true,
                        cor: true
                    }
                },
                lavador: {
                    select: {
                        id: true,
                        nome: true,
                        comissao: true
                    }
                },
                items: {
                    include: {
                        servico: {
                            select: {
                                id: true,
                                nome: true
                            }
                        },
                        adicional: {
                            select: {
                                id: true,
                                nome: true
                            }
                        }
                    }
                }
            }
        });
        res.json({
            message: 'Ordem de serviço cancelada com sucesso',
            ordem: updatedOrdem
        });
    }
    catch (error) {
        console.error('Erro ao cancelar ordem de serviço:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.cancelOrdem = cancelOrdem;
/**
 * Obter estatísticas de ordens de serviço
 */
const getOrdensStats = async (req, res) => {
    try {
        const { dataInicio, dataFim, lavadorId, servicoId } = req.query;
        const where = {
            empresaId: req.empresaId,
            status: 'FINALIZADO' // Garante que todas as estatísticas sejam baseadas apenas em ordens finalizadas
        };
        if (dataInicio || dataFim) {
            where.dataFim = {};
            if (dataInicio && dataInicio !== '') {
                const start = new Date(dataInicio);
                start.setUTCHours(0, 0, 0, 0);
                if (where.dataFim)
                    where.dataFim.gte = start;
            }
            if (dataFim && dataFim !== '') {
                const end = new Date(dataFim);
                end.setUTCHours(23, 59, 59, 999);
                if (where.dataFim)
                    where.dataFim.lte = end;
            }
        }
        if (lavadorId) {
            const washerFilterId = lavadorId;
            const washerFilterCondition = {
                OR: [
                    { lavadorId: washerFilterId },
                    { ordemLavadores: { some: { lavadorId: washerFilterId } } }
                ]
            };
            const existingAnd = Array.isArray(where.AND)
                ? [...where.AND]
                : where.AND
                    ? [where.AND]
                    : [];
            where.AND = [...existingAnd, washerFilterCondition];
        }
        if (servicoId) {
            where.items = {
                some: {
                    servicoId: servicoId,
                    tipo: 'SERVICO'
                }
            };
        }
        // Primeiro, obter os IDs das ordens que atendem aos critérios
        const ordensIds = await db_1.default.ordemServico.findMany({
            where,
            select: { id: true }
        });
        const ordensIdsList = ordensIds.map((o) => o.id);
        const [ordensPorStatus, valorTotal, ordensFinalizadas, topServicos, topLavadores] = await Promise.all([
            db_1.default.ordemServico.groupBy({
                by: ['status'],
                where,
                _count: {
                    status: true
                }
            }),
            db_1.default.ordemServico.aggregate({
                where,
                _sum: {
                    valorTotal: true
                }
            }),
            db_1.default.ordemServico.count({
                where: where // O status já está no 'where' principal
            }),
            // Corrigido: usar ordemId em vez de relação aninhada
            db_1.default.ordemServicoItem.groupBy({
                by: ['servicoId'],
                where: {
                    ordemId: { in: ordensIdsList },
                    servicoId: { not: null },
                    tipo: 'SERVICO'
                },
                _sum: {
                    quantidade: true
                },
                _count: {
                    id: true
                },
                orderBy: {
                    _sum: {
                        quantidade: 'desc'
                    }
                },
                take: 5
            }),
            db_1.default.ordemServico.groupBy({
                by: ['lavadorId'],
                where: {
                    ...where,
                    lavadorId: { not: null } // Correção definitiva aqui
                },
                _count: {
                    id: true
                },
                _sum: {
                    valorTotal: true
                },
                orderBy: {
                    _count: {
                        id: 'desc'
                    }
                },
                take: 5
            })
        ]);
        // Buscar detalhes dos serviços e lavadores
        const [servicosDetalhes, lavadoresDetalhes] = await Promise.all([
            db_1.default.servico.findMany({
                where: {
                    id: { in: topServicos.map((s) => s.servicoId).filter(Boolean) }
                },
                select: {
                    id: true,
                    nome: true
                }
            }),
            db_1.default.lavador.findMany({
                where: {
                    id: { in: topLavadores.map((l) => l.lavadorId).filter(Boolean) }
                },
                select: {
                    id: true,
                    nome: true,
                    comissao: true
                }
            })
        ]);
        // Calcular estatísticas adicionais
        const valorTotalFormatado = valorTotal._sum.valorTotal || 0;
        const totalOrdensCount = ordensIdsList.length;
        const taxaConclusao = totalOrdensCount > 0 ? (ordensFinalizadas / totalOrdensCount) * 100 : 0;
        const ticketMedio = ordensFinalizadas > 0 ? valorTotalFormatado / ordensFinalizadas : 0;
        // Estatísticas de pagamentos
        const pagamentosStats = await db_1.default.pagamento.groupBy({
            by: ['metodo'],
            where: {
                empresaId: req.empresaId,
                status: 'PAGO',
                ordemId: { in: ordensIdsList }
            },
            _sum: {
                valor: true
            },
            _count: {
                _all: true
            }
        });
        const pagamentosPendentes = await db_1.default.pagamento.aggregate({
            where: {
                empresaId: req.empresaId,
                status: 'PENDENTE',
                ordemId: { in: ordensIdsList }
            },
            _sum: {
                valor: true
            }
        });
        res.json({
            // Estatísticas gerais (compatibilidade com frontend)
            totalOrdens: totalOrdensCount,
            ordensPorStatus,
            valorTotal: valorTotalFormatado,
            ordensFinalizadas,
            taxaConclusao: Math.round(taxaConclusao * 100) / 100,
            ticketMedio: Math.round(ticketMedio * 100) / 100,
            // Top serviços (formato compatível com frontend)
            topServicos: topServicos.map((ts) => ({
                ...ts,
                _sum: {
                    quantidade: ts._sum.quantidade || 0
                },
                _count: {
                    id: ts._count.id
                },
                servico: servicosDetalhes.find(s => s.id === ts.servicoId)
            })),
            // Top lavadores (formato compatível com frontend)
            topLavadores: topLavadores.map((tl) => ({
                ...tl,
                _sum: {
                    valorTotal: tl._sum.valorTotal || 0
                },
                _count: {
                    id: tl._count.id
                },
                lavador: lavadoresDetalhes.find(l => l.id === tl.lavadorId)
            })),
            // Estatísticas de pagamentos
            pagamentosPorMetodo: pagamentosStats,
            valorPendente: pagamentosPendentes._sum.valor || 0,
        });
    }
    catch (error) {
        console.error('Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.getOrdensStats = getOrdensStats;
/**
 * Deletar ordem de serviço permanentemente
 */
const deleteOrdem = async (req, res) => {
    try {
        const { id } = req.params;
        // Verificar se ordem existe e pertence à empresa, incluindo dados para a notificação
        const ordem = await db_1.default.ordemServico.findFirst({
            where: {
                id,
                empresaId: req.empresaId
            },
            include: {
                cliente: { select: { nome: true } }
            }
        });
        if (!ordem) {
            return res.status(404).json({ error: 'Ordem de serviço não encontrada' });
        }
        // Deletar pagamentos associados
        await db_1.default.pagamento.deleteMany({
            where: {
                ordemId: id
            }
        });
        // Deletar os itens da ordem primeiro (devido à restrição de chave estrangeira)
        await db_1.default.ordemServicoItem.deleteMany({
            where: {
                ordemId: id
            }
        });
        // Deletar a ordem
        await db_1.default.ordemServico.delete({
            where: {
                id
            }
        });
        // Enviar notificação após a exclusão
        await (0, notificationService_1.createNotification)({
            empresaId: req.empresaId,
            mensagem: `A ordem #${ordem.numeroOrdem} (${ordem.cliente.nome}) foi excluída.`,
            type: 'ordemDeletada' // O link é opcional aqui
        });
        res.json({
            message: 'Ordem de serviço deletada com sucesso'
        });
    }
    catch (error) {
        console.error('Erro ao deletar ordem de serviço:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.deleteOrdem = deleteOrdem;
/**
 * Finalizar ordem de serviço manualmente
 * Processa pagamento, atualiza status e calcula comissão
 */
const finalizarOrdem = async (req, res) => {
    const empresaId = req.empresaId;
    const { id } = req.params;
    // Validação de entrada
    if (!empresaId) {
        return res.status(401).json({ error: 'Empresa não autenticada' });
    }
    // SECURITY: Validate and sanitize payment data
    const validation = (0, validate_1.validateFinalizarOrdem)(req.body);
    if (!validation.isValid) {
        return res.status(400).json({
            error: 'Dados de pagamento inválidos',
            details: validation.errors,
            code: 'VALIDATION_ERROR'
        });
    }
    // Use sanitized data
    const { pagamentos, lavadorDebitoId } = validation.sanitizedData;
    try {
        // Buscar a ordem e verificar se existe e pertence à empresa
        const ordem = await db_1.default.ordemServico.findFirst({
            where: {
                id,
                empresaId
            },
            include: {
                lavador: true,
                cliente: true,
                veiculo: true
            }
        });
        if (!ordem) {
            return res.status(404).json({
                error: 'Ordem de serviço não encontrada',
                code: 'ORDER_NOT_FOUND'
            });
        }
        // Verificar se a ordem já foi finalizada
        if (ordem.status === 'FINALIZADO') {
            return res.status(409).json({
                error: 'Esta ordem já foi finalizada',
                code: 'ORDER_ALREADY_FINALIZED'
            });
        }
        // Verificar se a ordem foi cancelada
        if (ordem.status === 'CANCELADO') {
            return res.status(409).json({
                error: 'Não é possível finalizar uma ordem cancelada',
                code: 'ORDER_CANCELLED'
            });
        }
        // Calcular valor total dos pagamentos
        const valorTotalPagamentos = pagamentos.reduce((sum, pag) => sum + pag.valor, 0);
        // Verificar se o valor total dos pagamentos corresponde ao valor da ordem
        if (Math.abs(valorTotalPagamentos - ordem.valorTotal) > 0.01) { // Tolerância de 1 centavo para erros de arredondamento
            return res.status(400).json({
                error: `Valor total dos pagamentos (R$ ${valorTotalPagamentos.toFixed(2)}) não corresponde ao valor da ordem (R$ ${ordem.valorTotal.toFixed(2)})`,
                code: 'PAYMENT_VALUE_MISMATCH'
            });
        }
        // Calcular comissão se houver lavador
        let comissaoCalculada = 0;
        if (ordem.lavador) {
            // Comissão é uma porcentagem do valor total (ex: 15.5% = 15.5)
            comissaoCalculada = (ordem.valorTotal * ordem.lavador.comissao) / 100;
        }
        // Executar tudo em uma transação atômica
        const resultado = await db_1.default.$transaction(async (tx) => {
            // 1. Atualizar status da ordem para FINALIZADO
            const ordemAtualizada = await tx.ordemServico.update({
                where: { id },
                data: {
                    status: 'FINALIZADO',
                    dataFim: new Date(),
                    comissao: comissaoCalculada,
                    comissaoPaga: false, // Será paga no fechamento de comissão
                    pago: true
                },
                include: {
                    cliente: true,
                    veiculo: true,
                    lavador: true,
                    items: {
                        include: {
                            servico: true,
                            adicional: true
                        }
                    }
                }
            });
            // 2. Criar registros de pagamento
            const pagamentosCriados = await Promise.all(pagamentos.map((pag) => tx.pagamento.create({
                data: {
                    empresaId,
                    ordemId: id,
                    metodo: pag.metodo,
                    valor: pag.valor,
                    status: 'PAGO',
                    pagoEm: new Date(),
                    observacoes: pag.observacoes || null
                }
            })));
            // 3. Se houver débito de lavador, criar registro de adiantamento
            if (lavadorDebitoId && ordem.lavador) {
                await tx.adiantamento.create({
                    data: {
                        empresaId,
                        lavadorId: lavadorDebitoId,
                        valor: comissaoCalculada,
                        status: 'QUITADO'
                    }
                });
            }
            return {
                ordem: ordemAtualizada,
                pagamentos: pagamentosCriados
            };
        });
        // 4. Enviar notificação após a transação
        await (0, notificationService_1.createNotification)({
            empresaId,
            mensagem: `Ordem #${ordem.numeroOrdem} (${ordem.cliente.nome} - ${ordem.veiculo.placa}) foi finalizada. Valor: R$ ${ordem.valorTotal.toFixed(2)}`,
            link: `ordens.html?id=${ordem.id}`,
            type: 'ordemEditada'
        });
        // Resposta de sucesso
        res.status(200).json({
            message: 'Ordem finalizada com sucesso',
            ordem: resultado.ordem,
            pagamentos: resultado.pagamentos,
            comissao: comissaoCalculada > 0 ? {
                valor: comissaoCalculada,
                porcentagem: ordem.lavador?.comissao,
                lavador: ordem.lavador?.nome
            } : null
        });
    }
    catch (error) {
        console.error('Erro ao finalizar ordem de serviço:', error);
        res.status(500).json({
            error: 'Erro interno do servidor ao finalizar ordem',
            details: error.message || 'Erro desconhecido'
        });
    }
};
exports.finalizarOrdem = finalizarOrdem;
/**
 * Itera sobre as empresas para finalizar ordens do dia conforme o horário de fechamento.
 * Esta função é chamada pelo cron job a cada 15 minutos.
 */
const processarFinalizacoesAutomaticas = async () => {
    const agora = new Date();
    try {
        const empresas = await db_1.default.empresa.findMany({
            where: { finalizacaoAutomatica: true, ativo: true },
        });
        if (empresas.length === 0) {
            return; // Nenhuma empresa para processar
        }
        console.log(`[${agora.toISOString()}] Verificando ${empresas.length} empresa(s) para finalização automática.`);
        for (const empresa of empresas) {
            const horarioFechamento = empresa.horarioFechamento || '19:00';
            const [horas, minutos] = horarioFechamento.split(':').map(Number);
            const dataFechamento = new Date();
            dataFechamento.setHours(horas, minutos, 0, 0);
            // Se a hora atual for posterior à hora de fechamento da empresa, processa.
            if (agora >= dataFechamento) {
                try {
                    const horarioAbertura = empresa.horarioAbertura || '07:00';
                    const [hAbertura, mAbertura] = horarioAbertura.split(':').map(Number);
                    const inicioDoDia = new Date();
                    inicioDoDia.setHours(hAbertura, mAbertura, 0, 0);
                    const ordensParaFinalizar = await db_1.default.ordemServico.findMany({
                        where: {
                            empresaId: empresa.id,
                            status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO'] },
                        },
                    });
                    if (ordensParaFinalizar.length > 0) {
                        console.log(`[${agora.toISOString()}] Finalizando ${ordensParaFinalizar.length} ordens para a empresa: ${empresa.nome}`);
                        const transacoes = ordensParaFinalizar.map((ordem) => db_1.default.ordemServico.update({
                            where: { id: ordem.id },
                            data: {
                                status: 'FINALIZADO',
                                dataFim: new Date(),
                                pagamentos: {
                                    create: {
                                        empresaId: empresa.id,
                                        valor: ordem.valorTotal,
                                        metodo: 'PENDENTE',
                                        status: 'PENDENTE',
                                    },
                                },
                            },
                        }));
                        await db_1.default.$transaction(transacoes);
                        console.log(`[${agora.toISOString()}] Ordens da empresa ${empresa.nome} finalizadas com sucesso.`);
                        // Criar notificação para o usuário
                        const totalFinalizadas = ordensParaFinalizar.length;
                        const mensagem = totalFinalizadas === 1
                            ? '1 ordem de serviço foi finalizada automaticamente.'
                            : `${totalFinalizadas} ordens de serviço foram finalizadas automaticamente.`;
                        await (0, notificationService_1.createNotification)({
                            empresaId: empresa.id,
                            mensagem: mensagem,
                            link: 'ordens.html?status=FINALIZADO', // Link para a página de ordens filtrada
                            type: 'finalizacaoAutomatica'
                        });
                    }
                }
                catch (error) {
                    console.error(`[${agora.toISOString()}] Erro ao processar finalização para a empresa ${empresa.nome}:`, error);
                }
            }
        }
    }
    catch (error) {
        console.error(`[${agora.toISOString()}] Erro geral no processo de finalização automática:`, error);
    }
};
exports.processarFinalizacoesAutomaticas = processarFinalizacoesAutomaticas;
//# sourceMappingURL=ordemController.js.map