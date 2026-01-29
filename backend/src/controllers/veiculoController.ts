import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface EmpresaRequest extends Request {
  empresaId?: string;
  empresa?: any;
}

/**
 * Criar novo veículo
 */
export const createVeiculo = async (req: EmpresaRequest, res: Response) => {
  try {
    const { clienteId, placa, modelo, cor, ano } = req.body;

    if (!clienteId || !placa) {
      return res.status(400).json({ 
        error: 'Cliente ID e placa são obrigatórios' 
      });
    }

    // Verificar se cliente existe e pertence à empresa
    const cliente = await prisma.cliente.findFirst({
      where: {
        id: clienteId,
        empresaId: req.empresaId
      }
    });

    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    // Verificar se placa já existe
    const existingVeiculo = await prisma.veiculo.findUnique({
      where: { placa: placa.toUpperCase() }
    });

    if (existingVeiculo) {
      return res.status(400).json({ 
        error: 'Veículo com esta placa já existe' 
      });
    }

    const veiculo = await prisma.veiculo.create({
      data: {
        clienteId,
        placa: placa.trim().toUpperCase(),
        modelo,
        cor,
        ano
      },
      include: {
        cliente: {
          select: {
            id: true,
            nome: true,
            telefone: true
          }
        }
      }
    });

    res.status(201).json({
      message: 'Veículo criado com sucesso',
      veiculo
    });
  } catch (error) {
    console.error('Erro ao criar veículo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Listar veículos da empresa
 */
export const getVeiculos = async (req: EmpresaRequest, res: Response) => {
  try {
    const { page = 1, limit = 10, search, clienteId } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {
      cliente: {
        empresaId: req.empresaId
      }
    };

    if (search) {
      where.OR = [
        { placa: { contains: search as string } },
        { modelo: { contains: search as string } },
        { cor: { contains: search as string } }
      ];
    }

    if (clienteId) {
      where.clienteId = clienteId as string;
    }

    const [veiculos, total] = await Promise.all([
      prisma.veiculo.findMany({
        where,
        include: {
          cliente: {
            select: {
              id: true,
              nome: true,
              telefone: true
            }
          },
          _count: {
            select: {
              ordens: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: Number(limit)
      }),
      prisma.veiculo.count({ where })
    ]);

    res.json({
      veiculos,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Erro ao listar veículos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Buscar veículo por ID
 */
export const getVeiculoById = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const veiculo = await prisma.veiculo.findFirst({
      where: {
        id,
        cliente: {
          empresaId: req.empresaId
        }
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
        ordens: {
          include: {
            lavador: {
              select: {
                nome: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 5
        },
        _count: {
          select: {
            ordens: true
          }
        }
      }
    });

    if (!veiculo) {
      return res.status(404).json({ error: 'Veículo não encontrado' });
    }

    res.json(veiculo);
  } catch (error) {
    console.error('Erro ao buscar veículo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Buscar veículo por Placa
 */
export const getVeiculoByPlaca = async (req: EmpresaRequest, res: Response) => {
  try {
    const { placa } = req.params;
    if (Array.isArray(placa)) {
      return res.status(400).json({ error: 'Placa inválida' });
    }

    if (!placa || Array.isArray(placa)) {
      return res.status(400).json({ error: 'Placa é obrigatória' });
    }

    const veiculo = await prisma.veiculo.findFirst({
      where: {
        placa: placa.toUpperCase(),
        cliente: {
          empresaId: req.empresaId
        }
      },
      include: {
        cliente: true
      }
    });

    if (!veiculo) {
      return res.status(404).json({ error: 'Veículo não encontrado' });
    }

    res.json(veiculo);
  } catch (error) {
    console.error('Erro ao buscar veículo por placa:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Atualizar veículo
 */
export const updateVeiculo = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { clienteId, placa, modelo, cor, ano } = req.body;

    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Verificar se veículo existe e pertence à empresa
    const existingVeiculo = await prisma.veiculo.findFirst({
      where: {
        id,
        cliente: {
          empresaId: req.empresaId
        }
      }
    });

    if (!existingVeiculo) {
      return res.status(404).json({ error: 'Veículo não encontrado' });
    }

    // Se clienteId foi fornecido, verificar se cliente existe
    if (clienteId) {
      const cliente = await prisma.cliente.findFirst({
        where: {
          id: clienteId,
          empresaId: req.empresaId
        }
      });

      if (!cliente) {
        return res.status(404).json({ error: 'Cliente não encontrado' });
      }
    }

    // Se placa foi alterada, verificar se já existe
    if (placa && placa !== existingVeiculo.placa) {
      const duplicateVeiculo = await prisma.veiculo.findUnique({
        where: { placa: placa.toUpperCase() }
      });

      if (duplicateVeiculo) {
        return res.status(400).json({ 
          error: 'Veículo com esta placa já existe' 
        });
      }
    }

    const veiculo = await prisma.veiculo.update({
      where: { id },
      data: {
        ...(clienteId && { clienteId }),
        ...(placa && { placa: placa.trim().toUpperCase() }),
        ...(modelo !== undefined && { modelo }),
        ...(cor !== undefined && { cor }),
        ...(ano !== undefined && { ano })
      },
      include: {
        cliente: {
          select: {
            id: true,
            nome: true,
            telefone: true
          }
        }
      }
    });

    res.json({
      message: 'Veículo atualizado com sucesso',
      veiculo
    });
  } catch (error) {
    console.error('Erro ao atualizar veículo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Excluir veículo
 */
export const deleteVeiculo = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Verificar se veículo existe e pertence à empresa
    const veiculo = await prisma.veiculo.findFirst({
      where: {
        id,
        cliente: {
          empresaId: req.empresaId
        }
      },
      select: {
        id: true,
        _count: {
          select: {
            ordens: true
          }
        }
      }
    });

    if (!veiculo) {
      return res.status(404).json({ error: 'Veículo não encontrado' });
    }

    // Não permitir excluir veículo com ordens de serviço
    if (veiculo._count.ordens > 0) {
      return res.status(400).json({
        error: 'Não é possível excluir veículo com ordens de serviço'
      });
    }

    await prisma.veiculo.delete({
      where: { id }
    });

    res.json({
      message: 'Veículo excluído com sucesso'
    });
  } catch (error) {
    console.error('Erro ao excluir veículo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};