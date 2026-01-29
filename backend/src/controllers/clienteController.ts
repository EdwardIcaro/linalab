import { Request, Response } from 'express';
import prisma from '../db';


interface EmpresaRequest extends Request {
  empresaId?: string;
  empresa?: any;
}

/**
 * Criar novo cliente
 */
export const createCliente = async (req: EmpresaRequest, res: Response) => {
  try {
    const { nome, telefone, email } = req.body;

    if (!nome) {
      return res.status(400).json({ 
        error: 'Nome do cliente é obrigatório' 
      });
    }

    // Verificar se cliente já existe na mesma empresa
    const existingCliente = await prisma.cliente.findFirst({
      where: {
        empresaId: req.empresaId,
        OR: [
          ...(email ? [{ email: email }] : []),
          ...(telefone ? [{ telefone }] : [])
        ]
      }
    });

    if (existingCliente) {
      return res.status(400).json({ 
        error: 'Cliente com este email ou telefone já existe' 
      });
    }

    const cliente = await prisma.cliente.create({
      data: {
        empresaId: req.empresaId!,
        nome,
        telefone: telefone || null,
        email: email || null, // Garante que email vazio seja salvo como null
      },
      include: {
        veiculos: true,
        _count: {
          select: {
            ordens: true,
            veiculos: true
          }
        }
      }
    });

    res.status(201).json({
      message: 'Cliente criado com sucesso',
      cliente
    });
  } catch (error) {
    console.error('Erro ao criar cliente:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Listar clientes da empresa
 */
export const getClientes = async (req: EmpresaRequest, res: Response) => {
  try {
    const { page = 1, limit = 100, search } = req.query; // Define valores padrão
    const skip = (Number(page) - 1) * Number(limit);

    // Construir filtro de busca
    const where: any = {
      empresaId: req.empresaId
    };

    if (search) {
      where.OR = [
        { nome: { contains: search as string } },
        { telefone: { contains: search as string } },
        { email: { contains: search as string } }
      ];
    }

    const [clientes, total] = await Promise.all([
      prisma.cliente.findMany({
        where,
        include: {
          veiculos: {
            select: {
              id: true,
              placa: true,
              modelo: true,
              cor: true
            }
          },
          ordens: {
            include: {
              lavador: {
                select: {
                  id: true,
                  nome: true
                }
              },
              items: {
                include: {
                  servico: {
                    select: {
                      id: true,
                      nome: true,
                    }
                  },
                  adicional: {
                    select: {
                      id: true,
                      nome: true,
                    }
                  }
                }
              }
            },
            orderBy: {
              createdAt: 'desc'
            }
          },
          _count: {
            select: {
              ordens: true,
              veiculos: true
            }
          }
        },
        orderBy: {
          nome: 'asc'
        },
        skip,
        take: Number(limit)
      }),
      prisma.cliente.count({ where })
    ]);

    res.json({
      clientes,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Erro ao listar clientes:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Buscar cliente por ID
 */
export const getClienteById = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const cliente = await prisma.cliente.findFirst({
      where: {
        id,
        empresaId: req.empresaId
      },
      include: {
        veiculos: {
          orderBy: { createdAt: 'desc' },
          include: { // Inclui a última ordem finalizada para inferir o tipo/subtipo
            ordens: {
              where: { status: 'FINALIZADO' },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: {
                items: {
                  take: 1, // Pega apenas o primeiro item para simplificar
                  include: { servico: { include: { tiposVeiculo: true } } }
                }
              }
            }
          }
        },
        ordens: {
          include: {
            veiculo: {
              select: {
                placa: true,
                modelo: true
              }
            },
            lavador: {
              select: {
                nome: true
              }
            },
            items: {
              include: {
                servico: { select: { nome: true } },
                adicional: { select: { nome: true } }
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 10 // Últimas 10 ordens
        },
        _count: {
          select: {
            ordens: true,
            veiculos: true
          }
        }
      }
    });

    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    res.json(cliente);
  } catch (error) {
    console.error('Erro ao buscar cliente:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Atualizar cliente
 */
export const updateCliente = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { nome, telefone, email, ativo } = req.body;

    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Verificar se cliente existe e pertence à empresa
    const existingCliente = await prisma.cliente.findFirst({
      where: {
        id,
        empresaId: req.empresaId
      }
    });

    if (!existingCliente) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    // Verificar duplicidade de email/telefone
    if (email || telefone) {
      const duplicateCliente = await prisma.cliente.findFirst({
        where: {
          AND: [
            { empresaId: req.empresaId },
            { id: { not: id } },
            {
              OR: [
                ...(email ? [{ email: email }] : []),
                ...(telefone ? [{ telefone }] : [])
              ]
            }
          ]
        }
      });

      if (duplicateCliente) {
        return res.status(400).json({ 
          error: 'Já existe um cliente com este email ou telefone' 
        });
      }
    }

    const cliente = await prisma.cliente.update({
      where: { id },
      data: {
        ...(nome && { nome }),
        ...(telefone !== undefined && { telefone: telefone || null }),
        ...(email !== undefined && { email: email || null }), // Garante que email vazio seja salvo como null
        ...(ativo !== undefined && { ativo })
      },
      include: {
        veiculos: true,
        _count: {
          select: {
            ordens: true,
            veiculos: true
          }
        }
      }
    });

    res.json({
      message: 'Cliente atualizado com sucesso',
      cliente
    });
  } catch (error) {
    console.error('Erro ao atualizar cliente:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Excluir cliente
 */
export const deleteCliente = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Verificar se cliente existe e pertence à empresa
    const cliente = await prisma.cliente.findFirst({
      where: {
        id,
        empresaId: req.empresaId
      },
      select: {
        id: true,
        _count: {
          select: {
            ordens: true,
            veiculos: true
          }
        }
      }
    });

    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    // Não permitir excluir cliente com ordens ou veículos
    if (cliente._count.ordens > 0 || cliente._count.veiculos > 0) {
      return res.status(400).json({
        error: 'Não é possível excluir cliente com ordens de serviço ou veículos cadastrados'
      });
    }

    await prisma.cliente.delete({
      where: { id }
    });

    res.json({
      message: 'Cliente excluído com sucesso'
    });
  } catch (error) {
    console.error('Erro ao excluir cliente:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Buscar cliente por placa do veículo
 */
export const getClienteByPlaca = async (req: EmpresaRequest, res: Response) => {
  try {
    const { placa } = req.params;
    if (Array.isArray(placa)) {
      return res.status(400).json({ error: 'Placa inválida' });
    }

    const veiculo = await prisma.veiculo.findFirst({
      where: {
        placa,
        cliente: {
          empresaId: req.empresaId
        }
      },
      include: {
        cliente: true
      }
    });

    if (!veiculo || !veiculo.cliente) {
      return res.status(404).json({ error: 'Veículo não encontrado' });
    }

    res.json({
      cliente: veiculo.cliente,
      veiculo
    });
  } catch (error) {
    console.error('Erro ao buscar cliente por placa:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};
