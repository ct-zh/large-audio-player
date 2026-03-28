# Repository Guidelines

## Project Structure & Module Organization

- `src/`: React frontend application.
- `src/App.tsx`: main desktop player flow, waveform request policy, and UI state.
- `src/components/`: reusable UI pieces such as `WaveformCanvas.tsx`.
- `src/lib/`: frontend bridge code for Tauri communication.
- `src/types.ts`: shared frontend-side payload and player state definitions.
- `src-tauri/src/main.rs`: Rust backend entrypoint, playback control, waveform generation, cache handling, and Tauri commands.
- `src-tauri/icons/`: desktop app icons.
- `dist/`: frontend build output. Do not edit manually.

## Build, Test, and Development Commands

- `npm install`: install frontend and Tauri CLI dependencies.
- `npm run dev`: start the Vite frontend dev server.
- `npm run build`: run TypeScript compile checks and build the frontend bundle.
- `npx tsc --noEmit`: frontend type-check only.
- `cd src-tauri && cargo check`: compile-check the Rust/Tauri backend.
- `npx tauri dev`: run the desktop app in development mode when local Tauri prerequisites are installed.

## Coding Style & Naming Conventions

- Use 2-space indentation in TypeScript/TSX and 4-space indentation in Rust.
- Prefer `camelCase` for variables/functions, `PascalCase` for React components and TypeScript interfaces, and `snake_case` for Rust fields and functions exposed internally.
- Keep bridge APIs aligned across `src/lib/tauriBridge.ts`, `src/types.ts`, and `src-tauri/src/main.rs`.
- Avoid editing generated or build output under `dist/` and `src-tauri/target/`.

## Testing Guidelines

- There is no formal test suite yet; use compile-time validation as the baseline.
- Before opening a PR, run:
  - `npx tsc --noEmit`
  - `npm run build`
  - `cd src-tauri && cargo check`
- For audio or waveform changes, manually verify file open, playback, seek, EQ, zoom, and waveform updates with a local `wav` or `mp3`.
- For waveform work, verify both overview and high-zoom detail requests and confirm cached reload behavior.

## Commit & Pull Request Guidelines

- Follow the existing concise imperative style, for example: `Initial large audio player prototype`.
- Keep commits focused by subsystem, such as frontend UI, waveform backend, or playback pipeline.
- PRs should include:
  - a short summary of user-visible changes
  - affected areas (`frontend`, `playback`, `waveform`, `tauri`)
  - screenshots or short recordings for UI changes
  - manual verification steps and sample file types tested

## Security & Configuration Tips

- Do not commit `.env` files, local secrets, or large audio fixtures.
- Use local desktop file paths carefully; prefer Tauri commands for file-backed operations rather than browser-only assumptions.
- Treat `src-tauri/target/`, `dist/`, and application cache output as disposable artifacts, not source files.
