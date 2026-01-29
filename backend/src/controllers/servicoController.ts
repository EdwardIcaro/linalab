import { Request, Response } from 'express';
import { TipoVeiculo } from '@prisma/client';
import prisma from '../db';


interface EmpresaRequest extends Request {
  empresaId?: string;
  empresa?: any;
}


/**
 * Criar novo serviço
 */
export const createServico = async (req: EmpresaRequest, res: Response) => {
  try {
    const { nome, descricao, duracao, preco, tipoVeiculo: tipoVeiculoNome, subtiposVeiculo } = req.body;

    if (!nome || preco === undefined || !tipoVeiculoNome) {
      return res.status(400).json({ 
        error: 'Nome, preço e tipo de veículo são obrigatórios' 
      });
    }

    const tiposVeiculoParaConectar: { id: string }[] = [];

    if (tipoVeiculoNome === 'CARRO') {
      // Se subtipos foram selecionados, busca os IDs deles
      if (subtiposVeiculo && subtiposVeiculo.length > 0) {
        const tipos = await prisma.tipoVeiculo.findMany({
          where: { nome: 'CARRO', categoria: { in: subtiposVeiculo }, empresaId: req.empresaId! }
        });
        tipos.forEach((t: TipoVeiculo) => tiposVeiculoParaConectar.push({ id: t.id }));
      } else { // Se nenhum subtipo foi selecionado, associa ao tipo "CARRO" geral
        const tipoGeral = await prisma.tipoVeiculo.findFirst({ where: { nome: 'CARRO', categoria: null, empresaId: req.empresaId! } });
        if (tipoGeral) tiposVeiculoParaConectar.push({ id: tipoGeral.id });
      }
    } else { // Para MOTO ou outros tipos
      const tipo = await prisma.tipoVeiculo.findFirst({ where: { nome: tipoVeiculoNome, categoria: null, empresaId: req.empresaId! } });
      if (tipo) tiposVeiculoParaConectar.push({ id: tipo.id });
    }

    if (tiposVeiculoParaConectar.length === 0) {
      return res.status(400).json({ error: 'Nenhum tipo de veículo correspondente encontrado para associar ao serviço.' });
    }

    const novoServico = await prisma.servico.create({
      data: {
        nome, descricao, duracao, preco: parseFloat(preco), empresaId: req.empresaId!,
        tiposVeiculo: { connect: tiposVeiculoParaConectar }
      },
    });

    res.status(201).json({
      message: 'Serviço criado com sucesso',
      servico: novoServico
    });
  } catch (error) {
    console.error('Erro ao criar serviço:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};
/**
 * Criar novo serviço adicional
 */
export const createAdicional = async (req: EmpresaRequest, res: Response) => {
  try {
    const { nome, descricao, preco } = req.body;

    if (!nome || preco === undefined) {
      return res.status(400).json({ 
        error: 'Nome e preço são obrigatórios' 
      });
    }

    const novoAdicional = await prisma.adicional.create({
      data: {
        nome,
        descricao,
        preco: parseFloat(preco),
        empresaId: req.empresaId!
      }
    });

    res.status(201).json({
      message: 'Serviço adicional criado com sucesso',
      adicional: novoAdicional
    });
  } catch (error) {
    console.error('Erro ao criar serviço adicional:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Listar serviços da empresa (com paginação)
 */
export const getServicos = async (req: EmpresaRequest, res: Response) => {
  try {
    const { page = 1, limit = 10, search, ativo, tipoVeiculo: tipoVeiculoNome, subtipoVeiculo: subtipoVeiculoNome } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {
      empresaId: req.empresaId
    };

    if (search) { 
      where.nome = { contains: search as string };
    }

    if (ativo !== undefined) {
      where.ativo = ativo === 'true';
    }

    if (tipoVeiculoNome) {
      const subtipo = subtipoVeiculoNome as string;

      // Se um subtipo for especificado (ex: HATCH), a lógica é:
      // Encontrar serviços onde o tipo de veículo associado é
      // (nome='CARRO' E categoria='HATCH') OU (nome='CARRO' E categoria=null)
      if (subtipo) {
        where.OR = [
          {
            tiposVeiculo: {
              some: {
                nome: tipoVeiculoNome as string,
                categoria: subtipo,
              },
            },
          },
          {
            tiposVeiculo: {
              some: {
                nome: tipoVeiculoNome as string,
                categoria: null,
              },
            },
          },
        ];
      } else {
        // Se NENHUM subtipo for especificado, a lógica é:
        // Encontrar serviços onde o tipo de veículo associado é
        // (nome='CARRO' E categoria=null)
        where.tiposVeiculo = {
          some: {
            nome: tipoVeiculoNome as string,
            categoria: null,
          },
        };
      }
    }

    const [servicos, total] = await Promise.all([
      prisma.servico.findMany({
        where,
        include: {
          // Inclui os tipos de veículo associados para exibição
          tiposVeiculo: { select: { nome: true, categoria: true } },
          _count: {
            select: {
              ordemItems: true
            }
          }
        },
        orderBy: {
          nome: 'asc'
        },
        skip,
        take: Number(limit)
      }),
      prisma.servico.count({ where })
    ]);

    res.json({
      servicos,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Erro ao listar serviços:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Listar serviços da empresa (formato simples para frontend)
 */
export const getServicosSimple = async (req: EmpresaRequest, res: Response) => {
  try {
    const { ativo } = req.query;

    const where: any = {
      empresaId: req.empresaId
    };

    if (ativo !== undefined) {
      where.ativo = ativo === 'true';
    }

    const servicos = await prisma.servico.findMany({
      where,
      orderBy: {
        nome: 'asc'
      }
    });

    res.json({ servicos });
  } catch (error) {
    console.error('Erro ao listar serviços:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Listar serviços adicionais da empresa (formato simples para frontend)
 */
export const getAdicionaisSimple = async (req: EmpresaRequest, res: Response) => {
  try {
    const { ativo } = req.query;

    const where: any = {
      empresaId: req.empresaId
    };

    if (ativo !== undefined) {
      where.ativo = ativo === 'true';
    }

    const adicionais = await prisma.adicional.findMany({
      where,
      orderBy: {
        nome: 'asc'
      }
    });

    res.json({ adicionais });
  } catch (error) {
    console.error('Erro ao listar serviços adicionais (simples):', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};
/**
 * Listar serviços adicionais da empresa
 */
export const getAdicionais = async (req: EmpresaRequest, res: Response) => {
  try {
    const { page = 1, limit = 10, search, ativo } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {
      empresaId: req.empresaId
    };

    if (search) {
      where.nome = { contains: search as string };
    }

    if (ativo !== undefined) {
      where.ativo = ativo === 'true';
    }

    const [adicionais, total] = await Promise.all([
      prisma.adicional.findMany({
        where,
        include: {
          _count: {
            select: {
              ordemItems: true
            }
          }
        },
        orderBy: {
          nome: 'asc'
        },
        skip,
        take: Number(limit)
      }),
      prisma.adicional.count({ where })
    ]);

    res.json({
      adicionais,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Erro ao listar serviços adicionais:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Buscar serviço por ID
 */
export const getServicoById = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const servico = await prisma.servico.findFirst({
      where: {
        id,
        empresaId: req.empresaId
      },
      include: {
        ordemItems: {
          include: {
            ordem: {
              select: {
                id: true,
                status: true,
                createdAt: true,
                cliente: {
                  select: {
                    nome: true
                  }
                }
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 10
        },
        _count: {
          select: {
            ordemItems: true
          }
        }
      }
    });

    if (!servico) {
      return res.status(404).json({ error: 'Serviço não encontrado' });
    }

    res.json(servico);
  } catch (error) {
    console.error('Erro ao buscar serviço:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Buscar serviço adicional por ID
 */
export const getAdicionalById = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const adicional = await prisma.adicional.findFirst({
      where: {
        id,
        empresaId: req.empresaId
      },
      include: {
        ordemItems: {
          include: {
            ordem: {
              select: {
                id: true,
                status: true,
                createdAt: true,
                cliente: {
                  select: {
                    nome: true
                  }
                }
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 10
        },
        _count: {
          select: {
            ordemItems: true
          }
        }
      }
    });

    if (!adicional) {
      return res.status(404).json({ error: 'Serviço adicional não encontrado' });
    }

    res.json(adicional);
  } catch (error) {
    console.error('Erro ao buscar serviço adicional:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Atualizar serviço
 */
export const updateServico = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { nome, descricao, duracao, ativo, preco, tipoVeiculo: tipoVeiculoNome, subtiposVeiculo } = req.body;

    // 1. Coleta os IDs dos novos tipos/subtipos para conectar
    const tiposVeiculoParaConectar: { id: string }[] = [];
    if (tipoVeiculoNome === 'CARRO') {
      if (subtiposVeiculo && subtiposVeiculo.length > 0) {
        const tipos = await prisma.tipoVeiculo.findMany({
          where: { nome: 'CARRO', categoria: { in: subtiposVeiculo }, empresaId: req.empresaId! }
        });
        tipos.forEach((t: TipoVeiculo) => tiposVeiculoParaConectar.push({ id: t.id }));
      } else {
        const tipoGeral = await prisma.tipoVeiculo.findFirst({ where: { nome: 'CARRO', categoria: null, empresaId: req.empresaId! } });
        if (tipoGeral) tiposVeiculoParaConectar.push({ id: tipoGeral.id });
      }
    } else { // Para MOTO ou outros tipos
      const tipo = await prisma.tipoVeiculo.findFirst({ where: { nome: tipoVeiculoNome, categoria: null, empresaId: req.empresaId! } });
      if (tipo) tiposVeiculoParaConectar.push({ id: tipo.id });
    }

    if (tiposVeiculoParaConectar.length === 0) {
      return res.status(400).json({ error: 'Nenhum tipo de veículo correspondente encontrado para associar ao serviço.' });
    }

    // 2. Atualiza o serviço e suas relações
    const servicoAtualizado = await prisma.servico.update({
      where: {
        id,
        empresaId: req.empresaId
      },
      data: {
        nome,
        descricao,
        duracao,
        ativo,
        preco: preco !== undefined ? parseFloat(preco) : undefined,
        // Desconecta todos os antigos e conecta os novos
        tiposVeiculo: { set: tiposVeiculoParaConectar }
      }
    });

    res.json({
      message: 'Serviço atualizado com sucesso',
      servico: servicoAtualizado
    });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Serviço não encontrado.' });
    }
    console.error('Erro ao atualizar serviço:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Atualizar serviço adicional
 */
export const updateAdicional = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { nome, descricao, ativo, preco } = req.body;

    const adicional = await prisma.adicional.updateMany({
      where: {
        id,
        empresaId: req.empresaId
      },
      data: {
        ...(nome && { nome }),
        ...(descricao !== undefined && { descricao }),
        ...(ativo !== undefined && { ativo }),
        ...(preco !== undefined && { preco: parseFloat(preco) })
      }
    });

    if (adicional.count === 0) {
      return res.status(404).json({ error: 'Serviço adicional não encontrado ou não pertence à empresa' });
    }

    const adicionalAtualizado = await prisma.adicional.findUnique({ where: { id } });

    res.json({
      message: 'Serviço adicional atualizado com sucesso',
      adicional: adicionalAtualizado
    });
  } catch (error) {
    console.error('Erro ao atualizar serviço adicional:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Excluir serviço
 */
export const deleteServico = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Verificar se serviço existe e pertence à empresa
    const servico = await prisma.servico.findFirst({
      where: {
        id,
        empresaId: req.empresaId
      },
      include: {
        _count: {
          select: {
            ordemItems: true
          }
        }
      }
    });

    if (!servico) {
      return res.status(404).json({ error: 'Serviço não encontrado' });
    }

    // Não permitir excluir serviço com itens de ordem
    if (servico._count.ordemItems > 0) {
      return res.status(400).json({ 
        error: 'Não é possível excluir serviço que já foi utilizado em ordens de serviço' 
      });
    }

    await prisma.servico.delete({
      where: { id }
    });

    res.json({
      message: 'Serviço excluído com sucesso'
    });
  } catch (error) {
    console.error('Erro ao excluir serviço:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Excluir serviço adicional
 */
export const deleteAdicional = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Verificar se serviço adicional existe e pertence à empresa
    const adicional = await prisma.adicional.findFirst({
      where: {
        id,
        empresaId: req.empresaId
      },
      include: {
        _count: {
          select: {
            ordemItems: true
          }
        }
      }
    });

    if (!adicional) {
      return res.status(404).json({ error: 'Serviço adicional não encontrado' });
    }

    // Não permitir excluir serviço adicional com itens de ordem
    if (adicional._count.ordemItems > 0) {
      return res.status(400).json({ 
        error: 'Não é possível excluir serviço adicional que já foi utilizado em ordens de serviço' 
      });
    }

    await prisma.adicional.delete({
      where: { id }
    });

    res.json({
      message: 'Serviço adicional excluído com sucesso'
    });
  } catch (error) {
    console.error('Erro ao excluir serviço adicional:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};