import { Request, Response, NextFunction } from 'express';
import prisma from '../db';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { verificarRateLimit, resetarRateLimit } from '../utils/rateLimiter';
import { getTodayRangeBRT } from '../utils/dateUtils';

const JWT_SECRET = process.env.SECRET_KEY || 'seu_segredo_jwt_aqui';

// ─── helpers ─────────────────────────────────────────────────────────────────

function gerarSessionJwt(lavadorId: string, empresaId: string, sessionVersion: number): string {
  return jwt.sign(
    { lavadorId, empresaId, sessionVersion, tipo: 'portal_session' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

async function buscarLavadorPorToken(token: string) {
  return prisma.lavador.findUnique({
    where: { linkTokenCurto: token },
    select: {
      id: true, nome: true, pin: true, pinDefinido: true,
      ativo: true, sessionVersion: true,
      tipoRemuneracao: true, baseComissao: true, comissao: true, salario: true,
      empresa: { select: { id: true, nome: true, horarioAbertura: true } },
    },
  });
}

// ─── público ─────────────────────────────────────────────────────────────────

// GET /api/p/:token
export const resolverTokenPublico = async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  try {
    const lavador = await buscarLavadorPorToken(token);
    if (!lavador || !lavador.ativo) return res.status(404).json({ erro: 'link_invalido' });
    res.json({
      lavadorId: lavador.id,
      nome: lavador.nome,
      pinDefinido: lavador.pinDefinido,
      empresa: {
        id: lavador.empresa.id,
        nome: lavador.empresa.nome,
        horarioAbertura: lavador.empresa.horarioAbertura,
      },
    });
  } catch (error) {
    console.error('[portal] resolverToken:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// POST /api/p/:token/pin/setup
export const setupPin = async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const { pin } = req.body;
  const ip = req.ip || 'unknown';

  if (!pin || !/^\d{4}$/.test(String(pin)))
    return res.status(400).json({ erro: 'PIN deve ter 4 dígitos numéricos' });

  if (!verificarRateLimit(`pin-setup:${ip}`, 5, 60 * 60 * 1000))
    return res.status(429).json({ erro: 'Muitas tentativas. Tente em 1 hora.' });

  try {
    const lavador = await buscarLavadorPorToken(token);
    if (!lavador || !lavador.ativo) return res.status(404).json({ erro: 'link_invalido' });
    if (lavador.pinDefinido) return res.status(400).json({ erro: 'PIN já foi definido' });

    const hash = await bcrypt.hash(String(pin), 10);
    await prisma.lavador.update({
      where: { id: lavador.id },
      data: { pin: hash, pinDefinido: true },
    });

    resetarRateLimit(`pin-setup:${ip}`);
    res.json({ token: gerarSessionJwt(lavador.id, lavador.empresa.id, lavador.sessionVersion) });
  } catch (error) {
    console.error('[portal] setupPin:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// POST /api/p/:token/pin/verify
export const verifyPin = async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const { pin } = req.body;
  const ip = req.ip || 'unknown';

  if (!pin || !/^\d{4}$/.test(String(pin)))
    return res.status(400).json({ erro: 'PIN inválido' });

  if (!verificarRateLimit(`pin-fail:${ip}`, 10, 60 * 60 * 1000))
    return res.status(429).json({ erro: 'Muitas tentativas. Tente em 1 hora.' });

  try {
    const lavador = await buscarLavadorPorToken(token);
    if (!lavador || !lavador.ativo) return res.status(404).json({ erro: 'link_invalido' });
    if (!lavador.pinDefinido || !lavador.pin)
      return res.status(400).json({ erro: 'PIN não configurado' });

    const ok = await bcrypt.compare(String(pin), lavador.pin);
    if (!ok) return res.status(401).json({ erro: 'PIN incorreto' });

    resetarRateLimit(`pin-fail:${ip}`);
    res.json({ token: gerarSessionJwt(lavador.id, lavador.empresa.id, lavador.sessionVersion) });
  } catch (error) {
    console.error('[portal] verifyPin:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ─── middleware de sessão ─────────────────────────────────────────────────────

export const portalSessionMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res.status(401).json({ erro: 'Não autenticado' });

  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any;
    if (payload.tipo !== 'portal_session')
      return res.status(401).json({ erro: 'Token inválido' });

    const lavador = await prisma.lavador.findUnique({
      where: { id: payload.lavadorId },
      select: { sessionVersion: true, ativo: true },
    });
    if (!lavador || !lavador.ativo || lavador.sessionVersion !== payload.sessionVersion)
      return res.status(401).json({ erro: 'Sessão expirada' });

    (req as any).lavadorId = payload.lavadorId;
    (req as any).empresaId = payload.empresaId;
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
};

// ─── autenticado ─────────────────────────────────────────────────────────────

// GET /api/p/me/dados
export const getDadosPortal = async (req: Request, res: Response) => {
  const lavadorId = (req as any).lavadorId as string;
  const empresaId = (req as any).empresaId as string;

  try {
    const lavador = await prisma.lavador.findUnique({
      where: { id: lavadorId },
      select: {
        id: true, nome: true, comissao: true,
        tipoRemuneracao: true, baseComissao: true, salario: true,
        empresa: { select: { nome: true } },
      },
    });
    if (!lavador) return res.status(404).json({ erro: 'Lavador não encontrado' });

    const sistemaDP = await prisma.empresaSistema.findFirst({
      where: { empresaId, sistema: 'data-point', ativo: true },
    });

    const { start: inicioHoje, end: fimHoje } = getTodayRangeBRT();
    const inicioMes = new Date(inicioHoje);
    inicioMes.setDate(1);

    // Ordens do dia com este lavador
    const ordensHoje = await prisma.ordemServicoLavador.findMany({
      where: {
        lavadorId,
        ordem: {
          empresaId,
          status: { in: ['FINALIZADO', 'AGUARDANDO_PAGAMENTO'] },
          dataFim: { gte: inicioHoje, lte: fimHoje },
        },
      },
      select: {
        ganho: true,
        ordem: {
          select: {
            id: true, valorTotal: true, desconto: true, status: true, dataFim: true,
            cliente: { select: { nome: true } },
            veiculo: { select: { placa: true, modelo: true } },
            items: {
              where: { tipo: 'SERVICO' },
              select: { servico: { select: { nome: true } } },
            },
          },
        },
      },
      orderBy: { ordem: { dataFim: 'desc' } },
    });

    // Resumo do mês (só FINALIZADO conta como faturamento)
    const ordensMes = await prisma.ordemServicoLavador.aggregate({
      where: {
        lavadorId,
        ordem: {
          empresaId,
          status: 'FINALIZADO',
          dataFim: { gte: inicioMes },
        },
      },
      _sum: { ganho: true },
      _count: { ordemId: true },
    });

    const ganhoHoje = ordensHoje.reduce((s, o) => s + (o.ganho ?? 0), 0);

    res.json({
      lavador: {
        nome: lavador.nome,
        empresa: lavador.empresa.nome,
        tipoRemuneracao: lavador.tipoRemuneracao,
        baseComissao: lavador.baseComissao,
        comissao: lavador.comissao,
        salario: lavador.salario,
      },
      dataPointAtivo: !!sistemaDP,
      hoje: {
        ganho: ganhoHoje,
        totalOrdens: ordensHoje.length,
        ordens: ordensHoje.map(o => ({
          id: o.ordem.id,
          cliente: o.ordem.cliente?.nome ?? '—',
          placa: o.ordem.veiculo?.placa ?? '—',
          modelo: o.ordem.veiculo?.modelo ?? '',
          servicos: o.ordem.items
            .map((i: any) => i.servico?.nome)
            .filter(Boolean)
            .join(', '),
          valorTotal: o.ordem.valorTotal,
          valorFinal: o.ordem.valorTotal - (o.ordem.desconto ?? 0),
          ganho: o.ganho ?? 0,
          status: o.ordem.status,
        })),
      },
      mes: {
        ganho: ordensMes._sum?.ganho ?? 0,
        totalOrdens: ordensMes._count?.ordemId ?? 0,
      },
    });
  } catch (error) {
    console.error('[portal] getDadosPortal:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ─── legado (/api/public/*) ───────────────────────────────────────────────────

export const getOrdensByLavadorPublic = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  try {
    const ordens = await prisma.ordemServico.findMany({
      where: { ordemLavadores: { some: { lavadorId: id } }, status: 'FINALIZADO' },
      orderBy: { dataFim: 'desc' },
      take: 50,
      select: {
        id: true, valorTotal: true, desconto: true, dataFim: true,
        cliente: { select: { nome: true } },
        veiculo: { select: { placa: true, modelo: true } },
      },
    });
    res.json({ ordens });
  } catch {
    res.status(500).json({ erro: 'Erro interno' });
  }
};

export const getLavadorPublicData = async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token obrigatório' });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    const lavadorToken = await prisma.lavadorToken.findFirst({
      where: { token, ativo: true, lavadorId: payload.lavadorId },
      include: {
        lavador: {
          select: {
            id: true, nome: true, comissao: true,
            tipoRemuneracao: true, salario: true,
            empresa: { select: { nome: true } },
          },
        },
      },
    });

    if (!lavadorToken) return res.status(401).json({ error: 'Token inválido ou expirado' });
    if (lavadorToken.expiresAt && new Date() > lavadorToken.expiresAt)
      return res.status(401).json({ error: 'Token expirado' });

    res.json({ lavador: lavadorToken.lavador, tokenExpiresAt: lavadorToken.expiresAt });
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
};
