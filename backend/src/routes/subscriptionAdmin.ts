import { Router } from 'express';
import {
  listAllSubscriptions,
  getSubscriptionDetails,
  grantLifetimeSubscription,
  updateSubscriptionStatus,
  extendSubscription,
  listPlans,
  createPlan,
  updatePlan,
  togglePlanStatus,
  listAddons,
  createAddon,
  updateAddon,
  deleteAddon,
  toggleAddonStatus,
  getSubscriptionStats
} from '../controllers/subscriptionAdminController';

const router: Router = Router();

/**
 * Subscription Admin Routes
 * Protected by adminMiddleware in index.ts
 * Only LINA_OWNER can access
 */

// Gerenciar assinaturas
router.get('/subscriptions', listAllSubscriptions);
router.get('/subscriptions/:id', getSubscriptionDetails);
router.post('/subscriptions/lifetime', grantLifetimeSubscription);
router.patch('/subscriptions/:id/status', updateSubscriptionStatus);
router.post('/subscriptions/:id/extend', extendSubscription);

// Gerenciar planos
router.get('/plans', listPlans);
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.patch('/plans/:id/toggle', togglePlanStatus);

// Gerenciar add-ons
router.get('/addons', listAddons);
router.post('/addons', createAddon);
router.put('/addons/:id', updateAddon);
router.delete('/addons/:id', deleteAddon);
router.patch('/addons/:id/toggle', toggleAddonStatus);

// Estatísticas
router.get('/stats', getSubscriptionStats);

export default router;
