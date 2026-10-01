<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.png">
    <img src=".github/assets/banner-light.png" alt="Konscious — every Claude session, one calm place." width="640">
  </picture>
</p>

<p align="center">
  Run up to six Claude Code sessions and shells side by side.<br>
  Each one shows whether it’s working, waiting for you, or done — so you only look where you’re needed.
</p>

<p align="center">
  <a href="https://konscious.hawkapp.in/download/Konscious-0.1.0-universal.dmg"><img src="https://img.shields.io/badge/Download_for_macOS-7.9_MB-C890A7?style=for-the-badge&labelColor=212121" alt="Download for macOS"></a>
  <a href="https://konscious.hawkapp.in/download/Konscious_0.1.0_x64-setup.exe"><img src="https://img.shields.io/badge/Download_for_Windows-3.2_MB-C890A7?style=for-the-badge&labelColor=212121" alt="Download for Windows"></a>
  <a href="https://konscious.hawkapp.in"><img src="https://img.shields.io/badge/Website-konscious.hawkapp.in-FBF5E5?style=for-the-badge&labelColor=212121" alt="Website"></a>
</p>

<p align="center">
  <img src="site/public/app-window.png" alt="Konscious with five sessions in a grid: three Claude Code sessions working, idle and waiting, a research session and a terminal, with usage rings in the title bar." width="100%">
</p>

## What it does

- **See which session needs you.** Every pane says whether its session is working, waiting for you, or idle. The status comes from Claude Code’s own hooks, so a session stuck on a permission prompt shows it the moment it stops.
- **Jump straight to it.** The title bar counts waiting sessions; one shortcut takes you to the next one.
- **Six at a time, or one in focus.** Up to six panes in a grid, or Focus on one. Hidden sessions keep running.
- **A shell beside every session.** Open a terminal in the same folder as the session you’re in.
- **Usage at a glance.** Rings in the title bar show your 5-hour and 7-day Claude usage; each pane shows its model and how full its context window is.
- **Picks up where you left off.** Quit any time. Every session that was running resumes its conversation, in the same layout.
- **Your setup stays yours.** Sessions run the Claude Code you already have, with your settings, hooks and logins. Konscious never edits them.

## Install

Konscious runs your own Claude Code, so install it and sign in first.

| | macOS | Windows |
|---|---|---|
| **Download** | [Konscious-0.1.0-universal.dmg](https://konscious.hawkapp.in/download/Konscious-0.1.0-universal.dmg) | [Konscious_0.1.0_x64-setup.exe](https://konscious.hawkapp.in/download/Konscious_0.1.0_x64-setup.exe) |
| **Runs on** | macOS 13 or later, Apple silicon and Intel | Windows 10 or 11, 64-bit |
| **Install** | Open the DMG and drag Konscious to Applications | Run the installer (for your account, no admin needed) |
| **First launch** | macOS stops it once because the app isn’t notarized yet: open **System Settings › Privacy & Security** and click **Open Anyway** | If Windows says it protected your PC, click **More info**, then **Run anyway** |
| **Claude Code** | `curl -fsSL https://claude.ai/install.sh \| bash` | `irm https://claude.ai/install.ps1 \| iex` |

**Updating** is installing again: drag the new version over the old one (choose **Replace**) on macOS, or run the new installer on Windows — it offers to close the running app. Sessions, layouts and settings are kept, and an install of the previous version is replaced.

## Keyboard shortcuts

| | macOS | Windows |
|---|---|---|
| New session | <kbd>⌘</kbd> <kbd>N</kbd> | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>N</kbd> |
| New terminal in this folder | <kbd>⌘</kbd> <kbd>T</kbd> | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>T</kbd> |
| Next session waiting for you | <kbd>⌘</kbd> <kbd>J</kbd> | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>J</kbd> |
| Focus on a pane, or back to the grid | <kbd>⌘</kbd> <kbd>↵</kbd> | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Enter</kbd> |
| Go to pane 1–9 | <kbd>⌘</kbd> <kbd>1</kbd>–<kbd>9</kbd> | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>1</kbd>–<kbd>9</kbd> |
| Workspaces and sessions | <kbd>⌘</kbd> <kbd>O</kbd> | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>O</kbd> |
| Session details | <kbd>⌘</kbd> <kbd>I</kbd> | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>I</kbd> |
| Text size bigger / smaller / default | <kbd>⌘</kbd> <kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd> | <kbd>Ctrl</kbd> <kbd>=</kbd> / <kbd>-</kbd> / <kbd>0</kbd> |

On Windows, plain <kbd>Ctrl</kbd> + letter stays with the terminal (<kbd>Ctrl</kbd> <kbd>C</kbd> still interrupts), which is why app shortcuts add <kbd>Shift</kbd>.

## How it works

Konscious is a [Tauri 2](https://tauri.app) app: a React 19 + TypeScript interface over a Rust engine that runs every session in its own pseudo-terminal.

- **Sessions are real.** Each pane runs the `claude` CLI (or your shell) in a PTY, the same way your terminal does. Output streams to [xterm.js](https://xtermjs.org) with flow control, so a flood in one pane never freezes the others.
- **Status from hooks, not guesswork.** Each Claude session starts with its own `--settings` file that adds small hooks (prompt submitted, tool running, permission needed, stopped). Your `~/.claude` configuration is never touched.
- **Nothing to lose on quit.** Layout and sessions are saved as you go (with backups), and every session that was running resumes its conversation on the next launch.

User data lives in `~/.konscious` (config, workspaces, layouts). Data from the previous version is moved there on first launch.

## Build from source

Requires Node 22+, pnpm and Rust (stable).

| Folder | What |
|---|---|
| [`app/`](app) | The macOS app — interface in `app/src`, Rust engine in `app/src-tauri` |
| [`windows/`](windows) | The Windows app, a separate copy with the Windows port ([notes](windows/README.md)) |
| [`site/`](site) | The website, [konscious.hawkapp.in](https://konscious.hawkapp.in) ([notes](site/README.md)) |
| [`scripts/`](scripts) | One command per build, install and deploy |
| [`release/`](release) | The built installers the website serves |
| [`claude_workspace_desktop_prd.md`](claude_workspace_desktop_prd.md) | Product requirements |

`app/` contains no Windows code, and nothing in `windows/` is part of the Mac build — a change meant for both platforms is made in both folders.

- **`scripts/build-mac.sh`** — runs the Mac checks (tests, typecheck, clippy), then builds `release/mac/Konscious-<version>-universal.dmg`. Never touches the installed app.
- **`scripts/build-windows.sh`** — cross-compiles on a Mac into `release/win/Konscious_<version>_x64-setup.exe`. One-time setup: `brew install llvm nsis` and `cargo install --locked cargo-xwin`.
- **`scripts/install-mac.sh`** — installs the newest DMG on this Mac, quitting and reopening the running app. `--dry-run` shows what it would do.
- **`scripts/build-site.sh`** — builds the website into `site/dist/`.
- **`scripts/deploy-site.sh`** — builds the website with the installers and deploys it to Vercel.

To work on the Mac app with hot reload, point it at a scratch data folder so it never touches your real sessions:

```sh
cd app
pnpm install
KONSCIOUS_HOME=/tmp/konscious-dev pnpm tauri dev
pnpm test                                             # interface tests
cargo test --manifest-path src-tauri/Cargo.toml --lib # engine tests
scripts/check-mac.sh                                  # everything the Mac build requires to pass
```
