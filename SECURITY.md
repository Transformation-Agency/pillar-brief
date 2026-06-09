# Security Policy

Pillar Brief is a local-first personal briefing app. It stores configured API
keys, Telegram pairing details, source history, generated briefs, and optional
audio/transcript artifacts in the local SQLite data directory.

## Supported Versions

Security fixes are handled on the current `main` branch until a formal release
policy is published.

## Reporting a Vulnerability

Please report security issues privately to Transformation Agency before opening
a public issue. Include:

- a short description of the issue
- affected version or commit
- reproduction steps
- whether any credentials, local data, or Telegram delivery paths are exposed

## Local Secrets

Never commit or publish:

- `data/`
- `src-tauri/resources/backend/`
- `src-tauri/binaries/`
- `src-tauri/target/`
- `.env`

The included `.gitignore` excludes those paths by default.
