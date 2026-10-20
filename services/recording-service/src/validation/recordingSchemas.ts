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