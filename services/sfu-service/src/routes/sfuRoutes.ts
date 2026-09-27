import { Router } from 'express';
import { getRouterCapabilities } from '../controllers/routerController.ts';
import { createTransportHandler, connectTransportHandler } from '../controllers/transportController.ts';

const router = Router();

router.get('/router-capabilities/:roomId', getRouterCapabilities);
router.post('/transports', createTransportHandler);
router.post('/transports/connect', connectTransportHandler);

export default router;