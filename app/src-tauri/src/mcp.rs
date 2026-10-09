//! The per-session MCP config.
//!
//! Konscious is not an MCP client. Each Claude session is — so switching a
//! connector on does not make Konscious talk to anyone, it writes a small
//! JSON file and points that session's own `claude` at it with
//! `--mcp-config`, exactly the way the hook settings file works.
//!
//! Two promises come out of that, and both are the reason it is done this
//! way rather than the easy way:
//!
//!   · The user's own configuration is never touched. Not `~/.claude.json`,
//!     not a `.mcp.json` in their repo. `--mcp-config` merges with whatever
//!     they already have, and when a connector is switched off the file
//!     simply stops being written.
//!   · No token ever reaches Konscious. Sign-in happens inside Claude, with
//!     `/mcp`, and Claude Code keeps the credentials.
//!
//! The file is written per session and per run, so a change takes effect on
//! the next session rather than reaching into a running one.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};

/// One server, as the frontend sends it.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Server {
    pub name: String,
    pub url: String,
}

/// What a server may be called. Lowercase because the name becomes a key
/// Claude shows as `mcp__<name>__<tool>`, and short because a long one makes
/// every tool name unreadable.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 32
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// https only. A connector is a remote service the user is about to sign in
/// to; sending an OAuth round trip over plain http is not something to offer,
/// and a non-url string would silently become a server Claude cannot reach.
pub fn valid_url(url: &str) -> bool {
    let rest = match url.strip_prefix("https://") {
        Some(rest) => rest,
        None => return false,
    };
    // A host at minimum, and nothing that could not survive a round trip
    // through JSON and a command line.
    !rest.is_empty()
        && !rest.starts_with('/')
        && url.len() <= 2048
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// The servers worth writing: valid ones, first mention of each name wins.
pub fn keep(servers: &[Server]) -> Vec<Server> {
    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for s in servers {
        if !valid_name(&s.name) || !valid_url(&s.url) || seen.contains(&s.name) {
            continue;
        }
        seen.push(s.name.clone());
        out.push(s.clone());
    }
    out
}

/// The file Claude reads. `type: "http"` is the transport every one of these
/// uses — they are hosted services, not local processes.
pub fn config_value(servers: &[Server]) -> Value {
    let mut map = serde_json::Map::new();
    for s in servers {
        map.insert(s.name.clone(), json!({ "type": "http", "url": s.url }));
    }
    json!({ "mcpServers": Value::Object(map) })
}

/// Writes the config for one run, or returns None when there is nothing to
/// write — which is the common case, and the one where `--mcp-config` must
/// not appear on the command line at all.
pub fn prepare(run_dir: &Path, session_id: &str, servers: &[Server]) -> std::io::Result<Option<PathBuf>> {
    let keeping = keep(servers);
    let path = run_dir.join(format!("{session_id}.mcp.json"));
    if keeping.is_empty() {
        // A connector switched off between runs must not leave its file
        // behind for the next one to pick up.
        let _ = fs::remove_file(&path);
        return Ok(None);
    }
    fs::create_dir_all(run_dir)?;
    fs::write(&path, serde_json::to_vec_pretty(&config_value(&keeping))?)?;
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(name: &str, url: &str) -> Server {
        Server { name: name.into(), url: url.into() }
    }

    #[test]
    fn accepts_the_names_claude_can_show_in_a_tool() {
        for ok in ["zomato", "swiggy_food", "my-server", "a", "x9", &"a".repeat(32)] {
            assert!(valid_name(ok), "{ok} should be allowed");
        }
    }

    #[test]
    fn refuses_a_name_that_would_make_an_unreadable_tool() {
        for bad in ["", "Zomato", "with space", "dots.here", "slash/es", &"a".repeat(33), "emoji🍕"] {
            assert!(!valid_name(bad), "{bad:?} should be refused");
        }
    }

    #[test]
    fn insists_on_https() {
        assert!(valid_url("https://mcp-server.zomato.com/mcp"));
        assert!(!valid_url("http://mcp-server.zomato.com/mcp"), "a sign-in must not go over plain http");
        assert!(!valid_url("ftp://x.test"));
        assert!(!valid_url("mcp-server.zomato.com"));
        assert!(!valid_url(""));
        assert!(!valid_url("https://"));
    }

    #[test]
    fn refuses_a_url_that_would_not_survive_the_trip() {
        assert!(!valid_url("https://x.test/a b"));
        assert!(!valid_url("https://x.test/\nHost: evil"));
        assert!(!valid_url(&format!("https://x.test/{}", "a".repeat(3000))));
    }

    #[test]
    fn writes_only_the_servers_that_are_on() {
        let got = config_value(&[s("zomato", "https://mcp-server.zomato.com/mcp")]);
        assert_eq!(
            got,
            json!({"mcpServers": {"zomato": {"type": "http", "url": "https://mcp-server.zomato.com/mcp"}}})
        );
    }

    #[test]
    fn drops_what_it_cannot_use_rather_than_write_it() {
        let got = keep(&[
            s("zomato", "https://mcp-server.zomato.com/mcp"),
            s("BAD NAME", "https://x.test"),
            s("insecure", "http://x.test"),
        ]);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "zomato");
    }

    #[test]
    fn keeps_the_first_of_a_duplicated_name() {
        let got = keep(&[s("dup", "https://one.test"), s("dup", "https://two.test")]);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].url, "https://one.test");
    }

    #[test]
    fn writes_nothing_at_all_when_no_connector_is_on() {
        let dir = tempfile::tempdir().unwrap();
        let got = prepare(dir.path(), "abc", &[]).unwrap();
        assert_eq!(got, None, "with nothing on there must be no file and no flag");
        assert!(!dir.path().join("abc.mcp.json").exists());
    }

    #[test]
    fn clears_a_file_left_by_a_previous_run() {
        // Switching the last connector off between runs must not leave the
        // old config for the next session to pick up.
        let dir = tempfile::tempdir().unwrap();
        prepare(dir.path(), "abc", &[s("zomato", "https://mcp-server.zomato.com/mcp")]).unwrap();
        assert!(dir.path().join("abc.mcp.json").exists());
        assert_eq!(prepare(dir.path(), "abc", &[]).unwrap(), None);
        assert!(!dir.path().join("abc.mcp.json").exists(), "the old config must go");
    }

    #[test]
    fn writes_a_file_claude_can_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = prepare(dir.path(), "abc", &[s("zomato", "https://mcp-server.zomato.com/mcp")])
            .unwrap()
            .expect("a path");
        let back: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(back["mcpServers"]["zomato"]["url"], "https://mcp-server.zomato.com/mcp");
        assert_eq!(back["mcpServers"]["zomato"]["type"], "http");
    }

    #[test]
    fn gives_each_session_its_own_file() {
        let dir = tempfile::tempdir().unwrap();
        let one = prepare(dir.path(), "one", &[s("z", "https://a.test")]).unwrap().unwrap();
        let two = prepare(dir.path(), "two", &[s("z", "https://a.test")]).unwrap().unwrap();
        assert_ne!(one, two);
    }
}
