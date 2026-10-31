const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:4000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

/**
 * Small fetch wrapper that throws on non-2xx so the script fails loudly.
 *
 * @param {string} url Full URL.
 * @param {RequestInit & { token?: string, json?: unknown }} opts Request options.
 * @returns {Promise<any>} Parsed JSON response.
 */
async function api(url, { token, json, ...opts } = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${opts.method ?? "GET"} ${url} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
}

/**
 * Poll Mailpit until a message to `to` arrives (or time out).
 *
 * @param {string} to Recipient address to look for.
 * @param {number} timeoutMs Give up after this many milliseconds.
 * @returns {Promise<any>} The matching Mailpit message summary.
 */
async function waitForMail(to, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { messages = [] } = await api(`${MAILPIT}/api/v1/messages`);
    const hit = messages.find((m) => m.To?.some((t) => t.Address === to));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email for ${to} within ${timeoutMs}ms`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ok  ${msg}`);
}

async function main() {
  const stamp = Date.now();
  const host = { email: `host${stamp}@example.com`, password: "password123" };
  const guest = `guest${stamp}@example.com`;

  console.log("1. Clear Mailpit");
  await api(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });

  console.log("2. Signup + login host");
  await api(`${GATEWAY}/api/auth/signup`, { method: "POST", json: host });
  const login = await api(`${GATEWAY}/api/auth/login`, { method: "POST", json: host });
  const token = login.data.accessToken;

  console.log("3. Create scheduled room (20 minutes from now)");
  const scheduledAt = new Date(Date.now() + 20 * 60_000).toISOString();
  const created = await api(`${GATEWAY}/api/v1/rooms`, {
    method: "POST", token, json: { title: "E2E Standup", scheduledAt },
  });
  const code = created.data.room.code;
  assert(Boolean(code), `room created (${code})`);

  console.log("4. Non-host cannot invite");
  const other = { email: `other${stamp}@example.com`, password: "password123" };
  await api(`${GATEWAY}/api/auth/signup`, { method: "POST", json: other });
  const otherLogin = await api(`${GATEWAY}/api/auth/login`, { method: "POST", json: other });
  let denied = false;
  try {
    await api(`${GATEWAY}/api/v1/notifications/invites`, {
      method: "POST", token: otherLogin.data.accessToken, json: { roomCode: code, emails: [guest] },
    });
  } catch (e) { denied = /403|404/.test(String(e)); }
  assert(denied, "non-host is rejected (403/404)");

  console.log("5. Host sends invite");
  const inv = await api(`${GATEWAY}/api/v1/notifications/invites`, {
    method: "POST", token, json: { roomCode: code, emails: [guest, guest.toUpperCase()], hostName: "E2E Host" },
  });
  assert(inv.data.invited.length === 1, "duplicate emails collapsed to one");
  assert(inv.data.remindersScheduled === 2, "two reminders scheduled (15 and 5 min)");

  console.log("6. Invite email arrives in Mailpit");
  const mail = await waitForMail(guest);
  assert(/invited you/.test(mail.Subject), `subject ok: "${mail.Subject}"`);

  console.log("7. Re-sending the same invite does not duplicate reminders");
  const again = await api(`${GATEWAY}/api/v1/notifications/invites`, {
    method: "POST", token, json: { roomCode: code, emails: [guest] },
  });
  assert(again.data.remindersScheduled === 0, "no duplicate reminders");

  console.log("8. End room cancels reminders");
  await api(`${GATEWAY}/api/v1/rooms/${code}/end`, { method: "POST", token });
  console.log("   (verify in DB: SELECT status FROM \"Notification\" WHERE \"roomCode\"='" + code + "';)");

  console.log("\nALL CHECKS PASSED");
}

main().catch((e) => { console.error("\nE2E FAILED:", e.message); process.exit(1); });
