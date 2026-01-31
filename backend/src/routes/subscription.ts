import { Router } from 'express';
import {
  getAvailablePlans,
  getMySubscription,
  getPricingBreakdown,
  createSubscription,
  cancelMySubscription,
  upgradePlan,
  downgradePlan,
  getAvailableAddons,
  addAddon,
  removeAddon,
  renewSubscription,
  getPaymentHistory
} from '../controllers/subscriptionController';

const router: Router = Router();

/**
 * Subscription Routes (Protected by userAuthMiddleware in index.ts)
 * Accessible to all authenticated users
 */

// Planos
router.get('/plans', getAvailablePlans);

// Minha assinatura
router.get('/my-subscription', getMySubscription);
router.get('/pricing-breakdown', getPricingBreakdown);
router.post('/subscribe', createSubscription);
router.post('/renew', renewSubscription);
router.post('/cancel', cancelMySubscription);

// Upgrade/Downgrade
router.post('/upgrade', upgradePlan);
router.post('/downgrade', downgradePlan);

// Add-ons
router.get('/addons', getAvailableAddons);
router.post('/addons', addAddon);
router.delete('/addons/:addonId', removeAddon);

// Histórico
router.get('/payment-history', getPaymentHistory);

export default router;
