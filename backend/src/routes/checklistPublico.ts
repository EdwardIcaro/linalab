import { Router, Request, Response } from 'express';
import { verificarRateLimit } from '../utils/rateLimiter';
import { dadosPublicosChecklist, fotoPublicaChecklist } from '../services/checklistLocalizaService';
import { CHECKLIST_ITENS } from '../controllers/solicitacaoController';

// Página pública do checklist da Localiza (/c/CÓDIGO): sem login, só leitura, 90 dias
const router: Router = Router();
const ROTULOS = new Map(CHECKLIST_ITENS);

router.get('/:token', async (req: Request, res: Response) => {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  if (!verificarRateLimit(`ckloc:${ip}`, 300, 60 * 60 * 1000)) return res.status(429).json({ error: 'Muitas consultas. Tente daqui a pouco.' });
  try {
    const d = await dadosPublicosChecklist(String(req.params.token || '').toUpperCase(), ROTULOS);
    if (d === 'expirado') return res.status(410).json({ error: 'Este checklist não está mais disponível (90 dias).' });
    if (!d) return res.status(404).json({ error: 'Checklist não encontrado.' });
    res.set('Cache-Control', 'no-store');
    return res.json(d);
  } catch (e) {
    console.error('[ChecklistPublico]', (e as Error)?.message);
    return res.status(500).json({ error: 'Não foi possível carregar agora.' });
  }
});

router.get('/:token/foto/:fotoId', async (req: Request, res: Response) => {
  try {
    const f = await fotoPublicaChecklist(String(req.params.token || '').toUpperCase(), String(req.params.fotoId || ''));
    if (!f) return res.status(404).end();
    res.set('Content-Type', f.tipo);
    res.set('Cache-Control', 'public, max-age=604800, immutable'); // foto trocada ganha id novo
    return res.send(f.buffer);
  } catch {
    return res.status(500).end();
  }
});

export default router;
