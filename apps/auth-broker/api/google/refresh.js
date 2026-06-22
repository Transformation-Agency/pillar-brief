import { exchangeGoogleToken, googleClient } from "./_utils.js";

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("allow", "POST");
      res.end("Method not allowed");
      return;
    }
    const { clientId, clientSecret } = googleClient();
    const body = await readJson(req);
    const refreshToken = String(body.refresh_token || "").trim();
    if (!refreshToken) throw new Error("Missing Google refresh token.");
    const token = await exchangeGoogleToken(new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }));
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({
      access_token: token.access_token || "",
      expires_in: token.expires_in || 3600,
      token_type: token.token_type || "Bearer",
      scope: token.scope || "",
    }));
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ error: error.message || "Google token refresh failed." }));
  }
}
