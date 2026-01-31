import { Router } from 'express';
import {
  createPaymentPreference,
  handleWebhook,
  getPaymentStatus,
  retryPayment
} from '../controllers/paymentController';
import userAuthMiddleware from '../middlewares/userAuthMiddleware';
import express from 'express';

const router = Router();

/**
 * POST /api/payments/create-preference
 * Criar preferência de pagamento (checkout)
 * Auth: userAuthMiddleware
 */
router.post('/create-preference', userAuthMiddleware, createPaymentPreference);

/**
 * GET /api/payments/status/:paymentId
 * Verificar status de um pagamento
 * Auth: userAuthMiddleware
 */
router.get('/status/:paymentId', userAuthMiddleware, getPaymentStatus);

/**
 * POST /api/payments/retry-payment
 * Retentar pagamento falhado
 * Auth: userAuthMiddleware
 */
router.post('/retry-payment', userAuthMiddleware, retryPayment);

/**
 * POST /api/payments/webhook
 * Webhook do Mercado Pago (IPN)
 * Auth: Nenhuma (validação por assinatura)
 */
router.post('/webhook', handleWebhook);

export default router;
