/**
 * Acompanhamento do veículo (15/11/2026): página pública do cliente + bloco no detalhe da ordem.
 * Regras em services/acompanhamentoService.ts.
 */

import { Request, Response } from 'express';
import { dadosPublicos, estadoAcomp, enviarAgora, naoEnviar } from '../services/acompanhamentoService';
import { verificarRateLimit } from '../utils/rateLimiter';

interface Req extends Request { empresaId?: string }

/** GET /api/v/:token — sem login; só o que o cliente pode ver. */
export async function getAcompanhamentoPublico(req: Request, res: Response) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  if (!verificarRateLimit(`acomp:${ip}`, 600, 60 * 60 * 1000)) return res.status(429).json({ error: 'Muitas consultas. Tente daqui a pouco.' });
  try {
    const token = String(req.params.token || '').toUpperCase();
    const d = await dadosPublicos(token, { equipe: req.query.equipe === '1' });
    if (!d) return res.status(404).json({ error: 'Link não encontrado.' });
    res.set('Cache-Control', 'no-store');
    return res.json(d);
  } catch (e) {
    console.error('[Acompanhamento] público:', (e as Error)?.message);
    return res.status(500).json({ error: 'Não foi possível carregar agora.' });
  }
}

/** GET /api/ordens/:id/acompanhamento */
export async function getAcompanhamentoOrdem(req: Req, res: Response) {
  try {
    const d = await estadoAcomp(req.params.id as string, req.empresaId!);
    if (!d) return res.status(404).json({ error: 'Ordem não encontrada' });
    return res.json(d);
  } catch (e) {
    console.error('[Acompanhamento] estado:', (e as Error)?.message);
    return res.status(500).json({ error: 'Erro ao carregar o acompanhamento' });
  }
}

/** POST /api/ordens/:id/acompanhamento/enviar — enviar agora / reenviar */
export async function postEnviarAcompanhamento(req: Req, res: Response) {
  try {
    const r = await enviarAgora(req.params.id as string, req.empresaId!);
    if (!r.ok) return res.status(400).json({ error: r.erro });
    return res.json(await estadoAcomp(req.params.id as string, req.empresaId!));
  } catch (e) {
    console.error('[Acompanhamento] enviar:', (e as Error)?.message);
    return res.status(500).json({ error: 'Erro ao enviar' });
  }
}

/** POST /api/ordens/:id/acompanhamento/nao-enviar */
export async function postNaoEnviarAcompanhamento(req: Req, res: Response) {
  try {
    if (!(await naoEnviar(req.params.id as string, req.empresaId!))) return res.status(404).json({ error: 'Ordem não encontrada' });
    return res.json(await estadoAcomp(req.params.id as string, req.empresaId!));
  } catch (e) {
    console.error('[Acompanhamento] não enviar:', (e as Error)?.message);
    return res.status(500).json({ error: 'Erro ao cancelar o envio' });
  }
}
