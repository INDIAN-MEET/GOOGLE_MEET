import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.ts';

/**
 * devCors(req, res, next)
 *
 * STEP 1: If NODE_ENV is not "development", do nothing.
 *         In production there is no CORS at all.
 *
 * STEP 2: Allow ONE exact origin (DEV_CORS_ORIGIN, default
 *         http://localhost:3000), never "*".
 *         Other origins get no CORS headers, so the browser blocks them.
 *
 * STEP 3: Allow only the methods and headers the test page needs:
 *         Content-Type and x-internal-secret.
 *
 * STEP 4: Answer the browser's OPTIONS preflight with 204 right here.
 *         The preflight carries no secret, so it must be answered
 *         BEFORE authGuard, or it would get a 401 and the real request
 *         would never be sent.
 */

export function devCors(req: Request, res: Response, next: NextFunction) {
    // STEP 1
    if (env.nodeEnv !== 'development') return next();

    // STEP 2
    if (req.headers.origin === env.devCorsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', env.devCorsOrigin);
        res.setHeader('Vary', 'Origin');

        // STEP 3
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-internal-secret');
    }

    // STEP 4
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }
    next();
}
