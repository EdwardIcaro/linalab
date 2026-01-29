import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../db';

interface EmpresaRequest extends Request {
  empresaId?: string;
}

const normalizePermissions = (permissoes: unknown): string[] => {
  if (!Array.isArray(permissoes)) return [];
  return Array.from(new Set(permissoes.filter((p) => typeof p === 'string' && p.trim().length > 0)));
};

const parseMaxDesconto = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 100) return null;
  return Math.round(parsed);
};

/**
 * Listar roles e usuarios (subaccounts) da empresa
 */
export const getRolesAndUsers = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId;
    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa n\u00e3o autenticada' });
    }

    const [roles, usuarios] = await Promise.all([
      prisma.role.findMany({
        where: { empresaId },
        include: {
          permissoes: true,
          _count: { select: { usuarios: true } }
        },
        orderBy: { nome: 'asc' }
      }),
      prisma.subaccount.findMany({
        where: { empresaId },
        select: {
          id: true,
          nome: true,
          email: true,
          maxDesconto: true,
          roleInt: { select: { id: true, nome: true } }
        },
        orderBy: { nome: 'asc' }
      })
    ]);

    res.json({ roles, usuarios });
  } catch (error) {
    console.error('Erro ao listar roles e usuarios:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Criar ou atualizar role
 */
export const upsertRole = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId;
    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa n\u00e3o autenticada' });
    }

    const { id, nome, permissoes } = req.body;
    if (!nome || typeof nome !== 'string') {
      return res.status(400).json({ error: 'Nome da fun\u00e7\u00e3o \u00e9 obrigat\u00f3rio' });
    }

    const permissionList = normalizePermissions(permissoes).map((p) => ({
      name: p,
      nome: p
    }));

    if (id) {
      const role = await prisma.role.findFirst({
        where: { id, empresaId }
      });

      if (!role) {
        return res.status(404).json({ error: 'Fun\u00e7\u00e3o n\u00e3o encontrada' });
      }

      const updatedRole = await prisma.$transaction(async (tx) => {
        const updated = await tx.role.update({
          where: { id },
          data: { nome },
          include: { _count: { select: { usuarios: true } }, permissoes: true }
        });

        await tx.permission.deleteMany({ where: { roleId: id } });

        if (permissionList.length > 0) {
          await tx.permission.createMany({
            data: permissionList.map((p) => ({ ...p, roleId: id }))
          });
        }

        return tx.role.findUnique({
          where: { id },
          include: { _count: { select: { usuarios: true } }, permissoes: true }
        });
      });

      return res.json({
        message: 'Fun\u00e7\u00e3o atualizada com sucesso',
        role: updatedRole
      });
    }

    const role = await prisma.role.create({
      data: {
        nome,
        empresaId,
        permissoes: {
          create: permissionList
        }
      },
      include: {
        _count: { select: { usuarios: true } },
        permissoes: true
      }
    });

    res.status(201).json({
      message: 'Fun\u00e7\u00e3o criada com sucesso',
      role
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'J\u00e1 existe uma fun\u00e7\u00e3o com este nome' });
    }
    console.error('Erro ao salvar fun\u00e7\u00e3o:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Excluir role
 */
export const deleteRole = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId;
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa n\u00e3o autenticada' });
    }

    const role = await prisma.role.findFirst({
      where: { id, empresaId },
      include: { _count: { select: { usuarios: true } } }
    });

    if (!role) {
      return res.status(404).json({ error: 'Fun\u00e7\u00e3o n\u00e3o encontrada' });
    }

    if (role._count.usuarios > 0) {
      return res.status(400).json({ error: 'N\u00e3o \u00e9 poss\u00edvel excluir uma fun\u00e7\u00e3o com usu\u00e1rios vinculados' });
    }

    await prisma.role.delete({ where: { id } });

    res.json({ message: 'Fun\u00e7\u00e3o exclu\u00edda com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir fun\u00e7\u00e3o:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Criar subaccount
 */
export const createSubaccount = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId;
    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa n\u00e3o autenticada' });
    }

    const { nome, email, senha, roleId, maxDesconto } = req.body;
    if (!nome || !email || !senha || !roleId) {
      return res.status(400).json({ error: 'Nome, email, senha e fun\u00e7\u00e3o s\u00e3o obrigat\u00f3rios' });
    }

    const maxDescontoValue = parseMaxDesconto(maxDesconto);
    if (maxDescontoValue === null) {
      return res.status(400).json({ error: 'Desconto m\u00e1ximo inv\u00e1lido' });
    }

    const role = await prisma.role.findFirst({
      where: { id: roleId, empresaId }
    });

    if (!role) {
      return res.status(400).json({ error: 'Fun\u00e7\u00e3o inv\u00e1lida para esta empresa' });
    }

    const hashedSenha = await bcrypt.hash(senha, 12);

    const user = await prisma.subaccount.create({
      data: {
        nome,
        email,
        senha: hashedSenha,
        roleId,
        maxDesconto: maxDescontoValue,
        empresaId
      },
      select: {
        id: true,
        nome: true,
        email: true,
        maxDesconto: true,
        roleInt: { select: { id: true, nome: true } }
      }
    });

    res.status(201).json({
      message: 'Usu\u00e1rio criado com sucesso',
      usuario: user
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Email j\u00e1 cadastrado' });
    }
    console.error('Erro ao criar usu\u00e1rio:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Atualizar subaccount
 */
export const updateSubaccount = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId;
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa n\u00e3o autenticada' });
    }

    const { nome, email, senha, roleId, maxDesconto } = req.body;

    const existing = await prisma.subaccount.findFirst({
      where: { id, empresaId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Usu\u00e1rio n\u00e3o encontrado' });
    }

    const updateData: any = {};
    if (nome) updateData.nome = nome;
    if (email) updateData.email = email;

    if (maxDesconto !== undefined) {
      const maxDescontoValue = parseMaxDesconto(maxDesconto);
      if (maxDescontoValue === null) {
        return res.status(400).json({ error: 'Desconto m\u00e1ximo inv\u00e1lido' });
      }
      updateData.maxDesconto = maxDescontoValue;
    }

    if (roleId) {
      const role = await prisma.role.findFirst({ where: { id: roleId, empresaId } });
      if (!role) {
        return res.status(400).json({ error: 'Fun\u00e7\u00e3o inv\u00e1lida para esta empresa' });
      }
      updateData.roleId = roleId;
    }

    if (senha) {
      updateData.senha = await bcrypt.hash(senha, 12);
    }

    const user = await prisma.subaccount.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        nome: true,
        email: true,
        maxDesconto: true,
        roleInt: { select: { id: true, nome: true } }
      }
    });

    res.json({
      message: 'Usu\u00e1rio atualizado com sucesso',
      usuario: user
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Email j\u00e1 cadastrado' });
    }
    console.error('Erro ao atualizar usu\u00e1rio:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

/**
 * Excluir subaccount
 */
export const deleteSubaccount = async (req: EmpresaRequest, res: Response) => {
  try {
    const empresaId = req.empresaId;
    const { id } = req.params;
    if (Array.isArray(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    if (!empresaId) {
      return res.status(401).json({ error: 'Empresa n\u00e3o autenticada' });
    }

    const existing = await prisma.subaccount.findFirst({
      where: { id, empresaId }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Usu\u00e1rio n\u00e3o encontrado' });
    }

    await prisma.subaccount.delete({ where: { id } });
    res.json({ message: 'Usu\u00e1rio exclu\u00eddo com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir usu\u00e1rio:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};
