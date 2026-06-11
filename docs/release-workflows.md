# Release Workflows

Pillar Brief has GitHub Actions workflows for desktop release artifacts:

- `.github/workflows/macos-release.yml` builds signed and notarized macOS DMGs for Apple Silicon and Intel.
- `.github/workflows/windows-build.yml` builds the Windows installer with Azure Trusted Signing.

## macOS Secrets

Add these repository secrets before running the macOS workflow:

- `APPLE_CERTIFICATE_P12_BASE64`: base64 encoded Developer ID Application `.p12` certificate.
- `APPLE_CERTIFICATE_PASSWORD`: password for the `.p12` certificate.
- `KEYCHAIN_PASSWORD`: temporary CI keychain password. Any strong random value is fine.
- `APPLE_SIGNING_IDENTITY`: exact Developer ID Application identity, for example `Developer ID Application: Your Company (TEAMID)`.
- `APPLE_ID`: Apple ID email used for notarization.
- `APPLE_PASSWORD`: app-specific password for that Apple ID.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

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
git tag v0.1.1
git push origin v0.1.1
```

On a tag, the workflow uploads these release assets:

- `Pillar.Brief_<version>_aarch64.dmg`
- `Pillar.Brief_<version>_aarch64.dmg.sha256`
- `Pillar.Brief_<version>_x64.dmg`
- `Pillar.Brief_<version>_x64.dmg.sha256`

The Apple Silicon job uses the checked-in arm64 whisper.cpp sidecar. The Intel job installs `whisper-cpp` on the Intel runner, builds an Intel sidecar vendor folder, and bundles the tiny English model from `vendor/whisper/models/ggml-tiny.en.bin`.

## Local Equivalent

The CI workflow is equivalent to:

```bash
npm ci
npm run desktop:build -- --target aarch64-apple-darwin --config src-tauri/tauri.ci.conf.json
xcrun notarytool submit <dmg> --wait
xcrun stapler staple <dmg>
```

The workflow writes `src-tauri/tauri.ci.conf.json` at runtime from secrets, so signing identity details do not need to live in the repository.
