import { Router } from 'express';
import { authGuard } from '../middleware/authGuard.js';
import { validateMiddleware } from '../middleware/validate.js';
import { createRoomSchema } from '../validation/roomSchemas.js';
import { createRoomController } from '../controllers/createRoomController.js';
import { joinRoomController } from '../controllers/joinRoomController.js';
import { leaveRoomController } from '../controllers/leaveRoomController.js';
import { endRoomController } from '../controllers/endRoomController.js';
import { getRoomController } from '../controllers/getRoomController.js';

const router = Router();

/**
 * All routes below require a valid JWT access token.
 * `authGuard` runs first on every request in this router,
 * attaching `req.userId` or rejecting with 401 before any
 * controller logic runs.
 */
router.use(authGuard);

/**
 * @route   POST /rooms
 * @desc    Create a new room, hosted by the authenticated user
 * @access  Private (requires Bearer token)
 * @body    { title?: string }
 */
router.post('/rooms', validateMiddleware(createRoomSchema), createRoomController);

/**
 * @route   GET /rooms/:code
 * @desc    Fetch a room by its shareable code, including active participants
 * @access  Private (requires Bearer token)
 * @param   {string} code - room's shareable join code (URL param)
 */
router.get('/rooms/:code', getRoomController);

/**
 * @route   POST /rooms/:code/join
 * @desc    Add the authenticated user as a participant of an active room
 * @access  Private (requires Bearer token)
 * @param   {string} code - room's shareable join code (URL param)
 */
router.post('/rooms/:code/join', joinRoomController);

/**
 * @route   POST /rooms/:code/leave
 * @desc    Mark the authenticated user's participation as ended (sets leftAt)
 * @access  Private (requires Bearer token)
 * @param   {string} code - room's shareable join code (URL param)
 */
router.post('/rooms/:code/leave', leaveRoomController);

/**
 * @route   POST /rooms/:code/end
 * @desc    Permanently end a room. Only the host may perform this action.
 * @access  Private (requires Bearer token, host-only)
 * @param   {string} code - room's shareable join code (URL param)
 */
router.post('/rooms/:code/end', endRoomController);

export default router;