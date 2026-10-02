import { Router } from 'express';
import { getRouterCapabilities } from '../controllers/routerController.ts';
import { createTransportHandler, connectTransportHandler } from '../controllers/transportController.ts';
import { produceHandler, listProducersHandler } from '../controllers/produceController.ts';
import { consumeHandler, resumeConsumerHandler } from '../controllers/consumeController.ts';
import { leavePeerHandler } from '../controllers/peerController.ts';

const router = Router();

router.get('/router-capabilities/:roomId', getRouterCapabilities);
router.post('/transports', createTransportHandler);
router.post('/transports/connect', connectTransportHandler);
router.post('/produce', produceHandler);
router.get('/producers/:roomId', listProducersHandler);
router.post('/consume', consumeHandler);
router.post('/consumer/resume', resumeConsumerHandler);
router.post('/peers/leave', leavePeerHandler);

export default router;