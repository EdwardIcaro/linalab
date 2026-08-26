import { Router } from 'express';
import {
  resolverTokenPublico,
  setupPin,
  verifyPin,
  portalSessionMiddleware,
  getDadosPortal,
  getExtratoPortal,
  getPontoHoje,
  gerarFaceTokenPortal,
  alterarPinPortal,
  removerPinPortal,
  registrarPonto,
  getEspelhoPortal,
  criarAjustePortal,
  getAjustesPortal,
  getExtratoLcPortal,
  gerarCodigoWpp,
  desvincularWpp,
  validarTokenPonto,
  confirmarPonto,
  validarTokenFace,
  confirmarFace,
  getFaceDoPonto,
} from '../controllers/portalPublicoController';
import { validarTotem, reconhecerTotem, confirmarTotem } from '../controllers/dpTotemPublicoController';

const router: Router = Router();

// Autenticadas — devem vir ANTES das rotas com :token para não colidir
router.get('/me/dados',        portalSessionMiddleware, getDadosPortal);
router.get('/me/extrato',      portalSessionMiddleware, getExtratoPortal);
router.get('/me/lc/extrato',   portalSessionMiddleware, getExtratoLcPortal);
router.get('/me/ponto/hoje',    portalSessionMiddleware, getPontoHoje);
router.post('/me/face-token',   portalSessionMiddleware, gerarFaceTokenPortal);
router.post('/me/pin/alterar',  portalSessionMiddleware, alterarPinPortal);
router.post('/me/pin/remover',  portalSessionMiddleware, removerPinPortal);
router.post('/me/ponto',        portalSessionMiddleware, registrarPonto);
router.get('/me/ponto/espelho', portalSessionMiddleware, getEspelhoPortal);
router.post('/me/ajuste',       portalSessionMiddleware, criarAjustePortal);
router.get('/me/ajustes',       portalSessionMiddleware, getAjustesPortal);

// Ponto via WhatsApp — token único gerado pelo bot (sem autenticação de sessão)
router.get('/ponto/validar',    validarTokenPonto);
router.get('/ponto/face',       getFaceDoPonto);
router.post('/ponto/confirmar', confirmarPonto);

// Cadastro do rosto — token pessoal gerado pelo gestor (uso único)
router.get('/face/validar',   validarTokenFace);
router.post('/face/confirmar', confirmarFace);

// Totem — aparelho pareado à empresa, reconhecimento facial 1:N
router.get('/totem/validar',    validarTotem);
router.post('/totem/reconhecer', reconhecerTotem);
router.post('/totem/confirmar',  confirmarTotem);

// Públicas (sem autenticação)
router.get('/:token',               resolverTokenPublico);
router.post('/:token/pin/setup',    setupPin);
router.post('/:token/pin/verify',   verifyPin);
router.post('/:token/wpp/codigo',      gerarCodigoWpp);
router.post('/:token/wpp/desvincular', desvincularWpp);

export default router;
