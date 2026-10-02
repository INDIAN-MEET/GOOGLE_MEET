import { Router } from 'express';
import { getRouterCapabilities } from '../controllers/routerController.ts';
import { createTransportHandler, connectTransportHandler } from '../controllers/transportController.ts';
import { produceHandler, listProducersHandler } from '../controllers/produceController.ts';
import { consumeHandler, resumeConsumerHandler } from '../controllers/consumeController.ts';
import { leavePeerHandler } from '../controllers/peerController.ts';
import { validate } from '../middleware/validate.ts';
import {
  roomParamsSchema, producersQuerySchema, createTransportSchema,
  connectTransportSchema, produceSchema, consumeSchema,
  resumeConsumerSchema, leavePeerSchema,
} from '../validation/sfuSchemas.ts';

/**
 * sfuRoutes.ts
 *
 * STEP 1: Create the router. app.ts mounts it at /api/v1/sfu behind
 *         authGuard, so every route below already needs the secret.
 *
 * STEP 2: On every route, validate(...) runs BEFORE the controller.
 *         Bad input stops there with a 400, so the controller only
 *         sees data of the right shape.
 *         - validate(schema)            -> checks req.body
 *         - validate(schema, 'params')  -> checks the URL part (:roomId)
 *         - validate(schema, 'query')   -> checks ?exceptPeerId=...
 *
 * STEP 3: Router capabilities. Only :roomId is checked.
 *
 * STEP 4: Transports. Create needs roomId, peerId, direction.
 *         Connect needs transportId and dtlsParameters too.
 *
 * STEP 5: Produce and list producers.
 *         The list route checks both the URL param and the query string.
 *
 * STEP 6: Consume and resume. Both are called by the receiving peer.
 *
 * STEP 7: Peer leave. Called by Signaling on leave-room and disconnect.
 *         It is idempotent, so a peer that is already gone still gets 200.
 *
 * STEP 8: Export the router.
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
export default router;