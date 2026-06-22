export const calendarScopes = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export function baseUrl(req) {
  return String(process.env.AUTH_BROKER_BASE_URL || `https://${req.headers.host || ""}`).replace(/\/+$/, "");
}

export function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function parseBase64UrlJson(value = "") {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

export function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function googleClient() {
  const clientId = String(process.env.GOOGLE_CALENDAR_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("Google Calendar OAuth is not configured.");
  }
  return { clientId, clientSecret };
}

export function assertLocalReturnTo(returnTo) {
  const url = new URL(String(returnTo || ""));
  const localHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !localHost || !url.pathname.startsWith("/api/google-calendar/oauth/complete")) {
    throw new Error("Invalid OAuth return target.");
  }
  return url.toString();
}

export function sendHtml(res, html, status = 200) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(html);
}

export function postBackPage({ returnTo, state, tokenPayload = "", error = "" }) {
  const title = error ? "Google Calendar was not connected" : "Google Calendar connected";
  const body = error
    ? "Pillar Brief could not complete Google Calendar connection. Return to the app and try again."
    : "Pillar Brief can now read today's events. You can return to the desktop app.";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:48px;line-height:1.5;color:#111827}
    main{max-width:680px}.button{display:inline-flex;align-items:center;justify-content:center;margin-top:20px;border:0;border-radius:8px;background:#111827;color:#fff;text-decoration:none;font:inherit;font-weight:800;padding:12px 16px;cursor:pointer}
    p{font-size:18px;color:#374151}.muted{color:#6b7280}
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
    <p class="muted">Sending the result back to the local Pillar Brief app...</p>
    <form method="POST" action="${escapeHtml(returnTo)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <input type="hidden" name="token_payload" value="${escapeHtml(tokenPayload)}">
      <input type="hidden" name="error" value="${escapeHtml(error)}">
      <button class="button" type="submit">Return to Pillar Brief</button>
    </form>
  </main>
  <script>document.forms[0].submit();</script>
</body>
</html>`;
}

export async function exchangeGoogleToken(body) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `Google OAuth failed: ${response.status}`);
  }
  return payload;
}
