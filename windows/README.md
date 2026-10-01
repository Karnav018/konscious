# Konscious for Windows

Windows build of Konscious (x64, Windows 10/11). This folder is a separate copy of
the app; the macOS app in `../app` never includes anything from here.

Build from the repo root (on macOS, cross-compiled):

```sh
scripts/build-windows.sh      # → release/win/Konscious_<version>_x64-setup.exe
```

What differs from the Mac app:

| Area | Windows |
|---|---|
| Terminals | PowerShell 7 (`pwsh`) if installed, else Windows PowerShell; ConPTY |
| Finding Claude | `%USERPROFILE%\.local\bin\claude.exe`, `Path`, WinGet links, npm `claude.cmd` |
| Status hooks | Exec-form hooks run `Konscious.exe hook …` directly (no bash needed) — `src-tauri/src/claude/win_hooks.rs` |
| Shortcuts | Ctrl+Shift+N/T/O/I/J/Enter/1–9; Ctrl+= / Ctrl+- / Ctrl+0 for text size |
| Clipboard | Ctrl+C copies when text is selected (else ^C), Ctrl+Shift+C copies, Ctrl+V pastes |
| Window | Native title bar; WebView2 reload/print/find keys disabled |
| Installer | NSIS, per-user install (no admin) |

Requirements on the Windows PC: Claude Code installed and logged in
(`irm https://claude.ai/install.ps1 | iex`). Git for Windows is optional.
The installer is unsigned, so SmartScreen shows "Windows protected your PC" —
choose **More info → Run anyway**.
