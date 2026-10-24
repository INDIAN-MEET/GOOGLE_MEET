import { env } from "../config/env.ts";
import { transporter } from "./transporter.ts";
import type { RenderedEmail } from "./templates.ts";

/**
 * Send one email through the shared SMTP transporter.
 * Throws on failure so the BullMQ worker can retry the job.
 *
 * @param to Recipient address.
 * @param email Rendered subject/text/html.
 * @returns The SMTP message id (useful for logs).
 */
export async function sendEmail(to: string, email: RenderedEmail): Promise<string> {
  const info = await transporter.sendMail({
    from: env.mailFrom,
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  return info.messageId;
}