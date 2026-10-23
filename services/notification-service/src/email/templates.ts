import { env } from "../config/env.ts";

/** Shape returned by every template. */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Data both templates need. */
export interface EmailContext {
  roomCode: string;
  roomTitle?: string | null;
  hostName?: string | null;
  message?: string | null;
  meetingAt?: Date | null;
  /** For reminders: minutes until the meeting starts. */
  minutesBefore?: number;
}

/**
 * Escape characters that have special meaning in HTML.
 *
 * @param s Untrusted text (title, host name, personal message).
 * @returns Text that is safe to embed inside HTML.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "'")
    .replace(/'/g, "'");
}

/**
 * Build the join link placed in every email.
 *
 * @param roomCode Room code, URL-encoded for safety.
 * @returns Absolute URL, for example http://localhost:5173/room/abc-defg-hij.
 */
export function joinUrl(roomCode: string): string {
  return `${env.frontendUrl}/room/${encodeURIComponent(roomCode)}`;
}

/**
 * Format a date as a readable UTC string. (A later improvement is storing the
 * recipient's timezone. UTC is explicit and never wrong.)
 *
 * @param d Meeting start time.
 * @returns For example "Mon, 26 Oct 2026, 14:30 UTC".
 */
function formatWhen(d: Date): string {
  return (
    d.toLocaleString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}

/**
 * Shared HTML layout so both emails look consistent.
 *
 * @param heading Large title at the top.
 * @param bodyHtml Inner HTML (already escaped by the caller).
 * @param url Join link used for the button.
 * @param buttonLabel Text on the button.
 */
function layout(heading: string, bodyHtml: string, url: string, buttonLabel: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
    <tr><td>
      <h2 style="margin:0 0 16px;color:#202124;">${heading}</h2>
      ${bodyHtml}
      <p style="margin:24px 0;">
        <a href="${url}" style="background:#1a73e8;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">${buttonLabel}</a>
      </p>
      <p style="color:#5f6368;font-size:12px;">Or paste this link into your browser:<br>${url}</p>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Render the invitation email.
 *
 * @param ctx Room and host details.
 * @returns Subject, text and HTML bodies.
 */
export function renderInvite(ctx: EmailContext): RenderedEmail {
  const title = ctx.roomTitle?.trim() || `Room ${ctx.roomCode}`;
  const host = ctx.hostName?.trim() || "Someone";
  const url = joinUrl(ctx.roomCode);
  const when = ctx.meetingAt ? formatWhen(ctx.meetingAt) : "now (open the link any time)";

  const subject = `${host} invited you to "${title}"`;

  const text = [
    `${host} invited you to join "${title}".`,
    `When: ${when}`,
    ctx.message ? `\nMessage: ${ctx.message}` : "",
    `\nJoin: ${url}`,
  ].join("\n");

  const html = layout(
    "You are invited",
    `<p style="color:#3c4043;"><b>${esc(host)}</b> invited you to <b>${esc(title)}</b>.</p>
     <p style="color:#3c4043;">When: <b>${esc(when)}</b></p>
     ${ctx.message ? `<p style="color:#3c4043;border-left:3px solid #dadce0;padding-left:12px;">${esc(ctx.message)}</p>` : ""}`,
    url,
    "Join meeting",
  );

  return { subject, text, html };
}

/**
 * Render the reminder email.
 *
 * @param ctx Room details plus `minutesBefore` and `meetingAt`.
 * @returns Subject, text and HTML bodies.
 */
export function renderReminder(ctx: EmailContext): RenderedEmail {
  const title = ctx.roomTitle?.trim() || `Room ${ctx.roomCode}`;
  const url = joinUrl(ctx.roomCode);
  const mins = ctx.minutesBefore ?? 5;
  const when = ctx.meetingAt ? formatWhen(ctx.meetingAt) : "soon";

  const subject = `Reminder: "${title}" starts in ${mins} minutes`;

  const text = `"${title}" starts in ${mins} minutes (${when}).\n\nJoin: ${url}`;

  const html = layout(
    `Starting in ${mins} minutes`,
    `<p style="color:#3c4043;"><b>${esc(title)}</b> starts at <b>${esc(when)}</b>.</p>`,
    url,
    "Join meeting",
  );

  return { subject, text, html };
}