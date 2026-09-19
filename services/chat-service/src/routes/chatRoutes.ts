import { Router } from 'express';
import { authGuard } from '../middleware/authGuard.ts';
import  getMessages  from '../controllers/getMessagesController.js';

const router = Router();

router.get('/:roomId/messages', authGuard, getMessages);

export default router;