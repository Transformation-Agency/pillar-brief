# Release Workflows

Pillar Brief has GitHub Actions workflows for desktop release artifacts:

- `.github/workflows/macos-release.yml` builds signed and notarized macOS DMGs for Apple Silicon and Intel.
- `.github/workflows/windows-build.yml` builds the Windows installer with Azure Trusted Signing.
- `.github/workflows/publish-updater-manifest.yml` publishes the Tauri signed updater manifest after release assets upload.

## macOS Secrets

Add these repository secrets before running the macOS workflow:

- `APPLE_CERTIFICATE_P12_BASE64`: base64 encoded Developer ID Application `.p12` certificate.
- `APPLE_CERTIFICATE_PASSWORD`: password for the `.p12` certificate.
- `KEYCHAIN_PASSWORD`: temporary CI keychain password. Any strong random value is fine.
- `APPLE_SIGNING_IDENTITY`: exact Developer ID Application identity, for example `Developer ID Application: Your Company (TEAMID)`.
- `APPLE_ID`: Apple ID email used for notarization.
- `APPLE_PASSWORD`: app-specific password for that Apple ID.
- `APPLE_TEAM_ID`: Apple Developer Team ID.
- `TAURI_SIGNING_PRIVATE_KEY`: private key generated for Tauri updater signatures.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: password for the Tauri updater private key.

Create the base64 certificate value locally:

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
```

## macOS Release Flow

The macOS workflow runs on:

- `workflow_dispatch`
- pushed tags matching `v*`

For a public release:

```bash
git tag v0.1.3
git push origin v0.1.3
```

On a tag, the workflow uploads these release assets:

- `Pillar.Brief_<version>_aarch64.dmg`
- `Pillar.Brief_<version>_aarch64.dmg.sha256`
- `Pillar.Brief_<version>_aarch64.app.tar.gz`
- `Pillar.Brief_<version>_aarch64.app.tar.gz.sig`
- `Pillar.Brief_<version>_aarch64.app.tar.gz.sha256`
- `Pillar.Brief_<version>_x64.dmg`
- `Pillar.Brief_<version>_x64.dmg.sha256`
- `Pillar.Brief_<version>_x64.app.tar.gz`
- `Pillar.Brief_<version>_x64.app.tar.gz.sig`
- `Pillar.Brief_<version>_x64.app.tar.gz.sha256`

The GitHub release body is read from
`docs/release-notes/<tag>.md`, for example
`docs/release-notes/v0.1.3.md`.

Both macOS jobs run on Apple Silicon GitHub runners. The Intel job cross-compiles the Rust app, downloads the official darwin-x64 Node sidecar, builds a static x86_64 `whisper-cli`, and bundles the tiny English model from `vendor/whisper/models/ggml-tiny.en.bin`.

## Windows Secrets

Add these repository secrets before running the Windows workflow:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_ENDPOINT`
- `AZURE_CODE_SIGNING_NAME`
- `AZURE_CERT_PROFILE_NAME`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

On a tag, the workflow uploads these release assets:

- `Pillar.Brief_<version>_x64-setup.exe`
- `Pillar.Brief_<version>_x64-setup.exe.sig`
- `Pillar.Brief_<version>_x64-setup.exe.sha256`

## Updater Manifest

The updater manifest workflow waits for the macOS and Windows updater assets,
reads the GitHub release notes, generates `latest.json`, and uploads it to the
same GitHub release. The desktop app checks:

```text
https://github.com/Transformation-Agency/pillar-brief/releases/latest/download/latest.json
```

Only the public updater key is committed in `src-tauri/tauri.conf.json`; the
private signing key stays in GitHub Actions secrets.

## Local Equivalent

The CI workflow is equivalent to:

```bash
npm ci
npm run desktop:build -- --target aarch64-apple-darwin --config src-tauri/tauri.ci.conf.json
xcrun notarytool submit <dmg> --wait
xcrun stapler staple <dmg>
```

The workflow writes `src-tauri/tauri.ci.conf.json` at runtime from secrets, so signing identity details do not need to live in the repository.
