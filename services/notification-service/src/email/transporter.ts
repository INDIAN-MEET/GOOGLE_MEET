import nodemailer from "nodemailer";
import { env } from "../config/env.ts";

/**
 * Shared Nodemailer transporter.
 * In dev (Mailpit) there is no auth, so `auth` is left undefined.
 */
export const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.secure, // true for port 465, false for 587/1025
  pool: true,
  maxConnections: 5,
  auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
});

/**
 * Verify that the SMTP server is reachable. Used by the /ready endpoint.
 *
 * @returns true if the SMTP handshake succeeds, false otherwise.
 */
export async function smtpIsReady(): Promise<boolean> {
  try {
    await transporter.verify();
    return true;
  } catch {
    return false;
  }
}