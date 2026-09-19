import Joi from 'joi';

export const createRoomSchema = Joi.object({
    title: Joi.string().max(100).optional()
});