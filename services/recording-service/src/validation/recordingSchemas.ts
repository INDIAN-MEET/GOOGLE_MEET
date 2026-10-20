import Joi from 'joi';

/** POST /recordings/start body */
export const startRecordingSchema = Joi.object({
  roomCode: Joi.string().trim().max(64).required(),
});

/** :id in the URL must be a UUID */
export const recordingIdParamSchema = Joi.object({
  id: Joi.string().guid().required(),
});

/** Webhook body from the SFU (section 4.4 of the guide) */
export const captureEndedSchema = Joi.object({
  recordingStartedAtMs: Joi.number().required(),
  recordingEndedAtMs: Joi.number().required(),
  reason: Joi.string().optional(),
  segments: Joi.array()
    .items(
      Joi.object({
        index: Joi.number().integer().min(0).required(),
        peerId: Joi.string().required(),
        userId: Joi.string().allow(null, '').optional(),
        source: Joi.string().valid('camera', 'screen').required(),
        hasVideo: Joi.boolean().required(),
        hasAudio: Joi.boolean().required(),
        file: Joi.string().required(),
        startedAtMs: Joi.number().required(),
        endedAtMs: Joi.number().required(),
      }),
    )
    .required(),
});

/** :id and :segmentId in the URL must both be UUIDs */
export const segmentParamSchema = Joi.object({
  id: Joi.string().guid().required(),
  segmentId: Joi.string().guid().required(),
});

/** GET /recordings query: filters and pagination */
export const listRecordingsQuerySchema = Joi.object({
  roomCode: Joi.string().trim().max(64).optional(),
  status: Joi.string().valid('STARTING', 'RECORDING', 'STOPPING', 'PROCESSING', 'READY', 'FAILED').optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

/** GET /recordings/:id/download and /segments/:id/download query */
export const downloadQuerySchema = Joi.object({
  segmentId: Joi.string().guid().optional(),
  download: Joi.boolean().truthy('1').falsy('0').default(false),
});