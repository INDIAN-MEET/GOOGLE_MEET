import { Router } from 'express';
import { startRecording, stopRecording } from '../controllers/recordingController.js';
import { authGuard } from '../middleware/authGuard.js';
import { validate } from '../middleware/validate.js';
import { recordingIdParamSchema, startRecordingSchema } from '../validation/recordingSchemas.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * User routes. authGuard runs first on every route.
 * List, get, download, delete are added in Step 10.7.
 */
const router = Router();
router.use(authGuard);

router.post('/start', validate(startRecordingSchema), asyncHandler(startRecording));
router.post('/:id/stop', validate(recordingIdParamSchema, 'params'), asyncHandler(stopRecording));

export default router;