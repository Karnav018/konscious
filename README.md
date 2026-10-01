# Konscious

A desktop workspace for running many terminal-based coding-agent sessions and
shells side by side: a grid of up to six live panes, focus mode, per-session
status (working / waiting / idle), and every session resumed on relaunch.

Built with Tauri 2, React 19 + TypeScript, and a Rust PTY engine.

## Layout

| Path | What |
|---|---|
| `app/` | The macOS app (frontend in `app/src`, Rust engine in `app/src-tauri`) |
| `windows/` | The Windows app — a separate copy with the Windows port ([notes](windows/README.md)) |
| `scripts/` | One build command per platform |
| `docs/design/` | Design reference |
| `claude_workspace_desktop_prd.md` | Product requirements |

`app/` contains no Windows code, and nothing in `windows/` is part of the Mac
build. A change meant for both platforms has to be made in both folders.

## Build

| Platform | Command | Output |
|---|---|---|
| macOS | `scripts/build-mac.sh` | `release/mac/Konscious-<version>-universal.dmg` |
| Windows | `scripts/build-windows.sh` | `release/win/Konscious_<version>_x64-setup.exe` |

`build-mac.sh` runs the Mac checks (tests, typecheck, clippy) first and
never touches the installed `/Applications/Konscious.app`. `build-windows.sh`
cross-compiles on this Mac. One-time setup for it:
`brew install llvm nsis`, `cargo install --locked cargo-xwin`.

## Develop (macOS)

Requires Node 22+, pnpm, and Rust (stable).

```sh
cd app
pnpm install
pnpm tauri dev          # run with hot reload
pnpm test               # frontend tests
cargo test --manifest-path src-tauri/Cargo.toml --lib   # engine tests
scripts/check-mac.sh    # everything the Mac build requires to pass
```

While developing, point the app at a scratch data folder so it never touches
your real sessions: `KONSCIOUS_HOME=/tmp/konscious-dev pnpm tauri dev`.

User data lives in `~/.konscious` (config, workspaces, layouts, runtime files).
Data from the app's earlier name (`~/.kova`) is moved there on first launch.
