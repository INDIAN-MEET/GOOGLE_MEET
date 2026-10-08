import Joi from 'joi';

/**
 * sfuSchemas.ts
 *
 * STEP 1: One reusable "id" rule: a required, trimmed string, 1-128 chars.
 *
 * STEP 2: One schema per endpoint, listing only the fields that
 *         endpoint needs. Nested objects (rtpParameters, dtlsParameters,
 *         rtpCapabilities) are only checked to be objects. Mediasoup
 *         validates their inside.
 *
 * STEP 3: Allowed values (direction, kind, source) are listed with
 *         .valid(), so "sideways" gives a clean 400.
 *
 * STEP 4: userId is optional. A value longer than 128 characters gets a clean 400.
 *
 * STEP 5 (NEW): recordingId becomes a folder name on disk, so only letters,
 *         numbers, "-" and "_" are allowed (same rule as in recordingManager).
 */
const id = Joi.string().trim().min(1).max(128).required();            // STEP 1

export const roomParamsSchema = Joi.object({ roomId: id });           // STEP 2
export const producersQuerySchema = Joi.object({
  exceptPeerId: Joi.string().trim().max(128).allow('').optional(),
});

export const createTransportSchema = Joi.object({
  roomId: id,
  peerId: id,
  direction: Joi.string().valid('send', 'recv').required(),           // STEP 3
});

export const connectTransportSchema = Joi.object({
  roomId: id,
  peerId: id,
  transportId: id,
  dtlsParameters: Joi.object().required(),
});

export const produceSchema = Joi.object({
  roomId: id,
  peerId: id,
  transportId: id,
  kind: Joi.string().valid('audio', 'video').required(),              // STEP 3
  rtpParameters: Joi.object().required(),
  source: Joi.string().valid('camera', 'mic', 'screen').required(),   // STEP 3
  userId: Joi.string().trim().max(128).optional(),                    // STEP 4
});

export const consumeSchema = Joi.object({
  roomId: id,
  peerId: id,
  producerId: id,
  rtpCapabilities: Joi.object().required(),
});

export const resumeConsumerSchema = Joi.object({
  roomId: id,
  peerId: id,
  consumerId: id,
});

export const leavePeerSchema = Joi.object({
  roomId: id,
  peerId: id,
});

// STEP 5
export const startRecordingSchema = Joi.object({
  roomId: id,
  recordingId: Joi.string().pattern(/^[\w-]{1,128}$/).required(),
});

export const stopRecordingSchema = Joi.object({
  roomId: id,
  reason: Joi.string().trim().max(64).optional(),
});