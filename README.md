# Kova

A desktop workspace for running many terminal-based coding-agent sessions and
shells side by side: a grid of up to six live panes, focus mode, per-session
status (working / waiting / idle), and every session resumed on relaunch.

Built with Tauri 2, React 19 + TypeScript, and a Rust PTY engine.

## Layout

| Path | What |
|---|---|
| `app/` | The application (frontend in `app/src`, Rust engine in `app/src-tauri`) |
| `docs/design/` | Design reference |
| `claude_workspace_desktop_prd.md` | Product requirements |

## Develop

Requires Node 22+, pnpm, and Rust (stable).

```sh
cd app
pnpm install
pnpm tauri dev          # run with hot reload
pnpm test               # frontend tests
cargo test --manifest-path src-tauri/Cargo.toml --lib   # engine tests
```

While developing, point the app at a scratch data folder so it never touches
your real sessions: `KOVA_HOME=/tmp/kova-dev pnpm tauri dev`.

## Build

```sh
cd app
# macOS universal DMG (ad-hoc signed)
CI=true pnpm tauri build --target universal-apple-darwin --bundles dmg
```

User data lives in `~/.kova` (config, workspaces, layouts, runtime files).
