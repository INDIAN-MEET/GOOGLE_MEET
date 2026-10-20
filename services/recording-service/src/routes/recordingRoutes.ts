import { Router } from 'express';
import { startRecording, stopRecording } from '../controllers/recordingController.ts';
import {
  deleteRecording,
  downloadRecording,
  downloadSegment,
  getRecording,
  getThumbnail,
  listRecordings,
} from '../controllers/recordingQueryController.ts';
import { authGuard } from '../middleware/authGuard.ts';
import { validate } from '../middleware/validate.ts';
import {
  downloadQuerySchema,
  listRecordingsQuerySchema,
  recordingIdParamSchema,
  segmentParamSchema,
  startRecordingSchema,
} from '../validation/recordingSchemas.ts';
import { asyncHandler } from '../utils/asyncHandler.ts';

/**
 * User routes. authGuard runs first on every route.
 * Static paths ("/start") are declared before "/:id" routes.
 */
const router = Router();
router.use(authGuard);

router.post('/start', validate(startRecordingSchema), asyncHandler(startRecording));
router.post('/:id/stop', validate(recordingIdParamSchema, 'params'), asyncHandler(stopRecording));

router.get('/', validate(listRecordingsQuerySchema, 'query'), asyncHandler(listRecordings));
router.get('/:id', validate(recordingIdParamSchema, 'params'), asyncHandler(getRecording));
router.get(
  '/:id/download',
  validate(recordingIdParamSchema, 'params'),
  validate(downloadQuerySchema, 'query'),
  asyncHandler(downloadRecording),
);
router.get(
  '/:id/segments/:segmentId/download',
  validate(segmentParamSchema, 'params'),
  validate(downloadQuerySchema, 'query'),
  asyncHandler(downloadSegment),
);
router.get('/:id/thumbnail', validate(recordingIdParamSchema, 'params'), asyncHandler(getThumbnail));
router.delete('/:id', validate(recordingIdParamSchema, 'params'), asyncHandler(deleteRecording));

export default router;