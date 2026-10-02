import type { Request, Response, NextFunction } from 'express';
import AppError from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';
import { removePeer, getPeerCount } from '../mediasoup/peerManager.ts';
import { closeRoom } from '../mediasoup/roomManager.ts';


/**
 * leavePeerHandler(req, res, next)   -> POST /api/v1/sfu/peers/leave
 *
 * STEP 1: Read roomId and peerId from the request body.
 *
 * STEP 2: Validate both are non-empty strings.
 *         If not, throw AppError 400.
 *
 * STEP 3: Call removePeer(roomId, peerId).
 *         This closes the transports and returns closedProducerIds.
 *         If the peer was already gone, it still succeeds (idempotent).
 *
 * STEP 4: If the room became empty, check getPeerCount(roomId) AGAIN.
 *         Race: the last peer left and a new peer joined at the same
 *         moment. Only call closeRoom() when the count is still 0.
 *
 * STEP 5: Respond 200 with { closedProducerIds, roomClosed }.
 *         Signaling uses closedProducerIds to broadcast
 *         "producer-closed" and "peer-left" to the other browsers.
 *
 * STEP 6: On any error, log it and pass it to the error handler.
 *         AppError keeps its real status code, anything else becomes 500.
 *
 * @param {Request} req - Body: { roomId: string, peerId: string }.
 * @param {Response} res - Returns { success, data: { closedProducerIds, roomClosed } }.
 * @param {NextFunction} next - Express error handler hook.
 */

export async function leavePeerHandler(req: Request, res: Response, next: NextFunction) {
    try {
        const { roomId, peerId } = req.body ?? {}

        // STEP 2
        if (typeof roomId !== 'string' || typeof peerId !== 'string' || !roomId || !peerId) {
            throw new AppError('roomId and peerId are required', 400);
        }
        // STEP 3
        const { closedProducerIds, roomEmpty } = removePeer(roomId, peerId)
        // STEP 4
        let roomClosed = false

        if (roomEmpty && getPeerCount(roomId) === 0) {
            await closeRoom(roomId) // must not throw for an unknown room
            roomClosed = true;
        }
        // STEP 5
        res.status(200).json({
            success: true,
            data: { closedProducerIds, roomClosed },
        });

    } catch (err) {
        if (!(err instanceof AppError)) {
            logger.error({ err }, 'Failed to leave peer');
        }
        next(err instanceof AppError ? err : new AppError('Failed to leave peer', 500));
    }
}