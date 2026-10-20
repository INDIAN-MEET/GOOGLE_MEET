import { Router } from 'express';
import { captureEnded } from '../controllers/internalController.ts';
import { internalGuard } from '../middleware/internalGuard.ts';
import { validate } from '../middleware/validate.ts';
import { captureEndedSchema, recordingIdParamSchema } from '../validation/recordingSchemas.ts';
import { asyncHandler } from '../utils/asyncHandler.ts';

/**
 * Internal routes called by SFU service.
 * Protected by internalGuard (x-internal-secret).
 */
const router = Router();
router.use(internalGuard);

router.post(
  '/:id/capture-ended',
  validate(recordingIdParamSchema, 'params'),
  validate(captureEndedSchema),
  asyncHandler(captureEnded),
);

export default router;