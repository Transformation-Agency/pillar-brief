# Third-Party Notices

Pillar Brief includes or can package the following third-party components for
local speech-to-text support.

## Symphonia

- Project: Symphonia
- Upstream: https://github.com/pdeljanov/Symphonia
- Used by: `src-tauri/audio-convert`
- Purpose: Decoding common podcast/audio formats for the bundled audio
  converter sidecar.
- License: MPL-2.0

The MPL-2.0 license text for Symphonia is available at:
https://github.com/pdeljanov/Symphonia/blob/master/LICENSE

## hound

- Project: hound
- Upstream: https://github.com/ruuda/hound
- Used by: `src-tauri/audio-convert`
- Purpose: Writing mono 16 kHz PCM WAV chunks for whisper.cpp transcription.
- License: Apache-2.0

The Apache-2.0 license text for hound is available at:
https://github.com/ruuda/hound/blob/master/LICENSE

## whisper.cpp / ggml

- Project: whisper.cpp
- Upstream: https://github.com/ggml-org/whisper.cpp
- Included paths:
  - `vendor/whisper/bin/whisper-cli`
  - `vendor/whisper/lib/libggml*.dylib`
  - `vendor/whisper/lib/libwhisper.1.dylib`
  - `vendor/whisper/libexec/libggml*.so`
- License: MIT
- Copyright: Copyright (c) 2023-2026 The ggml authors

The MIT license text for whisper.cpp is available at:
https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE

## OpenAI Whisper Model

- Project: Whisper
- Upstream: https://github.com/openai/whisper
- Included path: `vendor/whisper/models/ggml-tiny.en.bin`
- Model: `tiny.en`, converted to ggml format for whisper.cpp
- License: MIT
- Copyright: Copyright (c) 2022 OpenAI

The MIT license text for Whisper is available at:
https://github.com/openai/whisper/blob/main/LICENSE

## LLVM OpenMP Runtime

- Project: LLVM OpenMP Runtime
- Upstream: https://github.com/llvm/llvm-project/tree/main/openmp
- Included path: `vendor/whisper/lib/libomp.dylib`
- License: Apache License 2.0 with LLVM Exceptions

The LLVM OpenMP license text is available at:
https://github.com/llvm/llvm-project/blob/main/openmp/LICENSE.TXT

## Notes

The files under `vendor/whisper` are included so local desktop builds can use
the bundled tiny English Whisper model without downloading a model during first
run. Platform-specific release builds may replace these files with equivalent
platform-specific whisper.cpp artifacts.
