# Pillar Brief Setup Guide

Use this guide when setting up a fresh desktop or self-hosted Pillar Brief install.

## Model Provider

Pillar Brief needs one hosted model provider for brief generation, analyzer synthesis, source suggestions, and perspective lens generation. Model providers charge separately from Pillar Brief, so confirm billing or credits in the provider dashboard before expecting requests to run.

Recommended defaults:

- OpenAI: `gpt-5.4-mini`
- Grok: `grok-4.3`

Provider links:

- OpenAI API keys: https://platform.openai.com/api-keys
- OpenAI API key help: https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key
- Anthropic API keys: https://console.anthropic.com/settings/keys
- Anthropic API overview: https://docs.anthropic.com/en/api/overview
- OpenRouter API keys: https://openrouter.ai/settings/keys
- OpenRouter authentication docs: https://openrouter.ai/docs/api-reference/authentication
- Gemini API keys: https://aistudio.google.com/app/apikey
- Gemini model docs: https://ai.google.dev/gemini-api/docs/models
- xAI Console for Grok API keys: https://console.x.ai/
- xAI model docs: https://docs.x.ai/docs/models

## Telegram Delivery

Telegram is optional. You can always read briefs in the app without connecting a bot.

1. Open Telegram's BotFather token tutorial: https://core.telegram.org/bots/tutorial#obtain-your-bot-token
2. Create a bot with BotFather and copy the API token.
3. Paste the token into Pillar Brief.
4. In Telegram, open a chat with your new bot and tap Start.
5. When Pillar Brief shows a pairing code, send that code to the bot.

If pairing says another process is polling the bot, close any other Pillar Brief desktop windows or self-hosted servers using the same bot token, then try again.

## Source Integrations

Basic web, RSS, Reddit, YouTube, and podcast source setup can work without extra source API keys. Some source types are better with dedicated credentials.

- X API access: https://developer.x.com/en/portal/dashboard
- X API getting access docs: https://docs.x.com/x-api/getting-started/getting-access
- FFmpeg install page: https://formulae.brew.sh/formula/ffmpeg
- Homebrew install page: https://brew.sh

If a suggested source requires credentials you do not want to add during onboarding, skip that prerequisite and Pillar Brief will remove that source from the first-run setup.

## Optional Audio

ElevenLabs is optional and enables text-to-speech playback and Telegram audio delivery.

- ElevenLabs API keys: https://elevenlabs.io/app/settings/api-keys
- ElevenLabs text-to-speech API docs: https://elevenlabs.io/docs/api-reference/text-to-speech/stream

Local voice input uses the bundled whisper.cpp command and tiny English model in desktop builds. Self-hosted web deployments can configure their own whisper.cpp path and model path with `WHISPER_CPP_PATH` and `WHISPER_MODEL_PATH`.
