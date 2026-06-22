import { assertLocalReturnTo, base64UrlJson, baseUrl, exchangeGoogleToken, googleClient, parseBase64UrlJson, postBackPage, sendHtml } from "./_utils.js";

export default async function handler(req, res) {
  let state = "";
  let returnTo = "";
  try {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("allow", "GET");
      res.end("Method not allowed");
      return;
    }
    const brokerState = parseBase64UrlJson(req.query.state || "");
    state = String(brokerState.state || "");
    returnTo = assertLocalReturnTo(brokerState.returnTo);
    if (!state || !returnTo) throw new Error("Invalid OAuth state.");
    if (req.query.error) {
      return sendHtml(res, postBackPage({ returnTo, state, error: String(req.query.error) }), 400);
    }
    const code = String(req.query.code || "");
    if (!code) throw new Error("Missing Google OAuth code.");
    const { clientId, clientSecret } = googleClient();
    const redirectUri = `${baseUrl(req)}/api/google/callback`;
    const token = await exchangeGoogleToken(new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }));
    const tokenPayload = base64UrlJson({
      refresh_token: token.refresh_token || "",
      access_token: token.access_token || "",
      expires_in: token.expires_in || 3600,
      token_type: token.token_type || "Bearer",
      scope: token.scope || "",
    });
    return sendHtml(res, postBackPage({ returnTo, state, tokenPayload }));
  } catch (error) {
    if (returnTo && state) {
      return sendHtml(res, postBackPage({ returnTo, state, error: error.message || "Google Calendar OAuth failed." }), 400);
    }
    res.statusCode = 400;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(error.message || "Google Calendar OAuth failed.");
  }
}
