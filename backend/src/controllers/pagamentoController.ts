import { Request, Response } from 'express';
import prisma from '../db';
import { Prisma, Pagamento } from '@prisma/client';

interface EmpresaRequest extends Request {
  empresaId?: string;
}

interface PagamentoInput {
  method: string;
  amount: number;
}

/**
 * Criar novo pagamento
 */
export const createPagamento = async (req: EmpresaRequest, res: Response) => {
  try {
    const { ordemId, metodo, valor, observacoes } = req.body;

    if (!ordemId || !metodo || !valor) {
      return res.status(400).json({
        error: 'Ordem ID, método e valor são obrigatórios'
      });
    }

    // Verificar se ordem existe e pertence à empresa
    const ordem = await prisma.ordemServico.findFirst({
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
    const pagamento = await prisma.pagamento.create({
      data: {
        ordemId,
        empresaId: req.empresaId!,
        metodo: metodo as any,
        valor: valor,
        observacoes,
        status: metodo === 'PENDENTE' ? 'PENDENTE' as any : 'PAGO' as any,
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
  } catch (error) {
    console.error('Erro ao criar pagamento:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Listar pagamentos de uma ordem
 */
export const getPagamentosByOrdem = async (req: EmpresaRequest, res: Response) => {
  try {
    const { ordemId } = req.params;

    if (Array.isArray(ordemId)) {
      return res.status(400).json({ error: 'ID da ordem inválido' });
    }

    // Verificar se ordem existe e pertence à empresa
    const ordem = await prisma.ordemServico.findFirst({
      where: {
        id: ordemId,
        empresaId: req.empresaId
      }
    });

    if (!ordem) {
      return res.status(404).json({ error: 'Ordem de serviço não encontrada' });
    }

    const pagamentos = await prisma.pagamento.findMany({
      where: {
        ordemId,
        empresaId: req.empresaId
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json(pagamentos);
  } catch (error) {
    console.error('Erro ao listar pagamentos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Atualizar status de um pagamento
 */
export const updatePagamentoStatus = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { status } = req.body;

    // Verificar se pagamento existe e pertence à empresa
    const pagamento = await prisma.pagamento.findFirst({
      where: {
        id,
        empresaId: req.empresaId
      }
    });

    if (!pagamento) {
      return res.status(404).json({ error: 'Pagamento não encontrado' });
    }

    const updatedPagamento = await prisma.pagamento.update({
      where: { id },
      data: {
        status: status as any,
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
  } catch (error) {
    console.error('Erro ao atualizar pagamento:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Excluir um pagamento
 */
export const deletePagamento = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Verificar se pagamento existe e pertence à empresa
    const pagamento = await prisma.pagamento.findFirst({
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
    if (pagamento.ordem.status !== 'FINALIZADO' && pagamento.metodo !== 'PENDENTE' as any) {
      return res.status(400).json({ error: 'Não é possível excluir pagamentos de ordens que não estão finalizadas.' });
    }

    await prisma.pagamento.delete({
      where: { id }
    });

    // Verificar se a ordem ainda está totalmente paga
    await verificarStatusPagamentoOrdem(pagamento.ordemId);

    res.json({ message: 'Pagamento excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir pagamento:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Obter estatísticas de pagamento
 */
export const getPaymentStats = async (req: EmpresaRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    let dateFilter: Prisma.DateTimeFilter | {} = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          gte: new Date(startDate as string),
          lte: new Date(endDate as string)
        }
      };
    }

    // Total de pagamentos por método
    const pagamentosPorMetodo = await prisma.pagamento.groupBy({
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
    const pagamentosPorStatus = await prisma.pagamento.groupBy({
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
    const pagamentosPendentes = await prisma.pagamento.findMany({
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
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Função auxiliar para verificar e atualizar o status de pagamento de uma ordem
 */
async function verificarStatusPagamentoOrdem(ordemId: string) {
  const ordem = await prisma.ordemServico.findUnique({
    where: { id: ordemId },
    include: {
      pagamentos: {
        where: {
          status: 'PAGO'
        }
      }
    }
  });

  if (!ordem) return;

  const totalPago = ordem.pagamentos.reduce((sum: number, pgto: Pagamento) => sum + pgto.valor, 0);
  const estaTotalmentePaga = totalPago >= ordem.valorTotal;

  await prisma.ordemServico.update({
    where: { id: ordemId },
    data: {
      pago: estaTotalmentePaga
    }
  });
}

/**
 * Quitar Pendência - Versão Simples (Nova - Frontend atual)
 * Aceita: ordemId, pagamentoId, metodo
 * Usado por: historico.html, financeiro.html
 */
export const quitarPendenciaSimples = async (req: EmpresaRequest, res: Response) => {
  const empresaId = req.empresaId!;
  const { ordemId, pagamentoId, metodo } = req.body as {
    ordemId: string;
    pagamentoId: string;
    metodo: string;
  };

  // ✅ Validação melhorada
  if (!ordemId || !pagamentoId || !metodo) {
    return res.status(400).json({
      error: 'Dados insuficientes para quitar a pendência.',
      details: `Faltam: ${!ordemId ? 'ordemId' : ''} ${!pagamentoId ? 'pagamentoId' : ''} ${!metodo ? 'metodo' : ''}`
    });
  }

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Verificar se o pagamento pendente existe
      const pagamentoPendente = await tx.pagamento.findFirst({
        where: {
          id: pagamentoId,
          ordemId,
          empresaId,
          metodo: 'PENDENTE' as any
        }
      });

      if (!pagamentoPendente) {
        throw new Error('Pagamento pendente não encontrado');
      }

      // 2. Obter valor do pagamento para criar novo registro
      const valor = pagamentoPendente.valor;

      // 3. Deletar o pagamento pendente antigo
      await tx.pagamento.delete({
        where: { id: pagamentoId }
      });

      // 4. Criar novo registro com método fornecido
      await tx.pagamento.create({
        data: {
          ordemId,
          empresaId,
          metodo: metodo as any,
          valor: valor,
          status: 'PAGO',
          pagoEm: new Date()
        }
      });
    });

    res.status(200).json({
      message: 'Pendência quitada com sucesso.',
      metodo: metodo
    });
  } catch (error) {
    console.error('Erro ao quitar pendência:', error);
    const errorMsg = error instanceof Error ? error.message : 'Erro ao quitar pendência.';
    res.status(500).json({
      error: errorMsg,
      details: errorMsg
    });
  }
};

/**
 * Quitar Pendência - Versão com Array (Legacy)
 * Aceita: ordemId, pagamentos (array com method e amount)
 * Mantida para compatibilidade
 */
export const quitarPendencia = async (req: EmpresaRequest, res: Response) => {
  const empresaId = req.empresaId!;
  const { ordemId, pagamentos } = req.body as { ordemId: string; pagamentos: PagamentoInput[] };

  if (!ordemId || !pagamentos || !Array.isArray(pagamentos) || pagamentos.length === 0) {
    return res.status(400).json({ error: 'Dados insuficientes para quitar a pendência.' });
  }

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Encontrar e deletar o pagamento pendente antigo
      const pagamentoPendente = await tx.pagamento.findFirst({
        where: {
          ordemId,
          empresaId,
          metodo: 'PENDENTE' as any,
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
            metodo: p.method as any,
            valor: p.amount,
            status: 'PAGO',
            pagoEm: new Date(),
          },
        });
      }
    });
    res.status(200).json({ message: 'Pendência quitada com sucesso.' });
  } catch (error) {
    console.error('Erro ao quitar pendência:', error);
    res.status(500).json({ error: 'Erro ao quitar pendência.' });
  }
};
