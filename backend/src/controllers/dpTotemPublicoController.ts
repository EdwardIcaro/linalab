import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { verificarRateLimit } from '../utils/rateLimiter';
import { getTodayRangeBRT } from '../utils/dateUtils';
import { distanciaEuclidiana, embeddingValido } from '../utils/faceMatch';
import { determinarTipoEValidarCooldown } from '../utils/dpPontoUtils';
import { notificarPontoRegistrado } from '../services/dpPontoNotifier';
import { horaFormatadaBRT, haversine } from './portalPublicoController';
import { getTodayStrBRT } from '../utils/dateUtils';
import {
  resolverCargaHorariaDia, cargaDaJornada, calcMinutosTrabalhados,
  ehSaidaFinalProvavel, horaParaMin,
} from '../utils/dpPontoUtils';
import { getDateRangeBRT } from '../utils/dateUtils';
import { montarEspelhoMes, diasQuePedemAtencao } from '../services/dpEspelhoService';
import {
  montarSnapshot, hashDoSnapshot, estadoDaAssinatura,
  competenciaAnterior, nomeDaCompetencia, dentroDaJanelaDeConferencia,
} from '../services/dpAssinaturaService';

const JWT_SECRET = process.env.SECRET_KEY || 'seu_segredo_jwt_aqui';

// Reconhecimento 1:N — mais rígido que o 1:1 (THRESHOLD 0.55 em face.js), pois
// com N pessoas a chance de colisão acidental sobe. Exige também uma folga
// mínima entre o 1º e o 2º colocado para evitar match ambíguo entre rostos
// parecidos. Números de partida — calibrar depois de uso real.
const MATCH_THRESHOLD = 0.5;
const MATCH_GAP_MINIMO = 0.05;

/**
 * Contexto de cálculo do funcionário: a config da empresa e a carga que vale pra ele.
 * Vive aqui porque três handlers do totem precisam do mesmo par.
 */
async function contextoDoFuncionario(empresaId: string, funcionarioId: string) {
  const [sistema, func] = await Promise.all([
    prisma.empresaSistema.findFirst({ where: { empresaId, sistema: 'data-point', ativo: true }, select: { config: true } }),
    prisma.dpFuncionario.findUnique({
      where: { id: funcionarioId },
      select: { id: true, nome: true, cargaHorariaDia: true, cargoRef: { select: { cargaHorariaDia: true } } },
    }),
  ]);
  if (!sistema || !func) return null;
  const cfg = sistema.config ? JSON.parse(sistema.config as string) : {};
  const cargaEsperadaMin = resolverCargaHorariaDia(
    func.cargaHorariaDia,
    func.cargoRef?.cargaHorariaDia,
    cargaDaJornada(cfg.jornadaEntrada, cfg.jornadaSaida, cfg.intervaloMin),
  ) * 60;
  return { cfg, func, cargaEsperadaMin };
}

/** Já mostramos a conferência para essa pessoa hoje? Uma vez por dia basta. */
async function jaMostrouHoje(empresaId: string, funcionarioId: string, hoje: string): Promise<boolean> {
  const existe = await (prisma as any).notificacaoEnviada.findUnique({
    where: { empresaId_tipo_chave: { empresaId, tipo: 'DP_ESPELHO_TOTEM', chave: `${funcionarioId}:${hoje}` } },
    select: { id: true },
  });
  return !!existe;
}

async function registrarQueMostrou(empresaId: string, funcionarioId: string, hoje: string): Promise<void> {
  await (prisma as any).notificacaoEnviada.upsert({
    where: { empresaId_tipo_chave: { empresaId, tipo: 'DP_ESPELHO_TOTEM', chave: `${funcionarioId}:${hoje}` } },
    create: { empresaId, tipo: 'DP_ESPELHO_TOTEM', chave: `${funcionarioId}:${hoje}` },
    update: {},
  });
}

/**
 * Há espelho esperando ciência? Devolve a competência e por quê (nunca assinada, ou
 * assinada e alterada depois). Mês sem nenhuma batida não conta: não há o que conferir.
 */
async function espelhoPendente(
  empresaId: string,
  funcionarioId: string,
  tipoBatida: string,
  marcacoesDoDia: { tipo: string; timestamp: Date }[],
) {
  // Na entrada, não: a pessoa está indo trabalhar
  if (tipoBatida !== 'SAIDA') return null;

  const hoje = getTodayStrBRT();
  if (await jaMostrouHoje(empresaId, funcionarioId, hoje)) return null;

  const ctx = await contextoDoFuncionario(empresaId, funcionarioId);
  if (!ctx) return null;

  // Saída do almoço tem a mesma pressa da entrada — só a última do dia interrompe
  const inicioDia = getDateRangeBRT(hoje).start;
  const ehFinal = ehSaidaFinalProvavel({
    minutosTrabalhados: calcMinutosTrabalhados(marcacoesDoDia, null),
    agoraMin: Math.floor((Date.now() - inicioDia.getTime()) / 60000),
    saidaMin: horaParaMin(ctx.cfg.jornadaSaida || '17:00'),
    cargaMin: ctx.cargaEsperadaMin,
    toleranciaMin: ctx.cfg.toleranciaMin ?? 10,
  });
  if (!ehFinal) return null;

  const competencia = competenciaAnterior(hoje);
  const snapshot = await montarSnapshot(empresaId, { id: funcionarioId, cargaEsperadaMin: ctx.cargaEsperadaMin }, competencia, ctx.cfg);
  if (snapshot.marcacoes.length === 0) return null;

  const hash = hashDoSnapshot(snapshot);
  const estado = await estadoDaAssinatura(funcionarioId, competencia, hash);
  if (estado?.atual) return null;

  // Fora da janela só passa quem já assinou e teve o espelho alterado depois — esse
  // aviso é pontual e não pode esperar o mês que vem.
  const alterado = !!estado;
  if (!alterado && !dentroDaJanelaDeConferencia(hoje)) return null;

  await registrarQueMostrou(empresaId, funcionarioId, hoje);

  return {
    competencia,
    mes: nomeDaCompetencia(competencia),
    motivo: estado ? 'ALTERADO' : 'PENDENTE',
    assinadoAntesEm: estado?.assinadoEm ?? null,
    ctx,
  };
}

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

    // 18h para trás: cobre o dia inteiro em qualquer horário e ainda alcança o turno
    // da véspera, para a batida da madrugada ser reconhecida como saída
    const { start } = getTodayRangeBRT();
    const desde = new Date(Date.now() - 18 * 3600000);
    const marcacoesRecentes = await prisma.dpMarcacao.findMany({
      where: { funcionarioId: funcionario.id, timestamp: { gte: desde }, excluidaEm: null },
      orderBy: { timestamp: 'asc' },
    });
    const marcacoesHoje = marcacoesRecentes.filter(m => m.timestamp >= start);

    const { tipo, cooldownErro } = determinarTipoEValidarCooldown(marcacoesRecentes);
    if (cooldownErro) return res.status(429).json({ erro: cooldownErro });

    // O totem é um aparelho pareado à empresa e por isso não bloqueia por distância —
    // mas mede e guarda: se um dia o tablet sair de lá, o histórico mostra.
    const cfgEmpresa = await prisma.empresaSistema.findFirst({
      where: { empresaId, sistema: 'data-point', ativo: true },
      select: { config: true },
    });
    const cfgTotem = cfgEmpresa?.config ? JSON.parse(cfgEmpresa.config as string) : {};
    const empLat = parseFloat(cfgTotem.lat);
    const empLng = parseFloat(cfgTotem.lng);
    const raioGps: number = cfgTotem.raioGps || 80;
    let distanciaM: number | null = null;
    if (lat != null && lng != null && !isNaN(empLat) && !isNaN(empLng)) {
      distanciaM = Math.round(haversine(empLat, empLng, lat, lng));
    }

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
          distanciaM,
          foraDoRaio: distanciaM != null && distanciaM > raioGps,
          faceScore: score,
        },
      }),
      prisma.dpTotem.update({ where: { id: totemId }, data: { ultimoUsoEm: new Date() } }),
    ]);

    const horaFormatada = horaFormatadaBRT(marcacao.timestamp);

    // Confirmação no WhatsApp do funcionário (fire-and-forget)
    notificarPontoRegistrado(funcionario.id, tipo, horaFormatada).catch(() => {});

    // Depois de bater o ponto é o momento em que a pessoa está aqui, com tempo de olhar.
    // Falha nessa consulta não pode atrapalhar o registro que já aconteceu.
    let espelho: any = null;
    try {
      // inclui a batida que acabou de ser criada, senão o dia fica um turno atrás
      const doDia = [...marcacoesHoje, { tipo: marcacao.tipo, timestamp: marcacao.timestamp }];
      const pendente = await espelhoPendente(empresaId, funcionario.id, tipo, doDia);
      if (pendente) {
        espelho = {
          competencia: pendente.competencia,
          mes: pendente.mes,
          motivo: pendente.motivo,
          // vale 5 min: tempo de conferir os dias sem deixar a sessão aberta no tablet
          token: jwt.sign(
            { tipo: 'totem_espelho', funcionarioId: funcionario.id, empresaId, competencia: pendente.competencia, score },
            JWT_SECRET,
            { expiresIn: '5m' },
          ),
        };
      }
    } catch (e) {
      console.error('[totem] espelho pendente:', e);
    }

    res.json({ ok: true, tipo, horaFormatada, espelho });
  } catch (error: any) {
    // P2002 = índice único por minuto: duplo toque no totem, dois requests em paralelo
    if (error?.code === 'P2002') {
      return res.status(429).json({ erro: 'Seu ponto já foi registrado agora há pouco.' });
    }
    console.error('[totem] confirmar:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

/** Valida o token curto emitido depois do reconhecimento facial. */
function lerTokenEspelho(t?: string) {
  if (!t) return null;
  try {
    const payload: any = jwt.verify(t, JWT_SECRET);
    if (payload.tipo !== 'totem_espelho') return null;
    return payload as { funcionarioId: string; empresaId: string; competencia: string; score: number };
  } catch {
    return null;
  }
}

// GET /api/p/totem/espelho?t=TOKEN — o que a pessoa precisa conferir antes de assinar
export const espelhoTotem = async (req: Request, res: Response) => {
  const payload = lerTokenEspelho(req.query.t as string | undefined);
  if (!payload) return res.status(401).json({ erro: 'Sessão expirada. Escaneie novamente.' });

  try {
    const ctx = await contextoDoFuncionario(payload.empresaId, payload.funcionarioId);
    if (!ctx) return res.status(404).json({ erro: 'Funcionário não encontrado' });

    const [ano, mes] = payload.competencia.split('-').map(Number);
    const espelho = await montarEspelhoMes({
      empresaId: payload.empresaId,
      funcionarioId: payload.funcionarioId,
      cargaEsperadaMin: ctx.cargaEsperadaMin,
      ano, mes, cfg: ctx.cfg,
    });

    // Numa tela de totem, com gente esperando, a lista inteira do mês não ajuda: o que
    // precisa de conferência são os dias fora do normal.
    const atencao = diasQuePedemAtencao(espelho);

    res.json({
      nome: ctx.func.nome,
      competencia: payload.competencia,
      mes: nomeDaCompetencia(payload.competencia),
      resumo: espelho.resumo,
      cargaEsperadaMin: espelho.cargaEsperadaMin,
      diasAtencao: atencao.slice(0, 12),
      totalAtencao: atencao.length,
    });
  } catch (error) {
    console.error('[totem] espelho:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// POST /api/p/totem/espelho/assinar — { t }
export const assinarEspelhoTotem = async (req: Request, res: Response) => {
  const payload = lerTokenEspelho(req.body?.t as string | undefined);
  if (!payload) return res.status(401).json({ erro: 'Sessão expirada. Escaneie novamente.' });

  try {
    const ctx = await contextoDoFuncionario(payload.empresaId, payload.funcionarioId);
    if (!ctx) return res.status(404).json({ erro: 'Funcionário não encontrado' });

    const snapshot = await montarSnapshot(
      payload.empresaId,
      { id: payload.funcionarioId, cargaEsperadaMin: ctx.cargaEsperadaMin },
      payload.competencia,
      ctx.cfg,
    );
    const hashConteudo = hashDoSnapshot(snapshot);

    const jaAssinado = await estadoDaAssinatura(payload.funcionarioId, payload.competencia, hashConteudo);
    if (jaAssinado?.atual) return res.json({ ok: true, jaAssinado: true });

    await prisma.dpEspelhoAssinatura.create({
      data: {
        empresaId: payload.empresaId,
        funcionarioId: payload.funcionarioId,
        competencia: payload.competencia,
        hashConteudo,
        conteudo: JSON.stringify(snapshot),
        origem: 'TOTEM',
        faceScore: payload.score ?? null,
        ip: req.ip || null,
      },
    });

    res.json({ ok: true, mes: nomeDaCompetencia(payload.competencia) });
  } catch (error) {
    console.error('[totem] assinarEspelho:', error);
    res.status(500).json({ erro: 'Erro interno' });
  }
};
