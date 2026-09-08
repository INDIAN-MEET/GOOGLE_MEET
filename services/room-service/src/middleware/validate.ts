import { Request, Response, NextFunction } from "express"
import { ObjectSchema } from "joi"
import AppError from "../utils/AppError.js"
import logger from "../utils/logger.js"

/**  
 * * @param {ObjectSchema} schema
 * * @returns {Function}
 * * @description Validate middleware
 */
export const validateMiddleware = (schema: ObjectSchema) => {

    return (req: Request, res: Response, next: NextFunction) => {
        const { error } = schema.validate(req.body)

        if (error) {
            logger.error({ error, path: req.path, method: req.method }, 'Validation error');
            return next(new AppError(error.details[0].message, 400))
        }
        next()
    }


}