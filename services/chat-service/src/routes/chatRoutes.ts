import { Router } from 'express';
import { authGuard } from '../middleware/authGuard.ts';
import { validateQuery } from '../middleware/validate.ts';
import { getMessagesQuerySchema } from '../validation/chatSchemas.ts';
import getMessages from '../controllers/getMessagesController.ts';

const router = Router();

router.get('/:roomId/messages', authGuard, validateQuery(getMessagesQuerySchema), getMessages);

export default router;