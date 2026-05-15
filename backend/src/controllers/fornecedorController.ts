import { Request, Response } from 'express';
import prisma from '../db';

interface EmpresaRequest extends Request {
  empresaId?: string;
}

/**
 * Listar todos os fornecedores da empresa
 */
export const getFornecedores = async (req: EmpresaRequest, res: Response) => {
  try {
    const fornecedores = await prisma.fornecedor.findMany({
      where: { empresaId: req.empresaId },
      orderBy: { nome: 'asc' },
    });
    res.set('Cache-Control', 'private, max-age=300');
    res.set('Vary', 'Authorization');
    res.json(fornecedores);
  } catch (error) {
    console.error('Erro ao buscar fornecedores:', error);
    res.status(500).json({ error: 'Erro ao buscar fornecedores.' });
  }
};