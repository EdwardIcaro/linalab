import { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';

// Compara hashes de tamanho fixo: não vaza o segredo pelo tempo de resposta
function segredoConfere(recebido: string, esperado: string): boolean {
  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

export function botAuth(req: Request, res: Response, next: NextFunction) {
  // Lido na hora (não no import) pra não depender da ordem do dotenv.config()
  const BOT_SECRET = process.env.BOT_SECRET;

  // Fail-closed: sem segredo configurado nada passa. Antes liberava TODAS as rotas
  // (enviar mensagem, pareamento…) pela URL pública do ngrok.
  if (!BOT_SECRET) {
    console.error('[BotAuth] BOT_SECRET não configurado — recusando requisição.');
    return res.status(503).json({ error: 'Serviço indisponível' });
  }

  const recebido = req.headers['x-bot-secret'];
  if (typeof recebido !== 'string' || !segredoConfere(recebido, BOT_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}
