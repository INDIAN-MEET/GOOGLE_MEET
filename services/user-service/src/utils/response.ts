import { Response } from "express"

export const successResponse = (
    res: Response,
    data: object,
    statusCode: number = 200,
    message: string = 'Request successful'
) => {
    return res.status(statusCode).json({
        success: true,
        data,
        message
    })
}