import { assertLocalReturnTo, base64UrlJson, baseUrl, calendarScopes, googleClient } from "./_utils.js";

export default function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("allow", "GET");
      res.end("Method not allowed");
      return;
    }
    const { clientId } = googleClient();
    const state = String(req.query.state || "").trim();
    const returnTo = assertLocalReturnTo(req.query.return_to);
    if (!state) throw new Error("Missing OAuth state.");
    const scope = String(req.query.scope || calendarScopes.join(" ")).trim();
    const redirectUri = `${baseUrl(req)}/api/google/callback`;
    const brokerState = base64UrlJson({ state, returnTo, createdAt: Date.now() });
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      access_type: "offline",
      prompt: "consent",
      state: brokerState,
    })}`;
    res.statusCode = 302;
    res.setHeader("location", authUrl);
    res.end();
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(error.message || "Could not start Google Calendar OAuth.");
  }
}
