import Joi from 'joi';

export const getMessagesQuerySchema = Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(50),
    before: Joi.date().iso()
});
