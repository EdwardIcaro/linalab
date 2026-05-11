import { Router } from 'express';
import {
  resolverTokenPublico,
  setupPin,
  verifyPin,
  portalSessionMiddleware,
  getDadosPortal,
  getExtratoPortal,
  getPontoHoje,
  registrarPonto,
} from '../controllers/portalPublicoController';

const router: Router = Router();

// Autenticadas — devem vir ANTES das rotas com :token para não colidir
router.get('/me/dados',        portalSessionMiddleware, getDadosPortal);
router.get('/me/extrato',      portalSessionMiddleware, getExtratoPortal);
router.get('/me/ponto/hoje',   portalSessionMiddleware, getPontoHoje);
router.post('/me/ponto',       portalSessionMiddleware, registrarPonto);

// Públicas (sem autenticação)
router.get('/:token',             resolverTokenPublico);
router.post('/:token/pin/setup',  setupPin);
router.post('/:token/pin/verify', verifyPin);

export default router;
