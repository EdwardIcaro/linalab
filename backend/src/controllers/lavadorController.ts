import { Request, Response } from 'express';
import prisma from '../db';
import jwt from 'jsonwebtoken';

interface EmpresaRequest extends Request {
  empresaId?: string;
}

export const createLavador = async (req: EmpresaRequest, res: Response) => {
  const { nome, comissao } = req.body;
  const empresaId = req.empresaId;

  if (!nome || comissao === undefined) {
    return res.status(400).json({ error: 'Nome e comissão são obrigatórios.' });
  }

  try {
    const lavador = await prisma.lavador.create({
      data: { nome, comissao, empresaId: empresaId! },
    });
    res.status(201).json(lavador);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar lavador.' });
  }
};

export const getLavadores = async (req: EmpresaRequest, res: Response) => {
  try {
    const lavadores = await prisma.lavador.findMany({
      where: { empresaId: req.empresaId },
      include: {
        _count: {
          select: { ordens: true }
        }
      },
      orderBy: { nome: 'asc' },
    });
    res.json({ lavadores });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar lavadores.' });
  }
};

export const getLavadoresSimple = async (req: EmpresaRequest, res: Response) => {
  try {
    const lavadores = await prisma.lavador.findMany({
      where: { 
        empresaId: req.empresaId,
        ativo: true 
      },
      select: {
        id: true,
        nome: true,
      },
      orderBy: { nome: 'asc' },
    });
    res.json({ lavadores });
  } catch (error) {
    console.error('Erro ao buscar lavadores (simples):', error);
    res.status(500).json({ error: 'Erro ao buscar lavadores.' });
  }
};

/**
 * Listar tokens de acesso dos lavadores da empresa
 */
export const getLavadorTokens = async (req: EmpresaRequest, res: Response) => {
  try {
    const tokens = await prisma.lavadorToken.findMany({
      where: {
        lavador: {
          empresaId: req.empresaId
        }
      },
      include: {
        lavador: {
          select: {
            id: true,
            nome: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({ tokens });
  } catch (error) {
    console.error('Erro ao listar tokens dos lavadores:', error);
    res.status(500).json({ error: 'Erro ao listar tokens dos lavadores.' });
  }
};

/**
 * Atualizar status de um token
 */
export const updateLavadorTokenStatus = async (req: EmpresaRequest, res: Response) => {
  const { id } = req.params;
  const { ativo } = req.body;

  if (typeof ativo !== 'boolean') {
    return res.status(400).json({ error: 'Campo \"ativo\" deve ser booleano.' });
  }

  try {
    const updated = await prisma.lavadorToken.updateMany({
      where: {
        id,
        lavador: {
          empresaId: req.empresaId
        }
      },
      data: { ativo }
    });

    if (updated.count === 0) {
      return res.status(404).json({ error: 'Token nÃ£o encontrado para esta empresa.' });
    }

    res.json({ message: 'Status do token atualizado com sucesso' });
  } catch (error) {
    console.error('Erro ao atualizar status do token:', error);
    res.status(500).json({ error: 'Erro ao atualizar status do token.' });
  }
};

/**
 * Alternar status do token (ativo/inativo)
 */
export const toggleLavadorToken = async (req: EmpresaRequest, res: Response) => {
  const { id } = req.params;

  try {
    const token = await prisma.lavadorToken.findFirst({
      where: {
        id,
        lavador: {
          empresaId: req.empresaId
        }
      }
    });

    if (!token) {
      return res.status(404).json({ error: 'Token nÃ£o encontrado para esta empresa.' });
    }

    await prisma.lavadorToken.update({
      where: { id },
      data: { ativo: !token.ativo }
    });

    res.json({ message: 'Status do token atualizado com sucesso' });
  } catch (error) {
    console.error('Erro ao alternar status do token:', error);
    res.status(500).json({ error: 'Erro ao alternar status do token.' });
  }
};

/**
 * Excluir token de acesso
 */
export const deleteLavadorToken = async (req: EmpresaRequest, res: Response) => {
  const { id } = req.params;

  try {
    const deleted = await prisma.lavadorToken.deleteMany({
      where: {
        id,
        lavador: {
          empresaId: req.empresaId
        }
      }
    });

    if (deleted.count === 0) {
      return res.status(404).json({ error: 'Token nÃ£o encontrado para esta empresa.' });
    }

    res.json({ message: 'Token excluÃ­do com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir token:', error);
    res.status(500).json({ error: 'Erro ao excluir token.' });
  }
};

export const updateLavador = async (req: EmpresaRequest, res: Response) => {
  const { id } = req.params;
  const { nome, comissao } = req.body;

  try {
    const lavador = await prisma.lavador.update({
      where: { id, empresaId: req.empresaId },
      data: { nome, comissao },
    });
    res.json(lavador);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar lavador.' });
  }
};

export const deleteLavador = async (req: EmpresaRequest, res: Response) => {
  const { id } = req.params;

  try {
    await prisma.lavador.delete({
      where: { id, empresaId: req.empresaId },
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar lavador.' });
  }
};

/**
 * Gera um token JWT para a página pública do lavador.
 */
export const gerarTokenPublico = async (req: EmpresaRequest, res: Response) => {
    const { id } = req.params;
    const empresaId = req.empresaId;

    try {
        const lavador = await prisma.lavador.findFirst({
            where: { id, empresaId }
        });

        if (!lavador) {
            return res.status(404).json({ error: 'Lavador não encontrado nesta empresa.' });
        }

        // O token contém o ID do lavador e da empresa para validação na rota pública
        const token = jwt.sign(
            { lavadorId: lavador.id, empresaId: lavador.empresaId },
            process.env.JWT_SECRET || 'seu_segredo_jwt_aqui',
            { expiresIn: '24h' } // O link público expira em 24 horas
        );

        await prisma.lavadorToken.create({
            data: {
                token,
                lavadorId: lavador.id,
                ativo: true
            }
        });

        res.json({ token });

    } catch (error) {
        console.error('Erro ao gerar token público para lavador:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

