import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { TURN_SECRET, TURN_REALM } from '../config/env.js';
import { successResponse } from '../utils/response.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

/**
 * Generates short-lived TURN credentials (coturn's REST API auth scheme).
 * username = expiry timestamp; credential = HMAC-SHA1(username, sharedSecret).
 * coturn independently recomputes this to validate — no credential is
 * ever stored or registered ahead of time.
 */

export function getTurnCredentials(req: Request, res: Response, next: NextFunction) {
    try {
        const ttlSeconds = 600; // 10 minutes
        const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
        const username = `${expiry}:${req.userId}`

        const hmac = crypto.createHmac('sha1', TURN_SECRET)
        hmac.update(username)
        const credential = hmac.digest('base64')

        logger.info(`Generated TURN credentials for userId: ${req.userId}`)

        successResponse(res, {
            iceServers: [
                { urls: 'stun:localhost:3478' },
                {
                    urls: 'turn:localhost:3478',
                    username,
                    credential,
                },
            ],
        });

    } catch (err: any) {
        logger.error(`Failed to generate TURN credentials for userId: ${req.userId}`, err)
        next(new AppError('Failed to generate TURN credentials', 500))
    }
}