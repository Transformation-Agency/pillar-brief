import fs from "node:fs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function readCargoVersion(path) {
  const text = fs.readFileSync(path, "utf8");
  const match = text.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not find package version in ${path}`);
  }
  return match[1];
}

const versions = {
  "package.json": readJson("package.json").version,
  "package-lock.json": readJson("package-lock.json").version,
  "package-lock root package": readJson("package-lock.json").packages?.[""]?.version,
  "src-tauri/Cargo.toml": readCargoVersion("src-tauri/Cargo.toml"),
  "src-tauri/tauri.conf.json": readJson("src-tauri/tauri.conf.json").version,
};

const unique = [...new Set(Object.values(versions))];

if (unique.length !== 1) {
  console.error("Release version mismatch:");
  for (const [name, version] of Object.entries(versions)) {
    console.error(`- ${name}: ${version}`);
  }
  process.exit(1);
}

console.log(`Release version OK: ${unique[0]}`);
