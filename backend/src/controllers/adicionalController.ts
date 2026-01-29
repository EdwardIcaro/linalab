import { Request, Response } from 'express';
import prisma from '../db';

interface EmpresaRequest extends Request {
  empresaId?: string;
}

export const createAdicional = async (req: EmpresaRequest, res: Response) => {
  const { nome, preco } = req.body;
  const empresaId = req.empresaId;

  if (!nome || preco === undefined) {
    return res.status(400).json({ error: 'Nome e preço são obrigatórios.' });
  }

  try {
    const adicional = await prisma.adicional.create({
      data: { nome, preco, empresaId: empresaId! },
    });
    res.status(201).json(adicional);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar adicional.' });
  }
};

export const getAdicionais = async (req: EmpresaRequest, res: Response) => {
  try {
    const adicionais = await prisma.adicional.findMany({
      where: { empresaId: req.empresaId },
      orderBy: { nome: 'asc' },
    });
    res.json({ adicionais });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar adicionais.' });
  }
};

export const getAdicionaisSimple = async (req: EmpresaRequest, res: Response) => {
    try {
      const adicionais = await prisma.adicional.findMany({
        where: { empresaId: req.empresaId },
        select: { id: true, nome: true, preco: true },
        orderBy: { nome: 'asc' },
      });
      res.json({ adicionais });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao buscar adicionais.' });
    }
  };

export const updateAdicional = async (req: EmpresaRequest, res: Response) => {
  const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
  const { nome, preco } = req.body;

  try {
    const adicional = await prisma.adicional.update({
      where: { id, empresaId: req.empresaId },
      data: { nome, preco },
    });
    res.json(adicional);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar adicional.' });
  }
};

export const deleteAdicional = async (req: EmpresaRequest, res: Response) => {
  const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

  try {
    await prisma.adicional.delete({
      where: { id, empresaId: req.empresaId },
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar adicional.' });
  }
};