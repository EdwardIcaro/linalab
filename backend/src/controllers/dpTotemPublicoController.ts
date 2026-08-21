import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { verificarRateLimit } from '../utils/rateLimiter';
import { getTodayRangeBRT } from '../utils/dateUtils';
import { distanciaEuclidiana, embeddingValido } from '../utils/faceMatch';
import { determinarTipoEValidarCooldown } from '../utils/dpPontoUtils';
import { horaFormatadaBRT } from './portalPublicoController';

const JWT_SECRET = process.env.SECRET_KEY || 'seu_segredo_jwt_aqui';

// Reconhecimento 1:N — mais rígido que o 1:1 (THRESHOLD 0.55 em face.js), pois
// com N pessoas a chance de colisão acidental sobe. Exige também uma folga
// mínima entre o 1º e o 2º colocado para evitar match ambíguo entre rostos
// parecidos. Números de partida — calibrar depois de uso real.
const MATCH_THRESHOLD = 0.5;
const MATCH_GAP_MINIMO = 0.05;

// GET /api/p/totem/validar?t=TOKEN
export const validarTotem = async (req: Request, res: Response) => {
  const { t } = req.query as { t?: string };
  if (!t) return res.status(400).json({ erro: 'Token obrigatório' });

  try {
    const totem = await prisma.dpTotem.findUnique({
      where: { token: t },
      select: { nome: true, ativo: true, empresa: { select: { nome: true } } },
    });

    if (!totem) return res.status(404).json({ erro: 'Link inválido' });
    if (!totem.ativo) return res.status(403).json({ erro: 'Este totem foi desativado. Fale com o gestor.' });

    res.json({ empresaNome: totem.empresa.nome, totemNome: totem.nome });
  } catch (error) {
    console.error('[totem] validar:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// POST /api/p/totem/reconhecer — { token, embedding } → nunca expõe outros vetores
export const reconhecerTotem = async (req: Request, res: Response) => {
  const { token, embedding } = req.body as { token?: string; embedding?: unknown };
  if (!token) return res.status(400).json({ erro: 'Token obrigatório' });
  if (!embeddingValido(embedding)) return res.status(400).json({ erro: 'Leitura facial inválida' });

  if (!verificarRateLimit(`totem-reconhecer:${token}`, 40, 10 * 60 * 1000)) {
    return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  }

  try {
    const totem = await prisma.dpTotem.findUnique({
      where: { token },
      select: { id: true, empresaId: true, ativo: true },
    });
    if (!totem) return res.status(404).json({ erro: 'Link inválido' });
    if (!totem.ativo) return res.status(403).json({ erro: 'Este totem foi desativado. Fale com o gestor.' });

    const candidatos = await prisma.dpFuncionario.findMany({
      where: { empresaId: totem.empresaId, status: 'ATIVO', faceEmbedding: { not: null } },
      select: { id: true, nome: true, faceEmbedding: true },
    });

    let melhor: { id: string; nome: string; dist: number } | null = null;
    let segundaMelhorDist = Infinity;

    for (const c of candidatos) {
      const vetor = JSON.parse(c.faceEmbedding as string) as number[];
      const dist = distanciaEuclidiana(embedding, vetor);
      if (!melhor || dist < melhor.dist) {
        segundaMelhorDist = melhor ? melhor.dist : segundaMelhorDist;
        melhor = { id: c.id, nome: c.nome, dist };
      } else if (dist < segundaMelhorDist) {
        segundaMelhorDist = dist;
      }
    }

    if (!melhor || melhor.dist > MATCH_THRESHOLD) {
      return res.json({ match: false });
    }
    if (segundaMelhorDist - melhor.dist < MATCH_GAP_MINIMO) {
      // Rosto parecido demais com outro candidato — evita palpite ambíguo
      return res.json({ match: false });
    }

    const score = Math.max(0, Math.min(1, 1 - melhor.dist / MATCH_THRESHOLD * 0.5));
    const matchToken = jwt.sign(
      { tipo: 'totem_match', funcionarioId: melhor.id, empresaId: totem.empresaId, totemId: totem.id, score },
      JWT_SECRET,
      { expiresIn: '60s' }
    );

    res.json({ match: true, matchToken, nome: melhor.nome, score });
  } catch (error) {
    console.error('[totem] reconhecer:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// POST /api/p/totem/confirmar — { matchToken, lat?, lng?, gpsPrecisao? }
export const confirmarTotem = async (req: Request, res: Response) => {
  const { matchToken, lat, lng, gpsPrecisao } = req.body as {
    matchToken?: string; lat?: number; lng?: number; gpsPrecisao?: number;
  };
  if (!matchToken) return res.status(400).json({ erro: 'Token de confirmação obrigatório' });

  let payload: any;
  try {
    payload = jwt.verify(matchToken, JWT_SECRET);
    if (payload.tipo !== 'totem_match') throw new Error('tipo inválido');
  } catch {
    return res.status(401).json({ erro: 'Confirmação expirada. Escaneie novamente.' });
  }

  const { funcionarioId, empresaId, totemId, score } = payload as {
    funcionarioId: string; empresaId: string; totemId: string; score: number;
  };

  if (!verificarRateLimit(`totem-confirmar:${totemId}`, 60, 10 * 60 * 1000)) {
    return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  }

  try {
    const funcionario = await prisma.dpFuncionario.findFirst({
      where: { id: funcionarioId, empresaId, status: 'ATIVO' },
      select: { id: true, empresaId: true },
    });
    if (!funcionario) return res.status(404).json({ erro: 'Funcionário não encontrado' });

    const { start, end } = getTodayRangeBRT();
    const marcacoesHoje = await prisma.dpMarcacao.findMany({
      where: { funcionarioId: funcionario.id, timestamp: { gte: start, lte: end } },
      orderBy: { timestamp: 'asc' },
    });

    const { tipo, cooldownErro } = determinarTipoEValidarCooldown(marcacoesHoje);
    if (cooldownErro) return res.status(429).json({ erro: cooldownErro });

    const [marcacao] = await prisma.$transaction([
      prisma.dpMarcacao.create({
        data: {
          empresaId,
          funcionarioId: funcionario.id,
          tipo,
          canal: 'TOTEM',
          totemId,
          lat: lat ?? null,
          lng: lng ?? null,
          gpsPrecisao: gpsPrecisao ?? null,
          faceScore: score,
        },
      }),
      prisma.dpTotem.update({ where: { id: totemId }, data: { ultimoUsoEm: new Date() } }),
    ]);

    res.json({ ok: true, tipo, horaFormatada: horaFormatadaBRT(marcacao.timestamp) });
  } catch (error) {
    console.error('[totem] confirmar:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};
