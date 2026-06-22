# Pillar Brief Auth Broker

Small Vercel app that keeps the Google Calendar OAuth client secret off the
desktop app. It does not use a database.

## Endpoints

- `GET /api/google/start` starts Google OAuth and carries the local desktop
  callback target in encoded state.
- `GET /api/google/callback` exchanges the Google code server-side, then
  auto-posts the token payload to the local Pillar Brief backend.
- `POST /api/google/refresh` refreshes Google access tokens using the broker's
  web OAuth client secret.

## Vercel

Create a Vercel project with this directory as the project root:

```txt
apps/auth-broker
```

Suggested custom domain:

```txt
auth.pillar.transformationagency.com
```

Environment variables:

```txt
AUTH_BROKER_BASE_URL=https://auth.pillar.transformationagency.com
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
```

Google Cloud OAuth client type should be **Web application** with this redirect
URI:

```txt
https://auth.pillar.transformationagency.com/api/google/callback
```
