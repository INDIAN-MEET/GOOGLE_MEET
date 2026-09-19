import Joi from 'joi';

export const updateProfileSchema = Joi.object({
  displayName: Joi.string().max(50).optional(),
  avatarUrl: Joi.string().uri().optional(),
  preferences: Joi.string().optional(),
});