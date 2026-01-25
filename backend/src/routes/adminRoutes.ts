import { Router } from 'express';
import {
  getGlobalStats,
  listCompanies,
  getCompanyDetails,
  getRiskAlerts,
  getEngagement,
  toggleCompanyStatus,
} from '../controllers/adminController';

const router: Router = Router();

/**
 * Admin Routes
 * All routes are protected by adminMiddleware in index.ts
 * Only users with LINA_OWNER role can access these endpoints
 */

// Global platform statistics
router.get('/stats', getGlobalStats);

// Company management
router.get('/empresas', listCompanies);
router.get('/empresas/:id/details', getCompanyDetails);
router.patch('/empresas/:id/toggle-status', toggleCompanyStatus);

// Risk and engagement metrics
router.get('/alerts', getRiskAlerts);
router.get('/engagement', getEngagement);

export default router;
