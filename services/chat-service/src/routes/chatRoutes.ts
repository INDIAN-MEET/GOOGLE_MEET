import { Router } from 'express';
import { authGuard } from '../middleware/authGuard.js';
import { validateQuery } from '../middleware/validate.js';
import { getMessagesQuerySchema } from '../validation/chatSchemas.js';
import getMessages from '../controllers/getMessagesController.js';

const router = Router();

router.get('/:roomId/messages', authGuard, validateQuery(getMessagesQuerySchema), getMessages);

export default router;