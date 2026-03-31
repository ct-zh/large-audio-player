# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install                      # Install all dependencies (frontend + Tauri CLI)
source "$HOME/.cargo/env"        # Load Rust toolchain into shell (required for tauri commands)
npx tauri dev                    # Run desktop app in dev mode (Vite + cargo run)
npm run dev                      # Frontend-only dev server on localhost:1420
npm run build                    # TypeScript check + Vite production build
npx tsc --noEmit                 # Frontend type-check only
cd src-tauri && cargo check      # Rust backend compile-check
npx tauri build                  # Build production desktop app
```

Pre-commit validation: `npx tsc --noEmit` + `npm run build` + `cd src-tauri && cargo check`.

No formal test suite — verify audio changes manually with local wav/mp3 files:
- file open / drag-drop / system dialog
- playback / pause / restart / keyboard seek
- speed switching
- waveform hover / horizontal scroll / zoom
- EQ and DSP preset / parameter apply flow

## Architecture

Tauri 2 desktop app: **React frontend** communicates with **Rust backend** via Tauri commands and events. The frontend also works without Tauri (browser fallback with mock data).

### Frontend (`src/`)

- `App.tsx` — Main bilingual player UI, state management, DSP draft/apply flow, waveform request policy
- `components/WaveformCanvas.tsx` — Canvas-based waveform rendering with zoom, horizontal scroll, seek, and hover time
- `lib/tauriBridge.ts` — All backend calls go through here; each method checks `isTauri()` and falls back to mock data in browser
- `types.ts` — Shared type definitions (AudioMeta, EqSettings, DspSettings, WaveformPoint, PlayerState)

### Backend (`src-tauri/src/main.rs`)

Single-file Rust backend (~1,650 lines) containing:

- **Tauri commands**: `open_audio`, `play`, `pause`, `seek`, `set_gain`, `set_playback_rate`, `set_eq`, `set_dsp_settings`, `request_waveform_overview`, `get_playback_status`, `close_current_audio`
- **PlaybackController** — Dedicated thread with mpsc command channel, uses `rodio` for audio output
- **DSP pipeline** — High-pass/low-pass filters, speech/footstep emphasis, legacy 3-band EQ compatibility, expander, and high-frequency noise reduction applied via `Source` trait wrappers
- **Waveform generation** — Background thread with progress events, uses `symphonia` for audio parsing
- **Waveform caching** — Two-layer: in-memory HashMap + disk cache with content-hash keys

### Bridge contract

Types and command signatures must stay aligned across three files:
- `src/types.ts` (frontend types)
- `src/lib/tauriBridge.ts` (invoke calls with `snake_case` command names)
- `src-tauri/src/main.rs` (Rust structs with `#[serde(rename_all = "camelCase")]`)

Tauri events pushed from backend to frontend:
- `waveform_progress` — Generation progress updates
- `waveform_overview_ready` — Completed waveform data
- `playback_status` — Real-time position and playing state

### Waveform system

- **Overview**: ~720 points covering full file duration
- **Detail**: Up to 4,096 points for a specific time window (used on high zoom)
- **Cache key**: file content hash + point count + window range
- Frontend requests waveform via `request_waveform_overview` with optional `windowStartSec`/`windowEndSec` for detail views
- Frontend waveform viewport is horizontally scrollable when zoom exceeds visible width

### DSP system

- `DspSettings` is the primary controllable processing model
- UI uses a **draft / apply** workflow to avoid rebuilding the playback chain on every slider move
- New files default to DSP preset `off`
- Built-in preset: `upstairs_voice_footsteps`
- Browser fallback only guarantees UI state consistency; desktop Tauri path is the primary DSP implementation target

## Conventions

- 2-space indent in TypeScript/TSX, 4-space in Rust
- `camelCase` for TS variables/functions, `PascalCase` for components/interfaces, `snake_case` for Rust internals
- Rust structs exposed to frontend use `#[serde(rename_all = "camelCase")]`
- Do not edit `dist/` or `src-tauri/target/` — they are generated output
- Commit style: concise imperative, e.g. "Add cached viewport waveform loading"
- Keep bridge contracts aligned across `src/types.ts`, `src/lib/tauriBridge.ts`, and `src-tauri/src/main.rs`
