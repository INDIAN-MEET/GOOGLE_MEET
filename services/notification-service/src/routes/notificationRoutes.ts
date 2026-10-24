import { Router } from "express";
import { createInviteController } from "../controllers/inviteController.ts";
import { authGuard } from "../middleware/authGuard.ts";
import { validateBody } from "../middleware/validate.ts";
import { inviteSchema } from "../validation/notificationSchemas.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

/** Mounted at `/v1/notifications` in app.ts. */
export const notificationRoutes = Router();

// POST /v1/notifications/invites
notificationRoutes.post(
  "/invites",
  authGuard,
  validateBody(inviteSchema),
  asyncHandler(createInviteController),
);