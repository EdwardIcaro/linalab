"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.quitarPendencia = exports.getPaymentStats = exports.deletePagamento = exports.updatePagamentoStatus = exports.getPagamentosByOrdem = exports.createPagamento = void 0;
const db_1 = __importDefault(require("../db"));
/**
 * Criar novo pagamento
 */
const createPagamento = async (req, res) => {
    try {
        const { ordemId, metodo, valor, observacoes } = req.body;
        if (!ordemId || !metodo || !valor) {
            return res.status(400).json({
                error: 'Ordem ID, método e valor são obrigatórios'
            });
        }
        // Verificar se ordem existe e pertence à empresa
        const ordem = await db_1.default.ordemServico.findFirst({
            where: {
                id: ordemId,
                empresaId: req.empresaId
            }
        });
        if (!ordem) {
            return res.status(404).json({ error: 'Ordem de serviço não encontrada' });
        }
        // Validar valor
        if (valor <= 0) {
            return res.status(400).json({ error: 'Valor deve ser maior que zero' });
        }
        // Criar pagamento
        const pagamento = await db_1.default.pagamento.create({
            data: {
                ordemId,
                empresaId: req.empresaId,
                metodo: metodo,
                valor: valor,
                observacoes,
                status: metodo === 'PENDENTE' ? 'PENDENTE' : 'PAGO',
                pagoEm: metodo === 'PENDENTE' ? null : new Date()
            },
            include: {
                ordem: {
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
                        }
                    }
                }
            }
        });
        // Verificar se a ordem está totalmente paga
        await verificarStatusPagamentoOrdem(ordemId);
        res.status(201).json(pagamento);
    }
    catch (error) {
        console.error('Erro ao criar pagamento:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.createPagamento = createPagamento;
/**
 * Listar pagamentos de uma ordem
 */
const getPagamentosByOrdem = async (req, res) => {
    try {
        const { ordemId } = req.params;
        // Verificar se ordem existe e pertence à empresa
        const ordem = await db_1.default.ordemServico.findFirst({
            where: {
                id: ordemId,
                empresaId: req.empresaId
            }
        });
        if (!ordem) {
            return res.status(404).json({ error: 'Ordem de serviço não encontrada' });
        }
        const pagamentos = await db_1.default.pagamento.findMany({
            where: {
                ordemId,
                empresaId: req.empresaId
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        res.json(pagamentos);
    }
    catch (error) {
        console.error('Erro ao listar pagamentos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.getPagamentosByOrdem = getPagamentosByOrdem;
/**
 * Atualizar status de um pagamento
 */
const updatePagamentoStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        // Verificar se pagamento existe e pertence à empresa
        const pagamento = await db_1.default.pagamento.findFirst({
            where: {
                id,
                empresaId: req.empresaId
            }
        });
        if (!pagamento) {
            return res.status(404).json({ error: 'Pagamento não encontrado' });
        }
        const updatedPagamento = await db_1.default.pagamento.update({
            where: { id },
            data: {
                status: status,
                pagoEm: status === 'PAGO' ? new Date() : null
            },
            include: {
                ordem: {
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
                        }
                    }
                }
            }
        });
        // Verificar se a ordem está totalmente paga
        await verificarStatusPagamentoOrdem(pagamento.ordemId);
        res.json(updatedPagamento);
    }
    catch (error) {
        console.error('Erro ao atualizar pagamento:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.updatePagamentoStatus = updatePagamentoStatus;
/**
 * Excluir um pagamento
 */
const deletePagamento = async (req, res) => {
    try {
        const { id } = req.params;
        // Verificar se pagamento existe e pertence à empresa
        const pagamento = await db_1.default.pagamento.findFirst({
            where: {
                id,
                empresaId: req.empresaId
            },
            include: {
                ordem: true // Inclui os dados da ordem associada
            }
        });
        if (!pagamento) {
            return res.status(404).json({ error: 'Pagamento não encontrado' });
        }
        // Não permitir deletar pagamentos de ordens não finalizadas (exceto PENDENTE)
        if (pagamento.ordem.status !== 'FINALIZADO' && pagamento.metodo !== 'PENDENTE') {
            return res.status(400).json({ error: 'Não é possível excluir pagamentos de ordens que não estão finalizadas.' });
        }
        await db_1.default.pagamento.delete({
            where: { id }
        });
        // Verificar se a ordem ainda está totalmente paga
        await verificarStatusPagamentoOrdem(pagamento.ordemId);
        res.json({ message: 'Pagamento excluído com sucesso' });
    }
    catch (error) {
        console.error('Erro ao excluir pagamento:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.deletePagamento = deletePagamento;
/**
 * Obter estatísticas de pagamento
 */
const getPaymentStats = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let dateFilter = {};
        if (startDate && endDate) {
            dateFilter = {
                createdAt: {
                    gte: new Date(startDate),
                    lte: new Date(endDate)
                }
            };
        }
        // Total de pagamentos por método
        const pagamentosPorMetodo = await db_1.default.pagamento.groupBy({
            by: ['metodo'],
            where: {
                empresaId: req.empresaId,
                status: 'PAGO',
                ...dateFilter
            },
            _sum: {
                valor: true
            },
            _count: {
                _all: true
            }
        });
        // Total de pagamentos por status
        const pagamentosPorStatus = await db_1.default.pagamento.groupBy({
            by: ['status'],
            where: {
                empresaId: req.empresaId,
                ...dateFilter
            },
            _sum: {
                valor: true
            },
            _count: {
                _all: true
            }
        });
        // Pagamentos pendentes
        const pagamentosPendentes = await db_1.default.pagamento.findMany({
            where: {
                empresaId: req.empresaId,
                status: 'PENDENTE',
                ...dateFilter
            },
            include: {
                ordem: {
                    include: {
                        cliente: {
                            select: {
                                id: true,
                                nome: true,
                                telefone: true
                            }
                        }
                    }
                }
            }
        });
        res.json({
            porMetodo: pagamentosPorMetodo,
            porStatus: pagamentosPorStatus,
            pendentes: pagamentosPendentes
        });
    }
    catch (error) {
        console.error('Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};
exports.getPaymentStats = getPaymentStats;
/**
 * Função auxiliar para verificar e atualizar o status de pagamento de uma ordem
 */
async function verificarStatusPagamentoOrdem(ordemId) {
    const ordem = await db_1.default.ordemServico.findUnique({
        where: { id: ordemId },
        include: {
            pagamentos: {
                where: {
                    status: 'PAGO'
                }
            }
        }
    });
    if (!ordem)
        return;
    const totalPago = ordem.pagamentos.reduce((sum, pgto) => sum + pgto.valor, 0);
    const estaTotalmentePaga = totalPago >= ordem.valorTotal;
    await db_1.default.ordemServico.update({
        where: { id: ordemId },
        data: {
            pago: estaTotalmentePaga
        }
    });
}
const quitarPendencia = async (req, res) => {
    const empresaId = req.empresaId;
    const { ordemId, pagamentos } = req.body;
    if (!ordemId || !pagamentos || !Array.isArray(pagamentos) || pagamentos.length === 0) {
        return res.status(400).json({ error: 'Dados insuficientes para quitar a pendência.' });
    }
    try {
        await db_1.default.$transaction(async (tx) => {
            // 1. Encontrar e deletar o pagamento pendente antigo
            const pagamentoPendente = await tx.pagamento.findFirst({
                where: {
                    ordemId,
                    empresaId,
                    metodo: 'PENDENTE',
                },
            });
            if (pagamentoPendente) {
                await tx.pagamento.delete({
                    where: { id: pagamentoPendente.id },
                });
            }
            // 2. Criar os novos registros de pagamento
            for (const p of pagamentos) {
                await tx.pagamento.create({
                    data: {
                        ordemId,
                        empresaId,
                        metodo: p.method,
                        valor: p.amount,
                        status: 'PAGO',
                        pagoEm: new Date(),
                    },
                });
            }
        });
        res.status(200).json({ message: 'Pendência quitada com sucesso.' });
    }
    catch (error) {
        console.error('Erro ao quitar pendência:', error);
        res.status(500).json({ error: 'Erro ao quitar pendência.' });
    }
};
exports.quitarPendencia = quitarPendencia;
//# sourceMappingURL=pagamentoController.js.map