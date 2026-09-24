import { Router } from 'express';
import { getRouterCapabilities } from '../controllers/routerController.ts';

const router = Router();

router.get('/router-capabilities/:roomId', getRouterCapabilities)

export default router;