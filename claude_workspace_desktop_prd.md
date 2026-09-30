# Claude Workspace — Desktop App PRD & Technical Architecture

## 1. Product Definition

**Claude Workspace** is a local-first desktop application for managing multiple native Claude CLI sessions from one powerful workspace.

### Core positioning

> **The workspace for Claude Code.**

The application does not replace Claude CLI.

It does not create another AI agent layer.

It does not own Claude's conversation history.

It provides a desktop environment for:

- creating Claude CLI sessions
- organizing sessions
- viewing many sessions simultaneously
- switching between sessions quickly
- persisting workspace layouts
- monitoring session state
- managing terminal/process lifecycle
- showing Git information
- restoring the workspace later

---

# 2. Core Product Principle

The application should follow:

> **Don't own what Claude, Git, or the operating system already owns.**

### Claude owns

- Claude conversations
- Claude session state
- Claude context
- Claude memory
- Claude tools
- Claude's native communication capabilities

### Git owns

- branches
- commits
- history
- worktrees
- version control

### Filesystem / OS owns

- source files
- directories
- processes
- permissions
- environment

### Claude Workspace owns

- workspace organization
- session organization
- session display names
- layouts
- tabs
- panes
- window state
- process/session lifecycle
- lightweight UI metadata
- notifications
- Git visibility

---

# 3. Desktop-First Architecture

The application is a **native desktop application**, not a web application.

Recommended stack:

```text
Tauri 2
   │
   ├── React
   ├── TypeScript
   └── Rust
```

Architecture:

```text
                 CLAUDE WORKSPACE
                 Desktop Application
                         │
              ┌──────────┴──────────┐
              │                     │
        React + TypeScript       Tauri 2
              │                     │
              │                Rust Core
              │                     │
              │        ┌────────────┼────────────┐
              │        │            │            │
              │       PTY       Process       Filesystem
              │        │        Manager       Manager
              │        │            │
              │        └────────────┼────────────┘
              │                     │
              │                 Claude CLI
              │                     │
              │          ┌──────────┼──────────┐
              │          ▼          ▼          ▼
              │       Session 1  Session 2  Session 3
              │
              └──────── Tauri IPC ───────────────┘
```

---

# 4. Why Tauri 2

Tauri is a good fit because this application requires native system capabilities.

The application needs direct access to:

- Claude CLI processes
- pseudo-terminals
- filesystem
- Git
- process lifecycle
- keyboard shortcuts
- native notifications
- native menus
- multiple windows
- SSH in future versions

A browser-only application would have unnecessary restrictions around these capabilities.

---

# 5. Application Philosophy

The desktop app should feel like a combination of:

```text
VS Code
+
Warp
+
tmux
+
Claude Code
```

but focused specifically on managing Claude CLI sessions.

The user should feel:

> "I have one Claude development environment containing all my Claude sessions."

---

# 6. Main User Experience

The main desktop screen:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Claude Workspace                              ⌘K       + New Session │
├──────────────┬──────────────────────────────────────┬───────────────┤
│              │                                      │               │
│ WORKSPACES   │                                      │   SESSION     │
│              │       ┌────────────┐ ┌────────────┐ │               │
│ Hawk         │       │ Backend    │ │ Frontend   │ │   Backend     │
│  ├ Backend   │       │            │ │            │ │               │
│  ├ Frontend  │       │ Claude     │ │ Claude     │ │ 🟢 Working   │
│  └ Research  │       │ CLI        │ │ CLI        │ │               │
│              │       │            │ │            │ │ ~/hawk/api    │
│ Knowra       │       └────────────┘ └────────────┘ │               │
│  ├ Mobile    │                                      │ Git           │
│  └ Backend   │       ┌────────────┐ ┌────────────┐ │ feature/auth  │
│              │       │ Reviewer   │ │ Research   │ │               │
│ SESSIONS     │       │            │ │            │ │               │
│              │       │ Claude     │ │ Claude     │ │               │
│ 🟢 Backend   │       │ CLI        │ │ CLI        │ │               │
│ 🟢 Frontend  │       └────────────┘ └────────────┘ │               │
│ 🟡 Reviewer  │                                      │               │
│ 🔵 Research  │                                      │               │
│              │                                      │               │
├──────────────┴──────────────────────────────────────┴───────────────┤
│ 4 Claude sessions · 2 working · 1 waiting                 CPU 18%   │
└─────────────────────────────────────────────────────────────────────┘
```

---

# 7. Workspaces

A workspace represents a project or development environment.

Example:

```text
Workspace
│
├── Hawk
│   ├── Backend
│   ├── Frontend
│   ├── Research
│   └── Reviewer
│
├── Knowra
│   ├── Flutter
│   ├── API
│   └── ML
│
└── Personal
    ├── Research
    └── Experiments
```

Each workspace stores lightweight metadata:

- workspace ID
- workspace name
- project path
- session references
- layout
- active session
- UI state

---

# 8. Sessions

A session is a native Claude CLI session managed by the application.

Conceptually:

```text
Session
├── ID
├── display name
├── workspace ID
├── working directory
├── Claude session ID
├── process ID
├── PTY
├── status
├── pane position
├── created time
└── last active time
```

Example:

```text
Backend API

Claude Session:
abc123...

Directory:
/Users/karnav/projects/hawk/backend

Git:
feature/auth

Status:
🟢 Working

Last activity:
2 minutes ago
```

---

# 9. Native Claude CLI

Claude CLI remains the actual runtime.

Conceptually:

```text
Claude Workspace
       │
       ├── Claude CLI #1
       ├── Claude CLI #2
       ├── Claude CLI #3
       ├── Claude CLI #4
       └── Claude CLI #5
```

The application should not recreate Claude.

The user should still interact with the normal Claude CLI.

---

# 10. Session Creation

Click:

```text
+ New Session
```

Show:

```text
┌─────────────────────────────┐
│ New Claude Session          │
├─────────────────────────────┤
│ Name                        │
│ [ Backend API            ]  │
│                             │
│ Directory                   │
│ [ ~/projects/hawk/backend ] │
│                             │
│ Branch                     │
│ [ feature/auth            ]  │
│                             │
│             [ Create ]      │
└─────────────────────────────┘
```

The native process is then launched in the selected directory.

Conceptually:

```bash
cd ~/projects/hawk/backend
claude
```

The implementation should use the supported Claude CLI invocation/session mechanisms available at the time of development.

---

# 11. Session Lifecycle

The workspace should manage:

```text
CREATED
   ↓
STARTING
   ↓
WORKING
   ↓
WAITING
   ↓
WORKING
   ↓
IDLE
   ↓
COMPLETED
```

Possible visual states:

```text
🟢 Working
🟡 Waiting
🔵 Idle
⚪ Completed
🔴 Failed
```

The status system should use observable process/session/terminal signals and should not attempt to infer Claude's private reasoning.

---

# 12. PTY Architecture

A real pseudo-terminal should be used.

```text
React Terminal
      │
      │ Tauri IPC
      ▼
Rust PTY Manager
      │
      ▼
Claude CLI Process
      │
      ├── stdin
      ├── stdout
      └── stderr
```

The PTY layer is responsible for:

- starting the terminal
- sending input
- receiving output
- resizing terminal dimensions
- handling terminal lifecycle
- detaching
- reconnecting where supported

---

# 13. Process Manager

Rust should control native Claude processes.

Responsibilities:

```text
spawn()
attach()
detach()
restart()
terminate()
kill()
status()
exit()
```

Each process should track:

```text
Process
├── PID
├── command
├── cwd
├── environment
├── PTY
├── status
└── Claude session reference
```

React should not directly spawn or terminate Claude processes.

React communicates through Tauri IPC.

---

# 14. Session Manager

Core session API:

```text
create()
start()
attach()
detach()
pause()
resume()
restart()
stop()
kill()

sendInput()
resize()

getStatus()
getProcessInfo()

listSessions()
```

Relationship:

```text
Application Session
        │
        ├── Claude Session ID
        ├── Process
        ├── PTY
        ├── Working Directory
        └── UI Pane
```

---

# 15. Multi-Pane Layouts

The main workspace should support flexible layouts.

## Grid

```text
┌──────────────┬──────────────┐
│ Backend      │ Frontend     │
│              │              │
├──────────────┼──────────────┤
│ Reviewer     │ Research     │
│              │              │
└──────────────┴──────────────┘
```

## Vertical

```text
┌──────────────┐
│ Backend      │
├──────────────┤
│ Frontend     │
├──────────────┤
│ Reviewer     │
└──────────────┘
```

## Horizontal

```text
┌──────────────────────────────┐
│ Backend                      │
├──────────────────────────────┤
│ Frontend                     │
├──────────────────────────────┤
│ Reviewer                     │
└──────────────────────────────┘
```

## Focus

```text
┌────────────────────────────────────────┐
│                                        │
│             Backend Claude             │
│                                        │
│                                        │
└────────────────────────────────────────┘
```

---

# 16. Layout Tree

A flexible layout can be represented as a tree.

Example:

```text
Split Horizontal
├── Split Vertical
│   ├── Backend
│   └── Frontend
│
└── Split Vertical
    ├── Reviewer
    └── Research
```

Type:

```typescript
type LayoutNode =
  | {
      type: "session"
      sessionId: string
    }
  | {
      type: "split"
      direction: "horizontal" | "vertical"
      children: LayoutNode[]
      sizes: number[]
    }
```

This allows arbitrary nesting of panes.

---

# 17. Tabs

Sessions can also be opened as tabs.

```text
┌────────────┬────────────┬────────────┬────────────┐
│ Backend    │ Frontend   │ Research   │ Reviewer   │
│ ●          │ ●          │            │ ●          │
└────────────┴────────────┴────────────┴────────────┘
```

Closing a tab should not necessarily terminate the Claude process.

The process lifecycle should be controlled separately from the UI visibility.

---

# 18. Session Sidebar

The sidebar should provide a compact overview.

```text
SESSIONS

🟢 Backend
   Implementing auth

🟢 Frontend
   Dashboard UI

🟡 Reviewer
   Waiting for backend

🔵 Research
   Exploring PostgreSQL

⚪ Docs
   Idle
```

Show:

- session name
- status
- workspace
- working directory
- optional activity indicator
- unread notification indicator

Avoid generating AI summaries in V1.

---

# 19. Quick Switch

Global shortcut:

```text
⌘K
```

Search:

```text
Search sessions...

> backend

🟢 Backend API
🟢 Backend Debug
🟡 Backend Review
```

Keyboard shortcuts:

```text
⌘1 → Session 1
⌘2 → Session 2
⌘3 → Session 3
⌘4 → Session 4
```

---

# 20. Command Palette

The command palette should contain:

```text
⌘K

> New Claude Session
> Switch Session
> Search Sessions
> Switch Workspace
> Split Right
> Split Down
> Focus Session
> Rename Session
> Kill Session
> Resume Session
> Open Git
> Open Folder
> Open Terminal
> Toggle Sidebar
> Toggle Activity
```

This is one of the most important productivity features.

---

# 21. Notifications

The desktop application can show native notifications.

Examples:

```text
🟢 Backend completed
🟡 Reviewer waiting
🔴 Tests failed
```

Example notification:

```text
┌──────────────────────────────┐
│ Backend API                  │
│                              │
│ Claude finished working.     │
└──────────────────────────────┘
```

Notifications should be based on observable application events.

---

# 22. Activity Center

Display a lightweight event stream.

```text
ACTIVITY

13:08  Backend Claude finished
13:07  Frontend Claude started
13:02  Reviewer became idle
12:58  Backend session resumed
12:43  New Research session created
```

Clicking an event should open the associated session.

---

# 23. Git Integration

Git is shown for visibility.

Example:

```text
Backend

branch
feature/auth

↑ 3
↓ 0

modified:
7 files

commit:
a82f91c
```

Actions:

```text
Open Git
Open Worktree
Open Folder
Copy Path
```

Do not build a full Git client in V1.

Use the native Git CLI.

---

# 24. Terminal Mode

Support regular terminal interaction as well as Claude interaction.

### Claude

```text
┌─────────────────────────────┐
│ Claude                      │
│                             │
│ > Implement authentication  │
│                             │
│ ...                         │
└─────────────────────────────┘
```

### Shell

```text
┌─────────────────────────────┐
│ Terminal                    │
│                             │
│ $ git status                │
│ $ npm test                  │
│                             │
└─────────────────────────────┘
```

This means a workspace pane can provide direct terminal access without leaving the application.

---

# 25. Workspace Persistence

When the user closes the desktop app:

```text
Hawk

┌──────────────┬──────────────┐
│ Backend      │ Frontend     │
├──────────────┼──────────────┤
│ Reviewer     │ Research     │
└──────────────┴──────────────┘
```

the application should remember:

- pane structure
- pane sizes
- session assignments
- active session
- active workspace
- sidebar state
- window dimensions
- window position

On the next launch, the workspace should be reconstructed.

---

# 26. Persistence Strategy

## V1: No SQLite

SQLite is unnecessary for the initial product.

Use local files:

```text
~/.claude-workspace/
│
├── config.json
├── workspaces.json
└── layouts/
    ├── hawk.json
    └── knowra.json
```

Example:

```json
{
  "workspaces": [
    {
      "id": "hawk",
      "name": "Hawk",
      "path": "/Users/karnav/projects/hawk",
      "sessions": [
        {
          "id": "backend",
          "name": "Backend",
          "cwd": "/Users/karnav/projects/hawk/backend"
        },
        {
          "id": "frontend",
          "name": "Frontend",
          "cwd": "/Users/karnav/projects/hawk/frontend"
        }
      ]
    }
  ]
}
```

---

# 27. What We Store

Only lightweight metadata.

### Workspace

```text
id
name
path
sessions
layout
activeSession
createdAt
updatedAt
```

### Session

```text
id
workspaceId
name
cwd
claudeSessionId
processId
status
createdAt
lastActiveAt
```

### UI

```text
activeWorkspace
activeSession
windowWidth
windowHeight
windowPosition
sidebarState
layout
```

---

# 28. What We Do NOT Store

### Claude conversation

Do not duplicate it.

### Claude context

Do not duplicate it.

### Claude memory

Do not create a duplicate memory system.

### Project files

Do not copy them.

### Git history

Do not copy it.

### Terminal output

Do not permanently store it unless a future feature specifically requires logs.

---

# 29. Why Not SQLite?

SQLite becomes useful only if the product later needs large-scale structured queries.

For example:

```text
50 workspaces
300 sessions
10,000 activity events
```

Then features like:

```text
Search all sessions
Filter by date
Search activity
Find previous sessions
Tag sessions
```

could benefit from SQLite.

But V1 should remain:

```text
JSON/TOML
+
filesystem
+
Claude CLI
+
Git
```

This keeps the product lightweight.

---

# 30. Recommended Desktop Stack

## Desktop

```text
Tauri 2
```

## UI

```text
React
TypeScript
Tailwind CSS
Zustand
xterm.js
```

Optional:

```text
React Flow
```

only if a visual relationship/layout editor is needed later.

## Native

```text
Rust
```

## Terminal

```text
PTY
```

## Claude

```text
Claude CLI
```

## Version Control

```text
Git CLI
```

## Persistence

V1:

```text
JSON / TOML
```

Future:

```text
SQLite
```

---

# 31. React Component Architecture

Suggested structure:

```text
src/
├── app/
│   ├── App.tsx
│   └── routes.ts
│
├── components/
│   ├── WorkspaceSidebar/
│   ├── SessionSidebar/
│   ├── SessionPane/
│   ├── SessionTabs/
│   ├── LayoutManager/
│   ├── CommandPalette/
│   ├── ActivityCenter/
│   ├── NotificationCenter/
│   ├── GitStatus/
│   └── Terminal/
│
├── stores/
│   ├── workspace.store.ts
│   ├── session.store.ts
│   ├── layout.store.ts
│   └── ui.store.ts
│
├── hooks/
├── lib/
├── types/
└── main.tsx
```

---

# 32. Rust Architecture

Suggested structure:

```text
src/
├── main.rs
│
├── workspace/
│   ├── manager.rs
│   ├── model.rs
│   └── persistence.rs
│
├── session/
│   ├── manager.rs
│   ├── process.rs
│   ├── model.rs
│   └── status.rs
│
├── terminal/
│   ├── pty.rs
│   └── terminal.rs
│
├── claude/
│   ├── launcher.rs
│   ├── session.rs
│   └── adapter.rs
│
├── git/
│   ├── manager.rs
│   └── status.rs
│
├── layout/
│   ├── manager.rs
│   └── model.rs
│
└── commands/
    └── mod.rs
```

---

# 33. Tauri IPC

React communicates with Rust through Tauri commands/events.

Example conceptual commands:

```text
workspace_create
workspace_open
workspace_close
workspace_delete

session_create
session_start
session_attach
session_detach
session_resume
session_restart
session_stop
session_kill

terminal_write
terminal_resize

layout_update

git_status
git_branch

config_load
config_save
```

Rust sends events back to React:

```text
session_started
session_output
session_status_changed
session_exited

workspace_changed

git_status_changed

notification
```

---

# 34. Core Data Flow

Creating a Claude session:

```text
User
 │
 ▼
React
 │
 │ session_create
 ▼
Tauri IPC
 │
 ▼
Rust Session Manager
 │
 ├── validate directory
 ├── create PTY
 ├── spawn Claude CLI
 ├── register process
 └── register session
 │
 ▼
Claude CLI
 │
 ▼
PTY
 │
 ▼
Rust
 │
 │ events
 ▼
React
 │
 ▼
Session Pane
```

---

# 35. Multiple Sessions

```text
                 Rust Core
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
      PTY 1        PTY 2        PTY 3
        │            │            │
        ▼            ▼            ▼
    Claude #1    Claude #2    Claude #3
        │            │            │
        ▼            ▼            ▼
    Backend       Frontend     Research
```

All sessions run independently.

The workspace is simply managing their lifecycle and presentation.

---

# 36. Claude Session Communication

The application does **not** need to create a custom message bus.

If Claude CLI sessions can already communicate using Claude's existing mechanisms, the workspace should simply let those native sessions run independently.

The product's responsibility is:

```text
manage
organize
display
switch
restore
monitor
```

not:

```text
orchestrate
route AI messages
invent agent protocols
```

---

# 37. Remote Sessions — Future

A future version can support Claude sessions on remote machines.

Example:

```text
Mac
 │
 │ SSH
 ▼
Linux Server
 │
 ├── Claude #1
 ├── Claude #2
 ├── Claude #3
 └── Claude #4
```

The UI still appears as:

```text
Claude Workspace
```

but the processes are remote.

Possible future environments:

```text
Local
SSH
VM
Container
Remote server
```

This should be V2.

---

# 38. Session Templates — Future

A future version can define:

```text
Hawk Development

Backend
Directory: ./backend

Frontend
Directory: ./frontend

Research
Directory: ./research

Reviewer
Directory: ./backend
```

Then:

```text
Create Workspace
        ↓
Create sessions
        ↓
Restore layout
```

---

# 39. Workspace Profiles — Future

Example:

```text
Hawk Development

Layout:
Backend | Frontend
Tests   | Reviewer

Sessions:
Backend
Frontend
Tests
Reviewer
```

A profile can reconstruct the complete UI arrangement.

---

# 40. V1 Feature Scope

## Workspace

- [x] Create workspace
- [x] Open workspace
- [x] Rename workspace
- [x] Delete workspace
- [x] Project directory
- [x] Multiple workspaces
- [x] Workspace restoration

## Claude Sessions

- [x] Create session
- [x] Rename session
- [x] Start session
- [x] Stop session
- [x] Restart session
- [x] Attach/resume where supported
- [x] Close session
- [x] Session status
- [x] Multiple simultaneous sessions

## Layout

- [x] Tabs
- [x] Split horizontal
- [x] Split vertical
- [x] Grid
- [x] Focus mode
- [x] Resize panes
- [x] Persistent layouts

## Terminal

- [x] Interactive Claude CLI
- [x] Regular shell
- [x] Resize
- [x] Copy/paste
- [x] Keyboard shortcuts

## Git

- [x] Current branch
- [x] Clean/dirty status
- [x] Changed file count
- [x] Current commit
- [x] Open folder
- [x] Open worktree

## UX

- [x] Command palette
- [x] Session search
- [x] Keyboard shortcuts
- [x] Notifications
- [x] Activity center
- [x] Dark theme
- [x] Workspace restoration

---

# 41. Explicitly Out of Scope for V1

Do NOT build:

- AI agent orchestration
- custom agent roles
- task DAG
- custom message bus
- custom AI memory
- conversation database
- AI summarization
- cloud backend
- cloud synchronization
- analytics
- full Git client
- AI-generated session descriptions

The goal is to make the **workspace experience** excellent first.

---

# 42. V2

Potential V2 features:

```text
Remote SSH sessions
Session templates
Workspace templates
Advanced global search
Tags
Favorites
Pinned sessions
Session history
Activity history
Workspace snapshots
Multiple-machine management
Server session management
```

---

# 43. V3

Potential V3:

```text
Workspace automation
Claude hooks integration
MCP integrations
Advanced session analytics
Cross-machine synchronization
Remote server fleet management
```

These should only be considered after the core session manager is stable.

---

# 44. macOS-First Strategy

The first target should be macOS.

```text
Claude Workspace
       │
       ▼
   Tauri 2
       │
       ▼
React + Rust
       │
       ▼
Claude CLI
```

Package:

```text
Claude Workspace.app
```

and later:

```text
Claude Workspace.dmg
```

After the macOS version is stable:

```text
             Claude Workspace
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
        macOS     Linux     Windows
```

Most application logic can remain cross-platform through Tauri/Rust.

---

# 45. Security Principles

Because this is a local developer tool, security is important.

The app should:

- avoid sending project data to a cloud service
- avoid storing Claude conversations
- avoid storing credentials unnecessarily
- respect OS filesystem permissions
- clearly show the working directory
- clearly show the process being managed
- avoid silently executing commands outside the selected environment
- use native OS permissions where applicable

Future remote functionality should use secure SSH mechanisms rather than introducing a custom insecure transport.

---

# 46. Performance Goals

The workspace should be capable of handling many sessions without becoming sluggish.

Target:

```text
10 sessions
→ normal

20 sessions
→ comfortable

30+ sessions
→ still manageable
```

Important:

- terminal rendering should be efficient
- inactive panes should not waste unnecessary CPU
- process monitoring should be lightweight
- UI state should remain responsive
- session output should not be unnecessarily duplicated in memory
- application startup should be fast

---

# 47. User Experience Principle

The application should optimize for this workflow:

```text
Think
 ↓
Switch Claude
 ↓
Type
 ↓
Switch Claude
 ↓
Inspect
 ↓
Switch Claude
 ↓
Run terminal
 ↓
Switch Claude
 ↓
Review
```

The user should never feel:

> "I have too many terminal windows."

Instead:

> "All my Claude sessions are in one workspace."

---

# 48. Core Differentiator

The product should not attempt to make Claude smarter.

It makes the developer better at managing Claude.

Positioning:

> ## The workspace for Claude Code.
>
> Run, organize, switch, and manage all your Claude CLI sessions from one place.

The product value:

```text
10 Claude sessions
        ↓
1 workspace
        ↓
1 visual environment
        ↓
instant switching
        ↓
persistent layouts
        ↓
persistent workspace state
```

---

# 49. Final Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                   CLAUDE WORKSPACE                      │
│                  Desktop Application                   │
│                                                         │
│  React + TypeScript + Tailwind + Zustand + xterm.js    │
│                                                         │
│  ┌────────────┐ ┌────────────────────┐ ┌─────────────┐ │
│  │ Workspace  │ │ Session Grid       │ │ Inspector   │ │
│  │ Sidebar    │ │                    │ │             │ │
│  │            │ │ Claude 1 | Claude 2│ │ Session     │ │
│  │ Hawk       │ │ ----------+--------│ │ Git         │ │
│  │ Knowra     │ │ Claude 3 | Claude 4│ │ Status      │ │
│  │ Personal   │ │                    │ │             │ │
│  └────────────┘ └────────────────────┘ └─────────────┘ │
└──────────────────────────┬──────────────────────────────┘
                           │
                       Tauri IPC
                           │
┌──────────────────────────▼──────────────────────────────┐
│                       RUST CORE                         │
│                                                         │
│  Workspace Manager                                     │
│  Session Manager                                       │
│  PTY Manager                                            │
│  Process Manager                                        │
│  Layout Manager                                         │
│  Git Manager                                            │
│  Persistence                                             │
└─────────────┬───────────────────────────┬───────────────┘
              │                           │
              ▼                           ▼
       Claude CLI                    Git CLI
              │
       ┌──────┼──────┐
       ▼      ▼      ▼
     Claude Claude Claude
      #1      #2      #3
       │       │       │
       ▼       ▼       ▼
    Project Project Project
    Folder   Folder   Folder

Persistence:

~/.claude-workspace/
├── config.json
├── workspaces.json
└── layouts/
```

---

# 50. Final Decision

For the first version:

```text
                    USE
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       Tauri 2     React       Rust
          │          │          │
          │          │          ├── PTY
          │          │          ├── Processes
          │          │          ├── Claude CLI
          │          │          ├── Git
          │          │          └── Filesystem
          │          │
          │          └── Workspace UI
          │
          └── Native Desktop
```

Persistence:

```text
JSON / TOML
```

Not:

```text
SQLite
```

No cloud backend.

No agent orchestration.

No custom Claude communication system.

No duplicated conversation history.

The first product should be a **fast, local-first, macOS desktop workspace that makes managing many native Claude CLI sessions effortless.**

The fundamental rule:

> **Claude owns Claude. Git owns Git. The OS owns processes/files. Claude Workspace owns the workspace experience.**
