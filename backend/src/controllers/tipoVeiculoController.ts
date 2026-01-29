import { Request, Response } from 'express';
import prisma from '../db';

// const prisma = new PrismaClient(); // Removido para usar a instância global

interface EmpresaRequest extends Request {
  empresaId?: string;
}

/**
 * Criar novo tipo de veículo (ex: "CARRO", "MOTO") ou subtipo (ex: "CARRO/SUV")
 */
export const createTipoVeiculo = async (req: EmpresaRequest, res: Response) => {
  try {
    const { nome, categoria, descricao } = req.body;

    if (!nome) {
      return res.status(400).json({ error: 'O nome do tipo de veículo é obrigatório.' });
    }

    const novoTipoVeiculo = await prisma.tipoVeiculo.create({
      data: {
        nome,
        categoria,
        descricao,
        empresaId: req.empresaId!,
      },
    });

    res.status(201).json(novoTipoVeiculo);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Este tipo/subtipo de veículo já existe.' });
    }
    console.error('Erro ao criar tipo de veículo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Listar todos os tipos e subtipos de veículo da empresa
 */
export const getTiposVeiculo = async (req: EmpresaRequest, res: Response) => {
  try {
    const tiposVeiculo = await prisma.tipoVeiculo.findMany({
      where: {
        empresaId: req.empresaId,
      },
      orderBy: [
        { nome: 'asc' },
        { categoria: 'asc' },
      ],
    });
    res.json(tiposVeiculo);
  } catch (error) {
    console.error('Erro ao listar tipos de veículo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Buscar um tipo de veículo por ID
 */
export const getTipoVeiculoById = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const tipoVeiculo = await prisma.tipoVeiculo.findFirst({
      where: {
        id,
        empresaId: req.empresaId,
      },
      include: {
        _count: {
          select: { servicos: true }
        }
      }
    });

    if (!tipoVeiculo) {
      return res.status(404).json({ error: 'Tipo de veículo não encontrado.' });
    }

    res.json(tipoVeiculo);
  } catch (error) {
    console.error('Erro ao buscar tipo de veículo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Atualizar um tipo de veículo
 */
export const updateTipoVeiculo = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const { nome, categoria, descricao, ativo } = req.body;

    const tipoVeiculoAtualizado = await prisma.tipoVeiculo.update({
      where: {
        id,
        empresaId: req.empresaId,
      },
      data: {
        nome,
        categoria,
        descricao,
        ativo,
      },
    });

    res.json(tipoVeiculoAtualizado);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Tipo de veículo não encontrado.' });
    }
    console.error('Erro ao atualizar tipo de veículo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Excluir um tipo de veículo
 */
export const deleteTipoVeiculo = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Verificar se há serviços associados antes de excluir
    const servicosAssociados = await prisma.servico.count({
      where: {
        tiposVeiculo: {
          some: { id }
        }
      }
    });

    if (servicosAssociados > 0) {
      return res.status(400).json({ error: 'Não é possível excluir. Existem serviços associados a este tipo de veículo.' });
    }

    await prisma.tipoVeiculo.delete({
      where: {
        id,
        empresaId: req.empresaId,
      },
    });

    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Tipo de veículo não encontrado.' });
    }
    console.error('Erro ao excluir tipo de veículo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Listar serviços associados a um tipo de veículo
 */
export const getServicosByTipoVeiculo = async (req: EmpresaRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const servicos = await prisma.servico.findMany({
      where: {
        empresaId: req.empresaId,
        tiposVeiculo: {
          some: {
            id: id,
          },
        },
      },
    });
    res.json(servicos);
  } catch (error) {
    console.error('Erro ao listar serviços por tipo de veículo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Listar todos os subtipos (categorias) de um tipo de veículo principal.
 * Ex: /api/tipos-veiculo/subtipos/Carro -> retorna ["Hatch", "Sedan", "SUV"]
 */
export const getSubtiposByTipo = async (req: EmpresaRequest, res: Response) => {
  try {
    const { categoria: nomeTipo } = req.params;

    if (Array.isArray(nomeTipo)) {
      return res.status(400).json({ error: 'Nome do tipo inválido' });
    }

    const subtipos = await prisma.tipoVeiculo.findMany({
      where: {
        empresaId: req.empresaId,
        nome: nomeTipo,
        categoria: {
          not: null, // Garante que estamos pegando apenas subtipos
        },
      },
      distinct: ['categoria'],
      select: {
        categoria: true,
      },
    });

    res.json(subtipos.map((s: { categoria: string | null }) => s.categoria));
  } catch (error) {
    console.error(`Erro ao listar subtipos para ${req.params.categoria}:`, error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};