import express from "express";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const appMode = process.env.PILLAR_APP_MODE || (process.env.PILLAR_DESKTOP ? "desktop" : "web");
const isDesktop = appMode === "desktop";
const dataDir = process.env.PILLAR_DATA_DIR ? path.resolve(process.env.PILLAR_DATA_DIR) : path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = process.env.PILLAR_DB_PATH ? path.resolve(process.env.PILLAR_DB_PATH) : path.join(dataDir, "pillar-brief.sqlite");
const execFileAsync = promisify(execFile);
const audioDir = path.join(dataDir, "audio");
fs.mkdirSync(audioDir, { recursive: true });
const modelsDir = path.join(dataDir, "models");
fs.mkdirSync(modelsDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      locator TEXT NOT NULL,
      cadence TEXT NOT NULL DEFAULT 'Daily',
      status TEXT NOT NULL DEFAULT 'active',
      approval_status TEXT NOT NULL DEFAULT 'approved',
      credentials_status TEXT NOT NULL DEFAULT 'missing',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS normalized_items (
      id TEXT PRIMARY KEY,
      source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
      canonical_url TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      fingerprint TEXT NOT NULL,
      relevance_score REAL NOT NULL DEFAULT 0,
      rising_score REAL NOT NULL DEFAULT 0,
      first_seen_at TEXT,
      last_seen_at TEXT,
      last_used_at TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Note',
      visibility TEXT NOT NULL DEFAULT 'private',
      status TEXT NOT NULL DEFAULT 'active',
      tags TEXT NOT NULL DEFAULT '[]',
      body TEXT NOT NULL DEFAULT '',
      word_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      body TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lenses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL,
      schema_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS councils (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      synthesis_prompt TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS council_members (
      council_id TEXT NOT NULL REFERENCES councils(id) ON DELETE CASCADE,
      lens_id TEXT NOT NULL REFERENCES lenses(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (council_id, lens_id)
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      steps_json TEXT NOT NULL DEFAULT '[]',
      artifact_json TEXT NOT NULL DEFAULT '{}',
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS approval_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      risk TEXT NOT NULL DEFAULT 'low',
      status TEXT NOT NULL DEFAULT 'pending',
      run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      resolved_by TEXT,
      resolved_at TEXT,
      resolution_note TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      diff_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS telegram_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bot_token TEXT NOT NULL DEFAULT '',
      chat_id TEXT NOT NULL DEFAULT '',
      allowed_users TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      last_error TEXT,
      update_offset INTEGER NOT NULL DEFAULT 0,
      recent_commands TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL DEFAULT 'openai',
      model TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connector_credentials (
      provider TEXT PRIMARY KEY,
      api_key TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tts_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL DEFAULT 'elevenlabs',
      voice_id TEXT NOT NULL DEFAULT '',
      voice_name TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT 'eleven_multilingual_v2',
      telegram_auto_send INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS brief_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      owner_name TEXT NOT NULL DEFAULT 'You',
      product_name TEXT NOT NULL DEFAULT 'Pillar Brief',
      audience_context TEXT NOT NULL DEFAULT '',
      voice_rules TEXT NOT NULL DEFAULT '',
      delivery_frequency TEXT NOT NULL DEFAULT 'Daily',
      delivery_time TEXT NOT NULL DEFAULT '08:00',
      delivery_timezone TEXT NOT NULL DEFAULT 'America/Denver',
      delivery_day TEXT NOT NULL DEFAULT 'Monday',
      section_schema_json TEXT NOT NULL DEFAULT '[]',
      analyzers_json TEXT NOT NULL DEFAULT '[]',
      analyzer_behavior TEXT NOT NULL DEFAULT '',
      perspective_lenses_json TEXT NOT NULL DEFAULT '[]',
      perspective_lenses_migrated INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS onboarding_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      current_step TEXT NOT NULL DEFAULT 'welcome',
      brief_prompt TEXT NOT NULL DEFAULT '',
      source_suggestions_json TEXT NOT NULL DEFAULT '[]',
      brief_config_draft_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram_pairing_sessions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'waiting',
      bot_username TEXT NOT NULL DEFAULT '',
      deep_link TEXT NOT NULL DEFAULT '',
      chat_id TEXT NOT NULL DEFAULT '',
      telegram_user_id TEXT NOT NULL DEFAULT '',
      telegram_username TEXT NOT NULL DEFAULT '',
      update_offset INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      paired_at TEXT
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);
  const sourceColumns = db.prepare("PRAGMA table_info(sources)").all().map((c) => c.name);
  if (!sourceColumns.includes("config_json")) {
    db.exec("ALTER TABLE sources ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';");
  }
  const briefColumns = db.prepare("PRAGMA table_info(brief_config)").all().map((c) => c.name);
  if (!briefColumns.includes("delivery_frequency")) db.exec("ALTER TABLE brief_config ADD COLUMN delivery_frequency TEXT NOT NULL DEFAULT 'Daily';");
  if (!briefColumns.includes("delivery_time")) db.exec("ALTER TABLE brief_config ADD COLUMN delivery_time TEXT NOT NULL DEFAULT '08:00';");
  if (!briefColumns.includes("delivery_timezone")) db.exec("ALTER TABLE brief_config ADD COLUMN delivery_timezone TEXT NOT NULL DEFAULT 'America/Denver';");
  if (!briefColumns.includes("delivery_day")) db.exec("ALTER TABLE brief_config ADD COLUMN delivery_day TEXT NOT NULL DEFAULT 'Monday';");
  if (!briefColumns.includes("analyzers_json")) db.exec("ALTER TABLE brief_config ADD COLUMN analyzers_json TEXT NOT NULL DEFAULT '[]';");
  if (!briefColumns.includes("analyzer_behavior")) db.exec("ALTER TABLE brief_config ADD COLUMN analyzer_behavior TEXT NOT NULL DEFAULT '';");
  if (!briefColumns.includes("perspective_lenses_json")) db.exec("ALTER TABLE brief_config ADD COLUMN perspective_lenses_json TEXT NOT NULL DEFAULT '[]';");
  if (!briefColumns.includes("perspective_lenses_migrated")) db.exec("ALTER TABLE brief_config ADD COLUMN perspective_lenses_migrated INTEGER NOT NULL DEFAULT 0;");
  const onboardingColumns = db.prepare("PRAGMA table_info(onboarding_state)").all().map((c) => c.name);
  if (onboardingColumns.length && !onboardingColumns.includes("source_suggestions_json")) db.exec("ALTER TABLE onboarding_state ADD COLUMN source_suggestions_json TEXT NOT NULL DEFAULT '[]';");
  if (onboardingColumns.length && !onboardingColumns.includes("brief_config_draft_json")) db.exec("ALTER TABLE onboarding_state ADD COLUMN brief_config_draft_json TEXT NOT NULL DEFAULT '{}';");
  const ttsColumns = db.prepare("PRAGMA table_info(tts_settings)").all().map((c) => c.name);
  if (ttsColumns.length && !ttsColumns.includes("telegram_auto_send")) db.exec("ALTER TABLE tts_settings ADD COLUMN telegram_auto_send INTEGER NOT NULL DEFAULT 0;");
  const telegramColumns = db.prepare("PRAGMA table_info(telegram_settings)").all().map((c) => c.name);
  if (telegramColumns.length && !telegramColumns.includes("update_offset")) db.exec("ALTER TABLE telegram_settings ADD COLUMN update_offset INTEGER NOT NULL DEFAULT 0;");
  const normalizedColumns = db.prepare("PRAGMA table_info(normalized_items)").all().map((c) => c.name);
  if (!normalizedColumns.includes("first_seen_at")) db.exec("ALTER TABLE normalized_items ADD COLUMN first_seen_at TEXT;");
  if (!normalizedColumns.includes("last_seen_at")) db.exec("ALTER TABLE normalized_items ADD COLUMN last_seen_at TEXT;");
  if (!normalizedColumns.includes("last_used_at")) db.exec("ALTER TABLE normalized_items ADD COLUMN last_used_at TEXT;");
  if (!normalizedColumns.includes("usage_count")) db.exec("ALTER TABLE normalized_items ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0;");
  db.exec("UPDATE normalized_items SET first_seen_at = COALESCE(first_seen_at, created_at), last_seen_at = COALESCE(last_seen_at, created_at) WHERE first_seen_at IS NULL OR last_seen_at IS NULL;");
  db.exec("UPDATE brief_config SET product_name='Pillar Brief' WHERE product_name IN ('Strategy Console', 'Intelligence Desk');");
}

const now = () => new Date().toISOString();
const defaultOpenAiModel = "gpt-5.4-mini";
const modelProviders = ["openai", "anthropic", "openrouter", "gemini", "xai", "custom"];
const id = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const json = (value) => JSON.stringify(value ?? null);
const parse = (value, fallback) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};

const defaultAnalyzers = () => [
  {
    id: "analyzer-signal",
    name: "Signal Analyzer",
    role: "Relevance and evidence",
    description: "Separates meaningful source-backed movement from noise, repeats, and weak claims.",
    instructions: "Evaluate each item for source quality, freshness, specificity, corroboration, and practical relevance. Name what is known, what is uncertain, and what would change the read.",
    enabled: true,
  },
  {
    id: "analyzer-impact",
    name: "Impact Analyzer",
    role: "Decision and consequence",
    description: "Turns source items into implications, risks, opportunities, and watch items.",
    instructions: "Evaluate what the development could change for the brief owner. Prioritize concrete consequences, time horizon, affected actors, and practical next moves.",
    enabled: true,
  },
  {
    id: "analyzer-sentiment",
    name: "Sentiment Analyzer",
    role: "Narrative and reaction",
    description: "Reads how communities, markets, or audiences are responding without treating chatter as proof.",
    instructions: "Evaluate narrative momentum, audience reaction, consensus versus disagreement, and where sentiment may be overstated. Keep claims grounded in the configured sources.",
    enabled: true,
  },
];

const defaultAnalyzerBehavior = "Synthesize analyzer output into the clearest overall read: points of agreement, genuine disagreements, practical implications, open questions, one recommended next move, and calibrated confidence. Preserve disagreement instead of flattening it.";

function sanitizeAnalyzerList(items = [], fallback = []) {
  const source = Array.isArray(items) && items.length ? items : fallback;
  return source.map((item, index) => ({
    id: String(item.id || `analyzer-${index + 1}-${Date.now().toString(36)}`).trim(),
    name: String(item.name || "Untitled Analyzer").trim(),
    role: String(item.role || "").trim(),
    description: String(item.description || "").trim(),
    instructions: String(item.instructions || item.behavior || "").trim(),
    enabled: item.enabled !== false,
  })).filter((item) => item.name && item.instructions);
}

function sanitizePerspectiveLenses(items = []) {
  return sanitizeAnalyzerList(items, []).map((item, index) => ({
    ...item,
    id: item.id || `perspective-${index + 1}-${Date.now().toString(36)}`,
  }));
}

function legacyLensesAsPerspectiveLenses() {
  try {
    return lenses().map((lens) => ({
      id: lens.id,
      name: lens.name,
      role: lens.role,
      description: lens.description,
      instructions: lens.instructions,
      enabled: lens.enabled,
    }));
  } catch {
    return [];
  }
}
const run = (sql, params = {}) => db.prepare(sql).run(params);
const all = (sql, params = {}) => db.prepare(sql).all(params);
const get = (sql, params = {}) => db.prepare(sql).get(params);
const addMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
const randomCode = () => Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(2, 8).toUpperCase().padEnd(6, "X");
const candidateBrewPaths = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
const candidateFfmpegPaths = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
const defaultWhisperModel = process.env.WHISPER_MODEL_NAME || "tiny.en";
const whisperModelFile = `ggml-${defaultWhisperModel}.bin`;
const whisperModelUrl = process.env.WHISPER_MODEL_URL || `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${whisperModelFile}`;

function platformBinaryName(baseName) {
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function whisperBinaryCandidates() {
  const names = [
    platformBinaryName("whisper-cli"),
    platformBinaryName("main"),
    platformBinaryName("whisper"),
  ];
  const roots = [
    process.env.PILLAR_WHISPER_DIR,
    path.dirname(process.execPath || ""),
    path.join(dataDir, "whisper"),
    path.join(root, "vendor", "whisper"),
    path.join(root, "whisper"),
    path.join(root, "..", "whisper"),
    process.env.PILLAR_BACKEND_DIR ? path.join(process.env.PILLAR_BACKEND_DIR, "..", "whisper") : "",
    process.env.PILLAR_BACKEND_DIR ? path.join(process.env.PILLAR_BACKEND_DIR, "whisper") : "",
  ].filter(Boolean);
  return roots.flatMap((dir) => [
    ...names.map((name) => path.join(dir, name)),
    ...names.map((name) => path.join(dir, "bin", name)),
  ]);
}

function whisperModelCandidates() {
  return [
    path.join(modelsDir, whisperModelFile),
    path.join(dataDir, whisperModelFile),
    path.join(dataDir, "whisper", "models", whisperModelFile),
    path.join(root, "vendor", "whisper", "models", whisperModelFile),
    path.join(root, "..", "whisper", "models", whisperModelFile),
    process.env.PILLAR_BACKEND_DIR ? path.join(process.env.PILLAR_BACKEND_DIR, "..", "whisper", "models", whisperModelFile) : "",
    process.env.PILLAR_BACKEND_DIR ? path.join(process.env.PILLAR_BACKEND_DIR, "whisper", "models", whisperModelFile) : "",
  ].filter(Boolean);
}

function whisperRuntimeEnv(binaryPath = "") {
  const whisperRoot = path.dirname(path.dirname(binaryPath));
  const libexecDir = path.join(whisperRoot, "libexec");
  const backendPath = [
    path.join(libexecDir, "libggml-metal.so"),
    path.join(libexecDir, "libggml-blas.so"),
    path.join(libexecDir, "libggml-cpu-apple_m4.so"),
    path.join(libexecDir, "libggml-cpu-apple_m2_m3.so"),
    path.join(libexecDir, "libggml-cpu-apple_m1.so"),
  ].find((candidate) => fs.existsSync(candidate));
  return backendPath ? { ...process.env, GGML_BACKEND_PATH: backendPath } : process.env;
}

async function commandVersion(command, args = ["-version"]) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout: 5000 });
    return { ok: true, path: command, output: `${stdout || stderr}`.split("\n")[0] || command };
  } catch (error) {
    return { ok: false, path: command, error: error.message };
  }
}

async function resolveCommand(name, candidates = []) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const { stdout } = await execFileAsync("which", [name], { timeout: 5000 });
    const resolved = stdout.trim().split("\n")[0];
    return resolved || "";
  } catch {
    return "";
  }
}

async function localSttStatus() {
  const binaryPath = process.env.WHISPER_CPP_PATH
    ? path.resolve(process.env.WHISPER_CPP_PATH)
    : await resolveCommand("whisper-cli", whisperBinaryCandidates());
  const modelPath = process.env.WHISPER_MODEL_PATH
    ? path.resolve(process.env.WHISPER_MODEL_PATH)
    : whisperModelCandidates().find((candidate) => fs.existsSync(candidate)) || "";
  const binaryInstalled = binaryPath && fs.existsSync(binaryPath)
    ? { ok: true, path: binaryPath, output: binaryPath }
    : { ok: false };
  const modelInstalled = modelPath && fs.existsSync(modelPath);
  return {
    provider: "whisper.cpp",
    available: !!binaryInstalled.ok && !!modelInstalled,
    binaryAvailable: !!binaryInstalled.ok,
    modelAvailable: !!modelInstalled,
    binaryCandidatePath: binaryPath || "",
    binaryError: binaryInstalled.ok ? "" : binaryInstalled.error || "",
    binaryPath: binaryInstalled.ok ? binaryPath : "",
    modelPath: modelInstalled ? modelPath : "",
    modelName: defaultWhisperModel,
    modelFile: whisperModelFile,
    modelUrl: whisperModelUrl,
    installableModel: true,
    message: binaryInstalled.ok && modelInstalled
      ? `Local speech-to-text is ready with whisper.cpp ${defaultWhisperModel}.`
      : !binaryInstalled.ok
        ? "Local speech-to-text needs a whisper.cpp binary. Set WHISPER_CPP_PATH or bundle whisper-cli in vendor/whisper/bin."
        : `Local speech-to-text needs the ${whisperModelFile} model. Download it in Settings or set WHISPER_MODEL_PATH.`,
  };
}

async function ffmpegStatus() {
  const ffmpegPath = process.env.FFMPEG_PATH || await resolveCommand("ffmpeg", candidateFfmpegPaths);
  const brewPath = await resolveCommand("brew", candidateBrewPaths);
  const installed = ffmpegPath ? await commandVersion(ffmpegPath) : { ok: false };
  const canUseMacInstaller = isDesktop && process.platform === "darwin";
  return {
    available: !!installed.ok,
    path: installed.ok ? ffmpegPath : "",
    version: installed.ok ? installed.output : "",
    installable: canUseMacInstaller,
    homebrewAvailable: !!brewPath,
    homebrewPath: brewPath,
    installCommand: brewPath ? `${brewPath} install ffmpeg` : "Install Homebrew, then run brew install ffmpeg",
    message: installed.ok
      ? "FFmpeg is installed. Podcast transcription is available."
      : canUseMacInstaller
        ? "FFmpeg is not installed. Podcast transcription is unavailable until FFmpeg is installed."
        : "FFmpeg is not installed. Install FFmpeg with your system package manager to enable podcast transcription.",
  };
}

async function downloadLocalSttModel() {
  const status = await localSttStatus();
  if (status.modelAvailable) return { ok: true, modelPath: status.modelPath, message: "Whisper model is already installed." };
  fs.mkdirSync(modelsDir, { recursive: true });
  const target = path.join(modelsDir, whisperModelFile);
  const partial = `${target}.download`;
  const response = await fetchWithTimeout(whisperModelUrl, {}, 300000);
  if (!response.ok || !response.body) throw new Error(`Whisper model download failed: ${response.status} ${response.statusText}`);
  await pipeline(response.body, fs.createWriteStream(partial));
  fs.renameSync(partial, target);
  return { ok: true, modelPath: target, message: `Downloaded ${whisperModelFile}.` };
}

async function openHomebrewBootstrapInstaller() {
  const scriptPath = path.join(dataDir, "install-ffmpeg-macos.sh");
  const script = `#!/bin/bash
set -e
echo "Pillar Brief FFmpeg installer"
echo
if ! command -v brew >/dev/null 2>&1; then
  echo "Installing Homebrew..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
echo "Installing FFmpeg..."
brew install ffmpeg
echo
echo "FFmpeg install complete. Return to Pillar Brief and click Re-check."
read -n 1 -s -r -p "Press any key to close this window."
`;
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
  await execFileAsync("open", ["-a", "Terminal", scriptPath]);
  return scriptPath;
}

function installFfmpegWithBrew(brewPath) {
  return new Promise((resolve) => {
    const child = spawn(brewPath, ["install", "ffmpeg"], { env: process.env });
    let output = "";
    const append = (chunk) => {
      output = `${output}${chunk.toString()}`.slice(-8000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => resolve({ ok: false, error: error.message, output }));
    child.on("close", (code) => resolve({ ok: code === 0, code, output }));
  });
}

function sourceCredentialStatus(type) {
  if (["Web", "RSS", "Podcast", "Newsletter", "Reddit", "YouTube"].includes(type)) return "not required";
  if (type === "Calendar") return "missing";
  if (["X", "TikTok"].includes(type)) return "optional";
  return "missing";
}

function providerEnvKey(provider) {
  if (provider === "openai") return process.env.OPENAI_API_KEY || "";
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY || "";
  if (provider === "openrouter") return process.env.OPENROUTER_API_KEY || "";
  if (provider === "gemini") return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  if (provider === "xai") return process.env.XAI_API_KEY || process.env.GROK_API_KEY || "";
  if (provider === "custom") return process.env.CUSTOM_MODEL_API_KEY || "";
  return "";
}

function defaultModelForProvider(provider) {
  if (provider === "openai") return defaultOpenAiModel;
  if (provider === "xai") return "grok-4.3";
  return "";
}

function providerCredentialStatus(provider, savedApiKey = "") {
  if (savedApiKey) return "saved";
  return providerEnvKey(provider) ? "env" : "missing";
}

function modelProviderCredentialKey(provider) {
  return `model:${provider}`;
}

function savedModelProviderKey(provider, current = get("SELECT * FROM model_settings WHERE id=1")) {
  if (current?.provider === provider && current.api_key) return current.api_key;
  const row = get("SELECT api_key FROM connector_credentials WHERE provider=$provider", { $provider: modelProviderCredentialKey(provider) });
  return row?.api_key || "";
}

function saveModelProviderKey(provider, apiKey) {
  if (!apiKey) return;
  run(`INSERT INTO connector_credentials (provider, api_key, enabled, last_error, updated_at)
       VALUES ($provider, $apiKey, 1, '', $t)
       ON CONFLICT(provider) DO UPDATE SET api_key=$apiKey, enabled=1, last_error='', updated_at=$t`, {
    $provider: modelProviderCredentialKey(provider),
    $apiKey: apiKey,
    $t: now(),
  });
}

async function fetchProviderModels({ provider, apiKey, savedApiKey, baseUrl }) {
  const resolvedProvider = modelProviders.includes(provider) ? provider : "openai";
  provider = resolvedProvider;
  const envKey = providerEnvKey(provider);
  const runtimeKey = apiKey || savedApiKey || envKey;
  const source = apiKey ? "input" : savedApiKey ? "saved" : envKey ? "env" : "none";
  const headers = {};
  let url;

  if (provider === "openai") {
    if (!runtimeKey) return { provider, models: [], credentialSource: source, error: "Add an OpenAI API key or set OPENAI_API_KEY" };
    url = "https://api.openai.com/v1/models";
    headers.authorization = `Bearer ${runtimeKey}`;
  } else if (provider === "anthropic") {
    if (!runtimeKey) return { provider, models: [], credentialSource: source, error: "Add an Anthropic API key or set ANTHROPIC_API_KEY" };
    url = "https://api.anthropic.com/v1/models";
    headers["x-api-key"] = runtimeKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (provider === "openrouter") {
    url = "https://openrouter.ai/api/v1/models";
    if (runtimeKey) headers.authorization = `Bearer ${runtimeKey}`;
  } else if (provider === "gemini") {
    if (!runtimeKey) return { provider, models: [], credentialSource: source, error: "Add a Gemini API key or set GEMINI_API_KEY" };
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(runtimeKey)}`;
  } else if (provider === "xai") {
    if (!runtimeKey) return { provider, models: [], credentialSource: source, error: "Add an xAI API key or set XAI_API_KEY" };
    url = "https://api.x.ai/v1/models";
    headers.authorization = `Bearer ${runtimeKey}`;
  } else if (provider === "custom") {
    if (!baseUrl) return { provider, models: [], credentialSource: source, error: "Custom providers require a Base URL" };
    url = `${baseUrl.replace(/\/+$/, "")}/models`;
    if (runtimeKey) headers.authorization = `Bearer ${runtimeKey}`;
  } else {
    return { provider, models: [], credentialSource: source, error: "Unsupported provider" };
  }

  try {
    const response = await fetchWithTimeout(url, { headers });
    if (!response.ok) {
      return { provider, models: [], credentialSource: source, error: `Model discovery failed: ${response.status} ${response.statusText}` };
    }
    const payload = await response.json();
    const data = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
    const models = data
      .filter((item) => provider !== "gemini" || (item.supportedGenerationMethods || []).includes("generateContent"))
      .map((item) => item.id || item.name || item.model)
      .map((name) => String(name).replace(/^models\//, ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return { provider, models, credentialSource: source, error: "" };
  } catch (error) {
    return { provider, models: [], credentialSource: source, error: error.message || "Model discovery failed" };
  }
}

function modelRuntime(modelRow) {
  const apiKey = modelRow.api_key || savedModelProviderKey(modelRow.provider, modelRow) || providerEnvKey(modelRow.provider);
  const baseUrl = modelRow.provider === "custom"
    ? modelRow.base_url.replace(/\/+$/, "")
    : modelRow.provider === "openrouter"
      ? "https://openrouter.ai/api/v1"
    : modelRow.provider === "anthropic"
      ? "https://api.anthropic.com/v1"
      : modelRow.provider === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta"
        : modelRow.provider === "xai"
          ? "https://api.x.ai/v1"
        : "https://api.openai.com/v1";
  return { apiKey, baseUrl };
}

function parseModelJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("The model returned an empty response. Try again, or use the generated fallback draft.");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const body = fenced || raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  return JSON.parse(body);
}

function defaultSourceConfig(type) {
  if (type === "Reddit") return { mode: "subreddit" };
  if (type === "X") return { mode: "search" };
  if (type === "YouTube") return { mode: "channel" };
  if (type === "Podcast") return { mode: "feed" };
  if (type === "Newsletter") return { mode: "feed" };
  if (type === "Calendar") return { mode: "google", calendarId: "selected", includeAttendees: true, includeDescriptions: false, includeDeclined: false };
  if (type === "Web") return { mode: "page" };
  return { mode: "feed" };
}

function promptHasExplicitYearIntent(briefPrompt = "") {
  return /\b(19|20)\d{2}\b|\b(last|past|since|before|after|during|from|in)\s+(year|month|week|quarter|\d{4})\b/i.test(String(briefPrompt || ""));
}

function stripGeneratedYears(value = "") {
  return String(value || "")
    .replace(/^search:/i, "")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeSourceSuggestion(item, index = 0, options = {}) {
  const allowedTypes = new Set(["Web", "RSS", "Reddit", "X", "YouTube", "Podcast", "Newsletter", "TikTok", "Calendar"]);
  const type = allowedTypes.has(item?.type) ? item.type : "RSS";
  const rawConfig = item?.config && typeof item.config === "object" ? item.config : defaultSourceConfig(type);
  const rawXQuery = rawConfig.query || item?.locator || rawConfig.handle || "";
  const config = type === "X" ? { mode: "search", query: options.keepYears ? String(rawXQuery || "").trim() : stripGeneratedYears(rawXQuery) } : rawConfig;
  const locator = String(item?.locator || config.feedUrl || config.url || config.query || config.subreddits || config.channel || config.handle || "").trim();
  return {
    id: String(item?.id || `suggestion-${index + 1}`),
    name: String(item?.name || `${type} source`).trim().slice(0, 120),
    type,
    locator,
    cadence: ["Hourly", "Daily", "Weekly"].includes(item?.cadence) ? item.cadence : "Daily",
    config: { ...defaultSourceConfig(type), ...config },
    rationale: String(item?.rationale || "Suggested from your brief goals.").trim().slice(0, 500),
    confidence: Math.max(0, Math.min(1, Number(item?.confidence ?? 0.72))),
  };
}

function sanitizeBriefSetupDraft(item = {}, current = briefConfig()) {
  const currentOwnerName = String(current.ownerName || "").trim();
  const defaultSections = current.sections?.length ? current.sections : [
    { key: "executiveRead", label: "Executive Read", enabled: true, instruction: "2-3 plain-English paragraphs on what matters." },
    { key: "whyItMatters", label: currentOwnerName && !isDefaultOwnerName(currentOwnerName) ? `Why ${currentOwnerName} Should Care` : "Why It Matters", enabled: true, instruction: "Bullets tied to decisions, risks, opportunities, or watch items." },
    { key: "sourceEvidence", label: "Source Evidence", enabled: true, instruction: "Cited items behind the brief." },
  ];
  const sections = putCalendarBriefSectionFirst((Array.isArray(item.sections) ? item.sections : defaultSections).slice(0, 10).map((section, index) => ({
    key: String(section.key || `custom-${index + 1}`).trim().replace(/[^a-zA-Z0-9_-]/g, "-") || `custom-${index + 1}`,
    label: String(section.label || section.key || `Section ${index + 1}`).trim().slice(0, 80),
    enabled: section.enabled !== false,
    instruction: String(section.instruction || "Write this section in direct, useful plain English.").trim().slice(0, 600),
    promptTarget: "standard",
    promptRefId: "",
  })).filter((section) => section.key && section.label), { addIfConnected: true });
  return {
    ownerName: String(item.ownerName || current.ownerName || "You").trim().slice(0, 80) || "You",
    productName: String(item.productName || current.productName || "Pillar Brief").trim().slice(0, 80) || "Pillar Brief",
    audienceContext: String(item.audienceContext || current.audienceContext || "").trim().slice(0, 1200),
    voiceRules: String(item.voiceRules || current.voiceRules || "").trim().slice(0, 1200),
    deliveryFrequency: current.deliveryFrequency || "Daily",
    deliveryTime: current.deliveryTime || "08:00",
    deliveryTimezone: current.deliveryTimezone || "America/Denver",
    deliveryDay: current.deliveryDay || "Monday",
    sections,
  };
}

function defaultCalendarBriefSection() {
  return {
    key: "calendarAgenda",
    label: "Today's Calendar",
    enabled: true,
    instruction: "Use today's connected calendar events to prepare me for the day: meetings, schedule shape, likely prep needs, conflicts, sequencing, focus blocks, and follow-up reminders. Treat calendar entries as private schedule context, not news.",
    promptTarget: "standard",
    promptRefId: "",
  };
}

function isGoogleCalendarConnected() {
  try {
    const credential = googleCalendarCredential();
    return !!(credential.enabled && credential.data?.refreshToken);
  } catch {
    return false;
  }
}

function putCalendarBriefSectionFirst(sections = [], options = {}) {
  const usableSections = Array.isArray(sections) ? sections.filter(Boolean) : [];
  const existing = usableSections.find((section) => section?.key === "calendarAgenda");
  if (!existing && !(options.addIfConnected && isGoogleCalendarConnected())) return usableSections;
  const calendarSection = existing ? { ...defaultCalendarBriefSection(), ...existing, key: "calendarAgenda" } : defaultCalendarBriefSection();
  return [calendarSection, ...usableSections.filter((section) => section?.key !== "calendarAgenda")];
}

function ensureGoogleCalendarBriefSetup() {
  const markerKey = "google_calendar_brief_setup_seeded";
  const orderMarkerKey = "google_calendar_brief_section_ordered";
  const seeded = get("SELECT value FROM app_state WHERE key=$key", { $key: markerKey })?.value === "1";
  const ordered = get("SELECT value FROM app_state WHERE key=$key", { $key: orderMarkerKey })?.value === "1";
  const t = now();
  const existingSource = get("SELECT id FROM sources WHERE type='Calendar' AND locator='selected'");
  if (!existingSource) {
    const sourceId = id("src");
    const config = defaultSourceConfig("Calendar");
    run(`INSERT INTO sources (id, name, type, locator, cadence, status, approval_status, credentials_status, note, config_json, created_at, updated_at)
         VALUES ($id, 'Google Calendar', 'Calendar', 'selected', 'Daily', 'active', 'approved', 'configured', 'Auto-added when Google Calendar was connected.', $config, $t, $t)`, {
      $id: sourceId,
      $config: json(config),
      $t: t,
    });
    audit("source.created", "source", sourceId, "Google Calendar source auto-added after Calendar connection", {}, "system");
  }
  const row = get("SELECT section_schema_json FROM brief_config WHERE id=1");
  const sections = parse(row?.section_schema_json, []);
  if (Array.isArray(sections) && !sections.some((section) => section.key === "calendarAgenda") && !seeded) {
    run("UPDATE brief_config SET section_schema_json=$sections, updated_at=$t WHERE id=1", {
      $sections: json(putCalendarBriefSectionFirst(sections, { addIfConnected: true })),
      $t: t,
    });
    audit("brief_config.calendar_section_added", "brief_config", "1", "Added editable Today's Calendar section after Google Calendar connection", {}, "system");
  } else if (Array.isArray(sections) && sections.some((section) => section.key === "calendarAgenda") && !ordered) {
    run("UPDATE brief_config SET section_schema_json=$sections, updated_at=$t WHERE id=1", {
      $sections: json(putCalendarBriefSectionFirst(sections)),
      $t: t,
    });
    audit("brief_config.calendar_section_ordered", "brief_config", "1", "Moved Today's Calendar section to the top of Brief Setup", {}, "system");
  }
  run(`INSERT INTO app_state (key, value, updated_at) VALUES ($key, '1', $t)
       ON CONFLICT(key) DO UPDATE SET value='1', updated_at=$t`, { $key: markerKey, $t: t });
  run(`INSERT INTO app_state (key, value, updated_at) VALUES ($key, '1', $t)
       ON CONFLICT(key) DO UPDATE SET value='1', updated_at=$t`, { $key: orderMarkerKey, $t: t });
}

function isDefaultOwnerName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return !normalized || ["you", "brief owner", "the brief owner"].includes(normalized);
}

function sanitizeSourceConfig(type, config = {}, locator = "", options = {}) {
  const base = config && typeof config === "object" ? config : {};
  if (type === "Calendar") {
    return {
      mode: "google",
      calendarId: String(base.calendarId || locator || "selected").trim() || "selected",
      calendarIds: Array.isArray(base.calendarIds) ? base.calendarIds.map((item) => String(item || "").trim()).filter(Boolean) : [],
      includeDescriptions: base.includeDescriptions === true,
      includeAttendees: base.includeAttendees !== false,
      includeDeclined: base.includeDeclined === true,
    };
  }
  if (type === "X") {
    const rawQuery = String(base.query || locator || base.handle || "").trim();
    return {
      mode: "search",
      query: options.keepYears ? rawQuery : stripGeneratedYears(rawQuery),
      quickMode: true,
      quickModeLocked: true,
    };
  }
  return base;
}

function preferenceHintsFromPrompt(briefPrompt = "") {
  const text = String(briefPrompt || "");
  const lower = text.toLowerCase();
  const hints = [];
  if (/\bright[-\s]?wing\b|\bconservative\b|\bgop\b|\brepublican\b/.test(lower)) {
    hints.push("Preserve the user's right-leaning/conservative preference as part of the analysis frame.");
  }
  if (/\bleft[-\s]?wing\b|\bprogressive\b|\bdemocrat(ic)?\b|\bdems\b/.test(lower)) {
    hints.push("Preserve stated political-party or ideological preferences exactly enough to guide framing.");
  }
  if (/\bprefer\b|\balign\b|\bavoid\b|\bdon't\b|\bnot just\b|\bmainly\b|\bfocus\b|\blook mainly\b/.test(lower)) {
    hints.push("Carry over explicit preferences, exclusions, source priorities, and framing instructions from the request.");
  }
  if (/\blameness\b|\blame\b|\babsurd\b|\bfailure\b|\bweakness\b/.test(lower)) {
    hints.push("Preserve requested critique angles as source-grounded sentiment/framing, not as bland neutral topic coverage.");
  }
  if (/\bx\b|\btwitter\b|\breddit\b/.test(lower)) {
    hints.push("Preserve source preference for X/Reddit sentiment where requested.");
  }
  return hints;
}

function fallbackBriefSetupDraft(briefPrompt = "", current = briefConfig()) {
  const owner = current.ownerName || "You";
  const prompt = String(briefPrompt || "").toLowerCase();
  const preferenceHints = preferenceHintsFromPrompt(briefPrompt);
  const preferenceText = preferenceHints.length ? ` Preferences to preserve: ${preferenceHints.join(" ")}` : "";
  const topics = [];
  if (prompt.includes("crypto")) topics.push("crypto");
  if (prompt.includes("ai")) topics.push("AI");
  if (prompt.includes("politic")) topics.push("politics");
  if (prompt.includes("movie") || prompt.includes("hollywood")) topics.push("movies/Hollywood");
  if (prompt.includes("market")) topics.push("markets");
  if (prompt.includes("reddit")) topics.push("Reddit sentiment");
  if (prompt.includes("x ") || prompt.includes("twitter")) topics.push("X sentiment");
  const topicText = topics.length ? topics.join(", ") : "the topics in the brief request";
  return sanitizeBriefSetupDraft({
    ownerName: owner,
    productName: current.productName || "Pillar Brief",
    audienceContext: `A private daily brief for ${owner} focused on ${topicText}. Assume ${owner} wants the latest useful signals from today, with enough context to understand why they matter.${preferenceText}`,
    voiceRules: `Natural, direct, and useful. Prefer plain English, sharp bullets, and concrete takeaways. Avoid corporate stiffness, filler, fake certainty, and false-balance flattening of stated preferences.${preferenceHints.length ? " Keep stated worldview/taste/source preferences visible when source evidence supports them." : ""}`,
    sections: [
      { key: "topSignals", label: "Top Signals", enabled: true, instruction: "Lead with the most important items published today. Keep each item clear, specific, and tied to why it matters.", promptTarget: "standard" },
      { key: "sentimentRead", label: "Sentiment Read", enabled: true, instruction: `Summarize what people seem to be reacting to on X, Reddit, and other configured sources. Separate real signal from noise.${preferenceHints.length ? " Preserve the user's stated worldview/source preferences in the read when grounded in today's sources." : ""}`, promptTarget: "standard" },
      { key: "politicalRace", label: "Political Race", enabled: prompt.includes("politic") || prompt.includes("race"), instruction: `Cover meaningful political-race developments, polling signals, campaign moves, and narrative shifts from today.${preferenceHints.length ? " Keep explicit political framing preferences intact instead of smoothing them into generic neutrality." : ""}`, promptTarget: "standard" },
      { key: "industryMotion", label: "Industry Motion", enabled: true, instruction: "Explain production, market, industry, or business implications behind the day’s items, not just gossip or surface chatter.", promptTarget: "standard" },
      { key: "marketImpact", label: "Market Impact", enabled: prompt.includes("market") || prompt.includes("crypto"), instruction: "Call out how the day’s events may affect markets, risk appetite, crypto, AI, or broader sentiment.", promptTarget: "standard" },
      { key: "whatToWatch", label: "What To Watch Next", enabled: true, instruction: "End with the next developments, questions, or indicators worth watching over the next 24-72 hours.", promptTarget: "standard" },
      { key: "sourceEvidence", label: "Source Evidence", enabled: true, instruction: "List the source items used, with links where available. Only include items published today.", promptTarget: "standard" },
    ],
  }, current);
}

async function validateTelegramToken(botToken) {
  const token = String(botToken || "").trim();
  if (!token) throw new Error("Paste the API token BotFather gave you.");
  const base = `https://api.telegram.org/bot${token}`;
  const me = await fetchWithTimeout(`${base}/getMe`);
  const mePayload = await me.json().catch(() => ({}));
  if (!me.ok || !mePayload.ok) {
    throw new Error(mePayload.description || "Telegram could not validate that bot token.");
  }
  if (!mePayload.result?.username) throw new Error("Telegram validated the token, but did not return a bot username.");
  return { token, bot: mePayload.result, base };
}

function telegramPairingSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    botUsername: row.bot_username,
    deepLink: row.deep_link,
    qrUrl: row.deep_link ? `/api/telegram/pairing/${row.id}/qr.svg` : "",
    chatId: row.chat_id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username,
    error: row.error,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    pairedAt: row.paired_at,
  };
}

function activePairingSession(sessionId) {
  const row = get("SELECT * FROM telegram_pairing_sessions WHERE id=$id", { $id: sessionId });
  if (!row) return null;
  if (row.status === "waiting" && new Date(row.expires_at).getTime() < Date.now()) {
    run("UPDATE telegram_pairing_sessions SET status='expired', error='Pairing code expired. Start a new pairing code.' WHERE id=$id", { $id: sessionId });
    return get("SELECT * FROM telegram_pairing_sessions WHERE id=$id", { $id: sessionId });
  }
  return row;
}

async function sendTelegramMessage(botToken, chatId, text, options = {}) {
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram sendMessage failed: ${response.status} ${response.statusText}`);
  return payload;
}

async function sendTelegramMarkdown(botToken, chatId, markdown, options = {}) {
  const chunks = telegramChunks(markdown);
  const sentMessages = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const prefix = chunks.length > 1 ? `*${escapeTelegramMarkdown(`Part ${i + 1}/${chunks.length}`)}*\n\n` : "";
    const payload = await sendTelegramMessage(botToken, chatId, `${prefix}${chunks[i]}`, {
      parseMode: "MarkdownV2",
      replyMarkup: i === chunks.length - 1 ? options.replyMarkup : null,
    });
    sentMessages.push(payload.result?.message_id);
  }
  return { chunks: chunks.length, messageIds: sentMessages.filter(Boolean) };
}

function telegramPairingErrorMessage(description = "") {
  if (/terminated by other getUpdates request|conflict/i.test(description)) {
    return "Telegram says another app is already polling this bot token. Close any other Pillar Brief windows, stop any local/VPS server using the same bot, or create a fresh bot in BotFather, then start a new pairing code.";
  }
  if (/webhook/i.test(description)) {
    return "Telegram says this bot has a webhook configured. Remove the webhook before using pairing.";
  }
  return description || "Telegram pairing failed";
}

async function answerTelegramCallback(botToken, callbackQueryId, text = "") {
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text: text || "Working on it..." }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram answerCallbackQuery failed: ${response.status}`);
  return payload;
}

async function pollTelegramUpdates() {
  const elapsed = Date.now() - lastTelegramPollAt;
  if (telegramPollInFlight) return telegramPollInFlight;
  if (elapsed < 5000) return { skipped: true, reason: "recent poll" };
  telegramPollInFlight = (async () => {
    lastTelegramPollAt = Date.now();
  const waitingPairing = get("SELECT id FROM telegram_pairing_sessions WHERE status='waiting' AND expires_at > $t LIMIT 1", { $t: now() });
  if (waitingPairing) return { skipped: true, reason: "pairing active" };
  const tg = get("SELECT * FROM telegram_settings WHERE id=1");
  if (!tg?.enabled || !tg?.bot_token || !tg?.chat_id) return { skipped: true, reason: "telegram disabled" };
  const params = new URLSearchParams({
    timeout: "0",
    allowed_updates: JSON.stringify(["message", "callback_query"]),
  });
  const offset = Number(tg.update_offset || 0);
  if (offset) params.set("offset", String(offset));
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${tg.bot_token}/getUpdates?${params.toString()}`, {}, 12000);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(telegramPairingErrorMessage(payload.description || "Telegram polling failed"));
  let nextOffset = offset;
  let handled = 0;
  for (const update of payload.result || []) {
    nextOffset = Math.max(nextOffset, Number(update.update_id || 0) + 1);
    const callback = update.callback_query;
    const message = update.message;
    const callbackData = String(callback?.data || "");
    const messageText = String(message?.text || "").trim();
    const chatId = callback?.message?.chat?.id || message?.chat?.id;
    if (!chatId || String(chatId) !== String(tg.chat_id)) continue;
    if (callbackData.startsWith("deliberate:")) {
      handled += 1;
      const runId = callbackData.slice("deliberate:".length).trim();
      try {
        await answerTelegramCallback(tg.bot_token, callback.id, "Deliberating brief...");
        const deliberation = await deliberateWorkflowRun(runId);
        await sendTelegramMarkdown(tg.bot_token, String(chatId), formatDeliberationMarkdownV2(deliberation));
      } catch (error) {
        try { await answerTelegramCallback(tg.bot_token, callback.id, error.message || "Deliberation failed."); } catch {}
        await sendTelegramMessage(tg.bot_token, String(chatId), error.message || "Could not deliberate that brief.");
      }
    } else if (/^\/deliberate\b/i.test(messageText)) {
      handled += 1;
      const [, requestedRunId] = messageText.split(/\s+/);
      const runId = requestedRunId || workflowRuns()[0]?.id;
      if (!runId) {
        await sendTelegramMessage(tg.bot_token, String(chatId), "No saved briefs are available to deliberate yet.");
      } else {
        try {
          const deliberation = await deliberateWorkflowRun(runId);
          await sendTelegramMarkdown(tg.bot_token, String(chatId), formatDeliberationMarkdownV2(deliberation));
        } catch (error) {
          await sendTelegramMessage(tg.bot_token, String(chatId), error.message || "Could not deliberate that brief.");
        }
      }
    }
  }
  run("UPDATE telegram_settings SET update_offset=$offset, last_checked_at=$t, last_error='', updated_at=$t WHERE id=1", { $offset: nextOffset, $t: now() });
  return { ok: true, handled, nextOffset };
  })();
  try {
    return await telegramPollInFlight;
  } finally {
    telegramPollInFlight = null;
  }
}

function escapeTelegramMarkdown(value = "") {
  return String(value).replace(/[_*[\]()~`>#+\-=|{}.!]/g, (char) => `\\${char}`);
}

function telegramMarkdownLine(line = "") {
  const raw = String(line || "");
  const heading = raw.match(/^(#{1,3})\s+(.+)$/);
  if (heading) return `*${escapeTelegramMarkdown(heading[2])}*`;
  const numbered = raw.match(/^(\d+)\.\s+(.+)$/);
  if (numbered) return `${numbered[1]}\\. ${escapeTelegramMarkdown(numbered[2])}`;
  const bullet = raw.match(/^[-*]\s+(.+)$/);
  if (bullet) return `• ${escapeTelegramMarkdown(bullet[1])}`;
  const indented = raw.match(/^(\s+)(.+)$/);
  if (indented) return `${indented[1]}${escapeTelegramMarkdown(indented[2])}`;
  return escapeTelegramMarkdown(raw);
}

function markdownToTelegramMarkdown(markdown = "") {
  return String(markdown || "")
    .split("\n")
    .map(telegramMarkdownLine)
    .join("\n");
}

function telegramChunks(markdown = "") {
  const text = String(markdown || "").trim() || "Brief generated, but there was no rendered text.";
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= 3800) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.slice(0, 3800);
    const cut = Math.max(slice.lastIndexOf("\n## "), slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
    const end = cut > 1200 ? cut : 3800;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  return chunks;
}

function elevenLabsKey(explicitKey = "") {
  return String(explicitKey || "").trim()
    || get("SELECT api_key FROM connector_credentials WHERE provider='elevenlabs'")?.api_key
    || process.env.ELEVENLABS_API_KEY
    || "";
}

async function listElevenLabsVoices(apiKey = "") {
  const key = elevenLabsKey(apiKey);
  if (!key) throw new Error("Add an ElevenLabs API key to detect voices.");
  const response = await fetchWithTimeout("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": key },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.detail?.message || payload?.message || `ElevenLabs voice lookup failed: ${response.status}`);
  return (payload.voices || []).map((voice) => ({
    id: voice.voice_id,
    name: voice.name,
    category: voice.category || "",
    previewUrl: voice.preview_url || "",
  })).filter((voice) => voice.id && voice.name);
}

function ttsSettings() {
  const r = get("SELECT * FROM tts_settings WHERE id = 1");
  const apiKey = elevenLabsKey();
  return {
    provider: r.provider,
    voiceId: r.voice_id,
    voiceName: r.voice_name,
    modelId: r.model_id || "eleven_multilingual_v2",
    telegramAutoSend: !!r.telegram_auto_send,
    enabled: !!r.enabled,
    apiKeySaved: !!apiKey,
    credentialStatus: apiKey ? "saved" : "missing",
    status: r.enabled && apiKey && r.voice_id ? "ready" : "pending credentials",
    lastCheckedAt: r.last_checked_at,
    lastError: r.last_error,
    updatedAt: r.updated_at,
  };
}

function briefAudioText(artifact = {}) {
  const text = String(artifact.onePageBrief || renderOnePageBrief(artifact) || "")
    .replace(/^#\s+/gm, "")
    .replace(/^Generated:.*$/gm, "")
    .replace(/^##\s+/gm, "\n")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 9000);
}

async function synthesizeElevenLabsAudio({ text, filenamePrefix = "brief", apiKey = "", voiceId = "", modelId = "" } = {}) {
  const settings = ttsSettings();
  const key = elevenLabsKey(apiKey);
  const selectedVoice = String(voiceId || settings.voiceId || "").trim();
  const selectedModel = String(modelId || settings.modelId || "eleven_multilingual_v2").trim();
  if (!key) throw new Error("ElevenLabs API key is missing.");
  if (!selectedVoice) throw new Error("Choose an ElevenLabs voice before generating audio.");
  const response = await fetchWithTimeout(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(selectedVoice)}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: String(text || "").trim(), model_id: selectedModel }),
  }, 90000);
  const errorPayload = response.ok ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorPayload?.detail?.message || errorPayload?.message || `ElevenLabs TTS failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const audioId = id("audio");
  const fileName = `${filenamePrefix.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48) || "brief"}-${audioId}.mp3`;
  const filePath = path.join(audioDir, fileName);
  fs.writeFileSync(filePath, bytes);
  return {
    id: audioId,
    fileName,
    path: filePath,
    url: `/api/audio/${encodeURIComponent(fileName)}`,
    bytes: bytes.length,
    voiceId: selectedVoice,
    modelId: selectedModel,
    generatedAt: now(),
  };
}

async function sendTelegramAudio(botToken, chatId, audioPath, caption = "") {
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption.slice(0, 1024));
  form.append("audio", new Blob([fs.readFileSync(audioPath)], { type: "audio/mpeg" }), path.basename(audioPath));
  const response = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendAudio`, {
    method: "POST",
    body: form,
  }, 60000);
  const payload = await response.json().catch(() => ({}));
  if (!payload.ok) throw new Error(payload.description || `Telegram audio delivery failed: ${response.status}`);
  return payload;
}

async function deliverBriefToTelegram({ runId, artifact }) {
  const tg = get("SELECT * FROM telegram_settings WHERE id=1");
  if (!tg?.enabled || !tg?.bot_token || !tg?.chat_id) {
    const reason = "Telegram is not connected. Pair Telegram before delivery.";
    audit("telegram.delivery_skipped", "workflow_run", runId, reason, {}, "system");
    return { ok: false, skipped: true, reason };
  }
  const markdown = markdownToTelegramMarkdown(artifact.onePageBrief || renderOnePageBrief(artifact));
  const chunks = telegramChunks(markdown);
  const sentMessages = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const prefix = chunks.length > 1 ? `Part ${i + 1}/${chunks.length}\n\n` : "";
    const payload = await sendTelegramMessage(tg.bot_token, tg.chat_id, `${prefix}${chunks[i]}`, {
      parseMode: "MarkdownV2",
      replyMarkup: i === chunks.length - 1 ? { inline_keyboard: [[{ text: "Deliberate", callback_data: `deliberate:${runId}` }]] } : null,
    });
    sentMessages.push(payload.result?.message_id);
  }
  run("UPDATE telegram_settings SET last_checked_at=$t, last_error='', updated_at=$t WHERE id=1", { $t: now() });
  const delivery = { ok: true, chatId: tg.chat_id, chunks: chunks.length, messageIds: sentMessages.filter(Boolean), deliveredAt: now() };
  const tts = ttsSettings();
  if (tts.status === "ready" && tts.telegramAutoSend) {
    try {
      const audio = await synthesizeElevenLabsAudio({ text: briefAudioText(artifact), filenamePrefix: `telegram-${runId}` });
      const payload = await sendTelegramAudio(tg.bot_token, tg.chat_id, audio.path, "Audio brief");
      delivery.audio = { ok: true, url: audio.url, bytes: audio.bytes, messageId: payload.result?.message_id };
      artifact.audio = audio;
      audit("telegram.audio_delivered", "workflow_run", runId, `Delivered ElevenLabs audio to chat ${tg.chat_id}`, { messageId: payload.result?.message_id, bytes: audio.bytes }, "system");
    } catch (error) {
      delivery.audio = { ok: false, error: error.message || "Audio delivery failed" };
      audit("telegram.audio_failed", "workflow_run", runId, delivery.audio.error, {}, "system");
    }
  }
  audit("telegram.delivered", "workflow_run", runId, `Delivered brief to chat ${tg.chat_id}`, { chunks: chunks.length, messageIds: sentMessages, audio: delivery.audio }, "system");
  return delivery;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callTextModel({ system, prompt }) {
  const modelRow = get("SELECT * FROM model_settings WHERE id=1");
  const settings = modelSettings();
  if (settings.status !== "ready") throw new Error("Model connector is not ready");
  const { apiKey, baseUrl } = modelRuntime(modelRow);
  if (!apiKey) throw new Error("Model API key is missing");
  const controller = new AbortController();
  const modelTimeoutMs = 300000;
  const timeout = setTimeout(() => controller.abort(), modelTimeoutMs);

  try {
    if (modelRow.provider === "anthropic") {
      const response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: modelRow.model,
          max_tokens: 1800,
          temperature: 0.2,
          system,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) throw new Error(`Model call failed: ${response.status} ${response.statusText} ${(await response.text()).slice(0, 240)}`);
      const payload = await response.json();
      return (payload.content || []).map((part) => part.text || "").join("\n").trim();
    }

    if (modelRow.provider === "gemini") {
      const response = await fetch(`${baseUrl}/models/${encodeURIComponent(modelRow.model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      });
      if (!response.ok) throw new Error(`Model call failed: ${response.status} ${response.statusText} ${(await response.text()).slice(0, 240)}`);
      const payload = await response.json();
      return (payload.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("\n").trim();
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelRow.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Model call failed: ${response.status} ${response.statusText} ${(await response.text()).slice(0, 240)}`);
    const payload = await response.json();
    return payload.choices?.[0]?.message?.content || "";
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`Model call timed out after ${Math.round(modelTimeoutMs / 1000)} seconds`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanPodcastSearchTerm(value) {
  return String(value || "")
    .replace(/\s*\|\s*Podcast on Spotify\s*/gi, "")
    .replace(/\s*\|\s*Spotify\s*/gi, "")
    .replace(/^Listen to\s+/i, "")
    .replace(/\s+on Spotify$/i, "")
    .trim();
}

function spotifyTitleCandidates(title) {
  const cleaned = cleanPodcastSearchTerm(title);
  const parts = cleaned.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  return [...new Set([
    cleaned,
    parts.at(-1),
    parts.length > 1 ? parts.slice(1).join(" - ") : "",
    parts[0],
  ].filter(Boolean))];
}

function extractMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"");
  }
  return "";
}

async function resolveSpotifyPodcast(spotifyUrl) {
  if (!/^https:\/\/open\.spotify\.com\/(episode|show)\//.test(spotifyUrl || "")) {
    return { ok: false, error: "Paste a Spotify episode or show URL from open.spotify.com" };
  }

  let spotifyTitle = "";
  try {
    const oembed = await fetchWithTimeout(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`);
    if (oembed.ok) {
      const payload = await oembed.json();
      spotifyTitle = payload.title || "";
    }
  } catch {}

  if (!spotifyTitle) {
    try {
      const page = await fetchWithTimeout(spotifyUrl);
      if (page.ok) {
        const html = await page.text();
        spotifyTitle = extractMeta(html, "og:title") || extractMeta(html, "twitter:title");
      }
    } catch {}
  }

  const candidates = spotifyTitleCandidates(spotifyTitle);
  for (const term of candidates) {
    try {
      const response = await fetchWithTimeout(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=5&term=${encodeURIComponent(term)}`);
      if (!response.ok) continue;
      const payload = await response.json();
      const result = (payload.results || []).find((item) => item.feedUrl);
      if (result) {
        return {
          ok: true,
          spotifyTitle,
          searchTerm: term,
          podcastTitle: result.collectionName,
          author: result.artistName,
          feedUrl: result.feedUrl,
          artworkUrl: result.artworkUrl600 || result.artworkUrl100 || "",
          confidence: result.collectionName?.toLowerCase() === term.toLowerCase() ? "high" : "medium",
        };
      }
    } catch {}
  }

  return {
    ok: false,
    spotifyTitle,
    error: spotifyTitle
      ? `Could not find a public RSS feed match for "${cleanPodcastSearchTerm(spotifyTitle)}". Try the podcast show URL or paste the RSS feed directly.`
      : "Could not read enough metadata from Spotify to search for the RSS feed.",
  };
}

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .trim();
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] || "");
}

function attrValue(xml, attr) {
  const match = xml.match(new RegExp(`${attr}=["']([^"']+)["']`, "i"));
  return decodeXml(match?.[1] || "");
}

function parsePodcastRss(xml) {
  const channelTitle = tagValue(xml, "title");
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => {
    const item = match[0];
    const enclosure = item.match(/<enclosure\b[^>]*>/i)?.[0] || "";
    return {
      title: tagValue(item, "title") || "Untitled episode",
      guid: tagValue(item, "guid") || tagValue(item, "link") || attrValue(enclosure, "url"),
      link: tagValue(item, "link"),
      pubDate: tagValue(item, "pubDate"),
      description: tagValue(item, "description"),
      audioUrl: attrValue(enclosure, "url"),
      audioType: attrValue(enclosure, "type") || "audio/mpeg",
      audioLength: Number(attrValue(enclosure, "length") || 0),
      channelTitle,
    };
  }).filter((episode) => episode.audioUrl);
}

function stripHtml(value = "") {
  return decodeXml(String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
}

function parseGenericFeed(xml) {
  const rssItems = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => {
    const item = match[0];
    return {
      title: tagValue(item, "title") || "Untitled item",
      url: tagValue(item, "link") || tagValue(item, "guid"),
      body: stripHtml(tagValue(item, "description") || tagValue(item, "content:encoded")),
      publishedAt: tagValue(item, "pubDate") || tagValue(item, "dc:date"),
      stableId: tagValue(item, "guid") || tagValue(item, "link") || tagValue(item, "title"),
    };
  });
  const atomItems = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => {
    const item = match[0];
    const link = item.match(/<link\b[^>]*>/i)?.[0] || "";
    return {
      title: tagValue(item, "title") || "Untitled item",
      url: attrValue(link, "href") || tagValue(item, "id"),
      body: stripHtml(tagValue(item, "summary") || tagValue(item, "content")),
      publishedAt: tagValue(item, "published") || tagValue(item, "updated"),
      stableId: tagValue(item, "id") || attrValue(link, "href") || tagValue(item, "title"),
    };
  });
  return [...rssItems, ...atomItems].filter((item) => item.title || item.url);
}

function startOfLocalDay() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfLocalDay() {
  const date = startOfLocalDay();
  date.setDate(date.getDate() + 1);
  return date;
}

function publishedToday(value) {
  if (!value) return false;
  const published = new Date(value);
  return Number.isFinite(published.getTime()) && published >= startOfLocalDay() && published < endOfLocalDay();
}

function episodeIsToday(episode) {
  return publishedToday(episode.pubDate);
}

function safeExtFromContentType(contentType = "", url = "") {
  const lower = `${contentType} ${url}`.toLowerCase();
  if (lower.includes("m4a") || lower.includes("mp4")) return ".m4a";
  if (lower.includes("ogg")) return ".ogg";
  if (lower.includes("wav")) return ".wav";
  if (lower.includes("webm")) return ".webm";
  return ".mp3";
}

async function downloadAudio(url, label) {
  const response = await fetchWithTimeout(url, {}, 30000);
  if (!response.ok) throw new Error(`Audio download failed: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get("content-type") || "";
  const extension = safeExtFromContentType(contentType, url);
  const filePath = path.join(audioDir, `${label}${extension}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, bytes);
  return { filePath, bytes: bytes.length, contentType };
}

async function splitAudio(filePath, label) {
  const status = await ffmpegStatus();
  if (!status.available) {
    throw new Error("Local podcast transcription is unavailable because FFmpeg is not installed. Install FFmpeg, then try again.");
  }
  const outputPattern = path.join(audioDir, `${label}-part-%03d.m4a`);
  await execFileAsync(status.path, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", filePath,
    "-f", "segment",
    "-segment_time", "600",
    "-c:a", "aac",
    "-b:a", "64k",
    outputPattern,
  ]);
  return fs.readdirSync(audioDir)
    .filter((file) => file.startsWith(`${label}-part-`) && file.endsWith(".m4a"))
    .sort()
    .map((file) => path.join(audioDir, file));
}

function isWavFile(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(12);
    fs.readSync(fd, header, 0, 12, 0);
    fs.closeSync(fd);
    return header.slice(0, 4).toString("ascii") === "RIFF" && header.slice(8, 12).toString("ascii") === "WAVE";
  } catch {
    return false;
  }
}

async function ensureWhisperWav(filePath) {
  if (isWavFile(filePath)) return { filePath, cleanup: false };
  const status = await ffmpegStatus();
  if (!status.available) {
    throw new Error("Local speech-to-text needs WAV audio. FFmpeg is required to convert this audio format, or record/send WAV directly.");
  }
  const wavPath = path.join(audioDir, `whisper-input-${id("wav")}.wav`);
  await execFileAsync(status.path, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", filePath,
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    wavPath,
  ], { timeout: 180000 });
  return { filePath: wavPath, cleanup: true };
}

async function transcribeWithWhisperCpp(filePath) {
  const status = await localSttStatus();
  if (!status.available) throw new Error(status.message);
  const wav = await ensureWhisperWav(filePath);
  const outputPrefix = path.join(audioDir, `whisper-output-${id("txt")}`);
  try {
    const { stdout } = await execFileAsync(status.binaryPath, [
      "-m", status.modelPath,
      "-f", wav.filePath,
      "-otxt",
      "-of", outputPrefix,
      "-nt",
      "--no-gpu",
    ], { timeout: 900000, maxBuffer: 1024 * 1024 * 8, env: whisperRuntimeEnv(status.binaryPath) });
    const outputFile = `${outputPrefix}.txt`;
    const transcript = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : stdout;
    try { fs.unlinkSync(outputFile); } catch {}
    return transcript.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
  } finally {
    if (wav.cleanup) {
      try { fs.unlinkSync(wav.filePath); } catch {}
    }
  }
}

async function transcribeAudioFile(filePath, modelSettingsRow) {
  const localStatus = await localSttStatus();
  if (localStatus.available) return transcribeWithWhisperCpp(filePath);
  const apiKey = modelSettingsRow.api_key || providerEnvKey(modelSettingsRow.provider);
  if (!apiKey) throw new Error(`Local speech-to-text is not ready. ${localStatus.message} Add an OpenAI-compatible key in Settings as a cloud fallback.`);
  if (!["openai", "custom"].includes(modelSettingsRow.provider)) {
    throw new Error(`Local speech-to-text is not ready. ${localStatus.message} Cloud transcription currently supports OpenAI or custom OpenAI-compatible providers.`);
  }
  const endpoint = modelSettingsRow.provider === "custom"
    ? `${modelSettingsRow.base_url.replace(/\/+$/, "")}/audio/transcriptions`
    : "https://api.openai.com/v1/audio/transcriptions";
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes]), path.basename(filePath));
  form.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
  form.append("response_format", "json");

  let response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }, 180000);

  if (!response.ok && modelSettingsRow.provider === "openai" && !process.env.OPENAI_TRANSCRIPTION_MODEL) {
    const retryForm = new FormData();
    retryForm.append("file", new Blob([bytes]), path.basename(filePath));
    retryForm.append("model", "whisper-1");
    retryForm.append("response_format", "json");
    response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: retryForm,
    }, 180000);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Transcription failed: ${response.status} ${response.statusText} ${text.slice(0, 300)}`);
  }
  const payload = await response.json();
  return payload.text || payload.transcript || "";
}

function saveTranscriptDocument({ source, episode, transcript }) {
  const t = now();
  const fingerprint = createHash("sha256").update(`${source.id}:${episode.guid || episode.audioUrl}`).digest("hex");
  const existing = get("SELECT id FROM normalized_items WHERE fingerprint=$fingerprint", { $fingerprint: fingerprint });
  if (existing) {
    run("UPDATE normalized_items SET last_seen_at=$t WHERE id=$id", { $id: existing.id, $t: t });
    return { skipped: true, documentId: null, fingerprint };
  }

  const docId = id("doc");
  const title = `Transcript: ${episode.title}`;
  const words = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;
  run(`INSERT INTO knowledge_documents (id, title, type, visibility, status, tags, body, word_count, created_at, updated_at)
       VALUES ($id, $title, 'Transcript', 'private', 'active', $tags, $body, $words, $t, $t)`, {
    $id: docId,
    $title: title,
    $tags: json(["podcast", "transcript", source.name]),
    $body: transcript,
    $words: words,
    $t: t,
  });

  const chunks = transcript.match(/(.|[\r\n]){1,1800}/g) || [];
  chunks.forEach((chunk, i) => run("INSERT INTO document_chunks (id, document_id, chunk_index, body, token_count, created_at) VALUES ($id, $doc, $idx, $body, $tokens, $t)", {
    $id: id("chunk"), $doc: docId, $idx: i, $body: chunk, $tokens: Math.ceil(chunk.split(/\s+/).length * 1.35), $t: t,
  }));

  run(`INSERT INTO normalized_items (id, source_id, canonical_url, title, body, published_at, fingerprint, relevance_score, rising_score, first_seen_at, last_seen_at, created_at)
       VALUES ($id, $sourceId, $url, $title, $body, $published, $fingerprint, 0, 0, $t, $t, $t)`, {
    $id: id("item"),
    $sourceId: source.id,
    $url: episode.link || episode.audioUrl,
    $title: episode.title,
    $body: transcript,
    $published: episode.pubDate ? new Date(episode.pubDate).toISOString() : null,
    $fingerprint: fingerprint,
    $t: t,
  });

  return { skipped: false, documentId: docId, fingerprint };
}

function itemFingerprint(sourceId, stableId) {
  return createHash("sha256").update(`${sourceId}:${stableId}`).digest("hex");
}

function scoreText(text = "", keywords = "") {
  const terms = String(keywords || "")
    .split(/[,|]/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  const lower = String(text || "").toLowerCase();
  const hits = terms.filter((term) => lower.includes(term)).length;
  return Math.min(1, hits / Math.max(terms.length || 1, 3));
}

function saveNormalizedItem({ source, canonicalUrl, title, body, publishedAt, stableId, relevanceScore = 0, risingScore = 0 }) {
  const fingerprint = itemFingerprint(source.id, stableId || canonicalUrl || title);
  const existing = get("SELECT id FROM normalized_items WHERE fingerprint=$fingerprint", { $fingerprint: fingerprint });
  const seenAt = now();
  if (existing) {
    run(`UPDATE normalized_items
         SET last_seen_at=$seenAt,
             relevance_score=MAX(relevance_score, $relevance),
             rising_score=MAX(rising_score, $rising),
             body=CASE WHEN length(COALESCE(body, '')) < length($body) THEN $body ELSE body END
         WHERE id=$id`, {
      $id: existing.id,
      $seenAt: seenAt,
      $relevance: relevanceScore,
      $rising: risingScore,
      $body: body || "",
    });
    return { inserted: false, reused: true, id: existing.id, fingerprint };
  }
  const itemId = id("item");
  run(`INSERT INTO normalized_items (id, source_id, canonical_url, title, body, published_at, fingerprint, relevance_score, rising_score, first_seen_at, last_seen_at, created_at)
       VALUES ($id, $sourceId, $url, $title, $body, $published, $fingerprint, $relevance, $rising, $t, $t, $t)`, {
    $id: itemId,
    $sourceId: source.id,
    $url: canonicalUrl || "",
    $title: title || "Untitled item",
    $body: body || "",
    $published: publishedAt || null,
    $fingerprint: fingerprint,
    $relevance: relevanceScore,
    $rising: risingScore,
    $t: now(),
  });
  return { inserted: true, id: itemId, fingerprint };
}

async function transcribePodcastSource(sourceId, mode = "today") {
  const row = get("SELECT * FROM sources WHERE id=$id", { $id: sourceId });
  if (!row) throw new Error("Source not found");
  const source = { ...row, config: parse(row.config_json, {}) };
  if (source.type !== "Podcast") throw new Error("Source is not a podcast");
  const feedUrl = source.config.feedUrl || source.locator;
  if (!feedUrl) throw new Error("Podcast source does not have an RSS feed URL");

  const feed = await fetchWithTimeout(feedUrl);
  if (!feed.ok) throw new Error(`RSS fetch failed: ${feed.status} ${feed.statusText}`);
  const episodes = parsePodcastRss(await feed.text());
  const candidates = mode === "latest" ? episodes : episodes.filter(episodeIsToday);
  const episode = candidates[0];
  if (!episode) {
    const fetchedAt = now();
    const config = { ...source.config, lastFetchedAt: fetchedAt, lastFetchCacheStatus: "no-episode", lastFetchedCount: episodes.length, lastInsertedCount: 0 };
    run("UPDATE sources SET config_json=$config, updated_at=$t WHERE id=$id", { $id: source.id, $config: json(config), $t: fetchedAt });
    return { ok: true, transcribed: false, reason: mode === "latest" ? "No podcast episodes with audio were found." : "No podcast episode published today was found.", episodesChecked: episodes.length };
  }
  const episodeFingerprint = createHash("sha256").update(`${source.id}:${episode.guid || episode.audioUrl}`).digest("hex");
  const existingEpisode = get("SELECT id FROM normalized_items WHERE fingerprint=$fingerprint", { $fingerprint: episodeFingerprint });
  if (existingEpisode) {
    const config = { ...source.config, lastTranscribedGuid: episode.guid, lastTranscribedAt: now(), lastTranscriptItemId: existingEpisode.id };
    run("UPDATE sources SET config_json=$config, updated_at=$t WHERE id=$id", { $id: source.id, $config: json(config), $t: now() });
    return {
      ok: true,
      transcribed: false,
      skipped: true,
      reason: "Episode was already transcribed.",
      episode: { title: episode.title, pubDate: episode.pubDate, audioUrl: episode.audioUrl },
      documentId: source.config.lastTranscriptDocumentId || null,
      words: 0,
      chunks: 0,
      audioBytes: 0,
    };
  }

  const modelRow = get("SELECT * FROM model_settings WHERE id=1");
  const label = createHash("sha1").update(`${source.id}:${episode.guid || episode.audioUrl}:${Date.now()}`).digest("hex").slice(0, 14);
  const downloaded = await downloadAudio(episode.audioUrl, label);
  let partFiles = [downloaded.filePath];
  if (downloaded.bytes > 24 * 1024 * 1024) {
    partFiles = await splitAudio(downloaded.filePath, label);
  }
  const texts = [];
  for (const part of partFiles) {
    texts.push(await transcribeAudioFile(part, modelRow));
  }
  const transcript = texts.join("\n\n").trim();
  if (!transcript) throw new Error("Transcription returned no text");
  const saved = saveTranscriptDocument({ source, episode, transcript });
  const config = { ...source.config, lastTranscribedGuid: episode.guid, lastTranscribedAt: now(), lastTranscriptDocumentId: saved.documentId };
  run("UPDATE sources SET config_json=$config, updated_at=$t WHERE id=$id", { $id: source.id, $config: json(config), $t: now() });
  audit("podcast.transcribed", "source", source.id, saved.skipped ? `Already transcribed: ${episode.title}` : `Transcribed: ${episode.title}`, { documentId: saved.documentId, fingerprint: saved.fingerprint }, "system");
  return {
    ok: true,
    transcribed: !saved.skipped,
    skipped: saved.skipped,
    episode: { title: episode.title, pubDate: episode.pubDate, audioUrl: episode.audioUrl },
    documentId: saved.documentId,
    words: transcript.split(/\s+/).length,
    chunks: partFiles.length,
    audioBytes: downloaded.bytes,
  };
}

async function fetchRssSource(source) {
  const config = source.config || {};
  const feedUrl = config.feedUrl || source.locator;
  if (!feedUrl) return { ok: true, skipped: true, reason: "No RSS feed URL configured", seen: 0, inserted: 0 };
  const headers = { "User-Agent": "PillarBrief/0.1" };
  if (config.lastEtag) headers["If-None-Match"] = config.lastEtag;
  if (config.lastModified) headers["If-Modified-Since"] = config.lastModified;
  const response = await fetchWithTimeout(feedUrl, { headers });
  if (response.status === 304) {
    const fetchedAt = now();
    const nextConfig = { ...config, lastFetchedAt: fetchedAt, lastFetchCacheStatus: "not-modified", lastInsertedCount: 0 };
    run("UPDATE sources SET config_json=$config, updated_at=$t WHERE id=$id", { $id: source.id, $config: json(nextConfig), $t: fetchedAt });
    audit("rss.cache_hit", "source", source.id, "RSS feed not modified; using cached normalized items", {}, "system");
    return { ok: true, skipped: false, cached: true, cacheStatus: "not-modified", seen: 0, inserted: 0 };
  }
  if (!response.ok) throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
  const parsedItems = parseGenericFeed(await response.text()).slice(0, Number(config.maxItems || 8));
  const items = parsedItems.filter((item) => publishedToday(item.publishedAt));
  let inserted = 0;
  for (const item of items) {
    const saved = saveNormalizedItem({
      source,
      stableId: item.stableId,
      canonicalUrl: item.url,
      title: item.title,
      body: item.body,
      publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
      relevanceScore: scoreText(`${item.title} ${item.body}`, config.keywords),
      risingScore: item.publishedAt && new Date(item.publishedAt) >= startOfLocalDay() ? 0.35 : 0.1,
    });
    if (saved.inserted) inserted += 1;
  }
  const fetchedAt = now();
  const nextConfig = {
    ...config,
    lastFetchedAt: fetchedAt,
    lastFetchedCount: parsedItems.length,
    lastFetchedTodayCount: items.length,
    lastInsertedCount: inserted,
    lastFetchCacheStatus: inserted ? "new-items" : "deduped",
    lastEtag: response.headers.get("etag") || config.lastEtag || "",
    lastModified: response.headers.get("last-modified") || config.lastModified || "",
  };
  run("UPDATE sources SET config_json=$config, updated_at=$t WHERE id=$id", { $id: source.id, $config: json(nextConfig), $t: fetchedAt });
  audit("rss.fetched", "source", source.id, `Fetched ${parsedItems.length} RSS items; ${items.length} published today; inserted ${inserted}`, { fetched: parsedItems.length, today: items.length, inserted }, "system");
  return { ok: true, skipped: false, seen: parsedItems.length, today: items.length, inserted };
}

function redditUrlForSource(source) {
  const config = source.config || {};
  const limit = Math.max(5, Math.min(25, Number(config.maxItems || 10)));
  if (config.mode === "search") {
    const params = new URLSearchParams({ q: config.query || source.locator, sort: config.sort || "new", t: "day", limit: String(limit), raw_json: "1" });
    return `https://www.reddit.com/search.json?${params}`;
  }
  if (config.mode === "user") {
    const user = String(config.username || source.locator || "").replace(/^u\//, "").replace(/^@/, "");
    return `https://www.reddit.com/user/${encodeURIComponent(user)}/submitted.json?limit=${limit}&raw_json=1`;
  }
  const subreddit = String(config.subreddits || source.locator || "").split(",")[0].trim().replace(/^r\//, "").replace(/^subreddits:/, "");
  const sort = ["hot", "top"].includes(config.sort) ? config.sort : "new";
  return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.json?limit=${limit}&raw_json=1`;
}

function redditRssUrlForSource(source) {
  const config = source.config || {};
  if (config.mode === "search") {
    const params = new URLSearchParams({ q: config.query || source.locator, sort: config.sort || "new", t: "day" });
    return `https://www.reddit.com/search.rss?${params}`;
  }
  if (config.mode === "user") {
    const user = String(config.username || source.locator || "").replace(/^u\//, "").replace(/^@/, "");
    return `https://www.reddit.com/user/${encodeURIComponent(user)}/submitted.rss`;
  }
  const subreddit = String(config.subreddits || source.locator || "").split(",")[0].trim().replace(/^r\//, "").replace(/^subreddits:/, "");
  const sort = ["hot", "top"].includes(config.sort) ? config.sort : "new";
  return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}.rss`;
}

async function fetchRedditSource(source) {
  const config = source.config || {};
  const response = await fetchWithTimeout(redditUrlForSource(source), { headers: { "User-Agent": "PillarBrief/0.1 by operator" } });
  if (response.status === 403 || response.status === 429) {
    const rss = await fetchWithTimeout(redditRssUrlForSource(source), { headers: { "User-Agent": "PillarBrief/0.1 by operator" } });
    if (!rss.ok) throw new Error(`Reddit fetch failed: ${response.status} ${response.statusText}; RSS fallback failed: ${rss.status} ${rss.statusText}`);
    const parsedItems = parseGenericFeed(await rss.text()).slice(0, Number(config.maxItems || 10));
    const items = parsedItems.filter((item) => publishedToday(item.publishedAt));
    let inserted = 0;
    for (const item of items) {
      const saved = saveNormalizedItem({
        source,
        stableId: item.stableId,
        canonicalUrl: item.url,
        title: item.title,
        body: item.body,
        publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
        relevanceScore: scoreText(`${item.title} ${item.body}`, config.keywords || config.query),
        risingScore: item.publishedAt && new Date(item.publishedAt) >= startOfLocalDay() ? 0.3 : 0.08,
      });
      if (saved.inserted) inserted += 1;
    }
    const nextConfig = { ...config, lastFetchedAt: now(), lastFetchedCount: parsedItems.length, lastFetchedTodayCount: items.length, lastInsertedCount: inserted, lastFetchMode: "rss-fallback" };
    run("UPDATE sources SET config_json=$config, updated_at=$t WHERE id=$id", { $id: source.id, $config: json(nextConfig), $t: now() });
    audit("reddit.fetched", "source", source.id, `Fetched ${parsedItems.length} Reddit RSS items; ${items.length} published today; inserted ${inserted}`, { fetched: parsedItems.length, today: items.length, inserted, mode: "rss-fallback" }, "system");
    return { ok: true, skipped: false, seen: parsedItems.length, today: items.length, inserted, mode: "rss-fallback" };
  }
  if (!response.ok) throw new Error(`Reddit fetch failed: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  const parsedPosts = (payload.data?.children || []).map((child) => child.data).filter(Boolean);
  const posts = parsedPosts.filter((post) => publishedToday(post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null));
  let inserted = 0;
  for (const post of posts) {
    const body = [post.selftext, post.url && !String(post.url).includes("reddit.com") ? `Link: ${post.url}` : ""].filter(Boolean).join("\n");
    const saved = saveNormalizedItem({
      source,
      stableId: post.name || post.id,
      canonicalUrl: `https://www.reddit.com${post.permalink || ""}`,
      title: post.title,
      body,
      publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
      relevanceScore: scoreText(`${post.title} ${body}`, config.keywords || config.query),
      risingScore: Math.min(1, Math.log10(Number(post.score || 0) + Number(post.num_comments || 0) + 1) / 4),
    });
    if (saved.inserted) inserted += 1;
  }
  const nextConfig = { ...config, lastFetchedAt: now(), lastFetchedCount: parsedPosts.length, lastFetchedTodayCount: posts.length, lastInsertedCount: inserted };
  run("UPDATE sources SET config_json=$config, updated_at=$t WHERE id=$id", { $id: source.id, $config: json(nextConfig), $t: now() });
  audit("reddit.fetched", "source", source.id, `Fetched ${parsedPosts.length} Reddit posts; ${posts.length} published today; inserted ${inserted}`, { fetched: parsedPosts.length, today: posts.length, inserted }, "system");
  return { ok: true, skipped: false, seen: parsedPosts.length, today: posts.length, inserted };
}

async function fetchWebSource(source) {
  const config = source.config || {};
  const url = config.url || source.locator;
  if (!url || !/^https?:\/\//.test(url)) return { ok: true, skipped: true, reason: "No public web URL configured", seen: 0, inserted: 0 };
  const headers = { "User-Agent": "PillarBrief/0.1" };
  if (config.lastEtag) headers["If-None-Match"] = config.lastEtag;
  if (config.lastModified) headers["If-Modified-Since"] = config.lastModified;
  const response = await fetchWithTimeout(url, { headers });
  if (response.status === 304) {
    const fetchedAt = now();
    const nextConfig = { ...config, lastFetchedAt: fetchedAt, lastFetchCacheStatus: "not-modified", lastInsertedCount: 0 };
    run("UPDATE sources SET config_json=$config, updated_at=$t WHERE id=$id", { $id: source.id, $config: json(nextConfig), $t: fetchedAt });
    audit("web.cache_hit", "source", source.id, "Web page not modified; using cached normalized item", {}, "system");
    return { ok: true, skipped: false, cached: true, cacheStatus: "not-modified", seen: 0, inserted: 0 };
  }
  if (!response.ok) throw new Error(`Web fetch failed: ${response.status} ${response.statusText}`);
  const html = await response.text();
  const title = stripHtml(extractMeta(html, "og:title") || extractMeta(html, "twitter:title") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || source.name);
  const description = stripHtml(extractMeta(html, "og:description") || extractMeta(html, "description") || "");
  const publishedAt = extractMeta(html, "article:published_time") || extractMeta(html, "datePublished") || extractMeta(html, "publishdate") || extractMeta(html, "pubdate") || "";
  const saved = saveNormalizedItem({
    source,
    stableId: `${url}:${title}`,
    canonicalUrl: url,
    title,
    body: description,
    publishedAt: publishedAt && publishedToday(publishedAt) ? new Date(publishedAt).toISOString() : null,
    relevanceScore: scoreText(`${title} ${description}`, config.keywords),
    risingScore: 0.05,
  });
  const inserted = saved.inserted ? 1 : 0;
  const fetchedAt = now();
  const nextConfig = {
    ...config,
    lastFetchedAt: fetchedAt,
    lastFetchedCount: 1,
    lastInsertedCount: inserted,
    lastFetchCacheStatus: inserted ? "new-item" : "deduped",
    lastEtag: response.headers.get("etag") || config.lastEtag || "",
    lastModified: response.headers.get("last-modified") || config.lastModified || "",
  };
  run("UPDATE sources SET config_json=$config, updated_at=$t WHERE id=$id", { $id: source.id, $config: json(nextConfig), $t: fetchedAt });
  audit("web.fetched", "source", source.id, `Fetched web page metadata; inserted ${inserted}`, { fetched: 1, inserted }, "system");
  return { ok: true, skipped: false, seen: 1, inserted };
}

function eventDateTimeValue(value = {}) {
  return value.dateTime || value.date || "";
}

function eventDisplayTime(event = {}) {
  const start = eventDateTimeValue(event.start);
  const end = eventDateTimeValue(event.end);
  const opts = { hour: "numeric", minute: "2-digit" };
  if (!start) return "All day";
  if (event.start?.date && !event.start?.dateTime) return "All day";
  const startText = new Date(start).toLocaleTimeString([], opts);
  const endText = end ? new Date(end).toLocaleTimeString([], opts) : "";
  return endText ? `${startText}-${endText}` : startText;
}

function formatCalendarEventBody(event = {}, source = {}, config = {}) {
  const parts = [
    `Time: ${eventDisplayTime(event)}`,
    event.location ? `Location: ${event.location}` : "",
  ];
  if (config.includeAttendees !== false && Array.isArray(event.attendees) && event.attendees.length) {
    const attendees = event.attendees
      .filter((attendee) => attendee.email || attendee.displayName)
      .slice(0, 12)
      .map((attendee) => attendee.displayName || attendee.email)
      .join(", ");
    if (attendees) parts.push(`Attendees: ${attendees}`);
  }
  if (config.includeDescriptions && event.description) parts.push(`Description: ${stripHtml(event.description).slice(0, 1000)}`);
  return parts.filter(Boolean).join("\n");
}

function calendarAgendaFromEvents(events = [], source = {}, config = {}) {
  return events.map((event) => ({
    id: event.id,
    title: event.summary || "Untitled event",
    calendar: source.name,
    calendarId: config.calendarId || "primary",
    start: eventDateTimeValue(event.start),
    end: eventDateTimeValue(event.end),
    time: eventDisplayTime(event),
    location: event.location || "",
    attendees: config.includeAttendees === false ? [] : (event.attendees || []).slice(0, 12).map((attendee) => attendee.displayName || attendee.email).filter(Boolean),
    description: config.includeDescriptions ? stripHtml(event.description || "").slice(0, 1000) : "",
    htmlLink: event.htmlLink || "",
  }));
}

async function fetchGoogleCalendarEventsForCalendar({ source, calendarId, accessToken, config }) {
  const params = new URLSearchParams({
    timeMin: startOfLocalDay().toISOString(),
    timeMax: endOfLocalDay().toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    showDeleted: "false",
    maxResults: String(Math.max(1, Math.min(50, Number(config.maxResults || 20)))),
    timeZone: briefConfig().deliveryTimezone || "UTC",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Google Calendar fetch failed: ${response.status} ${response.statusText}`);
  return Array.isArray(payload.items) ? payload.items : [];
}

async function fetchGoogleCalendarSource(source) {
  const config = source.config || {};
  const credential = googleCalendarCredential();
  const selectedCalendarIds = Array.isArray(credential.data.selectedCalendarIds) && credential.data.selectedCalendarIds.length ? credential.data.selectedCalendarIds : ["primary"];
  const calendarIds = Array.isArray(config.calendarIds) && config.calendarIds.length
    ? config.calendarIds
    : config.calendarId && config.calendarId !== "selected"
      ? [config.calendarId]
      : selectedCalendarIds;
  const accessToken = await refreshGoogleCalendarAccessToken();
  const rawEventsByCalendar = [];
  for (const calendarId of calendarIds) {
    const events = await fetchGoogleCalendarEventsForCalendar({ source, calendarId, accessToken, config });
    rawEventsByCalendar.push(...events.map((event) => ({ ...event, pillarCalendarId: calendarId })));
  }
  const rawEvents = rawEventsByCalendar.sort((a, b) => String(eventDateTimeValue(a.start)).localeCompare(String(eventDateTimeValue(b.start))));
  const events = rawEvents.filter((event) => {
    if (event.status === "cancelled") return false;
    if (config.includeDeclined) return true;
    const selfAttendee = (event.attendees || []).find((attendee) => attendee.self);
    return selfAttendee?.responseStatus !== "declined";
  });
  let inserted = 0;
  for (const event of events) {
    const start = eventDateTimeValue(event.start);
    const saved = saveNormalizedItem({
      source,
      stableId: event.id ? `${event.pillarCalendarId || "calendar"}:${event.id}` : event.htmlLink || `${event.pillarCalendarId || "calendar"}:${event.summary}:${start}`,
      canonicalUrl: event.htmlLink || "",
      title: `Calendar: ${event.summary || "Untitled event"}`,
      body: formatCalendarEventBody(event, source, config),
      publishedAt: start ? new Date(start).toISOString() : startOfLocalDay().toISOString(),
      relevanceScore: 0.72,
      risingScore: 0.2,
    });
    if (saved.inserted) inserted += 1;
  }
  const agenda = calendarAgendaFromEvents(events, source, config);
  const fetchedAt = now();
  const nextConfig = { ...config, calendarId: config.calendarId || "selected", calendarIds, lastFetchedAt: fetchedAt, lastFetchedCount: rawEvents.length, lastFetchedTodayCount: events.length, lastInsertedCount: inserted, lastAgenda: agenda };
  run("UPDATE sources SET config_json=$config, updated_at=$t WHERE id=$id", { $id: source.id, $config: json(nextConfig), $t: fetchedAt });
  audit("calendar.fetched", "source", source.id, `Fetched ${events.length} Google Calendar event${events.length === 1 ? "" : "s"} for today`, { fetched: rawEvents.length, today: events.length, inserted, calendarIds }, "system");
  return { ok: true, skipped: false, seen: rawEvents.length, today: events.length, inserted, calendarIds, agenda };
}

function xBearerToken() {
  const row = get("SELECT * FROM connector_credentials WHERE provider='x'");
  return row?.enabled && row.api_key ? row.api_key : "";
}

const GOOGLE_CALENDAR_PROVIDER = "google_calendar";
const GOOGLE_CALENDAR_DESKTOP_CLIENT_ID = process.env.PILLAR_GOOGLE_CALENDAR_CLIENT_ID || "190790037747-8mou84ivna7taems83u92t7fpfsd12m3.apps.googleusercontent.com";
// Optional for self-hosted/custom confidential OAuth clients. The packaged
// desktop app uses Google's installed-app PKCE flow and does not need a secret.
const GOOGLE_CALENDAR_CLIENT_SECRET = process.env.PILLAR_GOOGLE_CALENDAR_CLIENT_SECRET || "";
const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
const GOOGLE_CALENDAR_SCOPE = GOOGLE_CALENDAR_SCOPES.join(" ");

function googleCalendarCredential() {
  const row = get("SELECT * FROM connector_credentials WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER });
  const data = parse(row?.api_key, {});
  return {
    row,
    data: data && typeof data === "object" ? data : {},
    enabled: !!row?.enabled,
  };
}

function googleCalendarRedirectUri(req) {
  return `${req.protocol}://${req.get("host")}/api/google-calendar/oauth/callback`;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function googleCalendarPkcePair() {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function googleCalendarPublicConnector(connector = googleCalendarCredential()) {
  const { row, data, enabled } = connector;
  const hasClient = !!(data.clientId || GOOGLE_CALENDAR_DESKTOP_CLIENT_ID);
  const hasRefreshToken = !!data.refreshToken;
  return {
    provider: "googleCalendar",
    enabled,
    apiKeySaved: hasRefreshToken,
    clientConfigured: hasClient,
    credentialStatus: hasRefreshToken ? "saved" : hasClient ? "client configured" : "missing",
    status: enabled && hasRefreshToken ? "ready" : hasClient ? "needs consent" : "pending credentials",
    calendarId: data.calendarId || "primary",
    selectedCalendarIds: Array.isArray(data.selectedCalendarIds) && data.selectedCalendarIds.length ? data.selectedCalendarIds : ["primary"],
    calendars: Array.isArray(data.calendars) ? data.calendars : [],
    scope: data.scope || GOOGLE_CALENDAR_SCOPE,
    redirectUri: data.redirectUri || "",
    lastCheckedAt: row?.last_checked_at || null,
    lastError: row?.last_error || null,
    updatedAt: row?.updated_at || null,
  };
}

function saveGoogleCalendarCredential(data, { enabled = false, lastError = "" } = {}) {
  run(`INSERT INTO connector_credentials (provider, api_key, enabled, last_error, updated_at)
       VALUES ($provider, $apiKey, $enabled, $err, $t)
       ON CONFLICT(provider) DO UPDATE SET api_key=$apiKey, enabled=$enabled, last_error=$err, updated_at=$t`, {
    $provider: GOOGLE_CALENDAR_PROVIDER,
    $apiKey: json(data),
    $enabled: enabled ? 1 : 0,
    $err: lastError,
    $t: now(),
  });
}

async function exchangeGoogleCalendarCode({ clientId, clientSecret, code, redirectUri, codeVerifier }) {
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  if (codeVerifier) body.set("code_verifier", codeVerifier);
  const response = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.error || `Google OAuth token exchange failed: ${response.status} ${response.statusText}`);
  return payload;
}

async function refreshGoogleCalendarAccessToken() {
  const connector = googleCalendarCredential();
  const { data, enabled } = connector;
  if (!enabled || !data.refreshToken || !(data.clientId || GOOGLE_CALENDAR_DESKTOP_CLIENT_ID)) throw new Error("Google Calendar is not connected.");
  if (data.accessToken && data.expiresAt && Number(data.expiresAt) > Date.now() + 60000) return data.accessToken;
  const body = new URLSearchParams({
    client_id: data.clientId || GOOGLE_CALENDAR_DESKTOP_CLIENT_ID,
    refresh_token: data.refreshToken,
    grant_type: "refresh_token",
  });
  const clientSecret = String(data.clientSecret || GOOGLE_CALENDAR_CLIENT_SECRET || "").trim();
  if (clientSecret) body.set("client_secret", clientSecret);
  const response = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload.error_description || payload.error || `Google token refresh failed: ${response.status} ${response.statusText}`;
    run("UPDATE connector_credentials SET last_checked_at=$t, last_error=$err, updated_at=$t WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER, $t: now(), $err: error });
    throw new Error(error);
  }
  const nextData = {
    ...data,
    accessToken: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
    tokenType: payload.token_type || data.tokenType || "Bearer",
  };
  saveGoogleCalendarCredential(nextData, { enabled: true });
  run("UPDATE connector_credentials SET last_checked_at=$t, last_error='', updated_at=$t WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER, $t: now() });
  return nextData.accessToken;
}

async function fetchGoogleCalendarList() {
  const accessToken = await refreshGoogleCalendarAccessToken();
  const response = await fetchWithTimeout("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Google Calendar list failed: ${response.status} ${response.statusText}`);
  return (Array.isArray(payload.items) ? payload.items : []).map((calendar) => ({
    id: calendar.id,
    summary: calendar.summary || calendar.id,
    description: calendar.description || "",
    primary: !!calendar.primary,
    accessRole: calendar.accessRole || "",
    backgroundColor: calendar.backgroundColor || "",
    selected: calendar.selected !== false,
  })).filter((calendar) => calendar.id);
}

function xHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

const X_QUICK_MAX_RESULTS = 10;
const X_QUICK_CACHE_MINUTES = 60;
const X_ESTIMATED_POST_READ_COST_USD = 0.005;

function xQuickQuery(rawQuery = "") {
  let query = String(rawQuery || "").trim();
  if (!query) return "";
  if (!/\bis:retweet\b/i.test(query) && !/\b-is:retweet\b/i.test(query)) query += " -is:retweet";
  if (!/\bis:reply\b/i.test(query) && !/\b-is:reply\b/i.test(query)) query += " -is:reply";
  return query;
}

function xQueryParams(config, maxResults = X_QUICK_MAX_RESULTS) {
  const params = new URLSearchParams({
    query: xQuickQuery(config.query || ""),
    max_results: String(X_QUICK_MAX_RESULTS),
    "tweet.fields": "created_at,public_metrics,author_id,lang",
    start_time: startOfLocalDay().toISOString(),
  });
  return params;
}

async function fetchXCount({ source, token }) {
  const config = source.config || {};
  const params = new URLSearchParams({ query: config.query || "", granularity: "day", start_time: startOfLocalDay().toISOString() });
  const response = await fetchWithTimeout(`https://api.x.com/2/tweets/counts/recent?${params}`, { headers: xHeaders(token) });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`X counts failed: ${response.status} ${response.statusText} ${text.slice(0, 240)}`);
  }
  const payload = await response.json();
  return (payload.data || []).reduce((sum, bucket) => sum + Number(bucket.tweet_count || 0), 0);
}

async function fetchXSource(source) {
  const config = source.config || {};
  if (!config.query) return { ok: true, skipped: true, reason: "No X query configured", inserted: 0, seen: 0 };
  const token = xBearerToken();
  if (!token) return { ok: true, skipped: true, reason: "X connector is missing or disabled", inserted: 0, seen: 0 };

  const maxResults = X_QUICK_MAX_RESULTS;
  const quickQuery = xQuickQuery(config.query);
  const params = xQueryParams({ ...config, query: quickQuery }, maxResults);
  const response = await fetchWithTimeout(`https://api.x.com/2/tweets/search/recent?${params}`, { headers: xHeaders(token) });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`X recent search failed: ${response.status} ${response.statusText} ${text.slice(0, 240)}`);
  }
  const payload = await response.json();
  const parsedPosts = Array.isArray(payload.data) ? payload.data.slice(0, maxResults) : [];
  const posts = parsedPosts.filter((post) => publishedToday(post.created_at));
  let inserted = 0;
  for (const post of posts) {
    const metrics = post.public_metrics || {};
    const engagement = Number(metrics.like_count || 0) + Number(metrics.retweet_count || 0) * 2 + Number(metrics.reply_count || 0) + Number(metrics.quote_count || 0) * 2;
    const saved = saveNormalizedItem({
      source,
      stableId: post.id,
      canonicalUrl: `https://x.com/i/web/status/${post.id}`,
      title: post.text.split(/\s+/).slice(0, 16).join(" "),
      body: post.text,
      publishedAt: post.created_at || null,
      relevanceScore: scoreText(post.text, config.keywords),
      risingScore: Math.min(1, Math.log10(engagement + 1) / 4),
    });
    if (saved.inserted) inserted += 1;
  }
  const estimatedCost = Number((parsedPosts.length * X_ESTIMATED_POST_READ_COST_USD).toFixed(3));
  const nextConfig = {
    ...config,
    query: config.query,
    quickMode: true,
    quickModeLocked: true,
    lastFetchedAt: now(),
    lastFetchedCount: parsedPosts.length,
    lastFetchedTodayCount: posts.length,
    lastInsertedCount: inserted,
    lastEstimatedCostUsd: estimatedCost,
  };
  run("UPDATE sources SET config_json=$config, updated_at=$t WHERE id=$id", { $id: source.id, $config: json(nextConfig), $t: now() });
  audit("x.fetched", "source", source.id, `Quick fetched ${parsedPosts.length} X posts; ${posts.length} published today; inserted ${inserted}; est. cost $${estimatedCost.toFixed(3)}`, { query: quickQuery, fetched: parsedPosts.length, today: posts.length, inserted, maxResults, estimatedCostUsd: estimatedCost, quickMode: true }, "system");
  return { ok: true, skipped: false, seen: parsedPosts.length, today: posts.length, inserted, maxResults, estimatedCostUsd: estimatedCost, quickMode: true, query: quickQuery };
}

function recentSourceCache(source, maxAgeMinutes = 10) {
  const config = source.config || {};
  const fetchedAt = config.lastFetchedAt || config.lastTranscribedAt;
  if (!fetchedAt) return null;
  const fetchedMs = new Date(fetchedAt).getTime();
  const ageMs = Date.now() - fetchedMs;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMinutes * 60 * 1000) return null;
  const minutesAgo = Math.max(1, Math.round(ageMs / 60000));
  return {
    ok: true,
    skipped: false,
    cached: true,
    cacheStatus: "recent-source-cache",
    reason: `Using source results gathered ${minutesAgo} minute${minutesAgo === 1 ? "" : "s"} ago.`,
    seen: Number(config.lastFetchedCount || 0),
    inserted: 0,
    preflightInserted: Number(config.lastFetchedTodayCount ?? config.lastInsertedCount ?? 0),
    lastFetchedAt: fetchedAt,
  };
}

async function fetchSourceCollection({ useRecentCache = false, onProgress } = {}) {
  const activeSources = sources().filter((s) => s.status === "active" && s.approvalStatus === "approved");
  const podcastSources = activeSources.filter((s) => s.type === "Podcast");
  const xSources = activeSources.filter((s) => s.type === "X");
  const rssSources = activeSources.filter((s) => s.type === "RSS");
  const redditSources = activeSources.filter((s) => s.type === "Reddit");
  const webSources = activeSources.filter((s) => s.type === "Web");
  const calendarSources = activeSources.filter((s) => s.type === "Calendar");
  const transcriptionSources = podcastSources.filter((s) => s.config?.transcribeNewEpisodes !== false);
  const transcriptionResults = [];
  let checkedSources = 0;
  const totalFetchSources = transcriptionSources.length + xSources.length + rssSources.length + redditSources.length + webSources.length + calendarSources.length;
  const reportFetchProgress = (label) => {
    checkedSources += 1;
    onProgress?.({
      output: `${checkedSources} of ${totalFetchSources} source${totalFetchSources === 1 ? "" : "s"} checked`,
      detail: label,
    });
  };
  for (const source of transcriptionSources) {
    try {
      const cached = useRecentCache ? recentSourceCache(source) : null;
      transcriptionResults.push(cached
        ? { sourceId: source.id, sourceName: source.name, transcribed: false, ...cached }
        : { sourceId: source.id, sourceName: source.name, ...(await transcribePodcastSource(source.id, "today")) });
    } catch (error) {
      transcriptionResults.push({ sourceId: source.id, sourceName: source.name, ok: false, error: error.message || "Transcription failed" });
    } finally {
      reportFetchProgress(`Podcast: ${source.name}`);
    }
  }
  const xResults = [];
  for (const source of xSources) {
    try {
      const cached = useRecentCache ? recentSourceCache(source, X_QUICK_CACHE_MINUTES) : null;
      xResults.push(cached ? { sourceId: source.id, sourceName: source.name, ...cached } : { sourceId: source.id, sourceName: source.name, ...(await fetchXSource(source)) });
    } catch (error) {
      xResults.push({ sourceId: source.id, sourceName: source.name, ok: false, error: error.message || "X fetch failed" });
      audit("x.fetch_failed", "source", source.id, error.message || "X fetch failed", {}, "system");
    } finally {
      reportFetchProgress(`X: ${source.name}`);
    }
  }
  const rssResults = [];
  for (const source of rssSources) {
    try {
      const cached = useRecentCache ? recentSourceCache(source) : null;
      rssResults.push(cached ? { sourceId: source.id, sourceName: source.name, ...cached } : { sourceId: source.id, sourceName: source.name, ...(await fetchRssSource(source)) });
    } catch (error) {
      rssResults.push({ sourceId: source.id, sourceName: source.name, ok: false, error: error.message || "RSS fetch failed" });
      audit("rss.fetch_failed", "source", source.id, error.message || "RSS fetch failed", {}, "system");
    } finally {
      reportFetchProgress(`RSS: ${source.name}`);
    }
  }
  const redditResults = [];
  for (const source of redditSources) {
    try {
      const cached = useRecentCache ? recentSourceCache(source) : null;
      redditResults.push(cached ? { sourceId: source.id, sourceName: source.name, ...cached } : { sourceId: source.id, sourceName: source.name, ...(await fetchRedditSource(source)) });
    } catch (error) {
      redditResults.push({ sourceId: source.id, sourceName: source.name, ok: false, error: error.message || "Reddit fetch failed" });
      audit("reddit.fetch_failed", "source", source.id, error.message || "Reddit fetch failed", {}, "system");
    } finally {
      reportFetchProgress(`Reddit: ${source.name}`);
    }
  }
  const webResults = [];
  for (const source of webSources) {
    try {
      const cached = useRecentCache ? recentSourceCache(source) : null;
      webResults.push(cached ? { sourceId: source.id, sourceName: source.name, ...cached } : { sourceId: source.id, sourceName: source.name, ...(await fetchWebSource(source)) });
    } catch (error) {
      webResults.push({ sourceId: source.id, sourceName: source.name, ok: false, error: error.message || "Web fetch failed" });
      audit("web.fetch_failed", "source", source.id, error.message || "Web fetch failed", {}, "system");
    } finally {
      reportFetchProgress(`Web: ${source.name}`);
    }
  }
  const calendarResults = [];
  for (const source of calendarSources) {
    try {
      const cached = useRecentCache ? recentSourceCache(source) : null;
      calendarResults.push(cached ? { sourceId: source.id, sourceName: source.name, agenda: source.config?.lastAgenda || [], ...cached } : { sourceId: source.id, sourceName: source.name, ...(await fetchGoogleCalendarSource(source)) });
    } catch (error) {
      calendarResults.push({ sourceId: source.id, sourceName: source.name, ok: false, error: error.message || "Google Calendar fetch failed", agenda: [] });
      audit("calendar.fetch_failed", "source", source.id, error.message || "Google Calendar fetch failed", {}, "system");
    } finally {
      reportFetchProgress(`Calendar: ${source.name}`);
    }
  }
  const itemCount = transcriptionResults.filter((result) => result.transcribed).length
    + xResults.reduce((sum, result) => sum + Number(result.inserted || 0) + Number(result.preflightInserted || 0), 0)
    + rssResults.reduce((sum, result) => sum + Number(result.inserted || 0) + Number(result.preflightInserted || 0), 0)
    + redditResults.reduce((sum, result) => sum + Number(result.inserted || 0) + Number(result.preflightInserted || 0), 0)
    + webResults.reduce((sum, result) => sum + Number(result.inserted || 0) + Number(result.preflightInserted || 0), 0)
    + calendarResults.reduce((sum, result) => sum + Number(result.inserted || 0) + Number(result.preflightInserted || 0), 0);
  return {
    activeSources,
    podcastSources,
    xSources,
    rssSources,
    redditSources,
    webSources,
    calendarSources,
    transcriptionSources,
    transcriptionResults,
    xResults,
    rssResults,
    redditResults,
    webResults,
    calendarResults,
    itemCount,
    sourceResults: { xFetches: xResults, rssFetches: rssResults, redditFetches: redditResults, webFetches: webResults, calendarFetches: calendarResults, calendarAgenda: calendarResults.flatMap((result) => result.agenda || []), podcastTranscriptions: transcriptionResults },
  };
}

function parseDeliveryMinutes(time) {
  const match = String(time || "08:00").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 8 * 60;
  const hours = Math.max(0, Math.min(23, Number(match[1])));
  const minutes = Math.max(0, Math.min(59, Number(match[2])));
  return hours * 60 + minutes;
}

function scheduleParts(date = new Date(), timeZone = "America/Denver") {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
    return {
      weekday: parts.weekday,
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
      minutes: hour * 60 + Number(parts.minute || 0),
    };
  } catch {
    return {
      weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getDay()],
      dateKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      minutes: date.getHours() * 60 + date.getMinutes(),
    };
  }
}

function sourcePreflightKey(date = new Date(), config = briefConfig()) {
  const parts = scheduleParts(date, config.deliveryTimezone);
  return `${parts.dateKey}:${config.deliveryTimezone}:${config.deliveryFrequency}:${config.deliveryDay}:${config.deliveryTime}`;
}

function shouldRunSourcePreflight(date = new Date(), config = briefConfig()) {
  const parts = scheduleParts(date, config.deliveryTimezone);
  if (config.deliveryFrequency === "Weekly" && config.deliveryDay !== parts.weekday) return null;
  const nowMinutes = parts.minutes;
  const targetMinutes = parseDeliveryMinutes(config.deliveryTime);
  return nowMinutes === targetMinutes ? sourcePreflightKey(date, config) : null;
}

function briefDeliveryDueKey(date = new Date(), config = briefConfig()) {
  const parts = scheduleParts(date, config.deliveryTimezone);
  if (config.deliveryFrequency === "Weekly" && config.deliveryDay !== parts.weekday) return null;
  return parts.minutes >= parseDeliveryMinutes(config.deliveryTime) ? sourcePreflightKey(date, config) : null;
}

async function runSourcePreflight(trigger = "Scheduled source preflight") {
  const started = now();
  const collection = await fetchSourceCollection({ useRecentCache: false });
  const completed = now();
  audit("sources.preflight", "brief_config", "1", trigger, {
    startedAt: started,
    completedAt: completed,
    activeSources: collection.activeSources.length,
    inserted: collection.itemCount,
    x: collection.xResults.length,
    rss: collection.rssResults.length,
    reddit: collection.redditResults.length,
    web: collection.webResults.length,
    podcasts: collection.transcriptionResults.length,
  }, "system");
  return collection;
}

let lastSourcePreflightKey = "";
let telegramPollInFlight = null;
let lastTelegramPollAt = 0;

const LAST_BRIEF_DELIVERY_KEY = "last_brief_delivery_key";

const appStateGet = (key) => get("SELECT value FROM app_state WHERE key=$key", { $key: key })?.value || "";
const appStateSet = (key, value) => run(`INSERT INTO app_state (key, value, updated_at) VALUES ($key, $value, $t)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`, { $key: key, $value: String(value ?? ""), $t: now() });

function briefDeliveryReady() {
  const onboarding = get("SELECT completed FROM onboarding_state WHERE id=1");
  if (!onboarding?.completed) return false;
  if (modelSettings().status !== "ready") return false;
  return get("SELECT COUNT(*) AS n FROM sources WHERE status='active'").n > 0;
}

function scheduledBriefAlreadyRan(dateKey, timezone) {
  const rows = all("SELECT started_at FROM workflow_runs WHERE trigger LIKE 'Scheduled%' AND status='completed' ORDER BY started_at DESC LIMIT 10");
  return rows.some((row) => scheduleParts(new Date(row.started_at), timezone).dateKey === dateKey);
}

async function runScheduledBriefDeliveryIfDue(trigger = "Scheduled · Auto-deliver brief") {
  const config = briefConfig();
  const date = new Date();
  const key = briefDeliveryDueKey(date, config);
  if (!key || key === appStateGet(LAST_BRIEF_DELIVERY_KEY)) return false;
  const parts = scheduleParts(date, config.deliveryTimezone);
  if (scheduledBriefAlreadyRan(parts.dateKey, config.deliveryTimezone)) {
    appStateSet(LAST_BRIEF_DELIVERY_KEY, key);
    return false;
  }
  if (!briefDeliveryReady()) return false;
  appStateSet(LAST_BRIEF_DELIVERY_KEY, key);
  try {
    await executeWorkflow(trigger);
  } catch (error) {
    // A failed run must not consume the day's slot; clear the key so the
    // minute interval retries instead of silently skipping until tomorrow.
    if (appStateGet(LAST_BRIEF_DELIVERY_KEY) === key) appStateSet(LAST_BRIEF_DELIVERY_KEY, "");
    audit("brief.delivery_failed", "brief_config", "1", error.message || "Scheduled brief delivery failed", {}, "system");
  }
  return true;
}

function startSourcePreflightScheduler() {
  const timer = setInterval(async () => {
    const key = shouldRunSourcePreflight();
    if (!key || key === lastSourcePreflightKey) return;
    lastSourcePreflightKey = key;
    try {
      await runSourcePreflight();
    } catch (error) {
      audit("sources.preflight_failed", "brief_config", "1", error.message || "Scheduled source preflight failed", {}, "system");
    }
  }, 60 * 1000);
  timer.unref?.();
}

function startBriefDeliveryScheduler() {
  // Catch up on a missed cutoff (e.g. the app was closed at delivery time) shortly after startup.
  const catchUp = setTimeout(() => {
    runScheduledBriefDeliveryIfDue("Scheduled · Catch-up brief on launch").catch(() => {});
  }, 3000);
  catchUp.unref?.();
  const timer = setInterval(() => {
    runScheduledBriefDeliveryIfDue().catch(() => {});
  }, 60 * 1000);
  timer.unref?.();
}

function audit(action, entityType, entityId, note = "", diff = {}, actor = "operator") {
  run(`INSERT INTO audit_logs (id, ts, actor, action, entity_type, entity_id, note, diff_json)
       VALUES ($id, $ts, $actor, $action, $entityType, $entityId, $note, $diff)`, {
    $id: id("audit"), $ts: now(), $actor: actor || "operator", $action: action,
    $entityType: entityType, $entityId: entityId, $note: note || "", $diff: json(diff || {}),
  });
}

function seed() {
  const count = get("SELECT COUNT(*) AS n FROM lenses").n;
  const t = now();
  if (count === 0) {
    const lenses = [
      ["lens-signal", "Signal Lens", "Relevance and evidence", "Separates meaningful source-backed movement from noise, repeats, and weak claims.", "Evaluate each item for source quality, freshness, specificity, corroboration, and practical relevance. Name what is known, what is uncertain, and what would change the read.", ["verdict", "evidence", "uncertainty", "next_check"]],
      ["lens-impact", "Impact Lens", "Decision and consequence", "Turns source items into implications, risks, opportunities, and watch items.", "Evaluate what the development could change for the brief owner. Prioritize concrete consequences, time horizon, affected actors, and practical next moves.", ["verdict", "impact", "time_horizon", "next_move"]],
      ["lens-sentiment", "Sentiment Lens", "Narrative and reaction", "Reads how communities, markets, or audiences are responding without treating chatter as proof.", "Evaluate narrative momentum, audience reaction, consensus versus disagreement, and where sentiment may be overstated. Keep claims grounded in the configured sources.", ["verdict", "reaction", "counter_signal", "confidence"]],
    ];
    const stmt = db.prepare(`INSERT INTO lenses (id, name, role, description, instructions, schema_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`);
    for (const lens of lenses) stmt.run(...lens.slice(0, 5), json(lens[5]), t, t);
  }
  const councilCount = get("SELECT COUNT(*) AS n FROM councils").n;
  if (councilCount === 0) {
    run(`INSERT INTO councils (id, name, synthesis_prompt, enabled, created_at, updated_at)
         VALUES ($id, $name, $prompt, 1, $t, $t)`, {
      $id: "council-brief",
      $name: "Brief Council",
      $prompt: "Synthesize each lens output into the clearest overall read: points of agreement, genuine disagreements, practical implications, open questions, one recommended next move, and calibrated confidence.",
      $t: t,
    });
    ["lens-signal", "lens-impact", "lens-sentiment"].forEach((lensId, i) => {
      run("INSERT INTO council_members (council_id, lens_id, position) VALUES ('council-brief', $lensId, $position)", { $lensId: lensId, $position: i + 1 });
    });
  }
  if (!get("SELECT id FROM telegram_settings WHERE id = 1")) {
    run("INSERT INTO telegram_settings (id, updated_at) VALUES (1, $t)", { $t: t });
  }
  if (!get("SELECT id FROM model_settings WHERE id = 1")) {
    run("INSERT INTO model_settings (id, updated_at) VALUES (1, $t)", { $t: t });
  }
  if (!get("SELECT id FROM tts_settings WHERE id = 1")) {
    run("INSERT INTO tts_settings (id, updated_at) VALUES (1, $t)", { $t: t });
  }
  if (!get("SELECT provider FROM connector_credentials WHERE provider = 'x'")) {
    run("INSERT INTO connector_credentials (provider, updated_at) VALUES ('x', $t)", { $t: t });
  }
  if (!get("SELECT provider FROM connector_credentials WHERE provider = 'elevenlabs'")) {
    run("INSERT INTO connector_credentials (provider, updated_at) VALUES ('elevenlabs', $t)", { $t: t });
  }
  if (!get("SELECT provider FROM connector_credentials WHERE provider = $provider", { $provider: GOOGLE_CALENDAR_PROVIDER })) {
    run("INSERT INTO connector_credentials (provider, updated_at) VALUES ($provider, $t)", { $provider: GOOGLE_CALENDAR_PROVIDER, $t: t });
  }
  const currentModel = get("SELECT * FROM model_settings WHERE id = 1");
  const modelProviderRow = currentModel?.provider
    ? get("SELECT api_key FROM connector_credentials WHERE provider=$provider", { $provider: modelProviderCredentialKey(currentModel.provider) })
    : null;
  if (currentModel?.provider && currentModel.api_key && !modelProviderRow?.api_key) {
    saveModelProviderKey(currentModel.provider, currentModel.api_key);
  }
  if (!get("SELECT id FROM brief_config WHERE id = 1")) {
    run(`INSERT INTO brief_config (id, owner_name, product_name, audience_context, voice_rules, delivery_frequency, delivery_time, delivery_timezone, delivery_day, section_schema_json, analyzers_json, analyzer_behavior, perspective_lenses_json, perspective_lenses_migrated, updated_at)
         VALUES (1, $owner, $product, $audience, $voice, 'Daily', '08:00', 'America/Denver', 'Monday', $sections, $analyzers, $behavior, '[]', 1, $t)`, {
      $owner: "You",
      $product: "Pillar Brief",
      $audience: "A private daily intelligence brief for the brief owner. Explain sources, entities, mechanisms, or technical terms when useful.",
      $voice: "Concise, strategic, candid, approval-safe, specific, and plain-English. Avoid generic corporate language.",
      $sections: json([
        { key: "executiveRead", label: "Executive Read", enabled: true, instruction: "2-3 concise paragraphs that explain the situation without unexplained jargon." },
        { key: "backgroundContext", label: "Plain-English Context", enabled: true, instruction: "3-7 bullets explaining key terms, entities, mechanisms, and jargon." },
        { key: "whyItMatters", label: "Why It Matters", enabled: true, instruction: "3-7 bullets connecting source signals to concrete decisions, risks, opportunities, or watch items." },
        { key: "futureImplications", label: "Future Implications", enabled: true, instruction: "3-7 bullets explaining what could change, who may act differently, and the time horizon." },
        { key: "doctrineProjectImpact", label: "Doctrine / Project Impact", enabled: true, instruction: "2-5 bullets about concrete effects on doctrine, projects, messaging, workflow, approvals, or questions to ask." },
        { key: "councilRead", label: "Analyzer Read", enabled: true, instruction: "Specific analyzer judgments in plain English." },
        { key: "councilSynthesis", label: "Analyzer Synthesis", enabled: true, instruction: "Where analyzers agree/disagree and the recommendation." },
        { key: "pov", label: "POV", enabled: true, instruction: "A concrete approval-safe provisional take, watch item, question, or action." },
        { key: "sourceEvidence", label: "Source Evidence", enabled: true, instruction: "Cited source items behind the brief." },
        { key: "openQuestions", label: "Open Questions Before Approval", enabled: true, instruction: "Questions to resolve before external delivery." },
      ]),
      $analyzers: json(defaultAnalyzers()),
      $behavior: defaultAnalyzerBehavior,
      $t: t,
    });
  }
  const configRow = get("SELECT analyzers_json, analyzer_behavior, perspective_lenses_json, perspective_lenses_migrated FROM brief_config WHERE id = 1");
  if (configRow) {
    const currentAnalyzers = parse(configRow.analyzers_json, []);
    if (!Array.isArray(currentAnalyzers) || currentAnalyzers.length === 0) {
      run("UPDATE brief_config SET analyzers_json=$analyzers, updated_at=$t WHERE id=1", { $analyzers: json(defaultAnalyzers()), $t: t });
    }
    if (!String(configRow.analyzer_behavior || "").trim()) {
      const legacyCouncil = councils()[0];
      run("UPDATE brief_config SET analyzer_behavior=$behavior, updated_at=$t WHERE id=1", { $behavior: legacyCouncil?.synthesisPrompt || defaultAnalyzerBehavior, $t: t });
    }
    const currentPerspectives = parse(configRow.perspective_lenses_json, []);
    if (Array.isArray(currentPerspectives) && currentPerspectives.length > 0 && !configRow.perspective_lenses_migrated) {
      run("UPDATE brief_config SET perspective_lenses_migrated=1, updated_at=$t WHERE id=1", { $t: t });
    } else if (!configRow.perspective_lenses_migrated) {
      const legacyPerspectives = legacyLensesAsPerspectiveLenses();
      if (legacyPerspectives.length) {
        run("UPDATE brief_config SET perspective_lenses_json=$lenses, perspective_lenses_migrated=1, updated_at=$t WHERE id=1", { $lenses: json(legacyPerspectives), $t: t });
      } else {
        run("UPDATE brief_config SET perspective_lenses_migrated=1, updated_at=$t WHERE id=1", { $t: t });
      }
    }
  }
  if (!get("SELECT id FROM onboarding_state WHERE id = 1")) {
    run("INSERT INTO onboarding_state (id, updated_at) VALUES (1, $t)", { $t: t });
  }
  const googleCalendarRow = get("SELECT enabled, api_key FROM connector_credentials WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER });
  const googleCalendarData = parse(googleCalendarRow?.api_key, {});
  if (googleCalendarRow?.enabled && googleCalendarData?.refreshToken) {
    ensureGoogleCalendarBriefSetup();
  }
}

function sources() {
  return all("SELECT * FROM sources ORDER BY created_at DESC").map((r) => ({
    id: r.id, name: r.name, type: r.type, locator: r.locator, cadence: r.cadence,
    status: r.status, approvalStatus: r.approval_status, credentialsStatus: r.credentials_status,
    note: r.note, config: parse(r.config_json, {}), createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}
function lenses() {
  return all("SELECT * FROM lenses ORDER BY created_at ASC").map((r) => ({
    id: r.id, name: r.name, role: r.role, description: r.description, instructions: r.instructions,
    schema: parse(r.schema_json, []), enabled: !!r.enabled, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}
function councils() {
  const rows = all("SELECT * FROM councils ORDER BY created_at ASC");
  return rows.map((r) => ({
    id: r.id, name: r.name, synthesisPrompt: r.synthesis_prompt, enabled: !!r.enabled,
    members: all("SELECT lens_id FROM council_members WHERE council_id = $id ORDER BY position", { $id: r.id }).map((m) => m.lens_id),
    createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}
function documents() {
  return all("SELECT * FROM knowledge_documents ORDER BY updated_at DESC").map((r) => ({
    id: r.id, title: r.title, type: r.type, visibility: r.visibility, status: r.status,
    tags: parse(r.tags, []), body: r.body, wordCount: r.word_count, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}
function workflowRuns() {
  return all("SELECT * FROM workflow_runs ORDER BY started_at DESC").map((r) => ({
    id: r.id, label: r.label, trigger: r.trigger, status: r.status, startedAt: r.started_at,
    completedAt: r.completed_at, steps: parse(r.steps_json, []), artifact: hydrateArtifact(parse(r.artifact_json, {})), error: r.error,
  }));
}
function approvals() {
  return all("SELECT * FROM approval_items ORDER BY created_at DESC").map((r) => ({
    id: r.id, title: r.title, kind: r.kind, risk: r.risk, status: r.status, runId: r.run_id,
    entityType: r.entity_type, entityId: r.entity_id, payload: parse(r.payload_json, {}),
    createdAt: r.created_at, resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, resolutionNote: r.resolution_note,
  }));
}
function audits() {
  return all("SELECT * FROM audit_logs ORDER BY ts DESC LIMIT 250").map((r) => ({
    id: r.id, ts: r.ts, actor: r.actor, action: r.action, entityType: r.entity_type,
    entityId: r.entity_id, note: r.note, diff: parse(r.diff_json, {}),
  }));
}
function telegramSettings() {
  const r = get("SELECT * FROM telegram_settings WHERE id = 1");
  return {
    enabled: !!r.enabled, botToken: r.bot_token ? "configured" : "", chatId: r.chat_id,
    allowedUsers: parse(r.allowed_users, []), lastCheckedAt: r.last_checked_at, lastError: r.last_error,
    recentCommands: parse(r.recent_commands, []), updatedAt: r.updated_at,
    commands: ["/brief", "/sources", "/lenses", "/deliberate", "/review", "/approve", "/reject", "/analyze"],
  };
}
function modelSettings() {
  const r = get("SELECT * FROM model_settings WHERE id = 1");
  const activeProviderKey = savedModelProviderKey(r.provider, r);
  const credentialStatus = providerCredentialStatus(r.provider, activeProviderKey);
  const customReady = r.provider !== "custom" || !!r.base_url;
  const providerCredentials = Object.fromEntries(modelProviders.map((provider) => {
    const savedKey = savedModelProviderKey(provider, r);
    return [provider, {
      apiKeySaved: !!savedKey,
      credentialStatus: providerCredentialStatus(provider, savedKey),
    }];
  }));
  return {
    provider: r.provider,
    model: r.model,
    apiKeySaved: !!activeProviderKey,
    baseUrl: r.provider === "custom" ? r.base_url : "",
    enabled: !!r.enabled,
    credentialStatus,
    status: r.enabled && r.model && customReady && credentialStatus !== "missing" ? "ready" : "pending credentials",
    providerCredentials,
    lastCheckedAt: r.last_checked_at,
    lastError: r.last_error,
    updatedAt: r.updated_at,
  };
}
function connectorSettings() {
  const rows = all("SELECT * FROM connector_credentials ORDER BY provider");
  const connectors = Object.fromEntries(rows.map((r) => {
    if (r.provider === GOOGLE_CALENDAR_PROVIDER) return [r.provider, googleCalendarPublicConnector({ row: r, data: parse(r.api_key, {}), enabled: !!r.enabled })];
    const hasKey = !!r.api_key;
    return [r.provider, {
      provider: r.provider,
      enabled: !!r.enabled,
      apiKeySaved: hasKey,
      credentialStatus: hasKey ? "saved" : "missing",
      status: r.enabled && hasKey ? "ready" : "pending credentials",
      lastCheckedAt: r.last_checked_at,
      lastError: r.last_error,
      updatedAt: r.updated_at,
    }];
  }));
  return {
    x: connectors.x || {
      provider: "x",
      enabled: false,
      apiKeySaved: false,
      credentialStatus: "missing",
      status: "pending credentials",
      lastCheckedAt: null,
      lastError: null,
      updatedAt: null,
    },
    elevenlabs: connectors.elevenlabs || {
      provider: "elevenlabs",
      enabled: false,
      apiKeySaved: false,
      credentialStatus: "missing",
      status: "pending credentials",
      lastCheckedAt: null,
      lastError: null,
      updatedAt: null,
    },
    googleCalendar: connectors[GOOGLE_CALENDAR_PROVIDER] || googleCalendarPublicConnector({ row: null, data: {}, enabled: false }),
  };
}
function onboardingState() {
  const r = get("SELECT * FROM onboarding_state WHERE id = 1");
  const model = modelSettings();
  const telegram = telegramSettings();
  const config = briefConfig();
  const activeSources = sources().filter((source) => source.status === "active").length;
  const scheduleSet = !!config.deliveryTime && !!config.deliveryTimezone;
  const telegramReady = !!(telegram.enabled && telegram.botToken && telegram.chatId && !telegram.lastError);
  const ownerNameReady = !isDefaultOwnerName(config.ownerName);
  const readiness = {
    ownerNameReady,
    modelReady: model.status === "ready",
    briefPromptSaved: !!String(r.brief_prompt || "").trim(),
    sourceReady: activeSources > 0,
    telegramReady,
    scheduleSet,
  };
  return {
    completed: !!r.completed,
    completedAt: r.completed_at,
    currentStep: r.current_step,
    briefPrompt: r.brief_prompt,
    sourceSuggestions: parse(r.source_suggestions_json, []),
    briefConfigDraft: sanitizeBriefSetupDraft(parse(r.brief_config_draft_json, {})),
    updatedAt: r.updated_at,
    readiness,
    canComplete: ownerNameReady && model.status === "ready" && !!String(r.brief_prompt || "").trim() && activeSources > 0 && scheduleSet,
  };
}
function workflowTemplate(config = briefConfig()) {
  const enabledSections = (config.sections || []).filter((section) => section.enabled !== false && section.key !== "sourceEvidence");
  const synthesizeName = enabledSections.length
    ? `Synthesize ${enabledSections.length} configured section${enabledSections.length === 1 ? "" : "s"}`
    : "Synthesize brief";
  return [
    ["fetch", "Fetch configured sources", "ingest"],
    ["normalize", "Normalize and dedupe items", "ingest"],
    ["score", "Score relevance and rising signal", "rank"],
    ["retrieve", "Retrieve saved documents", "rank"],
    ["select", "Select top issues", "rank"],
    ["synthesize", synthesizeName, "generate"],
    ["render", "Render brief", "deliver"],
    ["save", "Save artifact and run outputs", "deliver"],
    ["telegram", "Deliver Telegram brief", "deliver"],
  ];
}

function workflowPlan(config = briefConfig()) {
  return workflowTemplate(config).map(([key, name, group], index) => ({
    key,
    name,
    group,
    n: index + 1,
  }));
}

function workflowProgressSteps({ activeKey = "fetch", completed = new Set(), outputs = {}, config = briefConfig() } = {}) {
  const completedSet = completed instanceof Set ? completed : new Set(completed || []);
  return workflowTemplate(config).map(([key, name, group], index) => ({
    n: index + 1,
    key,
    name,
    group,
    status: completedSet.has(key) ? "done" : key === activeKey ? "active" : "pending",
    ms: 0,
    output: outputs[key]?.output || (key === activeKey ? "Working..." : ""),
    detail: outputs[key]?.detail || "",
  }));
}

function state() {
  return { sources: sources(), lenses: lenses(), councils: councils(), documents: documents(), workflowRuns: workflowRuns(), approvals: approvals(), auditLogs: audits(), telegram: telegramSettings(), model: modelSettings(), tts: ttsSettings(), connectors: connectorSettings(), briefConfig: briefConfig(), onboarding: onboardingState(), runtime: { mode: appMode, isDesktop, dataDir, workflowSteps: workflowPlan() } };
}
function briefConfig() {
  const r = get("SELECT * FROM brief_config WHERE id = 1");
  return {
    ownerName: r.owner_name,
    productName: r.product_name,
    audienceContext: r.audience_context,
    voiceRules: r.voice_rules,
    deliveryFrequency: r.delivery_frequency || "Daily",
    deliveryTime: r.delivery_time || "08:00",
    deliveryTimezone: r.delivery_timezone || "America/Denver",
    deliveryDay: r.delivery_day || "Monday",
    sections: parse(r.section_schema_json, []),
    analyzers: sanitizeAnalyzerList(parse(r.analyzers_json, []), defaultAnalyzers()),
    analyzerBehavior: String(r.analyzer_behavior || defaultAnalyzerBehavior),
    perspectiveLenses: sanitizePerspectiveLenses(parse(r.perspective_lenses_json, [])),
    updatedAt: r.updated_at,
  };
}

function sourceItemQuality(item) {
  const title = String(item.title || "");
  const body = String(item.body || "");
  const text = `${title} ${body}`.toLowerCase();
  let score = Number(item.relevance_score || 0) + Number(item.rising_score || 0);
  if (body.length > 160) score += 0.12;
  if (/^(newsroom|home|latest news|blog)$/i.test(title.trim())) score -= 0.35;
  if (/(brainrot|smegma|bukkake|shitpost|meme)/i.test(text)) score -= 0.7;
  if (item.source_name?.includes("Outbreak Watch") && !/(who|cdc|h5n1|avian flu|mpox|marburg|outbreak|disease outbreak|public health|hantavirus)/i.test(`${title} ${body}`)) score -= 0.5;
  if (item.source_type === "Web" && body.length < 120) score -= 0.2;
  return score;
}

function specificIssueCare(issue) {
  const text = `${issue.title} ${issue.summary || ""}`.toLowerCase();
  const owner = briefConfig().ownerName || "the brief owner";
  if (text.includes("arxiv") && text.includes("endorsement")) {
    return `The practical question is whether AI research distribution is becoming more gatekept. ${owner} should treat it as a credibility/access signal, then verify against ArXiv policy or researcher commentary before using it.`;
  }
  if (text.includes("parakeet") || text.includes("medical asr") || text.includes("clinical speech")) {
    return "This is a concrete open-model healthcare workflow signal: speech-to-text that can run locally may lower cost and privacy friction for clinical documentation, but it needs accuracy and liability checks.";
  }
  if (text.includes("hantavirus") || text.includes("h5n1") || text.includes("mpox") || text.includes("outbreak")) {
    return `This belongs in ${owner}'s watchlist only if it is corroborated by WHO, CDC, or local health authorities; social chatter alone should not drive a public claim.`;
  }
  if (text.includes("chip") || text.includes("datacenter") || text.includes("nvidia") || text.includes("export control")) {
    return `AI infrastructure affects who can build, train, and deploy frontier systems. ${owner} should watch whether this changes cost, access, or geopolitical leverage.`;
  }
  return `This is a candidate signal from ${issue.sourceName}. ${owner} should ask what decision it changes, who else is corroborating it, and whether it is strong enough for the approval queue.`;
}

function specificFutureImplication(issue) {
  const text = `${issue.title} ${issue.summary || ""}`.toLowerCase();
  if (text.includes("arxiv") && text.includes("endorsement")) {
    return "If the endorsement debate spreads, early-career and independent AI researchers may face more friction posting papers over the next few months, while moderators may tighten quality controls.";
  }
  if (text.includes("parakeet") || text.includes("medical asr") || text.includes("clinical speech")) {
    return "If local clinical ASR keeps improving, small healthcare teams could test private, lower-cost transcription pilots before enterprise vendors move.";
  }
  if (text.includes("hantavirus") || text.includes("h5n1") || text.includes("mpox") || text.includes("outbreak")) {
    return "If official agencies confirm a rise, the next change would be public-health guidance, travel/workplace precautions, or media attention; if not, it stays background noise.";
  }
  return "Over the next 7-30 days, watch for repeat mentions from primary sources, official actors, or high-signal technical communities before treating it as a durable trend.";
}

function timeContextForItem(item, reference = new Date()) {
  const firstSeen = item.first_seen_at || item.created_at;
  const lastSeen = item.last_seen_at || item.created_at;
  const lastUsed = item.last_used_at || "";
  const published = item.published_at || "";
  const daysSinceFirstSeen = firstSeen ? Math.floor((reference.getTime() - new Date(firstSeen).getTime()) / 86400000) : 0;
  const daysSinceLastUsed = lastUsed ? Math.floor((reference.getTime() - new Date(lastUsed).getTime()) / 86400000) : null;
  const reusedFromPriorBrief = Number(item.usage_count || 0) > 0 || Boolean(lastUsed);
  let framing = "Newly selected for this brief.";
  if (reusedFromPriorBrief && daysSinceLastUsed === 0) framing = "This item was already used earlier today; only repeat it if the surrounding synthesis changed.";
  else if (reusedFromPriorBrief && daysSinceLastUsed === 1) framing = "This item was used in yesterday's brief; refer to it as prior context unless there is new source movement.";
  else if (reusedFromPriorBrief && daysSinceLastUsed !== null) framing = `This item was used ${daysSinceLastUsed} days ago; treat it as cached context unless new source movement changes the implication.`;
  else if (daysSinceFirstSeen === 1) framing = "This was first seen yesterday; phrase it as recent context if no newer source changed it.";
  else if (daysSinceFirstSeen > 1) framing = `This was first seen ${daysSinceFirstSeen} days ago; avoid presenting it as breaking news.`;
  return {
    firstSeenAt: firstSeen,
    lastSeenAt: lastSeen,
    lastUsedAt: lastUsed,
    usageCount: Number(item.usage_count || 0),
    publishedAt: published,
    daysSinceFirstSeen,
    daysSinceLastUsed,
    reusedFromPriorBrief,
    framing,
  };
}

function topNormalizedItems(limit = 7) {
  const reference = new Date();
  const dayStart = startOfLocalDay().toISOString();
  const dayEnd = endOfLocalDay().toISOString();
  return all(`SELECT ni.*, s.name AS source_name, s.type AS source_type
              FROM normalized_items ni
              LEFT JOIN sources s ON s.id = ni.source_id
              WHERE ni.published_at >= $dayStart AND ni.published_at < $dayEnd
              ORDER BY (ni.relevance_score + ni.rising_score) DESC, ni.published_at DESC, ni.created_at DESC
              LIMIT 60`, { $dayStart: dayStart, $dayEnd: dayEnd }).map((item) => ({ ...item, quality_score: sourceItemQuality(item) }))
    .filter((item) => item.quality_score > -0.1)
    .sort((a, b) => b.quality_score - a.quality_score || String(b.published_at || b.created_at).localeCompare(String(a.published_at || a.created_at)))
    .slice(0, limit)
    .map((item) => {
    const body = String(item.body || "");
    const summary = body.length > 360 ? `${body.slice(0, 357)}...` : body;
    return {
      id: item.id,
      title: item.title,
      sourceId: item.source_id,
      sourceName: item.source_name || "Unknown source",
      sourceType: item.source_type || "",
      url: item.canonical_url,
      publishedAt: item.published_at,
      summary,
      whyJackShouldCare: specificIssueCare({ ...item, sourceName: item.source_name || "Unknown source", summary }),
      futureImplication: specificFutureImplication({ ...item, summary }),
      doctrineImpact: "Needs human review before it becomes a brief claim, public post, or doctrine update.",
      relevanceScore: item.relevance_score,
      risingScore: item.rising_score,
      qualityScore: item.quality_score,
      cacheContext: timeContextForItem(item, reference),
    };
  });
}

function markItemsUsedInBrief(items = []) {
  const t = now();
  for (const item of items) {
    if (!item?.id) continue;
    run("UPDATE normalized_items SET last_used_at=$t, usage_count=COALESCE(usage_count, 0) + 1 WHERE id=$id", { $id: item.id, $t: t });
  }
}

function deterministicStrategicBrief({ selectedIssues, lenses: lensRows, council, config = briefConfig() }) {
  const lead = selectedIssues[0];
  const themes = selectedIssues.slice(0, 4).map((issue) => issue.title);
  const context = plainEnglishContext(selectedIssues);
  const analyzerRows = (lensRows && lensRows.length ? lensRows : config.analyzers || defaultAnalyzers()).filter((item) => item.enabled !== false);
  const leadSummary = lead?.summary ? ` The source says: ${lead.summary}` : "";
  const owner = config.ownerName || "the brief owner";
  const brief = {
    mode: "deterministic-fallback",
    headline: lead ? `Today’s strongest signal is ${lead.title}` : "No usable source items published today",
    executiveRead: lead
      ? `The strongest item today is "${lead.title}" from ${lead.sourceName}.${leadSummary} Treat this as a monitored signal, not a settled conclusion: it needs corroboration from a primary source or another high-signal community before ${owner} should act on it.`
      : "The workflow ran, but did not ingest enough usable source material to produce an intelligence read.",
    backgroundContext: context.length ? context : selectedIssues.slice(0, 4).map((issue) => `${issue.title}: ${issue.summary || "The source did not include enough context; verify before relying on it."}`),
    whyJackShouldCare: selectedIssues.slice(0, 5).map((issue) => `${issue.title}: ${issue.whyJackShouldCare || specificIssueCare(issue)}`),
    futureImplications: selectedIssues.slice(0, 4).map((issue) => `${issue.title}: ${issue.futureImplication || specificFutureImplication(issue)}`),
    doctrineProjectImpact: selectedIssues.slice(0, 4).map((issue) => `${issue.title}: keep this as an internal watch item until the approval queue has stronger evidence, a clear owner-relevant angle, and a publish-safe claim.`),
    councilRead: analyzerRows.map((analyzer) => ({
      lens: analyzer.name,
      read: `${analyzer.name} would ask whether "${lead?.title || "this signal"}" changes incentives, public trust, or action, rather than rewarding novelty by itself.`,
      implication: `Use this analyzer to decide whether the item belongs in ${owner}'s watchlist, approval queue, or discard pile.`,
    })),
    councilSynthesis: council?.synthesisPrompt || config.analyzerBehavior
      ? "Analyzer synthesis is available as a deterministic pre-read, but model synthesis was not completed."
      : "No analyzer synthesis was completed.",
    jackPov: lead ? `Provisional ${owner} POV: "${lead.title}" is a watch item, not a take yet. The next useful move is to find the primary source or a second independent signal, then decide whether it changes ${owner}'s messaging, research priorities, or approval queue.` : "No POV drafted.",
    openQuestions: lead ? [
      "Which signals are corroborated by more than one source type?",
      "Which items create real action for the brief owner versus mere awareness?",
      "Which claims require primary-source verification before approval?",
    ] : ["Which sources published new items today, and which should be adjusted if the brief is too quiet?"],
  };
  brief.sectionResponses = sectionResponsesForBrief(brief, config, selectedIssues);
  return brief;
}

function knownSectionContent(brief = {}, key = "") {
  const map = {
    executiveRead: brief.executiveRead,
    backgroundContext: brief.backgroundContext,
    whyJackShouldCare: brief.whyJackShouldCare,
    whyItMatters: brief.whyJackShouldCare,
    futureImplications: brief.futureImplications,
    doctrineProjectImpact: brief.doctrineProjectImpact,
    councilRead: brief.councilRead,
    councilSynthesis: brief.councilSynthesis,
    jackPov: brief.jackPov,
    pov: brief.jackPov,
    openQuestions: brief.openQuestions,
    topSignals: brief.executiveRead,
    sentimentRead: brief.backgroundContext,
    politicalRace: brief.whyJackShouldCare,
    industryMotion: brief.doctrineProjectImpact,
    marketImpact: brief.futureImplications,
    whatToWatch: brief.openQuestions,
  };
  return map[key];
}

function fallbackSectionContent(section = {}, selectedIssues = [], config = briefConfig()) {
  if (!selectedIssues.length) return "No usable source items published today for this section.";
  const label = String(section.label || section.key || "Section").toLowerCase();
  const owner = config.ownerName || "the brief owner";
  if (label.includes("signal") || label.includes("top")) {
    return selectedIssues.slice(0, 5).map((issue) => `${issue.title}: ${issue.summary || issue.whyJackShouldCare || "Monitor this as a source-backed signal from today."}`);
  }
  if (label.includes("sentiment")) {
    return selectedIssues.slice(0, 5).map((issue) => `${issue.sourceName}: reaction centers on "${issue.title}". Treat the chatter as directional until corroborated.`);
  }
  if (label.includes("politic") || label.includes("race")) {
    return selectedIssues.slice(0, 5).map((issue) => `${issue.title}: ${issue.whyJackShouldCare || specificIssueCare(issue)}`);
  }
  if (label.includes("market") || label.includes("impact")) {
    return selectedIssues.slice(0, 4).map((issue) => `${issue.title}: ${issue.futureImplication || specificFutureImplication(issue)}`);
  }
  if (label.includes("watch")) {
    return [
      "Which stories get corroborated by more than one source type?",
      `Which items actually change ${owner}'s decisions, priorities, or watchlist?`,
      "Which claims need primary-source verification before relying on them?",
    ];
  }
  return selectedIssues.slice(0, 4).map((issue) => `${issue.title}: ${issue.summary || issue.whyJackShouldCare || "Worth monitoring from today's sources."}`);
}

function sectionResponsesForBrief(brief = {}, config = briefConfig(), selectedIssues = []) {
  return Object.fromEntries((config.sections || [])
    .filter((section) => section.enabled !== false && section.key !== "sourceEvidence")
    .map((section) => {
      const existing = brief.sectionResponses?.[section.key] ?? knownSectionContent(brief, section.key);
      return [section.key, existing || fallbackSectionContent(section, selectedIssues, config)];
    }));
}

function plainEnglishContext(selectedIssues) {
  const text = selectedIssues.map((issue) => `${issue.title} ${issue.summary || ""}`).join(" ").toLowerCase();
  const entries = [];
  if (text.includes("arxiv")) entries.push("ArXiv is a public preprint library where researchers post papers before or outside formal journal publication. It matters because AI researchers often use it to circulate work quickly.");
  if (text.includes("endorsement")) entries.push("ArXiv endorsement is a gatekeeping step for some categories: an existing approved contributor vouches that a new author is likely to submit relevant scholarly work. The tension is access versus reputation risk.");
  if (text.includes("ternary") || text.includes("bitnet")) entries.push("Ternary LLMs are language models whose weights use three values instead of high-precision numbers. The promise is cheaper/faster inference; the risk is that quality or scaling may not keep up.");
  if (text.includes("localllama")) entries.push("LocalLLaMA is a Reddit community focused on open-weight and locally run AI models. It is useful for early developer sentiment, not as a primary source.");
  if (text.includes("hacker news") || text.includes("hn:")) entries.push("Hacker News is a tech forum whose front page can surface early builder chatter. It is signal, not proof.");
  if (text.includes("switzerland") && text.includes("population")) entries.push("The Switzerland population-cap item is a policy signal: it points to political pressure around immigration, housing, infrastructure, and national capacity rather than AI directly.");
  return entries;
}

function validateStrategicBrief(brief) {
  const body = JSON.stringify(brief || {});
  const banned = [
    /\bour\b/i,
    /\bwe\b/i,
    /Jack's collaborations/i,
    /Jack's partnerships/i,
    /Jack's interests/i,
    /our partnerships/i,
    /our operations/i,
    /current AI projects/i,
    /internal guidelines/i,
    /internally position/i,
  ];
  const hit = banned.find((pattern) => pattern.test(body));
  if (hit) throw new Error(`Model brief used unsupported assumption or filler: ${hit}`);
  return brief;
}

async function synthesizeStrategicBrief({ selectedIssues, sourceResults }) {
  const config = briefConfig();
  const owner = config.ownerName || "the brief owner";
  const calendarAgenda = Array.isArray(sourceResults?.calendarAgenda) ? sourceResults.calendarAgenda : [];
  if (!selectedIssues.length && !calendarAgenda.length) throw new Error("No usable source items or calendar events from today were selected. Add or fix sources, then generate again.");
  const enabledAnalyzers = sanitizeAnalyzerList(config.analyzers, defaultAnalyzers()).filter((analyzer) => analyzer.enabled !== false);
  const enabledSections = (config.sections || []).filter((section) => section.enabled !== false).map((section) => {
    return {
      ...section,
      promptTarget: "standard",
      promptRefId: "",
    };
  });
  const system = [
    `Write ${owner}'s private daily brief.`,
    "Make it useful, readable, and direct. It should feel like a smart person wrote it for another smart person over coffee.",
    "Use the source items for claims about what happened. Use common knowledge only to explain context or jargon.",
    "Only use selected source items that were published today for the brief's news/signals. Do not include older posts just because they were discovered or cached today.",
    "Calendar agenda entries are private schedule context, not news. Use them only for agenda, prep, conflicts, sequencing, and focus recommendations.",
    "Do not invent quotes, source details, outcomes, companies, people, or numbers.",
    `Audience context: ${config.audienceContext || `${owner} is smart but may not know every term.`}`,
    `Voice rules: ${config.voiceRules || "Clear, concise, plain-English, with a little personality. Avoid corporate language."}`,
    `Write to ${owner} directly. Explain unfamiliar entities or mechanisms only when it helps.`,
    "Prefer short paragraphs and sharp bullets. Skip throat-clearing. No generic management-speak.",
    "For titleSummary, write the phrase that appears after today's date in the saved brief title. It must summarize the actual main points, not broad categories.",
    "Good titleSummary examples: OpenAI IPO chatter, Anthropic model rumors, and Intel chip speculation. Bad examples: AI, crypto, political race signals.",
    "Do not include the date in titleSummary. Use 8-16 words, name concrete people/companies/topics when available, and avoid words like signals, updates, happenings, latest, roundup, or news unless they are part of a source title.",
    "Use older cached items as context when useful, but do not present old items as breaking news.",
    `${owner} POV should sound like a real provisional take, question, or next move.`,
    "Use the configured analyzers to shape the brief. Treat them as internal analysis passes, not user-facing characters.",
    `Analyzer behavior: ${config.analyzerBehavior || defaultAnalyzerBehavior}`,
    "Return only valid JSON.",
  ].join(" ");
  const prompt = JSON.stringify({
    task: `Create a readable one-page strategic brief for ${owner} from the selected source items.`,
    requiredJsonShape: {
      mode: "model",
      headline: "one sentence",
      titleSummary: "8-16 words for the saved title after the date; concrete main points only, no date",
      sectionResponses: Object.fromEntries(enabledSections
        .filter((section) => section.key !== "sourceEvidence")
        .map((section) => [section.key, `${section.label}: answer this section using its instruction, today's selected source items, and calendarAgenda when relevant`])),
      executiveRead: "2-3 readable paragraphs that explain what matters",
      backgroundContext: ["helpful context or definitions only if needed"],
      whyJackShouldCare: ["sharp bullets on why this is worth attention"],
      futureImplications: ["what may change next and what to watch"],
      doctrineProjectImpact: ["practical takeaways or questions"],
      councilRead: [{ lens: "analyzer name", read: "analyzer judgment in plain English", implication: "why it matters" }],
      councilSynthesis: "short analyzer synthesis of agreement, disagreement, recommendation, confidence, and open questions",
      jackPov: "a natural provisional take, question, or next move",
      openQuestions: ["open questions worth resolving"],
    },
    briefConfig: {
      ownerName: owner,
      productName: config.productName,
      audienceContext: config.audienceContext,
      voiceRules: config.voiceRules,
      enabledSections,
      analyzers: enabledAnalyzers.map((analyzer) => ({
        name: analyzer.name,
        role: analyzer.role,
        description: analyzer.description,
        instructions: analyzer.instructions,
      })),
      analyzerBehavior: config.analyzerBehavior || defaultAnalyzerBehavior,
    },
    selectedIssues,
    calendarAgenda,
    sourceFreshnessPolicy: "Selected source items have publishedAt dates from today only. If no selectedIssues are present, say there were no usable items published today.",
    sourceResults,
  });
  let text = await callTextModel({ system, prompt });
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const brief = validateStrategicBrief({ mode: "model", ...parseModelJson(text) });
      return { ...brief, sectionResponses: sectionResponsesForBrief(brief, config, selectedIssues) };
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
    }
    const repairPrompt = JSON.stringify({
      task: "Rewrite the brief JSON so it passes the quality rules. Preserve the same facts and source grounding, but remove unsupported assumptions and filler.",
      rejectionReason: lastError?.message || "quality validation failed",
      forbidden: [
        "we/our voice",
        `claims about ${owner}'s partnerships, collaborations, operations, internal guidelines, healthcare ventures, projects, or business interests unless provided in source items`,
      ],
      required: "Use natural direct language. Keep the facts grounded. Include a concrete titleSummary that names the main points and does not include the date. Return only valid JSON in the required shape.",
      previousDraft: text,
      selectedIssues,
      analyzers: enabledAnalyzers.map((analyzer) => ({ name: analyzer.name, role: analyzer.role, description: analyzer.description, instructions: analyzer.instructions })),
      analyzerBehavior: config.analyzerBehavior || defaultAnalyzerBehavior,
    });
    text = await callTextModel({ system, prompt: repairPrompt });
  }
  throw lastError || new Error("Model brief failed quality validation");
}

function hydrateArtifact(artifact = {}) {
  if (Array.isArray(artifact.selectedIssues) && artifact.selectedIssues.length) return artifact;
  const fetchedItems = (artifact.xFetches || []).reduce((sum, result) => sum + Number(result.inserted || 0), 0);
  if (!fetchedItems) return artifact;
  const selectedIssues = topNormalizedItems();
  return {
    ...artifact,
    selectedIssues,
    onePageBrief: artifact.onePageBrief || renderOnePageBrief({ ...artifact, selectedIssues }),
    whyJackShouldCare: selectedIssues.map((issue) => issue.whyJackShouldCare).join("\n"),
    implications: selectedIssues.map((issue) => issue.futureImplication),
    doctrineImpact: selectedIssues.map((issue) => issue.doctrineImpact),
    council: {
      ...(artifact.council || {}),
      synthesis: selectedIssues.length
        ? `Analyzer input is ready for ${selectedIssues.length} selected issue${selectedIssues.length === 1 ? "" : "s"}; model synthesis still requires explicit generation/review.`
        : artifact.council?.synthesis,
    },
    jackPov: selectedIssues.length ? "Draft POV is pending model synthesis and approval." : artifact.jackPov,
  };
}

function renderOnePageBrief(artifact = {}) {
  const issues = artifact.selectedIssues || [];
  const config = briefConfig();
  const sections = (config.sections || []).filter((section) => section.enabled !== false);
  const brief = artifact.strategicBrief || deterministicStrategicBrief({ selectedIssues: issues, lenses: [], council: artifact.council, config });
  const lines = [
    `# ${artifact.title || brief.headline || "Daily Brief"}`,
    `Generated: ${artifact.generatedAt ? new Date(artifact.generatedAt).toLocaleString() : new Date().toLocaleString()}`,
  ];
  const bullets = (items) => Array.isArray(items) && items.length ? items.forEach((item) => lines.push(`- ${typeof item === "string" ? item : JSON.stringify(item)}`)) : lines.push("- No read generated.");
  const renderContent = (content) => {
    if (Array.isArray(content)) {
      if (!content.length) lines.push("- No read generated.");
      content.forEach((item) => {
        if (typeof item === "string") lines.push(`- ${item}`);
        else if (item?.lens || item?.read) {
          lines.push(`- ${item.lens ? `${item.lens}: ` : ""}${item.read || JSON.stringify(item)}`);
          if (item.implication) lines.push(`  Implication: ${item.implication}`);
        } else {
          lines.push(`- ${JSON.stringify(item)}`);
        }
      });
      return;
    }
    lines.push(String(content || "No read generated."));
  };
  const renderSourceEvidence = (section) => {
    lines.push("", `## ${section.label || "Source Evidence"}`);
    if (!issues.length) lines.push("No selected issues yet. The workflow completed but did not ingest enough source items to compile a brief.");
    else {
      issues.slice(0, 7).forEach((issue, index) => {
        lines.push(`${index + 1}. ${issue.title} (${issue.sourceName}${issue.publishedAt ? `, ${new Date(issue.publishedAt).toLocaleString()}` : ""})`);
        if (issue.summary) lines.push(`   ${issue.summary}`);
        if (issue.cacheContext?.framing) lines.push(`   Context: ${issue.cacheContext.framing}`);
        if (issue.url) lines.push(`   ${issue.url}`);
      });
    }
  };
  const renderConfiguredSection = (section) => {
    if (section.key === "sourceEvidence") {
      renderSourceEvidence(section);
      return;
    }
    lines.push("", `## ${section.label || section.key}`);
    const content = brief.sectionResponses?.[section.key]
      ?? knownSectionContent(brief, section.key)
      ?? fallbackSectionContent(section, issues, config);
    renderContent(content);
  };
  if (sections.length) {
    sections.forEach(renderConfiguredSection);
  } else {
    [
      { key: "executiveRead", label: "Executive Read" },
      { key: "backgroundContext", label: "Plain-English Context" },
      { key: "whyJackShouldCare", label: config.ownerName && config.ownerName !== "You" ? `Why ${config.ownerName} Should Care` : "Why It Matters" },
      { key: "futureImplications", label: "Future Implications" },
      { key: "doctrineProjectImpact", label: "Doctrine / Project Impact" },
      { key: "councilRead", label: "Analyzer Read" },
      { key: "councilSynthesis", label: "Analyzer Synthesis" },
      { key: "jackPov", label: config.ownerName && config.ownerName !== "You" ? `${config.ownerName} POV` : "POV" },
      { key: "sourceEvidence", label: "Source Evidence" },
      { key: "openQuestions", label: "Open Questions Before Approval" },
    ].forEach(renderConfiguredSection);
  }
  return lines.join("\n");
}

function formatDeliberation(deliberation = {}) {
  const lines = ["Perspective deliberation"];
  if (Array.isArray(deliberation.perspectives) && deliberation.perspectives.length) {
    for (const item of deliberation.perspectives) {
      lines.push("", `${item.name || "Perspective"}${item.role ? ` (${item.role})` : ""}`);
      if (item.take) lines.push(String(item.take));
      if (item.implication) lines.push(`Implication: ${item.implication}`);
    }
  }
  if (deliberation.synthesis) {
    lines.push("", "Synthesis", String(deliberation.synthesis));
  }
  return lines.join("\n").trim();
}

function formatDeliberationMarkdownV2(deliberation = {}) {
  const lines = ["*Perspective deliberation*"];
  if (Array.isArray(deliberation.perspectives) && deliberation.perspectives.length) {
    for (const item of deliberation.perspectives) {
      const heading = `${item.name || "Perspective"}${item.role ? ` (${item.role})` : ""}`;
      lines.push("", `*${escapeTelegramMarkdown(heading)}*`);
      if (item.take) lines.push(escapeTelegramMarkdown(String(item.take)));
      if (item.implication) lines.push(`*${escapeTelegramMarkdown("Implication")}*: ${escapeTelegramMarkdown(String(item.implication))}`);
    }
  }
  if (deliberation.synthesis) {
    lines.push("", `*${escapeTelegramMarkdown("Synthesis")}*`, escapeTelegramMarkdown(String(deliberation.synthesis)));
  }
  return lines.join("\n").trim();
}

async function deliberateWorkflowRun(runId, { regenerate = false } = {}) {
  const row = get("SELECT * FROM workflow_runs WHERE id=$id", { $id: runId });
  if (!row) throw new Error("Brief run not found.");
  const artifact = parse(row.artifact_json, {});
  if (artifact.deliberation && !regenerate) return artifact.deliberation;
  const config = briefConfig();
  const perspectiveLenses = sanitizePerspectiveLenses(config.perspectiveLenses).filter((lens) => lens.enabled !== false);
  if (!perspectiveLenses.length) throw new Error("Add at least one perspective lens before deliberating a brief.");
  if (modelSettings().status !== "ready") throw new Error("Set up a working model before deliberating a brief.");
  const briefText = String(artifact.onePageBrief || renderOnePageBrief(artifact) || "").trim();
  if (!briefText) throw new Error("This run does not have a saved brief to deliberate.");
  const system = [
    "You deliberate over a saved private intelligence brief using user-created perspective lenses.",
    "Each lens should give a distinct, useful take grounded in the saved brief text.",
    "Do not introduce new factual claims unless you clearly mark them as questions or hypotheses.",
    "Return only valid JSON.",
  ].join(" ");
  const prompt = JSON.stringify({
    task: "Run a perspective deliberation over this saved brief.",
    requiredJsonShape: {
      perspectives: [{ name: "lens name", role: "lens role", take: "specific read on the brief", implication: "what this perspective would do or watch next" }],
      synthesis: "where the perspectives agree, disagree, what matters most, and a practical next move",
    },
    brief: briefText.slice(0, 18000),
    perspectiveLenses: perspectiveLenses.map((lens) => ({
      name: lens.name,
      role: lens.role,
      description: lens.description,
      instructions: lens.instructions,
    })),
  });
  const text = await callTextModel({ system, prompt });
  const payload = parseModelJson(text);
  const deliberation = {
    perspectives: (Array.isArray(payload.perspectives) ? payload.perspectives : []).slice(0, 12).map((item, index) => ({
      name: String(item.name || perspectiveLenses[index]?.name || `Perspective ${index + 1}`).trim(),
      role: String(item.role || perspectiveLenses[index]?.role || "").trim(),
      take: String(item.take || item.read || "").trim(),
      implication: String(item.implication || item.nextMove || "").trim(),
    })).filter((item) => item.name && item.take),
    synthesis: String(payload.synthesis || payload.summary || "").trim(),
    generatedAt: now(),
  };
  if (!deliberation.perspectives.length && !deliberation.synthesis) throw new Error("The model did not return a usable deliberation.");
  const nextArtifact = { ...artifact, deliberation };
  run("UPDATE workflow_runs SET artifact_json=$artifact WHERE id=$id", { $id: runId, $artifact: json(nextArtifact) });
  audit("brief.deliberated", "workflow_run", runId, `Generated deliberation with ${deliberation.perspectives.length} perspective lens${deliberation.perspectives.length === 1 ? "" : "es"}`, {}, "system");
  return deliberation;
}

function briefDateTitle(generatedAt = now()) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(generatedAt));
}

function cleanBriefSummary(value = "") {
  return String(value || "")
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\bRT\s+@[\w_]+:\s*/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+#\w+/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.。]\s*$/, "")
    .trim();
}

function truncateTitleSummary(value = "", maxLength = 112) {
  const text = cleanBriefSummary(value)
    .replace(/^[\s\-*•\d.)]+/, "")
    .replace(/\s*\(source:.*$/i, "")
    .replace(/\s*source:\s*.*$/i, "")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength + 1);
  const atWord = clipped.slice(0, Math.max(clipped.lastIndexOf(" "), 40)).trim();
  return `${atWord || text.slice(0, maxLength).trim()}...`;
}

function titleSummaryLooksSpecific(value = "") {
  const text = String(value || "").trim();
  if (text.length < 8) return false;
  if (/^(daily\s+)?(brief|roundup|news|updates|latest|signals)$/i.test(text)) return false;
  if (/^(ai|crypto|markets?|political race|hollywood|global risk)(,\s*(ai|crypto|markets?|political race|hollywood|global risk))*\s+signals?$/i.test(text)) return false;
  return true;
}

function titleCandidatesFromContent(content) {
  const lines = Array.isArray(content)
    ? content.map((item) => typeof item === "string" ? item : `${item.lens ? `${item.lens}: ` : ""}${item.read || item.title || JSON.stringify(item)}`)
    : String(content || "").split(/\n+/);
  return lines.map((line) => {
    let text = truncateTitleSummary(line);
    text = text.replace(/^[\s\-*•\d.)]+/, "").trim();
    const colonIndex = text.indexOf(":");
    if (colonIndex > 10 && colonIndex < 85) text = text.slice(0, colonIndex).trim();
    return truncateTitleSummary(text, 70);
  }).filter(titleSummaryLooksSpecific);
}

function joinTitleParts(parts = []) {
  const unique = [];
  parts.forEach((part) => {
    const text = truncateTitleSummary(part, 70);
    if (text && titleSummaryLooksSpecific(text) && !unique.some((existing) => existing.toLowerCase() === text.toLowerCase())) unique.push(text);
  });
  const selected = unique.slice(0, 3);
  if (selected.length <= 1) return selected[0] || "";
  if (selected.length === 2) return `${selected[0]} and ${selected[1]}`;
  return `${selected[0]}, ${selected[1]}, and ${selected[2]}`;
}

function briefTitleSummary({ strategicBrief = {}, selectedIssues = [] } = {}) {
  const sectionResponses = strategicBrief.sectionResponses || {};
  const modelTitle = truncateTitleSummary(strategicBrief.titleSummary || strategicBrief.title || "", 112);
  if (titleSummaryLooksSpecific(modelTitle)) return modelTitle;
  const sectionCandidates = [
    ...titleCandidatesFromContent(sectionResponses.topSignals),
    ...titleCandidatesFromContent(sectionResponses.executiveRead),
    ...titleCandidatesFromContent(strategicBrief.headline),
  ];
  const sourceCandidates = selectedIssues.map((issue) => issue.title).filter(Boolean);
  const extracted = joinTitleParts([...sectionCandidates, ...sourceCandidates]);
  if (extracted) return truncateTitleSummary(extracted, 112);
  const fallback = cleanBriefSummary(
    selectedIssues.slice(0, 3).map((issue) => issue.title).filter(Boolean).join("; ") ||
    strategicBrief.headline ||
    "No usable source items published today"
  );
  return fallback.length > 110 ? `${fallback.slice(0, 107).trim()}...` : fallback;
}

function briefArtifactTitle({ generatedAt = now(), strategicBrief = {}, selectedIssues = [] } = {}) {
  const summary = briefTitleSummary({ strategicBrief, selectedIssues });
  return `${briefDateTitle(generatedAt)}: ${summary}`;
}

function saveBriefDocument({ runId, artifact }) {
  const body = artifact.onePageBrief || renderOnePageBrief(artifact);
  const existing = get("SELECT id FROM knowledge_documents WHERE type='Brief' AND tags LIKE $runTag", { $runTag: `%${runId}%` });
  if (existing) return existing.id;
  const t = now();
  const docId = id("doc");
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  run(`INSERT INTO knowledge_documents (id, title, type, visibility, status, tags, body, word_count, created_at, updated_at)
       VALUES ($id, $title, 'Brief', 'private', 'active', $tags, $body, $words, $t, $t)`, {
    $id: docId,
    $title: artifact.title || `Brief: ${runId}`,
    $tags: json(["brief", "workflow", runId]),
    $body: body,
    $words: words,
    $t: t,
  });
  audit("brief.document_saved", "document", docId, `One-page brief saved for ${runId}`, { runId }, "system");
  return docId;
}

async function executeWorkflow(trigger = "Manual", options = {}) {
  const runId = options.runId || id("run");
  const started = now();
  const configAtStart = briefConfig();
  const completedKeys = new Set();
  const stepOutputs = {};
  const progressDelay = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
  const writeProgress = (activeKey) => {
    run("UPDATE workflow_runs SET steps_json=$steps, artifact_json=$artifact WHERE id=$id", {
      $id: runId,
      $steps: json(workflowProgressSteps({ activeKey, completed: completedKeys, outputs: stepOutputs, config: configAtStart })),
      $artifact: json({ progressUpdatedAt: now(), activeStep: activeKey }),
    });
  };
  const finishProgress = (key, output = "Done", detail = "") => {
    completedKeys.add(key);
    stepOutputs[key] = { output, detail };
  };
  run(`INSERT INTO workflow_runs (id, label, trigger, status, started_at, completed_at, steps_json, artifact_json)
       VALUES ($id, $label, $trigger, 'running', $started, NULL, $steps, '{}')`, {
    $id: runId,
    $label: "Generating brief",
    $trigger: trigger,
    $started: started,
    $steps: json(workflowProgressSteps({ activeKey: "fetch", completed: completedKeys, outputs: stepOutputs, config: configAtStart })),
  });
  audit("run.started", "workflow_run", runId, `Trigger: ${trigger}`, {}, "system");
  try {
    writeProgress("fetch");
    await progressDelay(200);
    const {
      activeSources,
      transcriptionSources,
      transcriptionResults,
      xResults,
      rssResults,
      redditResults,
      webResults,
      calendarResults,
      itemCount,
      sourceResults,
    } = await fetchSourceCollection({
      useRecentCache: true,
      onProgress: ({ output, detail }) => {
        stepOutputs.fetch = { output, detail };
        writeProgress("fetch");
      },
    });
    finishProgress("fetch", `${activeSources.length} configured source${activeSources.length === 1 ? "" : "s"} checked`);
    writeProgress("normalize");
    await progressDelay();
    finishProgress("normalize", `${itemCount} normalized item${itemCount === 1 ? "" : "s"}`);
    writeProgress("score");
    await progressDelay();
    finishProgress("score", `${itemCount} scored item${itemCount === 1 ? "" : "s"}`);
    writeProgress("retrieve");
    await progressDelay();
    const docs = documents().filter((d) => d.status === "active");
    finishProgress("retrieve", `${docs.length} active document${docs.length === 1 ? "" : "s"} available`);
    writeProgress("select");
    await progressDelay();
    const selectedIssues = topNormalizedItems();
    finishProgress("select", `${selectedIssues.length} top issue${selectedIssues.length === 1 ? "" : "s"} selected`);
    writeProgress("synthesize");
    await progressDelay();
    const strategicBrief = await synthesizeStrategicBrief({ selectedIssues, sourceResults });
    finishProgress("synthesize", "Strategic synthesis generated");
    audit("brief.synthesized", "workflow_run", runId, `Strategic brief synthesized with ${strategicBrief.mode || "model"}`, { selectedIssues: selectedIssues.length }, "system");
    writeProgress("render");
    await progressDelay();
    const generatedAt = now();
    const artifact = {
    title: briefArtifactTitle({ generatedAt, strategicBrief, selectedIssues }),
    generatedAt,
    selectedIssues,
    podcastTranscriptions: transcriptionResults,
    xFetches: xResults,
    rssFetches: rssResults,
    redditFetches: redditResults,
    webFetches: webResults,
    calendarFetches: calendarResults,
    calendarAgenda: sourceResults.calendarAgenda || [],
    strategicBrief,
    whyJackShouldCare: Array.isArray(strategicBrief.whyJackShouldCare) ? strategicBrief.whyJackShouldCare.join("\n") : strategicBrief.whyJackShouldCare || "",
    implications: strategicBrief.futureImplications || [],
    doctrineImpact: strategicBrief.doctrineProjectImpact || [],
    analyzer: {
      behavior: configAtStart.analyzerBehavior || defaultAnalyzerBehavior,
      members: (configAtStart.analyzers || []).filter((analyzer) => analyzer.enabled !== false).map((analyzer) => analyzer.name),
      synthesis: strategicBrief.councilSynthesis || (selectedIssues.length
        ? `Analyzer synthesis is ready for ${selectedIssues.length} selected issue${selectedIssues.length === 1 ? "" : "s"}.`
        : "No issues were selected, so no analyzer judgment was generated."),
    },
    council: {
      name: "Brief Analyzers",
      members: (configAtStart.analyzers || []).filter((analyzer) => analyzer.enabled !== false).map((analyzer) => analyzer.name),
      synthesis: strategicBrief.councilSynthesis || (selectedIssues.length
        ? `Analyzer synthesis is ready for ${selectedIssues.length} selected issue${selectedIssues.length === 1 ? "" : "s"}.`
        : "No issues were selected, so no analyzer judgment was generated."),
    },
    jackPov: strategicBrief.jackPov || "",
  };
  artifact.onePageBrief = renderOnePageBrief(artifact);
  finishProgress("render", "Brief markdown rendered");
  writeProgress("save");
  await progressDelay();
  artifact.briefDocumentId = saveBriefDocument({ runId, artifact });
  finishProgress("save", artifact.briefDocumentId ? "Brief artifact and document saved" : "Brief artifact saved");
  writeProgress("telegram");
  await progressDelay();
  let telegramDelivery;
  try {
    telegramDelivery = await deliverBriefToTelegram({ runId, artifact });
  } catch (error) {
    telegramDelivery = { ok: false, error: error.message || "Telegram delivery failed", failedAt: now() };
    run("UPDATE telegram_settings SET last_checked_at=$t, last_error=$err, updated_at=$t WHERE id=1", { $t: now(), $err: telegramDelivery.error });
    audit("telegram.delivery_failed", "workflow_run", runId, telegramDelivery.error, {}, "system");
  }
  artifact.telegramDelivery = telegramDelivery;
  finishProgress("telegram", telegramDelivery?.ok
    ? `Delivered to Telegram in ${telegramDelivery.chunks || 1} message${telegramDelivery.chunks === 1 ? "" : "s"}`
    : telegramDelivery?.skipped
      ? telegramDelivery.reason
      : telegramDelivery?.error || "Telegram delivery failed");
  const steps = workflowTemplate().map(([key, name, group], index) => {
    let output = "Completed with no external mutation";
    let detail = "Deterministic step completed and persisted.";
    if (key === "fetch") {
      output = `${activeSources.length} configured source${activeSources.length === 1 ? "" : "s"} available`;
      detail = activeSources.length ? "External connectors are adapter-backed. Public/RSS sources can be fetched without keys; official API credentials improve reliability where available." : "No configured sources. Nothing was fetched.";
      if (transcriptionSources.length) detail += ` ${transcriptionSources.length} podcast source${transcriptionSources.length === 1 ? "" : "s"} will request episode transcription when new RSS items appear.`;
      const transcribed = transcriptionResults.filter((result) => result.transcribed).length;
      const noops = transcriptionResults.filter((result) => result.ok && !result.transcribed).length;
      const failed = transcriptionResults.filter((result) => result.ok === false).length;
      if (transcriptionResults.length) output += ` · podcast transcripts ${transcribed} new, ${noops} none today, ${failed} failed`;
      if (xResults.length) {
        const fetched = xResults.reduce((sum, result) => sum + Number(result.seen || 0), 0);
        const inserted = xResults.reduce((sum, result) => sum + Number(result.inserted || 0), 0);
        const skipped = xResults.filter((result) => result.skipped).length;
        const xFailed = xResults.filter((result) => result.ok === false).length;
        output += ` · X ${fetched} fetched, ${inserted} new, ${skipped} skipped, ${xFailed} failed`;
      }
      if (rssResults.length) output += ` · RSS ${rssResults.reduce((sum, result) => sum + Number(result.seen || 0), 0)} fetched, ${rssResults.reduce((sum, result) => sum + Number(result.inserted || 0), 0)} new`;
      if (redditResults.length) output += ` · Reddit ${redditResults.reduce((sum, result) => sum + Number(result.seen || 0), 0)} fetched, ${redditResults.reduce((sum, result) => sum + Number(result.inserted || 0), 0)} new`;
      if (webResults.length) output += ` · Web ${webResults.reduce((sum, result) => sum + Number(result.seen || 0), 0)} checked, ${webResults.reduce((sum, result) => sum + Number(result.inserted || 0), 0)} new`;
      if (calendarResults.length) output += ` · Calendar ${calendarResults.reduce((sum, result) => sum + Number(result.today || result.seen || 0), 0)} events`;
    }
    if (key === "normalize") output = `${itemCount} normalized item${itemCount === 1 ? "" : "s"}`;
    if (key === "score") output = `${itemCount} scored item${itemCount === 1 ? "" : "s"}`;
    if (key === "retrieve") output = `${docs.length} active document${docs.length === 1 ? "" : "s"} available`;
    if (key === "select") output = `${selectedIssues.length} top issue${selectedIssues.length === 1 ? "" : "s"} selected`;
    if (key === "synthesize") {
      const model = modelSettings();
      detail = model.status === "ready" ? `Model adapter ready: ${model.provider}/${model.model}` : "Model adapter is pending credentials; no generated text was fabricated.";
      output = "Strategic synthesis generated";
    }
    if (key === "render") output = "Brief markdown rendered";
    if (key === "save") output = artifact.briefDocumentId ? "Brief artifact and document saved" : "Brief artifact saved";
    if (key === "telegram") {
      output = telegramDelivery?.ok
        ? `Delivered to Telegram in ${telegramDelivery.chunks || 1} message${telegramDelivery.chunks === 1 ? "" : "s"}`
        : telegramDelivery?.skipped
          ? telegramDelivery.reason
          : telegramDelivery?.error || "Telegram delivery failed";
      detail = telegramDelivery?.ok ? `Chat ${telegramDelivery.chatId}` : "Generate completed, but Telegram delivery did not complete.";
    }
    return { n: index + 1, key, name, group, status: "done", ms: 25 + index * 7, output, detail };
  });
  markItemsUsedInBrief(selectedIssues);
  const completed = now();
  run(`INSERT INTO workflow_runs (id, label, trigger, status, started_at, completed_at, steps_json, artifact_json)
       VALUES ($id, $label, $trigger, 'completed', $started, $completed, $steps, $artifact)
       ON CONFLICT(id) DO UPDATE SET label=excluded.label, status='completed', completed_at=excluded.completed_at, steps_json=excluded.steps_json, artifact_json=excluded.artifact_json`, {
    $id: runId, $trigger: trigger, $started: started, $completed: completed, $steps: json(steps), $artifact: json(artifact),
    $label: artifact.title,
  });
  audit("artifact.saved", "workflow_run", runId, "Run artifact persisted", {}, "system");
  return workflowRuns().find((r) => r.id === runId);
  } catch (error) {
    const completed = now();
    const failedSteps = workflowProgressSteps({ activeKey: "", completed: completedKeys, outputs: stepOutputs, config: configAtStart });
    const failedIndex = Math.max(0, failedSteps.findIndex((step) => step.status !== "done"));
    failedSteps[failedIndex] = {
      ...failedSteps[failedIndex],
      status: "error",
      output: error.message || "Workflow failed",
      detail: "Generation stopped before saving or delivering a brief.",
    };
    run(`UPDATE workflow_runs
         SET status='failed', completed_at=$completed, error=$error, steps_json=$steps, artifact_json=$artifact
         WHERE id=$id`, {
      $id: runId,
      $completed: completed,
      $error: error.message || "Workflow failed",
      $steps: json(failedSteps),
      $artifact: json({ error: error.message || "Workflow failed", failedAt: completed }),
    });
    throw error;
  }
}

migrate();
seed();

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/state", async (req, res) => {
  try {
    await pollTelegramUpdates();
  } catch (error) {
    run("UPDATE telegram_settings SET last_checked_at=$t, last_error=$err, updated_at=$t WHERE id=1", { $t: now(), $err: error.message || "Telegram polling failed" });
    audit("telegram.poll_failed", "telegram_settings", "1", error.message || "Telegram polling failed", {}, "system");
  }
  res.json(state());
});

app.get("/api/notifications/latest-brief", (req, res) => {
  const row = get(`SELECT id, completed_at, artifact_json FROM workflow_runs
                   WHERE status='completed' AND trigger LIKE 'Scheduled%'
                   ORDER BY completed_at DESC LIMIT 1`);
  if (!row) return res.json({ run: null });
  const artifact = parse(row.artifact_json, {});
  const title = String(artifact.onePageBrief || "").match(/^#\s+(.+)$/m)?.[1]
    || artifact.strategicBrief?.headline || artifact.title || "Your daily brief is ready";
  res.json({ run: { id: row.id, completedAt: row.completed_at, title } });
});

app.post("/api/runtime/shutdown", (req, res) => {
  console.log("Shutdown requested: a newer Pillar Brief backend is taking over the port.");
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 150);
});

app.get("/api/runtime/ffmpeg", async (req, res) => {
  res.json({ ffmpeg: await ffmpegStatus(), state: state() });
});

app.get("/api/runtime/stt", async (req, res) => {
  res.json({ stt: await localSttStatus(), state: state() });
});

app.get("/api/audio/:fileName", (req, res) => {
  const fileName = path.basename(String(req.params.fileName || ""));
  const filePath = path.join(audioDir, fileName);
  if (!fileName.endsWith(".mp3") || !fs.existsSync(filePath)) return res.status(404).json({ error: "Audio file not found", state: state() });
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "private, max-age=86400");
  fs.createReadStream(filePath).pipe(res);
});

app.post("/api/audio/transcribe", express.raw({ type: ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "application/octet-stream"], limit: "25mb" }), async (req, res) => {
  try {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    if (!bytes.length) return res.status(400).json({ error: "No audio was recorded.", state: state() });
    const modelRow = get("SELECT * FROM model_settings WHERE id=1");
    const contentType = String(req.headers["content-type"] || "");
    const ext = contentType.includes("mp4") ? ".mp4" : contentType.includes("mpeg") ? ".mp3" : contentType.includes("wav") ? ".wav" : ".webm";
    const filePath = path.join(audioDir, `voice-input-${id("clip")}${ext}`);
    fs.writeFileSync(filePath, bytes);
    const transcript = await transcribeAudioFile(filePath, modelRow);
    try { fs.unlinkSync(filePath); } catch {}
    res.json({ transcript, state: state() });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not transcribe recorded audio.", state: state() });
  }
});

app.post("/api/runtime/stt/model/install", async (req, res) => {
  try {
    const result = await downloadLocalSttModel();
    audit("runtime.stt_model_installed", "runtime", "stt", result.message, { modelPath: result.modelPath }, "system");
    res.json({ ok: true, message: result.message, stt: await localSttStatus(), state: state() });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not download Whisper model.", stt: await localSttStatus(), state: state() });
  }
});

app.post("/api/runtime/ffmpeg/install", async (req, res) => {
  if (!isDesktop || process.platform !== "darwin") {
    return res.status(400).json({ error: "One-click FFmpeg install is only available in the macOS desktop app. Install FFmpeg with your system package manager.", ffmpeg: await ffmpegStatus(), state: state() });
  }
  const status = await ffmpegStatus();
  if (status.available) return res.json({ ok: true, message: "FFmpeg is already installed.", ffmpeg: status, state: state() });
  if (!status.homebrewAvailable) {
    const scriptPath = await openHomebrewBootstrapInstaller();
    return res.json({
      ok: true,
      message: "Opened the Homebrew and FFmpeg installer in Terminal. Return here and click Re-check when it finishes.",
      installerScriptPath: scriptPath,
      ffmpeg: await ffmpegStatus(),
      state: state(),
    });
  }
  const install = await installFfmpegWithBrew(status.homebrewPath);
  const nextStatus = await ffmpegStatus();
  if (!install.ok || !nextStatus.available) {
    return res.status(500).json({
      error: "FFmpeg install did not complete. You can also run `brew install ffmpeg` in Terminal.",
      output: install.output,
      ffmpeg: nextStatus,
      state: state(),
    });
  }
  audit("runtime.ffmpeg_installed", "runtime", "ffmpeg", "Installed FFmpeg with Homebrew", { output: install.output?.slice(-1200) || "" }, "system");
  res.json({ ok: true, message: "FFmpeg installed successfully.", ffmpeg: nextStatus, state: state() });
});

app.post("/api/runtime/open-url", async (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!/^https:\/\/(core\.telegram\.org|telegram\.org|t\.me|brew\.sh|formulae\.brew\.sh|ffmpeg\.org|platform\.openai\.com|help\.openai\.com|console\.anthropic\.com|docs\.anthropic\.com|openrouter\.ai|aistudio\.google\.com|ai\.google\.dev|developer\.x\.com|docs\.x\.com|console\.x\.ai|docs\.x\.ai|elevenlabs\.io)(\/|$)/i.test(url)) {
    return res.status(400).json({ error: "That external URL is not allowed.", state: state() });
  }
  if (isDesktop && process.platform === "darwin") {
    await execFileAsync("open", [url]);
    return res.json({ ok: true, opened: true, state: state() });
  }
  res.json({ ok: true, opened: false, url, state: state() });
});

app.get("/api/onboarding", (req, res) => res.json({ onboarding: onboardingState(), state: state() }));

app.patch("/api/onboarding", (req, res) => {
  const b = req.body || {};
  const current = onboardingState();
  const step = String(b.currentStep ?? current.currentStep ?? "welcome");
  const briefPrompt = String(b.briefPrompt ?? current.briefPrompt ?? "");
  const keepYears = promptHasExplicitYearIntent(briefPrompt);
  const suggestions = Array.isArray(b.sourceSuggestions) ? b.sourceSuggestions.map((source, index) => sanitizeSourceSuggestion(source, index, { keepYears })) : current.sourceSuggestions;
  const briefConfigDraft = b.briefConfigDraft ? sanitizeBriefSetupDraft(b.briefConfigDraft) : current.briefConfigDraft;
  run(`UPDATE onboarding_state
       SET current_step=$step, brief_prompt=$briefPrompt, source_suggestions_json=$suggestions, brief_config_draft_json=$draft, updated_at=$t
       WHERE id=1`, { $step: step, $briefPrompt: briefPrompt, $suggestions: json(suggestions), $draft: json(briefConfigDraft), $t: now() });
  audit("onboarding.updated", "onboarding", "1", `Onboarding step: ${step}`);
  res.json(state());
});

app.post("/api/onboarding/brief-setup-draft", async (req, res) => {
  const briefPrompt = String(req.body?.briefPrompt || "").trim();
  if (briefPrompt.length < 20) return res.status(400).json({ error: "Describe the brief you want in a sentence or two first.", state: state() });
  if (modelSettings().status !== "ready") return res.status(400).json({ error: "Set up a working model API key before generating a brief setup draft.", state: state() });
  const requestedOwnerName = String(req.body?.ownerName || "").trim();
  const current = { ...briefConfig(), ...(requestedOwnerName ? { ownerName: requestedOwnerName } : {}) };
  const system = [
    "You turn a user's brief request into concise settings for a daily intelligence brief app.",
    "Preserve the user's explicit preferences, worldview, ideological frame, source priorities, exclusions, and tone requests.",
    "Do not flatten preferences into generic neutral topic coverage. Make them visible in audienceContext, voiceRules, and relevant section instructions.",
    "Keep claims source-grounded and avoid instructing the brief to fabricate certainty.",
    "Return only valid JSON.",
  ].join(" ");
  const prompt = [
    "Create a brief setup draft from the request.",
    "Keep it natural, useful, direct, and not overcomplicated.",
    "Return JSON with: ownerName, productName, audienceContext, voiceRules, sections.",
    "sections must be an array of 5-8 objects with key, label, enabled, instruction, promptTarget.",
    "Use promptTarget='standard'. Do not invent lens, council, or promptRefId values.",
    "Good sections are specific enough to guide the brief, but short enough that the brief stays readable.",
    "Important: if the user states a preference such as political leaning, preferred framing, disliked groups/parties, source preference, exclusions, or tone, carry it over. Put enduring preferences in audienceContext and voiceRules. Put topic-specific preferences inside the relevant section instructions.",
    "For politically loaded preferences, preserve the requested frame while requiring source grounding. Do not sanitize it into bland both-sides language.",
    "For source preferences like 'mainly X and Reddit', preserve that as a source priority in audienceContext/section instructions.",
    "",
    `Current owner: ${current.ownerName || "the brief owner"}`,
    `Current product: ${current.productName}`,
    `Brief request: ${briefPrompt}`,
  ].join("\n");
  try {
    let draft;
    let fallbackReason = "";
    try {
      const text = await callTextModel({ system, prompt });
      draft = sanitizeBriefSetupDraft(parseModelJson(text), current);
    } catch (error) {
      fallbackReason = error.message || "Model returned an unusable setup draft";
      draft = fallbackBriefSetupDraft(briefPrompt, current);
    }
    run(`UPDATE onboarding_state
         SET brief_prompt=$briefPrompt, brief_config_draft_json=$draft, current_step='setup', updated_at=$t
         WHERE id=1`, { $briefPrompt: briefPrompt, $draft: json(draft), $t: now() });
    audit("onboarding.brief_setup_drafted", "onboarding", "1", fallbackReason ? `Used fallback setup draft: ${fallbackReason}` : `Drafted ${draft.sections.length} brief setup sections`, { fallbackReason }, "system");
    res.json({ draft, fallback: !!fallbackReason, warning: fallbackReason, state: state() });
  } catch (error) {
    audit("onboarding.brief_setup_draft_failed", "onboarding", "1", error.message || "Brief setup draft failed", {}, "system");
    res.status(400).json({ error: error.message || "Brief setup draft failed", state: state() });
  }
});

app.post("/api/onboarding/brief-setup-apply", (req, res) => {
  const draft = sanitizeBriefSetupDraft(req.body?.draft || onboardingState().briefConfigDraft);
  const current = briefConfig();
  const ownerName = isDefaultOwnerName(draft.ownerName) && !isDefaultOwnerName(current.ownerName)
    ? current.ownerName
    : draft.ownerName;
  run(`UPDATE brief_config
       SET owner_name=$owner, product_name=$product, audience_context=$audience,
           voice_rules=$voice, section_schema_json=$sections, updated_at=$t
       WHERE id=1`, {
    $owner: ownerName,
    $product: draft.productName,
    $audience: draft.audienceContext,
    $voice: draft.voiceRules,
    $sections: json(draft.sections),
    $t: now(),
  });
  run("UPDATE onboarding_state SET brief_config_draft_json=$draft, current_step='sources', updated_at=$t WHERE id=1", { $draft: json({ ...draft, ownerName }), $t: now() });
  audit("onboarding.brief_setup_applied", "brief_config", "1", `Applied onboarding brief setup draft with ${draft.sections.length} sections`, {}, "system");
  res.json(state());
});

app.post("/api/onboarding/source-suggestions", async (req, res) => {
  const briefPrompt = String(req.body?.briefPrompt || "").trim();
  if (briefPrompt.length < 20) return res.status(400).json({ error: "Describe the brief you want in a sentence or two first.", state: state() });
  if (modelSettings().status !== "ready") return res.status(400).json({ error: "Set up a working model API key before asking AI to suggest sources.", state: state() });
  const system = "You suggest concrete source records for a personal intelligence brief app. Return only valid JSON.";
  const prompt = [
    "Create 5-8 source suggestions for this brief request.",
    "Use only these source types: RSS, Web, Reddit, X, YouTube, Podcast, Newsletter.",
    "Prefer public RSS/Web/Reddit/YouTube/Podcast sources when possible. Use X only for handles or search queries that clearly need it.",
    "Return JSON with a top-level sources array. Each source must include: name, type, locator, cadence, config, rationale, confidence.",
    "Config examples: RSS {mode:'feed', feedUrl:'https://...'}, Web {mode:'page', url:'https://...'}, Reddit {mode:'subreddit', subreddits:'name'}, X {mode:'search', query:'...'}, YouTube {mode:'channel', channel:'@handle'}, Podcast {mode:'feed', feedUrl:'https://...'}, Newsletter {mode:'feed', feedUrl:'https://...'}, Calendar {mode:'google', calendarId:'primary'}",
    "For X search queries, do not include years unless the user explicitly asked for a specific year/date range. For latest/current/today briefs, use timeless topic queries; the app handles recency.",
    "Bad X query unless the user asked for that year: \"AI crypto politics 2024\". Better: \"AI crypto politics lang:en\".",
    "",
    `Brief request: ${briefPrompt}`,
  ].join("\n");
  try {
    const text = await callTextModel({ system, prompt });
    const payload = parseModelJson(text);
    const keepYears = promptHasExplicitYearIntent(briefPrompt);
    const suggestions = (Array.isArray(payload.sources) ? payload.sources : []).slice(0, 8).map((source, index) => sanitizeSourceSuggestion(source, index, { keepYears })).filter((source) => source.locator);
    if (!suggestions.length) throw new Error("The model did not return usable source suggestions. Try adding more specific topics or source names.");
    run(`UPDATE onboarding_state
         SET brief_prompt=$briefPrompt, source_suggestions_json=$suggestions, current_step='sources', updated_at=$t
         WHERE id=1`, { $briefPrompt: briefPrompt, $suggestions: json(suggestions), $t: now() });
    audit("onboarding.sources_suggested", "onboarding", "1", `Suggested ${suggestions.length} sources`, {}, "system");
    res.json({ suggestions, state: state() });
  } catch (error) {
    audit("onboarding.source_suggestions_failed", "onboarding", "1", error.message || "Source suggestions failed", {}, "system");
    res.status(400).json({ error: error.message || "Source suggestions failed", state: state() });
  }
});

app.post("/api/onboarding/complete", (req, res) => {
  const onboarding = onboardingState();
  if (!onboarding.canComplete) return res.status(400).json({ error: "Finish each required onboarding step before completing setup.", state: state() });
  run("UPDATE onboarding_state SET completed=1, completed_at=$t, current_step='complete', updated_at=$t WHERE id=1", { $t: now() });
  audit("onboarding.completed", "onboarding", "1", "First-run onboarding completed", {}, "system");
  res.json(state());
});

app.post("/api/onboarding/skip", (req, res) => {
  run("UPDATE onboarding_state SET completed=1, completed_at=$t, current_step='skipped', updated_at=$t WHERE id=1", { $t: now() });
  audit("onboarding.skipped", "onboarding", "1", "First-run onboarding skipped");
  res.json(state());
});

app.post("/api/onboarding/reset", (req, res) => {
  run("UPDATE onboarding_state SET completed=0, completed_at=NULL, current_step='welcome', updated_at=$t WHERE id=1", { $t: now() });
  audit("onboarding.reset", "onboarding", "1", "Onboarding reopened");
  res.json(state());
});

app.patch("/api/brief-config", (req, res) => {
  const current = briefConfig();
  const b = req.body || {};
  const sections = Array.isArray(b.sections) ? b.sections : current.sections;
  const analyzers = sanitizeAnalyzerList(Array.isArray(b.analyzers) ? b.analyzers : current.analyzers, defaultAnalyzers());
  const analyzerBehavior = String(b.analyzerBehavior ?? current.analyzerBehavior ?? defaultAnalyzerBehavior).trim() || defaultAnalyzerBehavior;
  const hasPerspectiveLenses = Object.prototype.hasOwnProperty.call(b, "perspectiveLenses");
  const perspectiveLenses = sanitizePerspectiveLenses(Array.isArray(b.perspectiveLenses) ? b.perspectiveLenses : current.perspectiveLenses);
  run(`UPDATE brief_config
       SET owner_name=$owner, product_name=$product, audience_context=$audience,
           voice_rules=$voice, delivery_frequency=$frequency, delivery_time=$time,
           delivery_timezone=$timezone, delivery_day=$day, section_schema_json=$sections,
           analyzers_json=$analyzers, analyzer_behavior=$analyzerBehavior,
           perspective_lenses_json=$perspectiveLenses,
           perspective_lenses_migrated=CASE WHEN $hasPerspectiveLenses = 1 THEN 1 ELSE perspective_lenses_migrated END,
           updated_at=$t
       WHERE id=1`, {
    $owner: String(b.ownerName ?? current.ownerName ?? "You").trim() || "You",
    $product: String(b.productName ?? current.productName ?? "Pillar Brief").trim() || "Pillar Brief",
    $audience: String(b.audienceContext ?? current.audienceContext ?? ""),
    $voice: String(b.voiceRules ?? current.voiceRules ?? ""),
    $frequency: ["Daily", "Weekly"].includes(b.deliveryFrequency) ? b.deliveryFrequency : current.deliveryFrequency,
    $time: String(b.deliveryTime ?? current.deliveryTime ?? "08:00"),
    $timezone: String(b.deliveryTimezone ?? current.deliveryTimezone ?? "America/Denver"),
    $day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].includes(b.deliveryDay) ? b.deliveryDay : current.deliveryDay,
    $sections: json(sections.map((section) => ({
      key: String(section.key || "").trim(),
      label: String(section.label || section.key || "").trim(),
      enabled: section.enabled !== false,
      instruction: String(section.instruction || ""),
      promptTarget: "standard",
      promptRefId: "",
    })).filter((section) => section.key && section.label)),
    $analyzers: json(analyzers),
    $analyzerBehavior: analyzerBehavior,
    $perspectiveLenses: json(perspectiveLenses),
    $hasPerspectiveLenses: hasPerspectiveLenses ? 1 : 0,
    $t: now(),
  });
  audit("brief_config.updated", "brief_config", "1", `Brief configuration updated for ${b.ownerName || current.ownerName}`);
  res.json(state());
});

function requestedPerspectiveLensLimit(promptText) {
  const text = promptText.toLowerCase();
  if (/\b(one|single|a lens|one lens|single lens|one perspective|single perspective)\b/.test(text)) return 1;
  const digit = /\b([2-6])\b/.exec(text);
  if (digit) return Number(digit[1]);
  const wordCounts = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  for (const [word, count] of Object.entries(wordCounts)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return count;
  }
  if (/\b(multiple|several|different perspectives|range of perspectives|set of perspectives|set of lenses|lenses|perspectives)\b/.test(text)) return 4;
  return 1;
}

app.post("/api/perspective-lenses/generate", async (req, res) => {
  const promptText = String(req.body?.prompt || "").trim();
  if (promptText.length < 8) return res.status(400).json({ error: "Describe the perspectives you want first.", state: state() });
  if (modelSettings().status !== "ready") return res.status(400).json({ error: "Set up a working model before generating perspective lenses.", state: state() });
  const lensLimit = requestedPerspectiveLensLimit(promptText);
  const system = [
    "You turn natural-language perspective requests into editable perspective lenses for a brief deliberation feature.",
    "Infer how many lenses the user wants from the request.",
    "Default to exactly one comprehensive lens when the user asks for one persona, one named thinker, one role, or one viewpoint.",
    "Generate multiple lenses only when the user clearly asks for multiple, several, a set, a range, or names multiple viewpoints.",
    "When a user references a real person, create an inspired analytical viewpoint, not a claim to represent that person's actual current opinions.",
    "Each lens must be practical, source-grounded, and safe for a private intelligence brief.",
    "Return only valid JSON.",
  ].join(" ");
  const modelPrompt = JSON.stringify({
    task: `Generate exactly ${lensLimit} perspective lens${lensLimit === 1 ? "" : "es"} from the user's request.`,
    request: promptText,
    countRules: {
      singularDefault: "If the request describes one persona or viewpoint, create one comprehensive lens with a rich role, description, and instructions.",
      multipleOnlyWhenExplicit: "Only create multiple lenses when the user explicitly asks for multiple perspectives or names more than one viewpoint.",
    },
    requiredJsonShape: {
      lenses: [{ name: "short name", role: "perspective role", description: "what it notices", instructions: "how it should evaluate a saved brief", enabled: true }],
    },
  });
  try {
    const text = await callTextModel({ system, prompt: modelPrompt });
    const payload = parseModelJson(text);
    const lenses = sanitizePerspectiveLenses((Array.isArray(payload.lenses) ? payload.lenses : []).map((lens, index) => ({
      ...lens,
      id: lens.id || id(`perspective-${index + 1}`),
    }))).slice(0, lensLimit);
    if (!lenses.length) throw new Error("The model did not return usable perspective lenses.");
    audit("perspectives.generated", "brief_config", "1", `Generated ${lenses.length} perspective lenses from onboarding prompt`, {}, "system");
    res.json({ lenses, state: state() });
  } catch (error) {
    audit("perspectives.generate_failed", "brief_config", "1", error.message || "Perspective generation failed", {}, "system");
    res.status(400).json({ error: error.message || "Perspective generation failed", state: state() });
  }
});

app.post("/api/workflow-runs/:id/deliberate", async (req, res) => {
  try {
    const deliberation = await deliberateWorkflowRun(req.params.id, { regenerate: req.body?.regenerate === true });
    res.json({ deliberation, state: state() });
  } catch (error) {
    res.status(400).json({ error: error.message || "Could not deliberate this brief.", state: state() });
  }
});

app.post("/api/sources", (req, res) => {
  const body = req.body || {};
  const sourceType = String(body.type || "Web");
  const config = sanitizeSourceConfig(sourceType, body.config || {}, body.locator || "", { keepYears: body.keepYears === true || body.config?.keepYears === true });
  const locator = sourceType === "X" ? `search:${config.query || ""}` : String(body.locator || "").trim();
  const t = now();
  const source = {
    id: id("src"), name: String(body.name || body.locator || "Untitled source").trim(),
    type: sourceType, locator,
    cadence: String(body.cadence || "Daily"), status: "active",
    approval_status: "approved", credentials_status: body.credentialsStatus || sourceCredentialStatus(String(body.type || "Web")), note: body.note || "",
  };
  run(`INSERT INTO sources (id, name, type, locator, cadence, status, approval_status, credentials_status, note, config_json, created_at, updated_at)
       VALUES ($id, $name, $type, $locator, $cadence, $status, $approval, $credentials, $note, $config, $t, $t)`, {
    $id: source.id, $name: source.name, $type: source.type, $locator: source.locator, $cadence: source.cadence,
    $status: source.status, $approval: source.approval_status, $credentials: source.credentials_status, $note: source.note, $config: json(config), $t: t,
  });
  audit("source.created", "source", source.id, source.name);
  res.json(state());
});

app.post("/api/podcast/resolve-spotify", async (req, res) => {
  const result = await resolveSpotifyPodcast(String(req.body?.spotifyUrl || "").trim());
  res.json(result);
});

app.post("/api/sources/:id/transcribe", async (req, res) => {
  try {
    const result = await transcribePodcastSource(req.params.id, req.body?.mode || "today");
    res.json({ result, state: state() });
  } catch (error) {
    audit("podcast.transcription_failed", "source", req.params.id, error.message || "Transcription failed", {}, "system");
    res.status(400).json({ error: error.message || "Transcription failed", state: state() });
  }
});

app.post("/api/sources/:id/fetch-x", async (req, res) => {
  try {
    const row = get("SELECT * FROM sources WHERE id=$id", { $id: req.params.id });
    if (!row) return res.status(404).json({ error: "Source not found", state: state() });
    const source = { ...row, config: parse(row.config_json, {}) };
    if (source.type !== "X") return res.status(400).json({ error: "Source is not an X connector", state: state() });
    const result = await fetchXSource(source);
    res.json({ result, state: state() });
  } catch (error) {
    audit("x.fetch_failed", "source", req.params.id, error.message || "X fetch failed", {}, "system");
    res.status(400).json({ error: error.message || "X fetch failed", state: state() });
  }
});

app.patch("/api/sources/:id", (req, res) => {
  const existing = get("SELECT * FROM sources WHERE id = $id", { $id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Source not found" });
  const body = req.body || {};
  const nextType = String(body.type || existing.type || "Web");
  const nextConfig = body.config ? sanitizeSourceConfig(nextType, body.config, body.locator || existing.locator, { keepYears: body.keepYears === true || body.config?.keepYears === true }) : parse(existing.config_json, {});
  const nextLocator = nextType === "X" ? `search:${nextConfig.query || ""}` : body.locator;
  const next = { ...existing, ...Object.fromEntries(Object.entries({
    name: body.name, type: body.type, locator: nextLocator, cadence: body.cadence, status: body.status,
    approval_status: body.approvalStatus, credentials_status: body.credentialsStatus, note: body.note,
    config_json: body.config ? json(nextConfig) : undefined,
  }).filter(([, v]) => v !== undefined)) };
  run(`UPDATE sources SET name=$name, type=$type, locator=$locator, cadence=$cadence, status=$status,
       approval_status=$approval, credentials_status=$credentials, note=$note, config_json=$config, updated_at=$t WHERE id=$id`, {
    $id: req.params.id, $name: next.name, $type: next.type, $locator: next.locator, $cadence: next.cadence,
    $status: next.status, $approval: next.approval_status, $credentials: next.credentials_status, $note: next.note, $config: next.config_json || "{}", $t: now(),
  });
  audit("source.updated", "source", req.params.id, next.name, { before: existing, after: next });
  res.json(state());
});

app.delete("/api/sources/:id", (req, res) => {
  const existing = get("SELECT * FROM sources WHERE id = $id", { $id: req.params.id });
  if (!existing) return res.status(404).json({ error: "Source not found" });
  run("DELETE FROM sources WHERE id=$id", { $id: req.params.id });
  audit("source.deleted", "source", req.params.id, existing.name, { before: existing });
  res.json(state());
});

app.post("/api/lenses", (req, res) => {
  const b = req.body || {};
  const lensId = b.id || id("lens");
  const t = now();
  run(`INSERT INTO lenses (id, name, role, description, instructions, schema_json, enabled, created_at, updated_at)
       VALUES ($id, $name, $role, $description, $instructions, $schema, $enabled, $t, $t)
       ON CONFLICT(id) DO UPDATE SET name=$name, role=$role, description=$description, instructions=$instructions,
       schema_json=$schema, enabled=$enabled, updated_at=$t`, {
    $id: lensId, $name: b.name || "Untitled Lens", $role: b.role || "", $description: b.description || "",
    $instructions: b.instructions || "", $schema: json(b.schema || []), $enabled: b.enabled === false ? 0 : 1, $t: t,
  });
  audit("lens.saved", "lens", lensId, b.name || "Untitled Lens");
  res.json(state());
});
app.patch("/api/lenses/:id", (req, res) => {
  const current = get("SELECT * FROM lenses WHERE id=$id", { $id: req.params.id });
  if (!current) return res.status(404).json({ error: "Lens not found" });
  const b = req.body || {};
  run(`UPDATE lenses SET name=$name, role=$role, description=$description, instructions=$instructions,
       schema_json=$schema, enabled=$enabled, updated_at=$t WHERE id=$id`, {
    $id: req.params.id, $name: b.name ?? current.name, $role: b.role ?? current.role,
    $description: b.description ?? current.description, $instructions: b.instructions ?? current.instructions,
    $schema: json(b.schema ?? parse(current.schema_json, [])), $enabled: b.enabled === undefined ? current.enabled : (b.enabled ? 1 : 0), $t: now(),
  });
  audit("lens.updated", "lens", req.params.id, b.name || current.name);
  res.json(state());
});

app.post("/api/councils", (req, res) => {
  const b = req.body || {};
  const councilId = b.id || id("council");
  const t = now();
  run(`INSERT INTO councils (id, name, synthesis_prompt, enabled, created_at, updated_at)
       VALUES ($id, $name, $prompt, $enabled, $t, $t)
       ON CONFLICT(id) DO UPDATE SET name=$name, synthesis_prompt=$prompt, enabled=$enabled, updated_at=$t`, {
    $id: councilId, $name: b.name || "Untitled Council", $prompt: b.synthesisPrompt || "", $enabled: b.enabled === false ? 0 : 1, $t: t,
  });
  run("DELETE FROM council_members WHERE council_id=$id", { $id: councilId });
  (b.members || []).forEach((lensId, i) => run("INSERT INTO council_members (council_id, lens_id, position) VALUES ($c, $l, $p)", { $c: councilId, $l: lensId, $p: i + 1 }));
  audit("council.saved", "council", councilId, b.name || "Untitled Council");
  res.json(state());
});

app.post("/api/documents", (req, res) => {
  const b = req.body || {};
  const docId = id("doc");
  const t = now();
  const body = String(b.body || "");
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  run(`INSERT INTO knowledge_documents (id, title, type, visibility, status, tags, body, word_count, created_at, updated_at)
       VALUES ($id, $title, $type, $visibility, 'active', $tags, $body, $words, $t, $t)`, {
    $id: docId, $title: b.title || "Untitled Document", $type: b.type || "Note", $visibility: b.visibility || "private",
    $tags: json(b.tags || []), $body: body, $words: words, $t: t,
  });
  const chunks = body.match(/(.|[\r\n]){1,1200}/g) || [];
  chunks.forEach((chunk, i) => run("INSERT INTO document_chunks (id, document_id, chunk_index, body, token_count, created_at) VALUES ($id, $doc, $idx, $body, $tokens, $t)", {
    $id: id("chunk"), $doc: docId, $idx: i, $body: chunk, $tokens: Math.ceil(chunk.split(/\s+/).length * 1.35), $t: t,
  }));
  audit("document.created", "document", docId, b.title || "Untitled Document");
  res.json(state());
});
app.patch("/api/documents/:id", (req, res) => {
  const current = get("SELECT * FROM knowledge_documents WHERE id=$id", { $id: req.params.id });
  if (!current) return res.status(404).json({ error: "Document not found" });
  const b = req.body || {};
  run(`UPDATE knowledge_documents SET title=$title, type=$type, visibility=$visibility, status=$status,
       tags=$tags, body=$body, word_count=$words, updated_at=$t WHERE id=$id`, {
    $id: req.params.id, $title: b.title ?? current.title, $type: b.type ?? current.type,
    $visibility: b.visibility ?? current.visibility, $status: b.status ?? current.status,
    $tags: json(b.tags ?? parse(current.tags, [])), $body: b.body ?? current.body,
    $words: (b.body ?? current.body).trim() ? (b.body ?? current.body).trim().split(/\s+/).length : 0, $t: now(),
  });
  audit("document.updated", "document", req.params.id, b.title || current.title);
  res.json(state());
});

app.post("/api/workflow-runs", async (req, res) => {
  const trigger = req.body?.trigger || "Manual";
  const runId = id("run");
  try {
    const promise = executeWorkflow(trigger, { runId });
    if (req.body?.wait === true) {
      const run = await promise;
      return res.json({ state: state(), run });
    }
    promise.catch((error) => {
      audit("run.failed", "workflow_run", runId, error.message || "Workflow failed", {}, "system");
    });
    res.status(202).json({ state: state(), run: workflowRuns().find((r) => r.id === runId) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Workflow failed", state: state() });
  }
});

app.get("/api/workflow-runs/:id", (req, res) => {
  const run = workflowRuns().find((item) => item.id === req.params.id);
  if (!run) return res.status(404).json({ error: "Workflow run not found", state: state() });
  res.json({ state: state(), run });
});

app.post("/api/workflow-runs/:id/audio", async (req, res) => {
  try {
    const workflowRun = workflowRuns().find((item) => item.id === req.params.id);
    if (!workflowRun) return res.status(404).json({ error: "Workflow run not found", state: state() });
    if (workflowRun.artifact?.audio?.url && workflowRun.artifact?.audio?.fileName) {
      return res.json({ audio: workflowRun.artifact.audio, state: state() });
    }
    const audio = await synthesizeElevenLabsAudio({ text: briefAudioText(workflowRun.artifact), filenamePrefix: `brief-${workflowRun.id}` });
    const nextArtifact = { ...(workflowRun.artifact || {}), audio };
    run("UPDATE workflow_runs SET artifact_json=$artifact WHERE id=$id", { $id: workflowRun.id, $artifact: json(nextArtifact) });
    audit("brief.audio_generated", "workflow_run", workflowRun.id, "Generated ElevenLabs audio for saved brief", { bytes: audio.bytes }, "system");
    res.json({ audio, state: state() });
  } catch (error) {
    res.status(400).json({ error: error.message || "Brief audio generation failed", state: state() });
  }
});

app.patch("/api/approvals/:id", (req, res) => {
  const current = get("SELECT * FROM approval_items WHERE id=$id", { $id: req.params.id });
  if (!current) return res.status(404).json({ error: "Approval not found" });
  const status = req.body?.status;
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "Invalid status" });
  run("UPDATE approval_items SET status=$status, resolved_by=$by, resolved_at=$t, resolution_note=$note WHERE id=$id", {
    $id: req.params.id, $status: status, $by: req.body?.by || "operator", $t: now(), $note: req.body?.note || "",
  });
  audit(`approval.${status}`, "approval", req.params.id, req.body?.note || status);
  res.json(state());
});

app.patch("/api/telegram", (req, res) => {
  const b = req.body || {};
  const current = get("SELECT * FROM telegram_settings WHERE id=1");
  const nextToken = b.botToken === "configured" ? current.bot_token : String(b.botToken || "").trim();
  const nextChat = String(b.chatId || "").trim();
  const allowedUsers = Array.isArray(b.allowedUsers) ? b.allowedUsers.map((user) => String(user).trim()).filter(Boolean) : [];
  run(`UPDATE telegram_settings SET bot_token=$token, chat_id=$chat, allowed_users=$users, enabled=$enabled,
       last_error=$err, updated_at=$t WHERE id=1`, {
    $token: nextToken,
    $chat: nextChat,
    $users: json(allowedUsers),
    $enabled: b.enabled ? 1 : 0,
    $err: b.enabled && !nextToken ? "Missing bot token" : b.enabled && !nextChat ? "Missing chat ID" : "",
    $t: now(),
  });
  audit("telegram.settings_updated", "telegram_settings", "1", b.enabled ? "Telegram enabled/updated" : "Telegram disabled/updated");
  res.json(state());
});

app.post("/api/telegram/token/validate", async (req, res) => {
  try {
    const { token, bot } = await validateTelegramToken(req.body?.botToken);
    run("UPDATE telegram_settings SET bot_token=$token, last_checked_at=$t, last_error='', updated_at=$t WHERE id=1", { $token: token, $t: now() });
    audit("telegram.token_validated", "telegram_settings", "1", `Validated @${bot.username}`, {}, "system");
    res.json({ ok: true, botUsername: bot.username, botName: bot.first_name || bot.username, state: state() });
  } catch (error) {
    run("UPDATE telegram_settings SET last_checked_at=$t, last_error=$err, updated_at=$t WHERE id=1", { $t: now(), $err: error.message || "Telegram token validation failed" });
    res.status(400).json({ error: error.message || "Telegram token validation failed", state: state() });
  }
});

app.post("/api/telegram/pairing/start", async (req, res) => {
  try {
    const requestedToken = String(req.body?.botToken || "").trim();
    const current = get("SELECT * FROM telegram_settings WHERE id=1");
    const botToken = requestedToken && requestedToken !== "configured" ? requestedToken : current.bot_token;
    const { token, bot, base } = await validateTelegramToken(botToken);
    const webhook = await fetchWithTimeout(`${base}/getWebhookInfo`);
    const webhookPayload = await webhook.json().catch(() => ({}));
    if (webhook.ok && webhookPayload.ok && webhookPayload.result?.url) {
      throw new Error("This bot already has a Telegram webhook configured. Remove the webhook first, then start pairing again.");
    }
    const code = randomCode();
    const sessionId = id("tgpair");
    const deepLink = `https://t.me/${bot.username}?start=${code}`;
    const t = now();
    run(`INSERT INTO telegram_pairing_sessions (id, code, status, bot_username, deep_link, expires_at, created_at)
         VALUES ($id, $code, 'waiting', $bot, $deepLink, $expires, $t)`, {
      $id: sessionId,
      $code: code,
      $bot: bot.username,
      $deepLink: deepLink,
      $expires: addMinutes(10),
      $t: t,
    });
    run("UPDATE telegram_settings SET bot_token=$token, last_checked_at=$t, last_error='', updated_at=$t WHERE id=1", { $token: token, $t: t });
    audit("telegram.pairing_started", "telegram_settings", "1", `Pairing code created for @${bot.username}`, { sessionId }, "system");
    res.json({ session: telegramPairingSession(get("SELECT * FROM telegram_pairing_sessions WHERE id=$id", { $id: sessionId })), state: state() });
  } catch (error) {
    run("UPDATE telegram_settings SET last_checked_at=$t, last_error=$err, updated_at=$t WHERE id=1", { $t: now(), $err: error.message || "Telegram pairing failed" });
    res.status(400).json({ error: error.message || "Telegram pairing failed", state: state() });
  }
});

app.get("/api/telegram/pairing/:id", (req, res) => {
  const row = activePairingSession(req.params.id);
  if (!row) return res.status(404).json({ error: "Pairing session not found" });
  res.json({ session: telegramPairingSession(row), state: state() });
});

app.get("/api/telegram/pairing/:id/qr.svg", (req, res) => {
  const row = activePairingSession(req.params.id);
  if (!row?.deep_link) return res.status(404).type("image/svg+xml").send(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#fff"/><text x="20" y="120" font-family="sans-serif" font-size="14">QR unavailable</text></svg>`);
  res.redirect(`https://quickchart.io/qr?size=240&margin=1&text=${encodeURIComponent(row.deep_link)}`);
});

app.post("/api/telegram/pairing/:id/poll", async (req, res) => {
  const row = activePairingSession(req.params.id);
  if (!row) return res.status(404).json({ error: "Pairing session not found", state: state() });
  if (row.status !== "waiting") return res.json({ session: telegramPairingSession(row), state: state() });
  const tg = get("SELECT * FROM telegram_settings WHERE id=1");
  if (!tg?.bot_token) return res.status(400).json({ error: "Missing bot token", state: state() });
  try {
    const params = new URLSearchParams({
      timeout: "0",
      allowed_updates: JSON.stringify(["message"]),
    });
    if (row.update_offset) params.set("offset", String(row.update_offset));
    const response = await fetchWithTimeout(`https://api.telegram.org/bot${tg.bot_token}/getUpdates?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      const description = payload.description || `Telegram getUpdates failed: ${response.status} ${response.statusText}`;
      throw new Error(telegramPairingErrorMessage(description));
    }
    let nextOffset = row.update_offset || 0;
    let matched = null;
    for (const update of payload.result || []) {
      nextOffset = Math.max(nextOffset, Number(update.update_id || 0) + 1);
      const message = update.message;
      const text = String(message?.text || "").trim();
      const chat = message?.chat;
      const from = message?.from || {};
      const normalized = text.replace(/^\/(start|pair)(@\w+)?\s*/i, "").trim().toUpperCase();
      if (chat?.type === "private" && /^\/start(@\w+)?$/i.test(text)) {
        await sendTelegramMessage(tg.bot_token, String(chat.id), "Pillar Brief pairing is ready. Reply with the code shown in the app.");
      }
      if (chat?.type === "private" && (normalized === row.code || text.toUpperCase() === row.code)) {
        matched = { chat, from };
        break;
      }
    }
    if (matched) {
      const chatId = String(matched.chat.id);
      const userId = String(matched.from.id || matched.chat.id);
      const username = matched.from.username || matched.chat.username || "";
      const allowed = Array.from(new Set([username, userId].filter(Boolean)));
      run(`UPDATE telegram_pairing_sessions
           SET status='paired', chat_id=$chat, telegram_user_id=$user, telegram_username=$username,
               update_offset=$offset, paired_at=$t, error=''
           WHERE id=$id`, { $id: row.id, $chat: chatId, $user: userId, $username: username, $offset: nextOffset, $t: now() });
      run(`UPDATE telegram_settings
           SET chat_id=$chat, allowed_users=$allowed, enabled=1, last_checked_at=$t, last_error='', updated_at=$t
           WHERE id=1`, { $chat: chatId, $allowed: json(allowed), $t: now() });
      await sendTelegramMessage(tg.bot_token, chatId, "Telegram is paired. Your brief delivery is ready.");
      audit("telegram.paired", "telegram_settings", "1", `Paired Telegram chat ${chatId}`, { username }, "system");
    } else {
      run("UPDATE telegram_pairing_sessions SET update_offset=$offset WHERE id=$id", { $id: row.id, $offset: nextOffset });
    }
    res.json({ session: telegramPairingSession(activePairingSession(row.id)), state: state() });
  } catch (error) {
    run("UPDATE telegram_pairing_sessions SET status='failed', error=$err WHERE id=$id", { $id: row.id, $err: error.message || "Telegram pairing failed" });
    run("UPDATE telegram_settings SET last_checked_at=$t, last_error=$err, updated_at=$t WHERE id=1", { $t: now(), $err: error.message || "Telegram pairing failed" });
    res.status(400).json({ error: error.message || "Telegram pairing failed", session: telegramPairingSession(activePairingSession(row.id)), state: state() });
  }
});

app.post("/api/telegram/test", async (req, res) => {
  const tg = get("SELECT * FROM telegram_settings WHERE id=1");
  if (!tg?.bot_token) return res.status(400).json({ error: "Missing bot token", state: state() });
  if (!tg?.chat_id) return res.status(400).json({ error: "Missing chat ID", state: state() });
  const base = `https://api.telegram.org/bot${tg.bot_token}`;
  try {
    const me = await fetchWithTimeout(`${base}/getMe`);
    const mePayload = await me.json().catch(() => ({}));
    if (!me.ok || !mePayload.ok) {
      throw new Error(mePayload.description || `Telegram getMe failed: ${me.status} ${me.statusText}`);
    }
    const text = `Pillar Brief test message.\nBot: @${mePayload.result?.username || "unknown"}\nTime: ${new Date().toLocaleString()}`;
    const send = await fetchWithTimeout(`${base}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: tg.chat_id, text, disable_web_page_preview: true }),
    });
    const sendPayload = await send.json().catch(() => ({}));
    if (!send.ok || !sendPayload.ok) {
      throw new Error(sendPayload.description || `Telegram sendMessage failed: ${send.status} ${send.statusText}`);
    }
    run("UPDATE telegram_settings SET enabled=1, last_checked_at=$t, last_error='', updated_at=$t WHERE id=1", { $t: now() });
    audit("telegram.test_sent", "telegram_settings", "1", `Sent test message to chat ${tg.chat_id}`, { botUsername: mePayload.result?.username || "" }, "system");
    res.json({ ok: true, botUsername: mePayload.result?.username || "", chatId: tg.chat_id, state: state() });
  } catch (error) {
    run("UPDATE telegram_settings SET last_checked_at=$t, last_error=$err, updated_at=$t WHERE id=1", { $t: now(), $err: error.message || "Telegram test failed" });
    audit("telegram.test_failed", "telegram_settings", "1", error.message || "Telegram test failed", {}, "system");
    res.status(400).json({ error: error.message || "Telegram test failed", state: state() });
  }
});

app.patch("/api/model", (req, res) => {
  const b = req.body || {};
  const current = get("SELECT * FROM model_settings WHERE id=1");
  const provider = modelProviders.includes(b.provider) ? b.provider : "openai";
  const baseUrl = provider === "custom" ? (b.baseUrl || "") : "";
  if (b.apiKey) saveModelProviderKey(provider, b.apiKey);
  const apiKey = b.apiKey || savedModelProviderKey(provider, current);
  const modelName = b.model || defaultModelForProvider(provider);
  const missing = b.enabled && (!modelName || providerCredentialStatus(provider, apiKey) === "missing" || (provider === "custom" && !baseUrl));
  run(`UPDATE model_settings SET provider=$provider, model=$model, api_key=$apiKey, base_url=$baseUrl,
       enabled=$enabled, last_error=$err, updated_at=$t WHERE id=1`, {
    $provider: provider,
    $model: modelName,
    $apiKey: apiKey,
    $baseUrl: baseUrl,
    $enabled: b.enabled ? 1 : 0,
    $err: missing ? "Missing runtime provider key, model name, or custom Base URL" : "",
    $t: now(),
  });
  audit("model.settings_updated", "model_settings", "1", b.enabled ? "Model connector enabled/updated" : "Model connector disabled/updated");
  res.json(state());
});

app.post("/api/model/models", async (req, res) => {
  const b = req.body || {};
  const current = get("SELECT * FROM model_settings WHERE id=1");
  const provider = modelProviders.includes(b.provider) ? b.provider : "openai";
  const result = await fetchProviderModels({ provider, apiKey: b.apiKey || "", savedApiKey: savedModelProviderKey(provider, current), baseUrl: b.baseUrl || "" });
  run("UPDATE model_settings SET last_checked_at=$t, last_error=$err WHERE id=1", { $t: now(), $err: result.error || "" });
  res.json({ ...result, state: state() });
});

app.post("/api/google-calendar/oauth/start", (req, res) => {
  const b = req.body || {};
  const clientId = String(b.clientId || GOOGLE_CALENDAR_DESKTOP_CLIENT_ID).trim();
  const clientSecret = String(b.clientSecret || GOOGLE_CALENDAR_CLIENT_SECRET || "").trim();
  if (!clientId) return res.status(400).json({ error: "Google Calendar OAuth client ID is not configured.", state: state() });
  const redirectUri = googleCalendarRedirectUri(req);
  const stateToken = id("gcal");
  const pkce = googleCalendarPkcePair();
  const data = {
    ...googleCalendarCredential().data,
    clientId,
    clientSecret: clientSecret || "",
    redirectUri,
    oauthState: stateToken,
    codeVerifier: pkce.verifier,
    scope: GOOGLE_CALENDAR_SCOPE,
    calendarId: "selected",
    selectedCalendarIds: googleCalendarCredential().data.selectedCalendarIds || ["primary"],
  };
  saveGoogleCalendarCredential(data, { enabled: !!data.refreshToken });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: stateToken,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  })}`;
  audit("google_calendar.oauth_started", "connector", GOOGLE_CALENDAR_PROVIDER, "Started Google Calendar OAuth consent", { redirectUri }, "system");
  res.json({ authUrl, redirectUri, state: state() });
});

app.get("/api/google-calendar/oauth/callback", async (req, res) => {
  const code = String(req.query.code || "");
  const returnedState = String(req.query.state || "");
  const connector = googleCalendarCredential();
  const data = connector.data;
  const render = (title, body, { autoReturn = false } = {}) => res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${autoReturn ? '<meta http-equiv="refresh" content="1.4; url=/#/settings">' : ''}<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:48px;line-height:1.5;color:#111827}main{max-width:640px}.button{display:inline-flex;align-items:center;justify-content:center;margin-top:20px;border-radius:8px;background:#111827;color:#fff;text-decoration:none;font-weight:800;padding:12px 16px}p{font-size:18px;color:#374151}code{background:#f3f4f6;padding:2px 6px;border-radius:6px}</style></head><body><main><h1>${title}</h1><p>${body}</p><p>${autoReturn ? "Returning to Pillar Brief Settings..." : "Use the button below to return to Pillar Brief."}</p><a class="button" href="/#/settings">Return to Pillar Brief</a></main><script>${autoReturn ? 'setTimeout(() => { window.location.href = "/#/settings"; }, 800);' : ''}</script></body></html>`);
  if (!code) {
    const error = String(req.query.error || "Missing OAuth code");
    run("UPDATE connector_credentials SET last_error=$err, updated_at=$t WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER, $err: error, $t: now() });
    return render("Google Calendar was not connected", error);
  }
  if (!data.oauthState || returnedState !== data.oauthState) {
    run("UPDATE connector_credentials SET last_error=$err, updated_at=$t WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER, $err: "OAuth state did not match.", $t: now() });
    return render("Google Calendar was not connected", "The OAuth state did not match. Start the connection again from Pillar Brief.");
  }
  try {
    const token = await exchangeGoogleCalendarCode({
      clientId: data.clientId,
      clientSecret: String(data.clientSecret || GOOGLE_CALENDAR_CLIENT_SECRET || "").trim(),
      code,
      redirectUri: data.redirectUri,
      codeVerifier: data.codeVerifier,
    });
    const nextData = {
      ...data,
      refreshToken: token.refresh_token || data.refreshToken || "",
      accessToken: token.access_token || "",
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      tokenType: token.token_type || "Bearer",
      oauthState: "",
      codeVerifier: "",
    };
    if (!nextData.refreshToken) throw new Error("Google did not return a refresh token. Try connecting again and approve offline access.");
    saveGoogleCalendarCredential(nextData, { enabled: true });
    ensureGoogleCalendarBriefSetup();
    run("UPDATE connector_credentials SET last_checked_at=$t, last_error='', updated_at=$t WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER, $t: now() });
    audit("google_calendar.connected", "connector", GOOGLE_CALENDAR_PROVIDER, "Google Calendar connected", {}, "system");
    try {
      const calendars = await fetchGoogleCalendarList();
      const selectedCalendarIds = calendars.filter((calendar) => calendar.primary || calendar.selected).map((calendar) => calendar.id);
      const withCalendars = { ...nextData, calendars, selectedCalendarIds: selectedCalendarIds.length ? selectedCalendarIds : ["primary"], calendarId: "selected" };
      saveGoogleCalendarCredential(withCalendars, { enabled: true });
    } catch {
      // Keep the connection valid even if calendar-list discovery needs a retry from the app.
    }
    return render("Google Calendar connected", "Pillar Brief can now read today's events. Return to the app to choose calendars.", { autoReturn: true });
  } catch (error) {
    const message = error.message || "Google Calendar OAuth failed";
    run("UPDATE connector_credentials SET last_error=$err, updated_at=$t WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER, $err: message, $t: now() });
    audit("google_calendar.oauth_failed", "connector", GOOGLE_CALENDAR_PROVIDER, message, {}, "system");
    return render("Google Calendar was not connected", message);
  }
});

app.post("/api/google-calendar/test", async (req, res) => {
  try {
    await refreshGoogleCalendarAccessToken();
    ensureGoogleCalendarBriefSetup();
    run("UPDATE connector_credentials SET last_checked_at=$t, last_error='', updated_at=$t WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER, $t: now() });
    res.json({ ok: true, connector: googleCalendarPublicConnector(), state: state() });
  } catch (error) {
    run("UPDATE connector_credentials SET last_checked_at=$t, last_error=$err, updated_at=$t WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER, $t: now(), $err: error.message || "Google Calendar test failed" });
    res.status(400).json({ error: error.message || "Google Calendar test failed", state: state() });
  }
});

app.post("/api/google-calendar/calendars", async (req, res) => {
  try {
    const calendars = await fetchGoogleCalendarList();
    const credential = googleCalendarCredential();
    const currentSelected = Array.isArray(credential.data.selectedCalendarIds) && credential.data.selectedCalendarIds.length
      ? credential.data.selectedCalendarIds
      : calendars.filter((calendar) => calendar.primary || calendar.selected).map((calendar) => calendar.id);
    const nextData = {
      ...credential.data,
      calendars,
      selectedCalendarIds: currentSelected.length ? currentSelected : ["primary"],
      calendarId: "selected",
    };
    saveGoogleCalendarCredential(nextData, { enabled: true });
    ensureGoogleCalendarBriefSetup();
    run("UPDATE connector_credentials SET last_checked_at=$t, last_error='', updated_at=$t WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER, $t: now() });
    res.json({ calendars, selectedCalendarIds: nextData.selectedCalendarIds, state: state() });
  } catch (error) {
    run("UPDATE connector_credentials SET last_checked_at=$t, last_error=$err, updated_at=$t WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER, $t: now(), $err: error.message || "Google Calendar list failed" });
    res.status(400).json({ error: error.message || "Google Calendar list failed", state: state() });
  }
});

app.patch("/api/google-calendar/calendars", (req, res) => {
  const credential = googleCalendarCredential();
  if (!credential.enabled || !credential.data.refreshToken) return res.status(400).json({ error: "Connect Google Calendar before choosing calendars.", state: state() });
  const selectedCalendarIds = Array.from(new Set((Array.isArray(req.body?.selectedCalendarIds) ? req.body.selectedCalendarIds : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)));
  if (!selectedCalendarIds.length) return res.status(400).json({ error: "Choose at least one calendar.", state: state() });
  const nextData = { ...credential.data, selectedCalendarIds, calendarId: "selected" };
  saveGoogleCalendarCredential(nextData, { enabled: true });
  audit("google_calendar.calendars_updated", "connector", GOOGLE_CALENDAR_PROVIDER, `Selected ${selectedCalendarIds.length} calendar${selectedCalendarIds.length === 1 ? "" : "s"}`, {}, "system");
  res.json(state());
});

app.post("/api/google-calendar/disconnect", (req, res) => {
  run("UPDATE connector_credentials SET api_key='', enabled=0, last_error='', updated_at=$t WHERE provider=$provider", { $provider: GOOGLE_CALENDAR_PROVIDER, $t: now() });
  audit("google_calendar.disconnected", "connector", GOOGLE_CALENDAR_PROVIDER, "Google Calendar disconnected", {}, "system");
  res.json(state());
});

app.patch("/api/connectors/:provider", (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  if (!["x", "elevenlabs"].includes(provider)) return res.status(404).json({ error: "Connector not found" });
  const b = req.body || {};
  const current = get("SELECT * FROM connector_credentials WHERE provider=$provider", { $provider: provider }) || {};
  const apiKey = b.apiKey ? b.apiKey : current.api_key || "";
  const missing = b.enabled && !apiKey;
  run(`INSERT INTO connector_credentials (provider, api_key, enabled, last_error, updated_at)
       VALUES ($provider, $apiKey, $enabled, $err, $t)
       ON CONFLICT(provider) DO UPDATE SET api_key=$apiKey, enabled=$enabled, last_error=$err, updated_at=$t`, {
    $provider: provider,
    $apiKey: apiKey,
    $enabled: b.enabled ? 1 : 0,
    $err: missing ? (provider === "x" ? "Missing X bearer token" : "Missing ElevenLabs API key") : "",
    $t: now(),
  });
  audit("connector.settings_updated", "connector", provider, b.enabled ? `${provider} connector enabled/updated` : `${provider} connector disabled/updated`);
  res.json(state());
});

app.post("/api/tts/voices", async (req, res) => {
  try {
    const voices = await listElevenLabsVoices(req.body?.apiKey);
    run("UPDATE tts_settings SET last_checked_at=$t, last_error='', updated_at=$t WHERE id=1", { $t: now() });
    res.json({ voices, state: state() });
  } catch (error) {
    run("UPDATE tts_settings SET last_checked_at=$t, last_error=$err, updated_at=$t WHERE id=1", { $t: now(), $err: error.message || "ElevenLabs voice lookup failed" });
    res.status(400).json({ error: error.message || "ElevenLabs voice lookup failed", state: state() });
  }
});

app.patch("/api/tts", (req, res) => {
  const b = req.body || {};
  const apiKey = String(b.apiKey || "").trim();
  if (apiKey) {
    run(`INSERT INTO connector_credentials (provider, api_key, enabled, last_error, updated_at)
         VALUES ('elevenlabs', $apiKey, 1, '', $t)
         ON CONFLICT(provider) DO UPDATE SET api_key=$apiKey, enabled=1, last_error='', updated_at=$t`, { $apiKey: apiKey, $t: now() });
  }
  const current = get("SELECT * FROM tts_settings WHERE id=1");
  const enabled = b.enabled === undefined ? !!current.enabled : !!b.enabled;
  const voiceId = String(b.voiceId ?? current.voice_id ?? "").trim();
  const voiceName = String(b.voiceName ?? current.voice_name ?? "").trim();
  const modelId = String(b.modelId ?? current.model_id ?? "eleven_multilingual_v2").trim() || "eleven_multilingual_v2";
  const telegramAutoSend = b.telegramAutoSend === undefined ? !!current.telegram_auto_send : !!b.telegramAutoSend;
  const hasKey = !!elevenLabsKey(apiKey);
  const lastError = enabled && (!hasKey || !voiceId) ? "Missing ElevenLabs API key or voice" : "";
  run(`UPDATE tts_settings SET provider='elevenlabs', voice_id=$voiceId, voice_name=$voiceName, model_id=$modelId,
       telegram_auto_send=$telegramAutoSend, enabled=$enabled, last_error=$lastError, updated_at=$t WHERE id=1`, {
    $voiceId: voiceId,
    $voiceName: voiceName,
    $modelId: modelId,
    $telegramAutoSend: telegramAutoSend ? 1 : 0,
    $enabled: enabled ? 1 : 0,
    $lastError: lastError,
    $t: now(),
  });
  audit("tts.settings_updated", "tts", "elevenlabs", enabled ? "ElevenLabs TTS enabled/updated" : "ElevenLabs TTS disabled/updated");
  res.json(state());
});

app.post("/api/tts/preview", async (req, res) => {
  try {
    const audio = await synthesizeElevenLabsAudio({
      text: String(req.body?.text || "This is your Pillar Brief audio preview.").slice(0, 500),
      filenamePrefix: "preview",
      apiKey: req.body?.apiKey,
      voiceId: req.body?.voiceId,
      modelId: req.body?.modelId,
    });
    res.json({ audio, state: state() });
  } catch (error) {
    res.status(400).json({ error: error.message || "ElevenLabs preview failed", state: state() });
  }
});

app.post("/api/telegram/commands", async (req, res) => {
  const command = String(req.body?.command || "").trim();
  const tg = get("SELECT * FROM telegram_settings WHERE id=1");
  const recent = parse(tg.recent_commands, []);
  let result = "Unsupported command";
  try {
    if (command === "/brief") result = workflowRuns()[0]?.id ? `Latest run: ${workflowRuns()[0].id}` : "No briefs have been generated yet.";
    if (command === "/sources") result = `${sources().length} configured source(s).`;
    if (command === "/lenses") result = `${briefConfig().perspectiveLenses.filter((l) => l.enabled !== false).length} perspective lens(es) configured.`;
    if (command === "/councils") result = "Councils have been replaced by Brief Setup analyzers and optional perspective deliberation.";
    if (command === "/review") result = `${approvals().filter((a) => a.status === "pending").length} pending approval(s).`;
    if (command.startsWith("/deliberate")) {
      const [, requestedRunId] = command.split(/\s+/);
      const runId = requestedRunId || workflowRuns()[0]?.id;
      result = runId ? formatDeliberation(await deliberateWorkflowRun(runId)) : "No briefs have been generated yet.";
    }
    if (command.startsWith("/analyze")) result = `Ad-hoc analysis requires configured model credentials. Request recorded: ${command}`;
    if (command.startsWith("/approve") || command.startsWith("/reject") || command.startsWith("/add_source") || command.startsWith("/add_lens")) result = "State-changing Telegram commands are adapter-backed and require authenticated Telegram user context.";
    const next = [{ command, result, ts: now() }, ...recent].slice(0, 20);
    run("UPDATE telegram_settings SET recent_commands=$recent, last_checked_at=$t WHERE id=1", { $recent: json(next), $t: now() });
    audit("telegram.command", "telegram_settings", "1", command, { result });
    res.json({ result, state: state() });
  } catch (error) {
    res.status(400).json({ error: error.message || "Telegram command failed", state: state() });
  }
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get(/.*/, (req, res) => res.sendFile(path.join(root, "dist", "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host);
server.on("listening", () => {
  startSourcePreflightScheduler();
  startBriefDeliveryScheduler();
  console.log(`Pillar Brief running at http://${host}:${port}`);
  console.log(`SQLite database: ${dbPath}`);
});
let takeoverAttempts = 0;
server.on("error", (error) => {
  // An orphaned backend from a previous session can hold the port. Ask it to
  // exit and retry so this process (the one the desktop shell tracks) wins.
  if (error.code === "EADDRINUSE" && takeoverAttempts < 20) {
    takeoverAttempts += 1;
    if (takeoverAttempts === 1) {
      console.error(`Port ${port} is in use; asking the previous Pillar Brief backend to exit.`);
      fetch(`http://${host}:${port}/api/runtime/shutdown`, { method: "POST" }).catch(() => {});
    }
    setTimeout(() => server.listen(port, host), 500);
    return;
  }
  console.error(`Server failed to start on ${host}:${port}:`, error);
  process.exitCode = 1;
});
