import { Router } from 'express';
import { getHub } from '../controllers/hubController';

const router: Router = Router();

router.get('/', getHub);

export default router;
