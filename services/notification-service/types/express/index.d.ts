import "express";

declare global {
  namespace Express {
    interface Request {
      /** Set by authGuard after the JWT is verified. */
      userId?: string;
      /** Raw access token, kept so we can forward it to room-service. */
      accessToken?: string;
    }
  }
}

export {};