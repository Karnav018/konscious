//! Tools Claude can call to drive Konscious: an MCP server on 127.0.0.1.
//!
//! Each Claude session Konscious launches gets `--mcp-config <run>/<id>.mcp.json`,
//! which names this server and a bearer token that belongs to that session
//! alone, so every call knows which pane made it. Nothing is added to the
//! user's own Claude config.
//!
//! Rust only speaks the protocol. A tool call is handed to the interface (event
//! `agent-call`), which owns sessions, layouts and the confirm dialog, and comes
//! back through the `agent_reply` command.
//!
//! The HTTP side is deliberately small: JSON-RPC over POST with one JSON reply
//! per request (MCP's streamable HTTP, never opening a stream), keep-alive, and
//! bounded header and body sizes. Requests from a browser page (an `Origin`
//! header, or a Host that isn't ours) are refused, so a website can't reach it.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use uuid::Uuid;

use crate::session::manager::Emitter;
use crate::sync::Lock;

pub const EV_CALL: &str = "agent-call";
/// The name Claude sees; its tools appear as `mcp__konscious__<tool>`.
pub const SERVER_NAME: &str = "konscious";
const MAX_HEADER: u64 = 16 * 1024;
const MAX_BODY: usize = 1024 * 1024;
/// Newest first: the answer to a version we don't know.
const PROTOCOLS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
/// Opening a session waits for the person to allow it; everything else is quick.
const ASK_WAIT: Duration = Duration::from_secs(300);
const CALL_WAIT: Duration = Duration::from_secs(20);
const IDLE: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct Reply {
    pub ok: bool,
    pub text: String,
}

pub struct Agent {
    port: u16,
    /// token → session id
    tokens: Mutex<HashMap<String, String>>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Reply>>>,
    next_call: AtomicU64,
    emit: Emitter,
}

impl Agent {
    /// Binds a free port on 127.0.0.1 and starts accepting. `None` if the
    /// port can't be had: sessions then launch exactly as before, without tools.
    pub fn start(emit: Emitter) -> Option<Arc<Self>> {
        let listener = TcpListener::bind("127.0.0.1:0").ok()?;
        let port = listener.local_addr().ok()?.port();
        let agent = Arc::new(Self::new(port, emit));
        let a = Arc::clone(&agent);
        std::thread::Builder::new()
            .name("agent-accept".into())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    let a = Arc::clone(&a);
                    let _ = std::thread::Builder::new().name("agent-conn".into()).spawn(move || a.serve(stream));
                }
            })
            .ok()?;
        Some(agent)
    }

    fn new(port: u16, emit: Emitter) -> Self {
        Self { port, tokens: Mutex::default(), pending: Mutex::default(), next_call: AtomicU64::new(0), emit }
    }

    /// The session's token, made on first use and kept for the app's lifetime,
    /// so a restarted session keeps working with the config it was given.
    fn token_for(&self, session_id: &str) -> String {
        let mut tokens = self.tokens.locked();
        if let Some((t, _)) = tokens.iter().find(|(_, s)| s.as_str() == session_id) {
            return t.clone();
        }
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        tokens.insert(token.clone(), session_id.to_string());
        token
    }

    /// The token stops working once its session is gone.
    pub fn forget(&self, session_id: &str) {
        self.tokens.locked().retain(|_, s| s != session_id);
    }

    pub fn config_value(&self, session_id: &str) -> Value {
        json!({
            "mcpServers": {
                SERVER_NAME: {
                    "type": "http",
                    "url": format!("http://127.0.0.1:{}/mcp", self.port),
                    "headers": { "Authorization": format!("Bearer {}", self.token_for(session_id)) }
                }
            }
        })
    }

    /// `<run>/<id>.mcp.json`, readable only by the user (it holds the token).
    pub fn write_config(&self, run_dir: &Path, session_id: &str) -> std::io::Result<PathBuf> {
        let path = run_dir.join(format!("{session_id}.mcp.json"));
        let mut open = std::fs::OpenOptions::new();
        open.create(true).write(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut open, 0o600);
        open.open(&path)?.write_all(&serde_json::to_vec_pretty(&self.config_value(session_id))?)?;
        Ok(path)
    }

    /// The interface's answer to a call. Late answers (after the wait ran out)
    /// find nobody listening and are dropped.
    pub fn reply(&self, call_id: u64, reply: Reply) {
        if let Some(tx) = self.pending.locked().remove(&call_id) {
            let _ = tx.send(reply);
        }
    }

    /* ── HTTP ─────────────────────────────────────────────────────── */

    fn serve(&self, stream: TcpStream) {
        let _ = stream.set_read_timeout(Some(IDLE));
        let Ok(read_half) = stream.try_clone() else { return };
        let mut reader = BufReader::new(read_half);
        let mut out = stream;
        while let Some(req) = read_request(&mut reader) {
            let (status, body) = self.respond(&req);
            if write_response(&mut out, status, body.as_ref()).is_err() || req.close {
                return;
            }
        }
    }

    fn respond(&self, req: &Request) -> (u16, Option<Value>) {
        if req.path != "/mcp" {
            return (404, None);
        }
        if req.header("origin").is_some() || !self.host_ok(req.header("host")) {
            return (403, None);
        }
        let Some(session) = self.session_of(req.header("authorization")) else {
            return (401, None);
        };
        if req.method != "POST" {
            return (405, None);
        }
        let Ok(msg) = serde_json::from_slice::<Value>(&req.body) else {
            return (400, Some(rpc_error(Value::Null, -32700, "Parse error")));
        };
        if !msg.is_object() {
            return (400, Some(rpc_error(Value::Null, -32600, "Batches are not supported")));
        }
        match msg.get("id") {
            // A notification (`notifications/initialized`) or a response: nothing to answer.
            None => (202, None),
            Some(_) if msg.get("method").is_none() => (202, None),
            Some(_) => (200, Some(self.rpc(&session, &msg))),
        }
    }

    fn host_ok(&self, host: Option<&str>) -> bool {
        let Some(host) = host else { return false };
        let port = self.port.to_string();
        matches!(host.rsplit_once(':'), Some((h, p)) if p == port && (h == "127.0.0.1" || h == "localhost"))
    }

    fn session_of(&self, auth: Option<&str>) -> Option<String> {
        let token = auth?.strip_prefix("Bearer ")?.trim();
        self.tokens.locked().get(token).cloned()
    }

    /* ── JSON-RPC ─────────────────────────────────────────────────── */

    fn rpc(&self, session: &str, msg: &Value) -> Value {
        let id = msg["id"].clone();
        let params = &msg["params"];
        match msg["method"].as_str().unwrap_or("") {
            "initialize" => rpc_result(id, initialize(params)),
            "ping" => rpc_result(id, json!({})),
            "tools/list" => rpc_result(id, json!({ "tools": tools() })),
            "tools/call" => rpc_result(id, self.call_tool(session, params)),
            other => rpc_error(id, -32601, &format!("Unknown method {other}")),
        }
    }

    fn call_tool(&self, session: &str, params: &Value) -> Value {
        let name = params["name"].as_str().unwrap_or("");
        let reply = if !TOOL_NAMES.contains(&name) {
            Reply { ok: false, text: format!("Konscious has no tool named {name:?}.") }
        } else {
            let args = match &params["arguments"] {
                Value::Null => json!({}),
                a => a.clone(),
            };
            let wait = if ASKING.contains(&name) { ASK_WAIT } else { CALL_WAIT };
            self.ask_interface(session, name, args, wait)
        };
        json!({ "content": [{ "type": "text", "text": reply.text }], "isError": !reply.ok })
    }

    fn ask_interface(&self, session: &str, tool: &str, args: Value, wait: Duration) -> Reply {
        let call_id = self.next_call.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = mpsc::channel();
        self.pending.locked().insert(call_id, tx);
        (self.emit)(EV_CALL, json!({ "callId": call_id, "sessionId": session, "tool": tool, "args": args }));
        let reply = rx.recv_timeout(wait).unwrap_or_else(|_| Reply {
            ok: false,
            text: "Konscious didn't answer in time. It may be on its lock screen, or the person didn't respond.".into(),
        });
        self.pending.locked().remove(&call_id);
        reply
    }
}

fn initialize(params: &Value) -> Value {
    let asked = params["protocolVersion"].as_str().unwrap_or("");
    let version = PROTOCOLS.iter().find(|v| **v == asked).copied().unwrap_or(PROTOCOLS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": SERVER_NAME, "title": "Konscious", "version": env!("CARGO_PKG_VERSION") },
        "instructions": "You are running inside Konscious, a desktop app that shows several Claude Code sessions side by side. These tools let you see the other sessions, open new ones and arrange the window. Opening a session asks the person first."
    })
}

const TOOL_NAMES: [&str; 14] = [
    "list_sessions",
    "new_session",
    "arrange",
    "manage_session",
    "workspaces",
    "usage",
    "notes",
    "notify",
    "pomodoro",
    "reminders",
    "caffeine",
    "media",
    "dock",
    "settings",
];
/// Tools that can stop and ask the person, so they wait longer for an answer.
const ASKING: [&str; 4] = ["new_session", "manage_session", "workspaces", "settings"];

/// The tool list. Descriptions are written for Claude: what the tool does,
/// when to use it, and what it can't do.
pub fn tools() -> Value {
    json!([
        {
            "name": "list_sessions",
            "title": "List sessions",
            "description": "List the sessions in Konscious: each one's name, whether it is working, waiting for the person, idle or stopped, its folder, whether it is visible in the grid, and which one is you. Use it before referring to another session by name.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "enum": ["workspace", "all"], "description": "Your workspace only (default), or every workspace." }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        },
        {
            "name": "new_session",
            "title": "Open a session",
            "description": "Open a new Claude session or terminal in Konscious, beside this one, and optionally start a Claude session on a task. Use it when the person asks you to open, start or spin up another session or terminal. Konscious asks the person to allow it first, so tell them what you are opening and why. The new session works on its own: you can't type into it afterwards, but list_sessions shows its progress. Konscious names it from the task unless you give a name.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "enum": ["claude", "terminal"], "description": "A Claude session (default) or a plain terminal." },
                    "folder": { "type": "string", "description": "Where it runs: an absolute path, ~/…, or a path relative to your folder. Defaults to your folder." },
                    "task": { "type": "string", "maxLength": 4000, "description": "The first message for the new Claude session, written as you would to a colleague: what to do and what done looks like. Ignored for terminals." },
                    "name": { "type": "string", "maxLength": 24, "description": "Optional short name. Leave it out and Konscious names it from the task." }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false }
        },
        {
            "name": "arrange",
            "title": "Arrange the window",
            "description": "Change how Konscious shows sessions in your workspace: switch between Grid, Focus and Notes, pick a grid arrangement, bring one session into focus, or even out the pane sizes. Only change the layout when the person asks.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "view": { "type": "string", "enum": ["grid", "focus", "notes"], "description": "Grid shows several panes; Focus shows one; Notes opens the workspace notes." },
                    "grid": { "type": "string", "enum": ["balanced", "lead", "columns", "strip", "free"], "description": "Balanced rows, Lead + stack (one large pane), Column stacks, Terminal strip, or Free splits." },
                    "focus": { "type": "string", "description": "Name of the session to select and show; with view \"focus\" it fills the window." },
                    "even_out": { "type": "boolean", "description": "Make every pane the same size." }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
        },
        {
            "name": "manage_session",
            "title": "Rename, stop or restart a session",
            "description": "Rename, stop or restart another session in your workspace, by name. Stopping and restarting ask the person first; you can't stop or restart yourself. A stopped session keeps its conversation and can be started again.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session": { "type": "string", "description": "The session's name, as list_sessions shows it." },
                    "action": { "type": "string", "enum": ["rename", "stop", "restart"] },
                    "name": { "type": "string", "maxLength": 24, "description": "The new name, for rename." }
                },
                "required": ["session", "action"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false }
        },
        {
            "name": "workspaces",
            "title": "Workspaces",
            "description": "List the person's workspaces (project folders, each with its own sessions), switch which one is on screen, or stop every session in another workspace. Stopping asks the person first and never applies to your own workspace.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["list", "switch", "stop_all"] },
                    "workspace": { "type": "string", "description": "The workspace's name, for switch and stop_all." }
                },
                "required": ["action"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false }
        },
        {
            "name": "usage",
            "title": "Plan usage",
            "description": "How much of the person's Claude plan limits is used, as Konscious last saw it: the 5-hour and 7-day windows as percentages, and when each resets.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true, "openWorldHint": false }
        },
        {
            "name": "notes",
            "title": "Workspace notes",
            "description": "Read and add to your workspace's notes: a task list and a scratch pad the person keeps in Konscious. Add tasks, tick them off by number, link a task to the session working on it, or append a line to the scratch pad. You can't delete or rewrite what the person wrote.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["list", "add", "done", "undone", "link", "append"] },
                    "text": { "type": "string", "maxLength": 500, "description": "The task, for add; the line, for append." },
                    "task": { "type": "integer", "minimum": 1, "description": "The task's number from list, for done, undone and link." },
                    "session": { "type": "string", "description": "The session's name, for link." }
                },
                "required": ["action"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false }
        },
        {
            "name": "notify",
            "title": "Tell the person",
            "description": "Show the person a short message in Konscious, and a system notification if the window is in the background. Use it when something they asked to hear about has happened, such as a long task finishing. At most one every 10 seconds.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "maxLength": 80 },
                    "body": { "type": "string", "maxLength": 240 }
                },
                "required": ["title"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false }
        },
        {
            "name": "pomodoro",
            "title": "Pomodoro timer",
            "description": "The dock's Pomodoro timer: start a focus stretch, stop it, set the focus and break lengths, or check where it is.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["status", "start", "stop"] },
                    "focus_minutes": { "type": "integer", "minimum": 1, "maximum": 180 },
                    "break_minutes": { "type": "integer", "minimum": 1, "maximum": 60 }
                },
                "required": ["action"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false }
        },
        {
            "name": "reminders",
            "title": "Water and stand-up reminders",
            "description": "The dock's Drink water and Stand up reminders: check when the next one is due, mark one done, snooze it, skip it, or change how often it comes.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "reminder": { "type": "string", "enum": ["water", "stand"] },
                    "action": { "type": "string", "enum": ["status", "done", "snooze", "skip", "every"] },
                    "minutes": { "type": "integer", "minimum": 10, "maximum": 240, "description": "For every: minutes between reminders." }
                },
                "required": ["reminder", "action"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false }
        },
        {
            "name": "caffeine",
            "title": "Caffeine log",
            "description": "The dock's caffeine log: log a drink, undo the last one, or see today's total and how much is still in the person's system.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["status", "log", "undo"] },
                    "drink": { "type": "string", "enum": ["espresso", "coffee", "tea", "energy"] },
                    "size": { "type": "string", "enum": ["s", "m", "l"] }
                },
                "required": ["action"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false }
        },
        {
            "name": "media",
            "title": "Now playing",
            "description": "What music is playing on the person's computer, and play, pause or skip it.",
            "inputSchema": {
                "type": "object",
                "properties": { "action": { "type": "string", "enum": ["status", "play_pause", "next", "previous"] } },
                "required": ["action"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": true }
        },
        {
            "name": "dock",
            "title": "Dock apps",
            "description": "The dock of small apps along the window's edge (water, stand up, sitting, caffeine, pomodoro, now playing, grid layout, warm colours, system stats): list them, switch one on or off, show or hide it in the dock, or move the dock to another edge.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["list", "on", "off", "pin", "unpin", "move"] },
                    "app": { "type": "string", "description": "The app's name or id, for on, off, pin and unpin." },
                    "edge": { "type": "string", "enum": ["left", "right", "top", "bottom"], "description": "For move." }
                },
                "required": ["action"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false }
        },
        {
            "name": "settings",
            "title": "Appearance settings",
            "description": "Read or change how Konscious looks: light or dark, the theme, the terminal text size, and warm colours. With no changes it reports the current settings. Changes ask the person first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "enum": ["light", "dark"] },
                    "theme": { "type": "string", "description": "A theme id: konscious, graphite, ember, moss, tide, paper, riso, contrast or glass." },
                    "terminal_size": { "type": "integer", "minimum": 9, "maximum": 24 },
                    "warm": { "type": "boolean", "description": "Warm colours on or off." }
                },
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false }
        }
    ])
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/* ── a minimal HTTP/1.1 reader and writer ─────────────────────────── */

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
    close: bool,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(String::as_str)
    }
}

/// `None` on EOF, a malformed request, or one over the size limits: the
/// connection is then closed without an answer.
fn read_request(r: &mut impl BufRead) -> Option<Request> {
    let mut budget = r.take(MAX_HEADER);
    let mut line = String::new();
    if budget.read_line(&mut line).ok()? == 0 {
        return None;
    }
    let mut parts = line.split_whitespace();
    let (method, path) = (parts.next()?.to_string(), parts.next()?.to_string());
    let version = parts.next()?.to_string();
    let mut headers = HashMap::new();
    loop {
        line.clear();
        if budget.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let l = line.trim_end_matches(['\r', '\n']);
        if l.is_empty() {
            break;
        }
        let (k, v) = l.split_once(':')?;
        headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
    }
    if headers.contains_key("transfer-encoding") {
        return None;
    }
    let len: usize = headers.get("content-length").map_or(Some(0), |v| v.parse().ok())?;
    if len > MAX_BODY {
        return None;
    }
    let mut body = vec![0; len];
    r.read_exact(&mut body).ok()?;
    let conn = headers.get("connection").map(|v| v.to_ascii_lowercase());
    let close = conn.as_deref() == Some("close") || (version == "HTTP/1.0" && conn.as_deref() != Some("keep-alive"));
    Some(Request { method, path: path.split('?').next().unwrap_or("").to_string(), headers, body, close })
}

fn write_response(out: &mut impl Write, status: u16, body: Option<&Value>) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Method Not Allowed",
    };
    let bytes = body.map(|b| serde_json::to_vec(b).unwrap_or_default()).unwrap_or_default();
    let mut head = format!("HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\n", bytes.len());
    if !bytes.is_empty() {
        head.push_str("Content-Type: application/json\r\n");
    }
    if status == 405 {
        head.push_str("Allow: POST\r\n");
    }
    head.push_str("\r\n");
    out.write_all(head.as_bytes())?;
    out.write_all(&bytes)?;
    out.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn agent() -> (Arc<Agent>, Arc<Mutex<Vec<Value>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = Arc::clone(&seen);
        let emit: Emitter = Arc::new(move |_, v| s.locked().push(v));
        (Arc::new(Agent::new(4242, emit)), seen)
    }

    fn req(method: &str, auth: Option<&str>, body: &str, extra: &str) -> Request {
        let mut raw = format!("{method} /mcp HTTP/1.1\r\nHost: 127.0.0.1:4242\r\nContent-Length: {}\r\n{extra}", body.len());
        if let Some(t) = auth {
            raw.push_str(&format!("Authorization: Bearer {t}\r\n"));
        }
        raw.push_str("\r\n");
        raw.push_str(body);
        read_request(&mut Cursor::new(raw.into_bytes())).expect("parses")
    }

    fn token(a: &Agent, session: &str) -> String {
        let v = a.config_value(session);
        let h = v["mcpServers"][SERVER_NAME]["headers"]["Authorization"].as_str().unwrap().to_string();
        h.trim_start_matches("Bearer ").to_string()
    }

    #[test]
    fn config_names_a_local_http_server_with_this_sessions_token() {
        let (a, _) = agent();
        let v = a.config_value("s-1");
        let server = &v["mcpServers"][SERVER_NAME];
        assert_eq!(server["type"], "http");
        assert_eq!(server["url"], "http://127.0.0.1:4242/mcp");
        assert_eq!(token(&a, "s-1"), token(&a, "s-1"), "stable across restarts");
        assert_ne!(token(&a, "s-1"), token(&a, "s-2"), "one token per session");
    }

    #[test]
    fn calls_without_a_valid_token_or_from_a_browser_are_refused() {
        let (a, _) = agent();
        let t = token(&a, "s-1");
        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#;
        assert_eq!(a.respond(&req("POST", None, init, "")).0, 401);
        assert_eq!(a.respond(&req("POST", Some("nope"), init, "")).0, 401);
        assert_eq!(a.respond(&req("POST", Some(&t), init, "Origin: https://evil.example\r\n")).0, 403);
        a.forget("s-1");
        assert_eq!(a.respond(&req("POST", Some(&t), init, "")).0, 401, "gone with its session");
    }

    #[test]
    fn initialize_echoes_a_known_version_and_lists_tools() {
        let (a, _) = agent();
        let t = token(&a, "s-1");
        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#;
        let (status, body) = a.respond(&req("POST", Some(&t), init, ""));
        assert_eq!(status, 200);
        assert_eq!(body.unwrap()["result"]["protocolVersion"], "2025-06-18");

        let note = r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;
        assert_eq!(a.respond(&req("POST", Some(&t), note, "")).0, 202);

        let list = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#;
        let tools = a.respond(&req("POST", Some(&t), list, "")).1.unwrap()["result"]["tools"].clone();
        let names: Vec<_> = tools.as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, TOOL_NAMES);
    }

    #[test]
    fn a_tool_call_goes_to_the_interface_and_returns_its_answer() {
        let (a, seen) = agent();
        let t = token(&a, "s-1");
        let a2 = Arc::clone(&a);
        let s2 = Arc::clone(&seen);
        // Plays the interface: answers the first call it sees.
        let ui = std::thread::spawn(move || loop {
            if let Some(call) = s2.locked().first().cloned() {
                assert_eq!(call["sessionId"], "s-1");
                assert_eq!(call["tool"], "arrange");
                assert_eq!(call["args"]["view"], "focus");
                a2.reply(call["callId"].as_u64().unwrap(), Reply { ok: true, text: "Focus".into() });
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        });
        let call = r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"arrange","arguments":{"view":"focus"}}}"#;
        let body = a.respond(&req("POST", Some(&t), call, "")).1.unwrap();
        ui.join().unwrap();
        assert_eq!(body["result"]["content"][0]["text"], "Focus");
        assert_eq!(body["result"]["isError"], false);
    }

    #[test]
    fn unknown_tools_and_methods_are_errors_not_crashes() {
        let (a, seen) = agent();
        let t = token(&a, "s-1");
        let call = r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"rm_rf"}}"#;
        let body = a.respond(&req("POST", Some(&t), call, "")).1.unwrap();
        assert_eq!(body["result"]["isError"], true);
        assert!(seen.locked().is_empty(), "never reached the interface");
        let odd = r#"{"jsonrpc":"2.0","id":5,"method":"resources/list"}"#;
        assert_eq!(a.respond(&req("POST", Some(&t), odd, "")).1.unwrap()["error"]["code"], -32601);
        assert_eq!(a.respond(&req("GET", Some(&t), "", "")).0, 405);
    }

    #[test]
    fn oversized_or_chunked_requests_are_dropped() {
        let big = format!("POST /mcp HTTP/1.1\r\nContent-Length: {}\r\n\r\n", MAX_BODY + 1);
        assert!(read_request(&mut Cursor::new(big.into_bytes())).is_none());
        let chunked = "POST /mcp HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n";
        assert!(read_request(&mut Cursor::new(chunked.as_bytes().to_vec())).is_none());
    }

    #[test]
    fn serves_over_a_real_socket() {
        let a = Agent::start(Arc::new(|_, _| {})).expect("binds 127.0.0.1");
        let t = token(&a, "s-1");
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
        let mut conn = TcpStream::connect(("127.0.0.1", a.port)).unwrap();
        let ask = |conn: &mut TcpStream| {
            write!(
                conn,
                "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {t}\r\nContent-Length: {}\r\n\r\n{body}",
                a.port,
                body.len()
            )
            .unwrap();
            let mut reader = BufReader::new(conn.try_clone().unwrap());
            let mut status = String::new();
            reader.read_line(&mut status).unwrap();
            let mut len = 0;
            loop {
                let mut h = String::new();
                reader.read_line(&mut h).unwrap();
                if h == "\r\n" {
                    break;
                }
                if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap();
                }
            }
            let mut out = vec![0; len];
            reader.read_exact(&mut out).unwrap();
            (status, serde_json::from_slice::<Value>(&out).unwrap())
        };
        let (status, reply) = ask(&mut conn);
        assert!(status.starts_with("HTTP/1.1 200"), "{status}");
        assert_eq!(reply["result"], json!({}));
        let (status, _) = ask(&mut conn);
        assert!(status.starts_with("HTTP/1.1 200"), "keep-alive: a second request on the same connection");
    }

    #[test]
    fn config_file_is_private() {
        let (a, _) = agent();
        let dir = tempfile::tempdir().unwrap();
        let path = a.write_config(dir.path(), "s-9").unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(v["mcpServers"][SERVER_NAME]["url"].is_string());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }
}

