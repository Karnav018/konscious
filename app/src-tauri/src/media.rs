//! What is playing, and the three buttons that control it.
//!
//! Two platforms, two completely different stories.
//!
//! On macOS this is AppleScript, deliberately. The obvious route is
//! MediaRemote.framework, which knows about every app including browsers —
//! and it is private, and since macOS 15.4 it refuses callers without an
//! entitlement Apple does not hand out. So we ask Spotify and Music directly.
//! That costs us browser audio (a YouTube tab is invisible here, and the
//! catalog says so) and it costs a permission prompt, but it is an interface
//! Apple means for us to use.
//!
//! The prompt is the awkward part. Automation consent is keyed to the code
//! signature, and this app is signed ad hoc, so the signature changes with
//! every build and the prompt comes back after every update. Worse, a refusal
//! sticks: macOS does not ask twice. So a refusal (Apple event error -1743)
//! is reported up to the frontend, which stops polling and offers to open the
//! right pane of System Settings, rather than asking again every two seconds
//! and getting nothing.
//!
//! The sharp edge, learned the hard way: AppleScript resolves an application's
//! dictionary when the script COMPILES, not when it runs. A script that merely
//! mentions `artwork url` fails to compile at all on a Mac without Spotify —
//! and `if application "Spotify" is running` cannot save it, because that
//! guard only does anything at run time. The first version of this file put
//! both players in one script, so on a Spotify-less Mac the read failed
//! outright and Apple Music never showed either.
//!
//! So: one script per player, and a player's vocabulary only ever appears in
//! its own script, which is run only once that player is known to be running
//! (a running app is an installed app, so it compiles). The probe that decides
//! this has to be term-free. `application "Spotify" is running`, by name, is —
//! it returns false when Spotify is absent. `application id "com.spotify.client"`
//! is not: it raises -1728 whether or not you wrap it in a try.
//!
//! On Windows the system itself keeps a Now Playing session, which every app
//! including browsers reports into, so there is nothing to ask permission for.

// Only the AppleScript path needs a subprocess; Windows asks the system
// directly, so these would be unused imports there.
#[cfg(target_os = "macos")]
use std::io::Read;
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};

use serde::Serialize;

/// A track, as a player describes it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    /// The player's own name, for the line under the title.
    pub app: String,
    pub title: String,
    pub artist: String,
    pub playing: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub artwork_url: Option<String>,
}

/// One read. `now` is absent when nothing is playing *and* when we were not
/// allowed to look, which is why `denied` is separate: the frontend treats
/// the two completely differently.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub now: Option<NowPlaying>,
    /// macOS refused the Apple event. Stop asking — it will not relent until
    /// the user changes it in System Settings.
    pub denied: bool,
    /// A script would not compile or run, for a reason that is our bug rather
    /// than the user's. Kept separate because the first version of this
    /// module failed exactly this way and it looked identical to silence:
    /// one script mentioned Spotify's vocabulary, so on a Mac without Spotify
    /// it did not compile, and Apple Music never appeared either.
    pub failed: bool,
}

/// What the island's buttons do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Toggle,
    Next,
    Prev,
}

impl Action {
    pub fn parse(name: &str) -> Option<Action> {
        match name {
            "toggle" => Some(Action::Toggle),
            "next" => Some(Action::Next),
            "prev" => Some(Action::Prev),
            _ => None,
        }
    }
}

/// The separator the script joins fields with: ASCII unit separator, which no
/// track title has ever contained.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const SEP: char = '\u{1f}';

/// Apple event error for "the user said no to Automation".
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const NOT_PERMITTED: &str = "-1743";

/// One field-separated line from the script into a track. The unit of
/// `duration` differs by player, which is the whole reason this is a function
/// with tests rather than three lines inline: Spotify reports milliseconds
/// and Music reports seconds, and getting it wrong makes a progress bar that
/// is wrong by a factor of a thousand.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_line(line: &str) -> Option<NowPlaying> {
    let f: Vec<&str> = line.split(SEP).collect();
    if f.len() < 7 {
        return None;
    }
    let app = f[0].trim();
    if app.is_empty() || app == "error" {
        return None;
    }
    let title = f[2].trim();
    if title.is_empty() {
        return None;
    }
    let secs = |s: &str| s.trim().parse::<f64>().ok().filter(|n| n.is_finite() && *n >= 0.0);
    let duration = secs(f[4]).unwrap_or(0.0);
    let duration_ms = if app == "Spotify" { duration } else { duration * 1000.0 };
    let artwork = f[6].trim();
    Some(NowPlaying {
        app: app.to_string(),
        title: title.to_string(),
        artist: f[3].trim().to_string(),
        playing: f[1].trim() == "playing",
        position_ms: (secs(f[5]).unwrap_or(0.0) * 1000.0) as u64,
        duration_ms: duration_ms as u64,
        artwork_url: (!artwork.is_empty()).then(|| artwork.to_string()),
    })
}

/// Windows names the source by its app user model id — "Spotify.exe", or a
/// package family name, or for some browsers an opaque code. Trim it to
/// something that can sit on one line of a pill.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn pretty_app(id: &str) -> String {
    let tail = id.rsplit(['\\', '/', '!']).next().unwrap_or(id);
    let base = tail.strip_suffix(".exe").unwrap_or(tail);
    let name = base.split('_').next().unwrap_or(base).trim();
    if name.is_empty() {
        return "Media".to_string()
    }
    // An id that is all hex and no vowels is a code, not a name.
    if name.len() > 12 && name.chars().all(|c| c.is_ascii_hexdigit()) {
        return "Media".to_string()
    }
    name.to_string()
}

/// Which of the players to believe. One that is playing beats one that is
/// merely open, so a paused Music does not hide a running Spotify.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn pick(out: &str) -> MediaState {
    let denied = out.lines().any(|l| {
        let mut f = l.split(SEP);
        f.next() == Some("error") && f.next().is_some_and(|n| n.trim() == NOT_PERMITTED)
    });
    let tracks: Vec<NowPlaying> = out.lines().filter_map(parse_line).collect();
    let now = tracks
        .iter()
        .find(|t| t.playing)
        .or_else(|| tracks.first())
        .cloned();
    MediaState { now, denied, failed: false }
}

/// What one run of osascript came back with.
#[cfg(target_os = "macos")]
#[derive(Debug, Default)]
struct Run {
    out: String,
    denied: bool,
    failed: bool,
}

/// How long a read may take before we abandon it. The script carries its own
/// two-second Apple event timeout; this is the outer guard for everything
/// that is not an Apple event.
#[cfg(target_os = "macos")]
const READ_LIMIT: Duration = Duration::from_secs(3);

/// Logged at most once: a syntax error is the same every poll, and two of
/// them a second would be the loudest thing in the log.
#[cfg(target_os = "macos")]
static SAID_BROKEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Runs a script, giving up rather than waiting on a wedged player.
#[cfg(target_os = "macos")]
fn osascript(source: &str, limit: Duration) -> Run {
    let Ok(mut child) = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(source)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
    else {
        return Run::default();
    };
    let began = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if began.elapsed() < limit => std::thread::sleep(Duration::from_millis(25)),
            // Gone, or out of time. Either way stop waiting on it.
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Run::default();
            }
        }
    }
    let mut out = String::new();
    if let Some(mut pipe) = child.stdout.take() {
        let _ = pipe.read_to_string(&mut out);
    }
    let mut err = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_string(&mut err);
    }
    // A syntax error means our script is wrong, not that the user said no or
    // that nothing is playing. It has to be told apart from both.
    let failed = err.contains("-2740") || err.contains("-2741");
    if failed && !SAID_BROKEN.swap(true, std::sync::atomic::Ordering::Relaxed) {
        eprintln!("[media] a script did not compile: {}", err.trim());
    }
    Run {
        out,
        denied: err.contains(NOT_PERMITTED),
        failed,
    }
}

/// The script that always runs, so it must always compile.
///
/// It reads Music, whose vocabulary ships with every macOS, and probes for
/// Spotify by name, which needs none of Spotify's own terms. Nothing is
/// addressed with `tell` before its `is running` guard passes: `tell`
/// launches an app that is not running, and a music player that opened itself
/// because a dock tile was switched on would be unforgivable.
#[cfg(target_os = "macos")]
const READ_SCRIPT: &str = r#"
set sep to (ASCII character 31)
set out to {}
if application "Spotify" is running then set end of out to "probe" & sep & "spotify"
if application "Music" is running then
  try
    with timeout of 2 seconds
      tell application "Music" to set end of out to "Music" & sep & (player state as text) & sep & (name of current track) & sep & (artist of current track) & sep & ((duration of current track) as text) & sep & ((player position) as text) & sep & ""
    end timeout
  on error errMsg number errNum
    set end of out to "error" & sep & (errNum as text)
  end try
end if
set AppleScript's text item delimiters to linefeed
return out as text
"#;

/// Spotify's own script, and the only place its vocabulary appears. Run only
/// once the probe above says Spotify is running — a running app is installed,
/// so this compiles by the time it is ever used.
#[cfg(target_os = "macos")]
const SPOTIFY_READ: &str = r#"
set sep to (ASCII character 31)
set out to ""
try
  with timeout of 2 seconds
    tell application "Spotify" to set out to "Spotify" & sep & (player state as text) & sep & (name of current track) & sep & (artist of current track) & sep & ((duration of current track) as text) & sep & ((player position) as text) & sep & (artwork url of current track)
  end timeout
on error errMsg number errNum
  set out to "error" & sep & (errNum as text)
end try
return out
"#;

/// Whether the probe saw Spotify running.
#[cfg(target_os = "macos")]
fn saw_spotify(out: &str) -> bool {
    out.lines().any(|l| {
        let mut f = l.split(SEP);
        f.next() == Some("probe") && f.next().is_some_and(|v| v.trim() == "spotify")
    })
}

#[cfg(target_os = "macos")]
pub fn now() -> MediaState {
    let first = osascript(READ_SCRIPT, READ_LIMIT);
    let mut lines = first.out.clone();
    let mut denied = first.denied;
    let mut failed = first.failed;
    // Only now, and only if it is actually running, is Spotify asked — which
    // is also the only moment its script is guaranteed to compile.
    if saw_spotify(&first.out) {
        let second = osascript(SPOTIFY_READ, READ_LIMIT);
        lines.push('\n');
        lines.push_str(&second.out);
        denied |= second.denied;
        failed |= second.failed;
    }
    let mut state = pick(&lines);
    state.denied |= denied;
    state.failed |= failed;
    state
}

/// One player's control script. Each player's verbs live only in its own.
#[cfg(target_os = "macos")]
fn control_script(player: &str, verb: &str) -> String {
    format!(
        r#"
set done to false
try
  with timeout of 2 seconds
    if application "{player}" is running then
      tell application "{player}" to {verb}
      set done to true
    end if
  end timeout
end try
return done as text
"#
    )
}

/// Acts on whichever player the island is showing, rather than guessing.
///
/// That costs a read before the button does anything, which on a click is
/// nothing — and it means the buttons always act on the track you can see,
/// which the first version of this did not actually guarantee.
#[cfg(target_os = "macos")]
pub fn control(action: Action) -> bool {
    let verb = match action {
        Action::Toggle => "playpause",
        Action::Next => "next track",
        Action::Prev => "previous track",
    };
    let Some(track) = now().now else { return false };
    // Only the two players we know how to speak to, matched against exactly
    // the names the read scripts report, so nothing else reaches a script.
    let player = match track.app.as_str() {
        "Spotify" => "Spotify",
        "Music" => "Music",
        _ => return false,
    };
    osascript(&control_script(player, verb), READ_LIMIT).out.trim() == "true"
}

#[cfg(windows)]
mod win {
    use std::sync::OnceLock;

    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };

    use super::{pretty_app, Action, MediaState, NowPlaying};

    /// Creating the manager is a cross-process call, so it is made once and
    /// kept. RequestAsync().get() blocks, which is why every caller is
    /// already inside spawn_blocking.
    fn manager() -> Option<&'static Manager> {
        static ONCE: OnceLock<Option<Manager>> = OnceLock::new();
        ONCE.get_or_init(|| Manager::RequestAsync().ok().and_then(|op| op.get().ok()))
            .as_ref()
    }

    /// 100-nanosecond ticks, which is how WinRT counts time, to milliseconds.
    const fn ms(ticks: i64) -> u64 {
        if ticks <= 0 {
            0
        } else {
            (ticks / 10_000) as u64
        }
    }

    pub fn now() -> MediaState {
        // Nothing to ask permission for here: the system keeps this session
        // on every app's behalf, so `denied` is never set on Windows.
        let Some(session) = manager().and_then(|m| m.GetCurrentSession().ok()) else {
            return MediaState::default();
        };
        let Some(props) = session.TryGetMediaPropertiesAsync().ok().and_then(|op| op.get().ok()) else {
            return MediaState::default();
        };
        let title = props.Title().map(|t| t.to_string()).unwrap_or_default();
        if title.trim().is_empty() {
            return MediaState::default();
        }
        let playing = session
            .GetPlaybackInfo()
            .and_then(|i| i.PlaybackStatus())
            .map(|s| s == Status::Playing)
            .unwrap_or(false);
        let (position_ms, duration_ms) = match session.GetTimelineProperties() {
            Ok(t) => {
                let at = t.Position().map(|p| ms(p.Duration)).unwrap_or(0);
                let start = t.StartTime().map(|p| ms(p.Duration)).unwrap_or(0);
                let end = t.EndTime().map(|p| ms(p.Duration)).unwrap_or(0);
                (at.saturating_sub(start), end.saturating_sub(start))
            }
            Err(_) => (0, 0),
        };
        MediaState {
            now: Some(NowPlaying {
                app: pretty_app(&session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default()),
                title: title.trim().to_string(),
                artist: props.Artist().map(|a| a.to_string()).unwrap_or_default().trim().to_string(),
                playing,
                position_ms,
                duration_ms,
                // The thumbnail is a stream, not a URL. Reading and inlining
                // it every poll is not worth what it adds; the island shows
                // the glyph instead.
                artwork_url: None,
            }),
            // Neither applies here: Windows hands this over without asking,
            // and there is no script to fail to compile.
            denied: false,
            failed: false,
        }
    }

    pub fn control(action: Action) -> bool {
        let Some(session) = manager().and_then(|m| m.GetCurrentSession().ok()) else {
            return false;
        };
        let op = match action {
            Action::Toggle => session.TryTogglePlayPauseAsync(),
            Action::Next => session.TrySkipNextAsync(),
            Action::Prev => session.TrySkipPreviousAsync(),
        };
        op.ok().and_then(|o| o.get().ok()).unwrap_or(false)
    }
}

#[cfg(windows)]
pub fn now() -> MediaState {
    win::now()
}

#[cfg(windows)]
pub fn control(action: Action) -> bool {
    win::control(action)
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn now() -> MediaState {
    MediaState::default()
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn control(_action: Action) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(fields: &[&str]) -> String {
        fields.join(&SEP.to_string())
    }

    #[test]
    fn reads_a_spotify_track_with_its_milliseconds() {
        let got = parse_line(&line(&[
            "Spotify",
            "playing",
            "Teardrop",
            "Massive Attack",
            "330000",
            "42.5",
            "https://i.scdn.co/image/abc",
        ]))
        .expect("a track");
        assert_eq!(got.title, "Teardrop");
        assert_eq!(got.artist, "Massive Attack");
        assert!(got.playing);
        assert_eq!(got.duration_ms, 330_000, "Spotify reports milliseconds");
        assert_eq!(got.position_ms, 42_500);
        assert_eq!(got.artwork_url.as_deref(), Some("https://i.scdn.co/image/abc"));
    }

    #[test]
    fn reads_a_music_track_with_its_seconds() {
        let got = parse_line(&line(&["Music", "paused", "Avril 14th", "Aphex Twin", "124.5", "10", ""]))
            .expect("a track");
        assert!(!got.playing);
        assert_eq!(got.duration_ms, 124_500, "Music reports seconds");
        assert_eq!(got.position_ms, 10_000);
        assert_eq!(got.artwork_url, None, "Music has no artwork url to give");
    }

    #[test]
    fn ignores_a_line_that_is_not_a_track() {
        assert!(parse_line("").is_none());
        assert!(parse_line(&line(&["Spotify", "playing"])).is_none());
        assert!(parse_line(&line(&["error", "-1743", "", "", "", "", ""])).is_none());
        // No title is no track, whatever else the player said.
        assert!(parse_line(&line(&["Spotify", "playing", "", "x", "1", "1", ""])).is_none());
    }

    #[test]
    fn survives_a_player_reporting_nonsense() {
        let got = parse_line(&line(&["Spotify", "playing", "Track", "Artist", "nope", "-5", ""])).expect("a track");
        assert_eq!(got.duration_ms, 0);
        assert_eq!(got.position_ms, 0);
    }

    #[test]
    fn prefers_the_player_that_is_actually_playing() {
        let out = format!(
            "{}\n{}",
            line(&["Music", "paused", "Quiet", "Someone", "100", "0", ""]),
            line(&["Spotify", "playing", "Loud", "Someone Else", "200000", "0", ""])
        );
        let got = pick(&out);
        assert_eq!(got.now.expect("a track").title, "Loud");
        assert!(!got.denied);
    }

    #[test]
    fn falls_back_to_a_player_that_is_merely_open() {
        let out = line(&["Music", "paused", "Quiet", "Someone", "100", "0", ""]);
        assert_eq!(pick(&out).now.expect("a track").title, "Quiet");
    }

    #[test]
    fn reports_a_refusal_rather_than_pretending_nothing_plays() {
        let got = pick(&line(&["error", "-1743"]));
        assert!(got.denied, "a declined prompt has to be told apart from silence");
        assert_eq!(got.now, None);
    }

    #[test]
    fn does_not_call_an_ordinary_script_error_a_refusal() {
        // -1728 is "can't get current track", which happens whenever a player
        // is open with nothing loaded. Common, and not a permission problem.
        let got = pick(&line(&["error", "-1728"]));
        assert!(!got.denied);
    }

    #[test]
    fn says_nothing_plays_when_no_player_is_open() {
        assert_eq!(pick(""), MediaState { now: None, denied: false, failed: false });
    }

    #[test]
    fn takes_only_the_three_actions_it_knows() {
        assert_eq!(Action::parse("toggle"), Some(Action::Toggle));
        assert_eq!(Action::parse("next"), Some(Action::Next));
        assert_eq!(Action::parse("prev"), Some(Action::Prev));
        assert_eq!(Action::parse("play"), None);
        assert_eq!(Action::parse(""), None);
    }

    #[test]
    fn tidies_the_names_windows_gives_its_apps() {
        assert_eq!(pretty_app("Spotify.exe"), "Spotify");
        assert_eq!(pretty_app("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"), "Microsoft.ZuneMusic");
        assert_eq!(pretty_app(r"C:\\Program Files\\foobar2000\\foobar2000.exe"), "foobar2000");
        // Firefox reports an opaque code; a name is better than that.
        assert_eq!(pretty_app("308046B0AF4A39CB"), "Media");
        assert_eq!(pretty_app(""), "Media");
        assert_eq!(pretty_app("   "), "Media");
    }

    #[test]
    fn tells_a_refusal_from_a_broken_script_from_silence() {
        // Three different states that all used to look the same.
        let quiet = pick("");
        assert!(!quiet.denied && !quiet.failed && quiet.now.is_none());
        let refused = pick(&line(&["error", "-1743"]));
        assert!(refused.denied && !refused.failed);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn never_addresses_a_player_before_checking_it_is_running() {
        // `tell` launches an app that is not running. Every tell in the read
        // script must sit inside an `is running` guard, or switching the app
        // on would open Music.
        for (at, _) in READ_SCRIPT.match_indices("tell application") {
            let before = &READ_SCRIPT[..at];
            assert!(
                before.matches("is running then").count() > before.matches("end if").count(),
                "a tell at byte {at} is not inside an `is running` guard"
            );
        }
        for player in ["Spotify", "Music"] {
            let src = control_script(player, "playpause");
            for (at, _) in src.match_indices("tell application") {
                assert!(
                    src[..at].contains("is running then"),
                    "the {player} control script tells it before checking it is running"
                );
            }
        }
    }

    /// Whether AppleScript will compile this at all. The dictionary of every
    /// application a script names is resolved here, which is the whole point.
    #[cfg(target_os = "macos")]
    fn compiles(source: &str) -> Result<(), String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let out = dir.path().join("probe.scpt");
        let got = Command::new("/usr/bin/osacompile")
            .arg("-o")
            .arg(&out)
            .arg("-e")
            .arg(source)
            .output()
            .map_err(|e| e.to_string())?;
        if got.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&got.stderr).trim().to_string())
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn the_scripts_that_always_run_always_compile() {
        // The bug this test exists for: AppleScript resolves an application's
        // dictionary when a script COMPILES. One script naming both players
        // therefore failed outright on a Mac without Spotify — not just for
        // Spotify, for Apple Music too — and the `is running` guard could not
        // help, because that only does anything at run time. Music ships with
        // every macOS since 10.15, so everything here must compile anywhere.
        //
        // Note what this does NOT compile: anything naming Spotify. Those
        // scripts cannot compile without Spotify installed, which is exactly
        // why they are scripts of their own, reached only once the probe has
        // seen Spotify running — a running app being an installed one. This
        // test found that the Spotify control script had the same problem as
        // the read ("next track" is dictionary vocabulary too), so the
        // boundary is drawn around both.
        if let Err(why) = compiles(READ_SCRIPT) {
            panic!("READ_SCRIPT does not compile on a stock Mac: {why}");
        }
        for verb in ["playpause", "next track", "previous track"] {
            if let Err(why) = compiles(&control_script("Music", verb)) {
                panic!("the Music control script ({verb}) does not compile: {why}");
            }
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn reaches_a_spotify_script_only_through_the_probe() {
        // The structural claim behind the test above. Every script naming
        // Spotify is unreachable until the probe has reported it running:
        // SPOTIFY_READ is guarded by saw_spotify, and the Spotify control
        // script is guarded by the player name, which can only ever come back
        // from SPOTIFY_READ.
        assert!(!saw_spotify(""), "no probe output must never reach Spotify");
        let music_only = line(&["Music", "playing", "x", "y", "1", "0", ""]);
        assert!(!saw_spotify(&music_only));
        assert_eq!(pick(&music_only).now.expect("a track").app, "Music");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn only_spotify_s_own_script_speaks_spotify() {
        // Its vocabulary is what will not compile elsewhere. `tell` is listed
        // too: a tell resolves a dictionary even when it never runs.
        let spotify_only = ["artwork url", "spotify url", "tell application \"Spotify\""];
        for term in spotify_only {
            assert!(
                !READ_SCRIPT.contains(term),
                "READ_SCRIPT contains {term:?}, which will not compile without Spotify installed"
            );
            assert!(
                !control_script("Music", "playpause").contains(term),
                "the Music control script contains {term:?}"
            );
        }
        // And the probe that decides whether to run it needs none of them.
        assert!(READ_SCRIPT.contains("application \"Spotify\" is running"));
        assert!(
            !READ_SCRIPT.contains("application id"),
            "`application id` raises -1728 for an app that is not installed, even inside a try"
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn asks_spotify_only_once_the_probe_has_seen_it() {
        assert!(saw_spotify(&line(&["probe", "spotify"])));
        assert!(!saw_spotify(""));
        assert!(!saw_spotify(&line(&["Music", "playing", "x", "y", "1", "0", ""])));
    }
}
