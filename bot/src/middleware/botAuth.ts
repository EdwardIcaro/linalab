import { Request, Response, NextFunction } from 'express';

const BOT_SECRET = process.env.BOT_SECRET;

export function botAuth(req: Request, res: Response, next: NextFunction) {
  if (!BOT_SECRET) {
    console.warn('[BotAuth] BOT_SECRET não configurado — endpoint desprotegido!');
    return next();
  }
  const secret = req.headers['x-bot-secret'];
  if (secret !== BOT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}
