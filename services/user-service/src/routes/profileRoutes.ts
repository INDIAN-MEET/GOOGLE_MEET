import { Router } from 'express';
import { authGuard } from '../middleware/authGuard.js';
import { validateMiddleware } from '../middleware/validate.js';
import { updateProfileSchema } from '../validation/profileSchemas.js';
import { meController } from '../controllers/meController.js';
import { updateProfileController } from '../controllers/updateProfileController.js';

const router = Router();

router.get('/me', authGuard, meController);
router.patch('/me', authGuard, validateMiddleware(updateProfileSchema), updateProfileController);

export default router;