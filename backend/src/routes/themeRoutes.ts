import { Router } from 'express';
import { getThemeConfig, updateThemeConfig } from '../controllers/themeController';

const router: Router = Router();

/**
 * Theme Routes
 * All routes are protected by authMiddleware in index.ts
 * Requires valid empresa-scoped JWT token
 */

// Get current company's theme configuration
router.get('/config', getThemeConfig);

// Update company's theme configuration
router.patch('/config', updateThemeConfig);

export default router;
