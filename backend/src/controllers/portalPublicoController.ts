import { Request, Response, NextFunction } from 'express';
import prisma from '../db';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { verificarRateLimit, resetarRateLimit } from '../utils/rateLimiter';
import { getTodayRangeBRT, getTodayStrBRT, getDateRangeBRT } from '../utils/dateUtils';

const JWT_SECRET = process.env.SECRET_KEY || 'seu_segredo_jwt_aqui';

// ─── helpers ─────────────────────────────────────────────────────────────────

function gerarSessionJwt(lavadorId: string, empresaId: string, sessionVersion: number): string {
  return jwt.sign(
    { lavadorId, empresaId, sessionVersion, tipo: 'portal_session' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function gerarSessionJwtDp(dpFuncionarioId: string, empresaId: string, sessionVersion: number): string {
  return jwt.sign(
    { dpFuncionarioId, empresaId, sessionVersion, tipo: 'portal_session_dp' },
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

async function buscarDpFuncionarioPorToken(token: string) {
  return prisma.dpFuncionario.findUnique({
    where: { linkToken: token },
    select: {
      id: true, nome: true, pin: true, pinDefinido: true,
      status: true, sessionVersion: true, empresaId: true,
      empresa: { select: { id: true, nome: true, horarioAbertura: true } },
    },
  });
}

const DP_FUNC_SELECT = {
  id: true, nome: true, cargo: true, cargaHorariaDia: true, jornadaEntrada: true,
} as const;

async function buscarDpFuncPorSessao(
  lavadorId: string | undefined,
  dpFuncionarioId: string | undefined,
  empresaId: string,
) {
  if (lavadorId) {
    return prisma.dpFuncionario.findFirst({
      where: { empresaId, lavadorId, status: 'ATIVO' },
      select: DP_FUNC_SELECT,
    });
  }
  if (dpFuncionarioId) {
    return prisma.dpFuncionario.findFirst({
      where: { id: dpFuncionarioId, empresaId, status: 'ATIVO' },
      select: DP_FUNC_SELECT,
    });
  }
  return null;
}

// ─── público ─────────────────────────────────────────────────────────────────

// GET /api/p/:token
export const resolverTokenPublico = async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  try {
    const lavador = await buscarLavadorPorToken(token);
    if (lavador?.ativo) {
      return res.json({
        lavadorId: lavador.id,
        nome: lavador.nome,
        pinDefinido: lavador.pinDefinido,
        empresa: {
          id: lavador.empresa.id,
          nome: lavador.empresa.nome,
          horarioAbertura: lavador.empresa.horarioAbertura,
        },
      });
    }

    const dpFunc = await buscarDpFuncionarioPorToken(token);
    if (dpFunc && dpFunc.status !== 'DESLIGADO') {
      return res.json({
        dpFuncionarioId: dpFunc.id,
        nome: dpFunc.nome,
        pinDefinido: dpFunc.pinDefinido,
        empresa: {
          id: dpFunc.empresa.id,
          nome: dpFunc.empresa.nome,
          horarioAbertura: dpFunc.empresa.horarioAbertura,
        },
      });
    }

    return res.status(404).json({ erro: 'link_invalido' });
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
    if (lavador?.ativo) {
      if (lavador.pinDefinido) return res.status(400).json({ erro: 'PIN já foi definido' });
      const hash = await bcrypt.hash(String(pin), 10);
      await prisma.lavador.update({
        where: { id: lavador.id },
        data: { pin: hash, pinDefinido: true },
      });
      resetarRateLimit(`pin-setup:${ip}`);
      return res.json({ token: gerarSessionJwt(lavador.id, lavador.empresa.id, lavador.sessionVersion) });
    }

    const dpFunc = await buscarDpFuncionarioPorToken(token);
    if (dpFunc && dpFunc.status !== 'DESLIGADO') {
      if (dpFunc.pinDefinido) return res.status(400).json({ erro: 'PIN já foi definido' });
      const hash = await bcrypt.hash(String(pin), 10);
      await prisma.dpFuncionario.update({
        where: { id: dpFunc.id },
        data: { pin: hash, pinDefinido: true },
      });
      resetarRateLimit(`pin-setup:${ip}`);
      return res.json({ token: gerarSessionJwtDp(dpFunc.id, dpFunc.empresaId, dpFunc.sessionVersion) });
    }

    return res.status(404).json({ erro: 'link_invalido' });
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
    if (lavador?.ativo) {
      if (!lavador.pinDefinido || !lavador.pin)
        return res.status(400).json({ erro: 'PIN não configurado' });
      const ok = await bcrypt.compare(String(pin), lavador.pin);
      if (!ok) return res.status(401).json({ erro: 'PIN incorreto' });
      resetarRateLimit(`pin-fail:${ip}`);
      return res.json({ token: gerarSessionJwt(lavador.id, lavador.empresa.id, lavador.sessionVersion) });
    }

    const dpFunc = await buscarDpFuncionarioPorToken(token);
    if (dpFunc && dpFunc.status !== 'DESLIGADO') {
      if (!dpFunc.pinDefinido || !dpFunc.pin)
        return res.status(400).json({ erro: 'PIN não configurado' });
      const ok = await bcrypt.compare(String(pin), dpFunc.pin);
      if (!ok) return res.status(401).json({ erro: 'PIN incorreto' });
      resetarRateLimit(`pin-fail:${ip}`);
      return res.json({ token: gerarSessionJwtDp(dpFunc.id, dpFunc.empresaId, dpFunc.sessionVersion) });
    }

    return res.status(404).json({ erro: 'link_invalido' });
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

    if (payload.tipo === 'portal_session') {
      const lavador = await prisma.lavador.findUnique({
        where: { id: payload.lavadorId },
        select: { sessionVersion: true, ativo: true },
      });
      if (!lavador || !lavador.ativo || lavador.sessionVersion !== payload.sessionVersion)
        return res.status(401).json({ erro: 'Sessão expirada' });
      (req as any).lavadorId = payload.lavadorId;
      (req as any).empresaId = payload.empresaId;
      return next();
    }

    if (payload.tipo === 'portal_session_dp') {
      const dpFunc = await prisma.dpFuncionario.findUnique({
        where: { id: payload.dpFuncionarioId },
        select: { sessionVersion: true, status: true },
      });
      if (!dpFunc || dpFunc.status === 'DESLIGADO' || dpFunc.sessionVersion !== payload.sessionVersion)
        return res.status(401).json({ erro: 'Sessão expirada' });
      (req as any).dpFuncionarioId = payload.dpFuncionarioId;
      (req as any).empresaId = payload.empresaId;
      return next();
    }

    return res.status(401).json({ erro: 'Token inválido' });
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
};

// ─── autenticado ─────────────────────────────────────────────────────────────

// GET /api/p/me/dados
export const getDadosPortal = async (req: Request, res: Response) => {
  const lavadorId = (req as any).lavadorId as string | undefined;
  const dpFuncionarioId = (req as any).dpFuncionarioId as string | undefined;
  const empresaId = (req as any).empresaId as string;

  // Sessão dpFuncionario (usuário sistema, sem Lina Wash)
  if (!lavadorId && dpFuncionarioId) {
    try {
      const dpFunc = await prisma.dpFuncionario.findUnique({
        where: { id: dpFuncionarioId },
        select: { nome: true, empresa: { select: { nome: true } } },
      });
      if (!dpFunc) return res.status(404).json({ erro: 'Funcionário não encontrado' });
      const sistemaDP = await prisma.empresaSistema.findFirst({
        where: { empresaId, sistema: 'data-point', ativo: true },
      });
      return res.json({
        lavador: {
          nome: dpFunc.nome,
          empresa: dpFunc.empresa.nome,
          tipoRemuneracao: null,
          baseComissao: null,
          comissao: null,
          salario: null,
          telefone: null,
        },
        dataPointAtivo: !!sistemaDP,
        hoje: { ganho: 0, totalOrdens: 0, ordens: [] },
        mes: { ganho: 0, totalOrdens: 0 },
      });
    } catch (error) {
      console.error('[portal] getDadosPortal (dp):', error);
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  try {
    const lavador = await prisma.lavador.findUnique({
      where: { id: lavadorId! },
      select: {
        id: true, nome: true, comissao: true,
        tipoRemuneracao: true, baseComissao: true, salario: true,
        telefone: true,
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
        telefone: lavador.telefone ?? null,
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

// ─── GET /api/p/me/extrato ───────────────────────────────────────────────────
// Retorna os dados no mesmo shape que getLavadorPublicData,
// mas autenticado pelo session JWT do portal.
export const getExtratoPortal = async (req: Request, res: Response) => {
  const lavadorId = (req as any).lavadorId as string;

  try {
    const trintaDiasAtras = new Date();
    trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
    trintaDiasAtras.setHours(0, 0, 0, 0);

    const lavador = await prisma.lavador.findUnique({
      where: { id: lavadorId },
      select: {
        id: true, nome: true, comissao: true, tipoRemuneracao: true,
        baseComissao: true, salario: true,
        empresa: { select: { nome: true, horarioAbertura: true } },
      },
    });
    if (!lavador) return res.status(404).json({ erro: 'Lavador não encontrado' });

    const ordens = await prisma.ordemServico.findMany({
      where: {
        OR: [
          { lavadorId },
          { ordemLavadores: { some: { lavadorId } } },
        ],
        createdAt: { gte: trintaDiasAtras },
        status: { in: ['EM_ANDAMENTO', 'FINALIZADO', 'PENDENTE', 'AGUARDANDO_PAGAMENTO'] },
      },
      include: {
        veiculo: { select: { modelo: true, placa: true } },
        items: {
          include: {
            servico: { select: { nome: true } },
            adicional: { select: { nome: true } },
          },
        },
        lavador: { select: { nome: true, comissao: true } },
        ordemLavadores: {
          include: {
            lavador: { select: { id: true, nome: true, comissao: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const fechamentos = await prisma.fechamentoComissao.findMany({
      where: { lavadorId, data: { gte: trintaDiasAtras } },
      include: {
        ordensPagas: {
          include: {
            veiculo: { select: { placa: true, modelo: true } },
            items: { include: { servico: { select: { nome: true } }, adicional: { select: { nome: true } } } },
            lavador: { select: { nome: true, comissao: true } },
            ordemLavadores: { include: { lavador: { select: { id: true, nome: true, comissao: true } } } },
          },
        },
        ordemLavadoresPagos: {
          include: {
            lavador: { select: { id: true, nome: true, comissao: true } },
            ordem: {
              include: {
                veiculo: { select: { placa: true, modelo: true } },
                items: { include: { servico: { select: { nome: true } }, adicional: { select: { nome: true } } } },
                lavador: { select: { nome: true, comissao: true } },
                ordemLavadores: { include: { lavador: { select: { id: true, nome: true, comissao: true } } } },
              },
            },
          },
        },
        adiantamentosQuitados: true,
      },
      orderBy: { data: 'desc' },
    });

    const gorjetas = await (prisma.gorjeta as any).findMany({
      where: { lavadorId, criadoEm: { gte: trintaDiasAtras } },
      orderBy: { criadoEm: 'desc' },
    });

    const adiantamentosNaoQuitados = await prisma.adiantamento.findMany({
      where: { lavadorId, status: { not: 'QUITADO' } },
      include: { caixaRegistro: { select: { descricao: true } } },
      orderBy: { data: 'desc' },
    });

    const sistemaDP = await prisma.empresaSistema.findFirst({
      where: { empresaId: (req as any).empresaId, sistema: 'data-point', ativo: true },
    });

    res.json({
      lavadorId: lavador.id,
      nome: lavador.nome,
      comissao: lavador.comissao,
      tipoRemuneracao: lavador.tipoRemuneracao,
      baseComissao: lavador.baseComissao,
      salario: lavador.salario,
      empresa: lavador.empresa.nome,
      dataPointAtivo: !!sistemaDP,
      ordens,
      gorjetas,
      fechamentos,
      adiantamentosNaoQuitados,
      tokenExpiresAt: null, // portal não expira por tempo
    });
  } catch (error) {
    console.error('[portal] extrato:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ─── POST /api/p/:token/wpp/codigo ───────────────────────────────────────────
export const gerarCodigoWpp = async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };

  try {
    const lavador = await buscarLavadorPorToken(token);
    if (!lavador || !lavador.ativo) return res.status(404).json({ erro: 'link_invalido' });

    // Gera código de 6 chars alfanumérico (sem 0/O/I/1)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const codigo = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const expiraEm = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    await prisma.lavador.update({
      where: { id: lavador.id },
      data: { codigoWpp: codigo, codigoWppExpiraEm: expiraEm },
    });

    // Número do bot (instância global, empresaId = null)
    const botInst = await prisma.whatsappInstance.findFirst({
      where: { empresaId: null },
      select: { ownerPhone: true },
    });
    const botNumero = botInst?.ownerPhone?.replace(/\D/g, '') ?? null;

    res.json({ codigo, expiraEm, botNumero });
  } catch (error) {
    console.error('[portal] gerarCodigoWpp:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ─── POST /api/p/:token/wpp/desvincular ──────────────────────────────────────
export const desvincularWpp = async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  try {
    const lavador = await buscarLavadorPorToken(token);
    if (!lavador || !lavador.ativo) return res.status(404).json({ erro: 'link_invalido' });

    await prisma.lavador.update({
      where: { id: lavador.id },
      data: { telefone: null, codigoWpp: null, codigoWppExpiraEm: null },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('[portal] desvincularWpp:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ─── helpers ponto ───────────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function horaFormatadaBRT(d: Date): string {
  return new Date(d).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

function calcMinHoje(marcacoes: Array<{ tipo: string; timestamp: Date }>, now: Date): number {
  let total = 0; let i = 0;
  while (i < marcacoes.length) {
    if (marcacoes[i].tipo === 'ENTRADA') {
      let j = i + 1;
      while (j < marcacoes.length && marcacoes[j].tipo !== 'SAIDA') j++;
      if (j < marcacoes.length) {
        total += Math.round((marcacoes[j].timestamp.getTime() - marcacoes[i].timestamp.getTime()) / 60000);
        i = j + 1;
      } else {
        total += Math.round((now.getTime() - marcacoes[i].timestamp.getTime()) / 60000);
        i++;
      }
    } else { i++; }
  }
  return total;
}

// ─── GET /api/p/me/ponto/hoje ─────────────────────────────────────────────────
export const getPontoHoje = async (req: Request, res: Response) => {
  const lavadorId = (req as any).lavadorId as string | undefined;
  const dpFuncionarioId = (req as any).dpFuncionarioId as string | undefined;
  const empresaId = (req as any).empresaId as string;

  try {
    const [funcionario, sistema] = await Promise.all([
      buscarDpFuncPorSessao(lavadorId, dpFuncionarioId, empresaId),
      prisma.empresaSistema.findFirst({
        where: { empresaId, sistema: 'data-point', ativo: true },
      }),
    ]);

    if (!funcionario) return res.status(404).json({ erro: 'Você não está cadastrado no Data Point desta empresa.' });
    if (!sistema) return res.status(404).json({ erro: 'Data Point não ativo' });

    const cfg = sistema.config ? JSON.parse(sistema.config as string) : {};
    const { start, end } = getTodayRangeBRT();
    const now = new Date();

    const marcacoes = await prisma.dpMarcacao.findMany({
      where: { funcionarioId: funcionario.id, timestamp: { gte: start, lte: end } },
      orderBy: { timestamp: 'asc' },
    });

    const cargaEsperadaMin = (funcionario.cargaHorariaDia ?? 8) * 60;
    const jornadaSaida = cfg.jornadaSaida || '17:00';
    const [jsH, jsM] = jornadaSaida.split(':').map(Number);
    const jornadaSaidaMin = (jsH || 0) * 60 + (jsM || 0);
    const nowBrtMin = Math.floor(((now.getTime() - 3 * 3600000) % 86400000) / 60000);
    const minutosHoje = calcMinHoje(marcacoes, now);

    let estado = 'AUSENTE';
    if (marcacoes.length > 0) {
      const ultima = marcacoes[marcacoes.length - 1];
      if (ultima.tipo === 'ENTRADA') {
        estado = 'DENTRO';
      } else {
        estado = (minutosHoje >= cargaEsperadaMin - 30 || nowBrtMin >= jornadaSaidaMin)
          ? 'ENCERROU' : 'FORA_TEMP';
      }
    }

    res.json({
      funcionario: { id: funcionario.id, nome: funcionario.nome, cargo: funcionario.cargo },
      config: {
        jornadaEntrada: cfg.jornadaEntrada || '08:00',
        jornadaSaida,
        raioGps: cfg.raioGps || 80,
        lat: cfg.lat ?? null,
        lng: cfg.lng ?? null,
      },
      estado,
      minutosHoje,
      cargaEsperadaMin,
      proximoTipo: (!marcacoes.length || marcacoes[marcacoes.length - 1].tipo === 'SAIDA') ? 'ENTRADA' : 'SAIDA',
      marcacoes: marcacoes.map(m => ({
        id: m.id,
        tipo: m.tipo,
        horaFormatada: horaFormatadaBRT(m.timestamp),
        gpsPrecisaoSuspeita: m.gpsPrecisaoSuspeita,
        gpsNegado: m.gpsNegado,
      })),
    });
  } catch (error) {
    console.error('[portal] pontoHoje:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ─── POST /api/p/me/ponto ─────────────────────────────────────────────────────
export const registrarPonto = async (req: Request, res: Response) => {
  const lavadorId = (req as any).lavadorId as string | undefined;
  const dpFuncionarioId = (req as any).dpFuncionarioId as string | undefined;
  const empresaId = (req as any).empresaId as string;
  const { lat, lng, gpsPrecisao, gpsNegado = false } = req.body;

  try {
    const [funcionario, sistema] = await Promise.all([
      buscarDpFuncPorSessao(lavadorId, dpFuncionarioId, empresaId),
      prisma.empresaSistema.findFirst({
        where: { empresaId, sistema: 'data-point', ativo: true },
      }),
    ]);

    if (!funcionario) return res.status(404).json({ erro: 'Você não está cadastrado no Data Point.' });
    if (!sistema) return res.status(404).json({ erro: 'Data Point não ativo' });

    const cfg = sistema.config ? JSON.parse(sistema.config as string) : {};
    const { start, end } = getTodayRangeBRT();

    const marcacoesHoje = await prisma.dpMarcacao.findMany({
      where: { funcionarioId: funcionario.id, timestamp: { gte: start, lte: end } },
      orderBy: { timestamp: 'asc' },
    });

    const lastMarcacao = marcacoesHoje[marcacoesHoje.length - 1];
    const tipo = (!lastMarcacao || lastMarcacao.tipo === 'SAIDA') ? 'ENTRADA' : 'SAIDA';

    // Cooldown: 5 min entre marcações do mesmo tipo
    if (lastMarcacao && lastMarcacao.tipo === tipo) {
      const diffMin = (Date.now() - new Date(lastMarcacao.timestamp).getTime()) / 60000;
      if (diffMin < 5) {
        const wait = Math.ceil(5 - diffMin);
        return res.status(429).json({ erro: `Aguarde ${wait} minuto${wait !== 1 ? 's' : ''} para bater ponto novamente.` });
      }
    }

    // GPS: validação baseada em nivelGps (BASICO | MEDIO | RIGIDO | MAXIMO)
    let gpsPrecisaoSuspeita = false;
    let gpsForaRaio = false;
    const empLat = parseFloat(cfg.lat);
    const empLng = parseFloat(cfg.lng);
    const raioGps: number = cfg.raioGps || 80;
    const nivelGps: string = cfg.nivelGps || 'BASICO';
    const temLocEmpresa = !isNaN(empLat) && !isNaN(empLng);

    if (!gpsNegado && lat != null && lng != null && temLocEmpresa) {
      const dist = haversine(empLat, empLng, parseFloat(lat), parseFloat(lng));
      if (dist > raioGps)     gpsForaRaio = true;
      if (dist > raioGps * 3) gpsPrecisaoSuspeita = true; // muito longe = suspeito
    }
    // Precisão sub-metro é impossível em GPS real — indica mock GPS app
    if (gpsPrecisao != null && gpsPrecisao < 1) gpsPrecisaoSuspeita = true;

    // Aplicar bloqueio conforme nível de restrição
    if (temLocEmpresa) {
      if (nivelGps === 'RIGIDO' && !gpsNegado && gpsForaRaio) {
        return res.status(403).json({ erro: 'Você está fora da área autorizada para registrar ponto.' });
      }
      if (nivelGps === 'MAXIMO') {
        if (gpsNegado) {
          return res.status(403).json({ erro: 'GPS obrigatório para registro de ponto. Ative a localização e tente novamente.' });
        }
        if (gpsForaRaio) {
          return res.status(403).json({ erro: 'Você está fora da área autorizada para registrar ponto.' });
        }
      }
    }

    const marcacao = await prisma.dpMarcacao.create({
      data: {
        empresaId,
        funcionarioId: funcionario.id,
        tipo,
        canal: 'PWA',
        lat: lat != null ? parseFloat(lat) : null,
        lng: lng != null ? parseFloat(lng) : null,
        gpsPrecisao: gpsPrecisao != null ? parseFloat(gpsPrecisao) : null,
        gpsPrecisaoSuspeita,
        gpsNegado: Boolean(gpsNegado),
        ip: req.ip || null,
      },
    });

    res.json({
      ok: true,
      tipo,
      horaFormatada: horaFormatadaBRT(marcacao.timestamp),
      gpsPrecisaoSuspeita,
    });
  } catch (error) {
    console.error('[portal] registrarPonto:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ─── GET /api/p/me/ponto/espelho ─────────────────────────────────────────────
export const getEspelhoPortal = async (req: Request, res: Response) => {
  const lavadorId = (req as any).lavadorId as string | undefined;
  const dpFuncionarioId = (req as any).dpFuncionarioId as string | undefined;
  const empresaId = (req as any).empresaId as string;

  const { mes } = req.query as { mes?: string }; // YYYY-MM
  const agora = new Date();
  const anoAtual  = agora.getFullYear();
  const mesAtual  = agora.getMonth() + 1;
  const [ano, m] = mes
    ? mes.split('-').map(Number)
    : [anoAtual, mesAtual];

  try {
    const [funcionario, sistema] = await Promise.all([
      buscarDpFuncPorSessao(lavadorId, dpFuncionarioId, empresaId),
      prisma.empresaSistema.findFirst({
        where: { empresaId, sistema: 'data-point', ativo: true },
      }),
    ]);

    if (!funcionario) return res.status(404).json({ erro: 'Você não está cadastrado no Data Point desta empresa.' });
    if (!sistema)     return res.status(404).json({ erro: 'Data Point não ativo' });

    const cfg = sistema.config ? JSON.parse(sistema.config as string) : {};
    const toleranciaMin: number = cfg.toleranciaMin ?? 10;
    const cargaEsperadaMin = (funcionario.cargaHorariaDia ?? 8) * 60;

    // Dias do mês
    const diasNoMes = new Date(ano, m, 0).getDate();
    const diasDoMes: string[] = [];
    for (let d = 1; d <= diasNoMes; d++) {
      diasDoMes.push(`${ano}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
    }

    // Busca marcações do mês inteiro de uma vez
    const { start: mesStart } = getDateRangeBRT(diasDoMes[0]);
    const { end: mesEnd }     = getDateRangeBRT(diasDoMes[diasDoMes.length - 1]);

    const todasMarcacoes = await prisma.dpMarcacao.findMany({
      where: { funcionarioId: funcionario.id, timestamp: { gte: mesStart, lte: mesEnd } },
      select: { tipo: true, timestamp: true },
      orderBy: { timestamp: 'asc' },
    });

    const hoje = getTodayStrBRT();
    const now  = new Date();

    let totalMinutos = 0;
    let totalPresente = 0;
    let totalFalta = 0;
    let pendencias = 0; // incompletas + parciais

    const dias = diasDoMes.map(dia => {
      const diaSemana  = new Date(dia + 'T12:00:00').getDay(); // 0=dom
      const isFds      = diaSemana === 0 || diaSemana === 6;
      const isHoje     = dia === hoje;
      const isFuturo   = dia > hoje;

      const { start, end } = getDateRangeBRT(dia);
      const marcacoesDia   = todasMarcacoes.filter(
        mc => mc.timestamp >= start && mc.timestamp <= end,
      );

      if (isFuturo) {
        return { dia, diaSemana, status: 'FUTURO', minutosTrabalhou: 0, marcacoes: [] };
      }

      if (isFds && marcacoesDia.length === 0) {
        return { dia, diaSemana, status: 'FOLGA', minutosTrabalhou: 0, marcacoes: [] };
      }

      const fimCalculo     = isHoje ? now : end;
      const minutosTrabalhou = calcMinHoje(
        marcacoesDia.map(mc => ({ tipo: mc.tipo, timestamp: mc.timestamp })),
        fimCalculo,
      );

      const ultima     = marcacoesDia[marcacoesDia.length - 1];
      const incompleto = ultima?.tipo === 'ENTRADA' && !isHoje;

      const horaEntrada = marcacoesDia.find(mc => mc.tipo === 'ENTRADA');
      const ultimaSaida = [...marcacoesDia].reverse().find(mc => mc.tipo === 'SAIDA');

      let status: string;
      if (marcacoesDia.length === 0) {
        status = 'FALTA';
        totalFalta++;
      } else if (isHoje) {
        status = 'HOJE';
        totalMinutos += minutosTrabalhou;
      } else if (incompleto) {
        status = 'INCOMPLETO';
        pendencias++;
        totalMinutos += minutosTrabalhou;
      } else if (minutosTrabalhou >= cargaEsperadaMin - toleranciaMin) {
        status = 'PRESENTE';
        totalPresente++;
        totalMinutos += minutosTrabalhou;
      } else {
        status = 'FALTA_PARCIAL';
        pendencias++;
        totalMinutos += minutosTrabalhou;
      }

      return {
        dia,
        diaSemana,
        status,
        minutosTrabalhou,
        marcacoes: marcacoesDia.map(mc => ({
          tipo: mc.tipo,
          hora: horaFormatadaBRT(mc.timestamp),
        })),
        horaEntrada: horaEntrada ? horaFormatadaBRT(horaEntrada.timestamp) : null,
        horaSaida:   ultimaSaida ? horaFormatadaBRT(ultimaSaida.timestamp) : null,
      };
    });

    res.json({
      mes: { ano, mes: m },
      funcionario: { nome: funcionario.nome, cargo: funcionario.cargo, cargaEsperadaMin },
      resumo: { totalMinutos, totalPresente, totalFalta, pendencias },
      dias,
    });
  } catch (error) {
    console.error('[portal] espelhoPortal:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ─── POST /api/p/me/ajuste ───────────────────────────────────────────────────
export const criarAjustePortal = async (req: Request, res: Response) => {
  const lavadorId = (req as any).lavadorId as string | undefined;
  const dpFuncionarioId = (req as any).dpFuncionarioId as string | undefined;
  const empresaId = (req as any).empresaId as string;
  const { data, tipo, descricao } = req.body;

  if (!data || !tipo || !descricao?.trim())
    return res.status(400).json({ erro: 'data, tipo e descricao são obrigatórios' });

  const tiposValidos = ['JUSTIFICAR_FALTA', 'CORRIGIR_HORA', 'OUTRO'];
  if (!tiposValidos.includes(tipo))
    return res.status(400).json({ erro: 'Tipo inválido' });

  try {
    const funcionario = await buscarDpFuncPorSessao(lavadorId, dpFuncionarioId, empresaId);
    if (!funcionario)
      return res.status(404).json({ erro: 'Você não está cadastrado no Data Point desta empresa.' });

    const existente = await prisma.dpAjuste.findFirst({
      where: { funcionarioId: funcionario.id, data, status: 'PENDENTE' },
    });
    if (existente)
      return res.status(400).json({ erro: 'Já existe um ajuste pendente para este dia.' });

    const ajuste = await prisma.dpAjuste.create({
      data: {
        empresaId,
        funcionarioId: funcionario.id,
        data,
        tipo,
        descricao: descricao.trim(),
        updatedAt: new Date(),
      },
    });

    res.status(201).json({ ajuste });
  } catch (error) {
    console.error('[portal] criarAjuste:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ─── GET /api/p/me/ajustes ───────────────────────────────────────────────────
export const getAjustesPortal = async (req: Request, res: Response) => {
  const lavadorId = (req as any).lavadorId as string | undefined;
  const dpFuncionarioId = (req as any).dpFuncionarioId as string | undefined;
  const empresaId = (req as any).empresaId as string;

  try {
    const funcionario = await buscarDpFuncPorSessao(lavadorId, dpFuncionarioId, empresaId);
    if (!funcionario) return res.status(404).json({ erro: 'Não cadastrado no Data Point.' });

    const ajustes = await prisma.dpAjuste.findMany({
      where: { funcionarioId: funcionario.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json({ ajustes });
  } catch (error) {
    console.error('[portal] getAjustes:', error);
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
