import { Router } from 'express';
import { startRecording, stopRecording } from '../controllers/recordingController.ts';
import { authGuard } from '../middleware/authGuard.ts';
import { validate } from '../middleware/validate.ts';
import { recordingIdParamSchema, startRecordingSchema } from '../validation/recordingSchemas.ts';
import { asyncHandler } from '../utils/asyncHandler.ts';

/**
 * User routes. authGuard runs first on every route.
 * List, get, download, delete are added in Step 10.7.
 */
const router = Router();
router.use(authGuard);

router.post('/start', validate(startRecordingSchema), asyncHandler(startRecording));
router.post('/:id/stop', validate(recordingIdParamSchema, 'params'), asyncHandler(stopRecording));

export default router;