import { Request, Response } from 'express';
import prisma from '../db';
import { empresaWaConnect, empresaWaStatus, empresaWaDisconnect, empresaWaSend } from '../services/empresaWaClient';

const TEMPLATES_PADRAO = [
  { nome: 'Veículo pronto', categoria: 'FINALIZACAO', texto: 'Olá {{nome}}! Seu veículo {{placa}} está pronto para retirada. 🚗✨' },
  { nome: 'Pesquisa de satisfação', categoria: 'POS_VENDA', texto: 'Olá {{nome}}! Como ficou o {{placa}}? Esperamos que tenha gostado do nosso serviço! 😊' },
  { nome: 'Retorno de cliente', categoria: 'PRE_VENDA', texto: 'Olá {{nome}}! Faz {{dias}} dias desde sua última visita. Que tal uma lavagem essa semana? 🚿' },
];

// ── Status da sessão da empresa ───────────────────────────────────────────────
export async function getStatus(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  try {
    const session = await prisma.whatsappEmpresaSession.findUnique({
      where: { empresaId },
      select: { status: true, phoneNumber: true },
    });
    // Se não tem registro no banco, está desconectado
    if (!session) return res.json({ status: 'DESCONECTADO', phoneNumber: null });

    // Consulta status em tempo real no bot
    try {
      const live = await empresaWaStatus(empresaId);
      return res.json({ status: live.status, phoneNumber: session.phoneNumber });
    } catch {
      return res.json({ status: session.status, phoneNumber: session.phoneNumber });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Iniciar conexão — retorna QR ──────────────────────────────────────────────
export async function connect(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  try {
    const result = await empresaWaConnect(empresaId);

    // Na primeira conexão, criar templates padrão se não existirem
    const count = await prisma.mensagemTemplate.count({ where: { empresaId } });
    if (count === 0) {
      await prisma.mensagemTemplate.createMany({
        data: TEMPLATES_PADRAO.map(t => ({ ...t, empresaId })),
      });
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Desconectar ───────────────────────────────────────────────────────────────
export async function disconnect(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  try {
    await empresaWaDisconnect(empresaId);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Enviar mensagem ───────────────────────────────────────────────────────────
export async function send(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  const { telefone, texto } = req.body as { telefone: string; texto: string };
  if (!telefone || !texto) return res.status(400).json({ error: 'telefone e texto são obrigatórios' });
  try {
    await empresaWaSend(empresaId, telefone, texto);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Enviar mensagem via template ─────────────────────────────────────────────
export async function enviarTemplate(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  const { ordemId, templateId } = req.body as { ordemId: string; templateId: string };

  if (!ordemId || !templateId)
    return res.status(400).json({ error: 'ordemId e templateId são obrigatórios' });

  try {
    const [ordem, template, empresa] = await Promise.all([
      prisma.ordemServico.findFirst({
        where: { id: ordemId, empresaId },
        include: {
          cliente: { select: { id: true, nome: true, telefone: true } },
          veiculo:  { select: { placa: true } },
        },
      }),
      prisma.mensagemTemplate.findFirst({ where: { id: templateId, empresaId } }),
      prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true } }),
    ]);

    if (!ordem)    return res.status(404).json({ error: 'Ordem não encontrada' });
    if (!template) return res.status(404).json({ error: 'Template não encontrado' });

    const digits   = (ordem.cliente?.telefone || '').replace(/\D/g, '');
    if (!digits) return res.status(400).json({ error: 'Cliente sem telefone cadastrado' });
    const telefone = digits.startsWith('55') ? digits : `55${digits}`;

    // Dias desde última visita anterior (para {{dias}})
    let dias = 0;
    if (ordem.cliente?.id) {
      const anterior = await prisma.ordemServico.findFirst({
        where: { clienteId: ordem.cliente.id, empresaId, status: 'FINALIZADO', id: { not: ordemId } },
        orderBy: { dataFim: 'desc' },
        select: { dataFim: true },
      });
      if (anterior?.dataFim)
        dias = Math.floor((Date.now() - anterior.dataFim.getTime()) / (1000 * 60 * 60 * 24));
    }

    const nome     = (ordem.cliente?.nome || 'cliente').split(' ')[0];
    const placa    = ordem.veiculo?.placa || '';
    const valorFmt = `R$ ${(ordem.valorTotal || 0).toFixed(2).replace('.', ',')}`;

    const texto = template.texto
      .replace(/\{\{nome\}\}/g,    nome)
      .replace(/\{\{placa\}\}/g,   placa)
      .replace(/\{\{valor\}\}/g,   valorFmt)
      .replace(/\{\{dias\}\}/g,    String(dias))
      .replace(/\{\{empresa\}\}/g, empresa?.nome || '');

    await empresaWaSend(empresaId, telefone, texto);

    return res.json({ ok: true, mensagem: texto });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erro ao enviar mensagem' });
  }
}

// ── Enviar mensagem direta para cliente (CRM) ─────────────────────────────────
export async function enviarParaCliente(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  const { clienteId, templateId, texto } = req.body as { clienteId: string; templateId?: string; texto?: string };

  if (!clienteId) return res.status(400).json({ error: 'clienteId é obrigatório' });
  if (!templateId && !texto) return res.status(400).json({ error: 'templateId ou texto são obrigatórios' });

  try {
    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      include: {
        veiculos: { take: 1, orderBy: { createdAt: 'asc' } },
        ordens:   { where: { status: 'FINALIZADO' }, orderBy: { dataFim: 'desc' }, take: 1 },
      },
    });

    if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });

    const digits = (cliente.telefone || '').replace(/\D/g, '');
    if (!digits) return res.status(400).json({ error: 'Cliente sem telefone cadastrado' });
    const telefone = digits.startsWith('55') ? digits : `55${digits}`;

    let mensagem = texto || '';

    if (templateId) {
      const [template, empresa] = await Promise.all([
        prisma.mensagemTemplate.findFirst({ where: { id: templateId, empresaId } }),
        prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true } }),
      ]);
      if (!template) return res.status(404).json({ error: 'Template não encontrado' });

      const nome  = (cliente.nome || 'cliente').split(' ')[0];
      const placa = (cliente.veiculos[0]?.placa) || '';
      let dias = 0;
      if (cliente.ordens[0]?.dataFim)
        dias = Math.floor((Date.now() - (cliente.ordens[0].dataFim as Date).getTime()) / 86400000);

      mensagem = template.texto
        .replace(/\{\{nome\}\}/g,    nome)
        .replace(/\{\{placa\}\}/g,   placa)
        .replace(/\{\{dias\}\}/g,    String(dias))
        .replace(/\{\{empresa\}\}/g, empresa?.nome || '');
    }

    await empresaWaSend(empresaId, telefone, mensagem);
    return res.json({ ok: true, mensagem });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erro ao enviar mensagem' });
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────
export async function getTemplates(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  try {
    const templates = await prisma.mensagemTemplate.findMany({
      where: { empresaId },
      orderBy: [{ categoria: 'asc' }, { createdAt: 'asc' }],
    });
    return res.json({ templates });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createTemplate(req: Request, res: Response) {
  const empresaId = (req as any).empresaId as string;
  const { nome, categoria, texto } = req.body;
  if (!nome || !categoria || !texto) return res.status(400).json({ error: 'nome, categoria e texto são obrigatórios' });
  try {
    const template = await prisma.mensagemTemplate.create({
      data: { empresaId, nome, categoria, texto },
    });
    return res.status(201).json({ template });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateTemplate(req: Request, res: Response) {
  const empresaId  = (req as any).empresaId as string;
  const templateId = req.params['id'] as string;
  const { nome, texto, ativo } = req.body;
  try {
    const existing = await prisma.mensagemTemplate.findFirst({ where: { id: templateId, empresaId } });
    if (!existing) return res.status(404).json({ error: 'Template não encontrado' });
    const updated = await prisma.mensagemTemplate.update({
      where: { id: templateId },
      data:  { ...(nome !== undefined && { nome }), ...(texto !== undefined && { texto }), ...(ativo !== undefined && { ativo }) },
    });
    return res.json({ template: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export async function deleteTemplate(req: Request, res: Response) {
  const empresaId  = (req as any).empresaId as string;
  const templateId = req.params['id'] as string;
  try {
    const existing = await prisma.mensagemTemplate.findFirst({ where: { id: templateId, empresaId } });
    if (!existing) return res.status(404).json({ error: 'Template não encontrado' });
    await prisma.mensagemTemplate.delete({ where: { id: templateId } });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
