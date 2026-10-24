import Joi from 'joi';

export const createRoomSchema = Joi.object({
    title: Joi.string().max(100).optional(),
    scheduledAt: Joi.date().iso().greater('now').optional()
});