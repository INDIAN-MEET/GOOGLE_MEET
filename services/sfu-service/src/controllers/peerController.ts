import type { Request, Response, NextFunction } from 'express';
import AppError from '../utils/AppError.ts';
import { logger } from '../utils/logger.ts';
import { removePeer, getPeerCount } from '../mediasoup/peerManager.ts';
import { closeRoom } from '../mediasoup/roomManager.ts';
import { notifyPeerLeft } from '../recording/recordingManager.ts';

/**
 * leavePeerHandler(req, res, next)   -> POST /api/v1/sfu/peers/leave
 *
 * STEP 1: Read roomId and peerId from the request body.
 *
 * STEP 2: Validate both are non-empty strings, else AppError 400.
 *
 * STEP 3: removePeer() closes the transports and returns closedProducerIds.
 *         Already gone = still success (idempotent).
 *
 * STEP 3b (NEW): notifyPeerLeft() closes this peer's recording segments.
 *         It runs BEFORE closeRoom(), because the segments use the Router.
 *         If the room is now empty, it also stops the recording
 *         ("room-empty") and starts the webhook in the background.
 *         It never throws, so "leave" cannot fail because of recording.
 *
 * STEP 4: If the room became empty, check getPeerCount() AGAIN
 *         (race: a new peer may have joined) and only then closeRoom().
 *
 * STEP 5: Respond 200 with { closedProducerIds, roomClosed }.
 *
 * STEP 6: On any error, log it and pass it on. AppError keeps its status,
 *         anything else becomes 500.
 */
export async function leavePeerHandler(req: Request, res: Response, next: NextFunction) {
    try {
        // STEP 1
        const { roomId, peerId } = req.body ?? {};

        // STEP 2
        if (typeof roomId !== 'string' || typeof peerId !== 'string' || !roomId || !peerId) {
            throw new AppError('roomId and peerId are required', 400);
        }

        // STEP 3
        const { closedProducerIds, roomEmpty } = removePeer(roomId, peerId);

        // STEP 3b
        await notifyPeerLeft(roomId, peerId);

        // STEP 4
        let roomClosed = false;

        if (roomEmpty && getPeerCount(roomId) === 0) {
            await closeRoom(roomId);
            roomClosed = true;
        }

        // STEP 5
        res.status(200).json({
            success: true,
            data: { closedProducerIds, roomClosed },
        });
    } catch (err) {
        // STEP 6
        if (!(err instanceof AppError)) {
            logger.error({ err }, 'Failed to leave peer');
        }
        next(err instanceof AppError ? err : new AppError('Failed to leave peer', 500));
    }
}