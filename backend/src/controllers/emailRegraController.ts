import { Request, Response } from 'express';
import prisma from '../db';
import { botGetGrupos } from '../services/botServiceClient';

// Regras de leitura de email → WhatsApp. Config GLOBAL do sistema (sem empresaId).
// O bot (PC local) lê essas regras diretamente do Neon via polling.

const TIPOS_DESTINO = ['GRUPO', 'NUMEROS'];

function validarRegra(body: any): string | null {
  const { nome, remetenteContem, regexExtracao, template, destinoTipo, destinoValor } = body;
  if (!nome || !remetenteContem || !regexExtracao || !template || !destinoTipo || !destinoValor) {
    return 'Campos obrigatórios: nome, remetenteContem, regexExtracao, template, destinoTipo, destinoValor.';
  }
  if (!TIPOS_DESTINO.includes(destinoTipo)) {
    return 'destinoTipo deve ser GRUPO ou NUMEROS.';
  }
  // Valida que a regex compila antes de salvar (evita quebrar o poller do bot)
  try {
    new RegExp(regexExtracao);
  } catch {
    return 'regexExtracao inválida.';
  }
  return null;
}

export const getEmailRegras = async (_req: Request, res: Response) => {
  try {
    const regras = await prisma.emailRegra.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ regras });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar regras de email.' });
  }
};

export const createEmailRegra = async (req: Request, res: Response) => {
  const erro = validarRegra(req.body);
  if (erro) return res.status(400).json({ error: erro });

  const { nome, ativo, remetenteContem, assuntoContem, regexExtracao, template, destinoTipo, destinoValor } = req.body;
  try {
    const regra = await prisma.emailRegra.create({
      data: {
        nome,
        ativo: ativo !== false,
        remetenteContem,
        assuntoContem: assuntoContem || null,
        regexExtracao,
        template,
        destinoTipo,
        destinoValor,
      },
    });
    res.status(201).json(regra);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar regra de email.' });
  }
};

export const updateEmailRegra = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (Array.isArray(id)) return res.status(400).json({ error: 'ID inválido' });

  // Se veio só o toggle de ativo, não exige o resto
  const somenteToggle = Object.keys(req.body).length === 1 && typeof req.body.ativo === 'boolean';
  if (!somenteToggle) {
    const erro = validarRegra(req.body);
    if (erro) return res.status(400).json({ error: erro });
  }

  const { nome, ativo, remetenteContem, assuntoContem, regexExtracao, template, destinoTipo, destinoValor } = req.body;
  try {
    const regra = await prisma.emailRegra.update({
      where: { id: id as string },
      data: somenteToggle
        ? { ativo }
        : {
            nome,
            ativo: ativo !== false,
            remetenteContem,
            assuntoContem: assuntoContem || null,
            regexExtracao,
            template,
            destinoTipo,
            destinoValor,
          },
    });
    res.json(regra);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar regra de email.' });
  }
};

export const deleteEmailRegra = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (Array.isArray(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await prisma.emailRegra.delete({ where: { id: id as string } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar regra de email.' });
  }
};

// Proxy: pede ao bot a lista de grupos de WhatsApp em que ele participa,
// para o usuário escolher o destino (JID) sem digitar manualmente.
export const getWhatsappGrupos = async (_req: Request, res: Response) => {
  try {
    const data = await botGetGrupos();
    res.json({ grupos: data.grupos || [] });
  } catch (error: any) {
    res.status(502).json({ error: 'Não foi possível listar os grupos do bot.', details: String(error?.message || error) });
  }
};
