import { Request, Response, NextFunction } from 'express';
import { ChatMessage } from '../models/ChatMessage.js';
import { successResponse } from '../utils/response.js';
import AppError from '../utils/AppError.js';

async function getMessages(req: Request, res: Response, next: NextFunction) {
    try {
        const { roomId } = req.params;
        const limit = Math.min(Number(req.query.limit) || 50, 200);

        const messages = await ChatMessage.find({ roomId })
            .sort({ createdAt: 1 })
            .limit(limit)
            .lean()

        successResponse(res, { messages });

    } catch (err: any) {
        next(new AppError('Failed to fetch chat history', 500));
    }
}

export default getMessages