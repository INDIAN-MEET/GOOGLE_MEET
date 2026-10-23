import Joi from "joi";

/**
 * Body of POST /v1/notifications/invites.
 *
 * - roomCode: the room the invitees are being invited to.
 * - emails:   1 to 50 addresses (duplicates are removed later).
 * - message:  optional personal note shown in the email (max 500 chars).
 * - hostName: optional display name shown as "X invited you".
 */
export const inviteSchema = Joi.object({
  roomCode: Joi.string().trim().min(3).max(64).required(),
  emails: Joi.array()
    .items(Joi.string().trim().lowercase().email({ tlds: { allow: false } }))
    .min(1)
    .max(50)
    .required(),
  message: Joi.string().trim().max(500).allow("").optional(),
  hostName: Joi.string().trim().max(80).allow("").optional(),
});