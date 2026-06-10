<p align="center">
  <img src="public/assets/readme-logo-banner.svg" alt="Pillar Brief" width="720" />
</p>

<p align="center">
  <strong>A self-hosted desktop app that turns your sources into scheduled daily intelligence briefs, with optional Telegram delivery.</strong>
</p>

<p align="center">
  by
  <a href="https://transformationagency.com">
    <img src="public/assets/ta-logo.png" alt="" width="18" />
    <strong>Transformation Agency</strong>
  </a>
</p>

<p align="center">
  <a href="https://github.com/Transformation-Agency/pillar-brief/releases/download/v0.1.0/Pillar.Brief_0.1.0_aarch64.dmg">
    <img src="https://img.shields.io/badge/Download-M--series%20Macs-black?style=for-the-badge&logo=apple" alt="Download for M-series Macs" />
  </a>
  <a href="https://github.com/Transformation-Agency/pillar-brief/releases/download/v0.1.0/Pillar.Brief_0.1.0_x64.dmg">
    <img src="https://img.shields.io/badge/Download-Intel%20Macs-333333?style=for-the-badge&logo=apple" alt="Download for Intel Macs" />
  </a>
  <a href="https://github.com/Transformation-Agency/pillar-brief/releases/download/v0.1.0/Pillar.Brief_0.1.0_x64-setup.exe">
    <img src="https://img.shields.io/badge/Download-Windows-0078D4?style=for-the-badge" alt="Download for Windows" />
  </a>
</p>

<p align="center">
  <a href="#features">Features</a>
  · <a href="#quick-start">Quick Start</a>
  · <a href="#configuration">Configuration</a>
  · <a href="#desktop-app">Desktop App</a>
  · <a href="#security-and-data">Security</a>
</p>

---

## What It Does

Pillar Brief watches the sources you care about, filters for items published
today, synthesizes them through your brief setup, saves the artifact locally,
and delivers the result as a brief to you every day, with optional Telegram
integration.

It is built for people who want a daily briefing system they can tune:
topics, tone, model provider, source mix, section prompts, delivery schedule,
and Telegram destination.

## Features

- First-run onboarding for name, model key, brief intent, suggested sources,
  Telegram pairing, and delivery schedule
- Local SQLite storage for settings, sources, brief artifacts, run history, and
  audit logs
- OpenAI, Anthropic, OpenRouter, Gemini, and custom OpenAI-compatible model settings
- Source adapters for RSS, web pages, Reddit, X search, podcasts, YouTube, and
  newsletters
- Locked X quick mode to reduce API usage
- Today-only source selection for generated briefs
- Editable brief setup with section-level prompts
- Scheduled and manual generation
- Automatic Telegram delivery in Markdown
- Tauri desktop packaging for a local macOS app

## Quick Start

### Requirements

- Required: Node.js 24 or newer
- Required: npm
- Optional for desktop: Rust and Tauri platform prerequisites
- Optional for podcast transcription: FFmpeg
- Optional for local speech-to-text: whisper.cpp `whisper-cli` and a ggml model
- Optional integrations: OpenAI, Anthropic, OpenRouter, Telegram, and X

### Install

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The onboarding flow will walk you through model setup, source setup, Telegram
pairing, and delivery schedule.

## Optional System Dependencies

### Desktop Builds

Desktop packaging uses Tauri, which requires Rust and platform build tools.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
npm install
npm run desktop:dev
```

For full setup instructions, see the
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

### Podcast Transcription

Podcast transcription can use local whisper.cpp speech-to-text or an
OpenAI-compatible cloud transcription fallback. Long podcast audio also
requires FFmpeg so the server can split/convert media before transcription.

macOS:

```bash
brew install ffmpeg
```

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install ffmpeg
```

Verify:

```bash
ffmpeg -version
```

### Local Speech-To-Text

For local voice input and offline transcription, install or bundle
[whisper.cpp](https://github.com/ggml-org/whisper.cpp). The app looks for a
`whisper-cli` binary and a ggml model.

Self-hosted example:

```bash
WHISPER_CPP_PATH=/opt/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL_PATH=/opt/whisper.cpp/models/ggml-tiny.en.bin
```

Desktop release builds can place assets under `vendor/whisper` before running
`npm run desktop:build`:

```text
vendor/whisper/bin/whisper-cli
vendor/whisper/models/ggml-tiny.en.bin
```

If the binary is present but the model is missing, Settings can download the
default `tiny.en` model into the app data directory.

### Web-Only Use

For the normal self-hosted web app, you only need Node.js 24 or newer and npm.

## Configuration

Pillar Brief can be configured through the app UI or environment variables.

Common environment variables:

```bash
HOST=127.0.0.1
PORT=5173
PILLAR_DATA_DIR=./data
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
CUSTOM_MODEL_API_KEY=
GEMINI_API_KEY=
WHISPER_CPP_PATH=
WHISPER_MODEL_PATH=
```

Credentials entered in the UI are stored in the local SQLite database. For
self-hosted deployments, prefer a private data volume and an `.env` file that
is never committed.

## Telegram Pairing

Pillar Brief uses Telegram bot deep links so users do not need to manually find
or paste a chat ID.

1. Create a bot with [@BotFather](https://t.me/BotFather).
2. Paste the BotFather token into Pillar Brief.
3. Open the generated Telegram link or scan the QR code.
4. Tap Start.
5. Pillar Brief stores the chat ID locally and sends a confirmation message.

## Desktop App

The Tauri wrapper packages the same local web app and backend into a desktop
application.

```bash
npm run desktop:dev
npm run desktop:build
```

The desktop app stores data in the platform app data directory by default.

## Security And Data

Pillar Brief can run as a self-hosted desktop app, and it stores sensitive
configuration locally.

Do not commit or share:

- `data/`
- `.env`
- `src-tauri/resources/backend/`
- `src-tauri/binaries/`
- `src-tauri/target/`

The local SQLite database can contain model API keys, X bearer tokens, Telegram
bot tokens, Telegram chat IDs, generated briefs, normalized source items, and
podcast/audio artifacts.

## Scripts

```bash
npm run dev              # start the local web app
npm run start            # production-mode local server
npm run build            # build frontend assets
npm run check            # production build check
npm run desktop:dev      # run Tauri desktop app
npm run desktop:build    # build Tauri desktop app
```

## License

MIT © 2026 [Transformation Agency](https://transformationagency.com)
