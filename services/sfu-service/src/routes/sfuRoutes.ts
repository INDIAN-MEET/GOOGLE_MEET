import { Router } from 'express';
import { getRouterCapabilities } from '../controllers/routerController.ts';
import { createTransportHandler, connectTransportHandler } from '../controllers/transportController.ts';
import { produceHandler, listProducersHandler } from '../controllers/produceController.ts';
import { consumeHandler, resumeConsumerHandler } from '../controllers/consumeController.ts';
import { leavePeerHandler } from '../controllers/peerController.ts';
import { startRecordingHandler, stopRecordingHandler } from '../controllers/recordingController.ts';
import { validate } from '../middleware/validate.ts';
import {
  roomParamsSchema, producersQuerySchema, createTransportSchema,
  connectTransportSchema, produceSchema, consumeSchema,
  resumeConsumerSchema, leavePeerSchema,
  startRecordingSchema, stopRecordingSchema,
} from '../validation/sfuSchemas.ts';

/**
 * sfuRoutes.ts
 *
 * STEP 1: Create the router. app.ts mounts it at /api/v1/sfu behind
 *         authGuard, so every route below already needs the secret.
 *
 * STEP 2: On every route, validate(...) runs BEFORE the controller.
 *         Bad input stops there with a 400.
 *
 * STEP 3: Router capabilities. Only :roomId is checked.
 *
 * STEP 4: Transports (create, connect).
 *
 * STEP 5: Produce and list producers.
 *
 * STEP 6: Consume and resume.
 *
 * STEP 7: Peer leave. Idempotent.
 *
 * STEP 8 (NEW): Recording start and stop. Called by recording-service
 *         (internal only, same secret as everything else).
 *
 * STEP 9: Export the router.
 */

// STEP 1
const router = Router();

// STEP 3
router.get(
  '/router-capabilities/:roomId',
  validate(roomParamsSchema, 'params'),
  getRouterCapabilities,
);

// STEP 4
router.post('/transports', validate(createTransportSchema), createTransportHandler);
router.post('/transports/connect', validate(connectTransportSchema), connectTransportHandler);

// STEP 5
router.post('/produce', validate(produceSchema), produceHandler);
router.get(
  '/producers/:roomId',
  validate(roomParamsSchema, 'params'),
  validate(producersQuerySchema, 'query'),
  listProducersHandler,
);

// STEP 6
router.post('/consume', validate(consumeSchema), consumeHandler);
router.post('/consumer/resume', validate(resumeConsumerSchema), resumeConsumerHandler);

// STEP 7
router.post('/peers/leave', validate(leavePeerSchema), leavePeerHandler);

// STEP 8
router.post('/recordings/start', validate(startRecordingSchema), startRecordingHandler);
router.post('/recordings/stop', validate(stopRecordingSchema), stopRecordingHandler);

// STEP 9
export default router;