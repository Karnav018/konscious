use std::io::{Read, Write};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::claude::launcher::Launch;
use crate::error::{AppError, AppResult};

pub struct Spawned {
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
    /// The child calls setsid(), so pid == pgid == session id.
    pub pid: i32,
}

pub fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 }
}

pub fn spawn(launch: &Launch, cols: u16, rows: u16) -> AppResult<Spawned> {
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| AppError::Spawn(format!("openpty: {e}")))?;
    let mut cmd = CommandBuilder::new(&launch.program);
    cmd.args(&launch.args);
    cmd.cwd(&launch.cwd);
    // CommandBuilder snapshots *our* environment; replace it entirely.
    cmd.env_clear();
    for (k, v) in &launch.env {
        cmd.env(k, v);
    }
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::Spawn(format!("{}: {e}", launch.program.display())))?;
    // Keeping the slave open would stop the reader from ever seeing EOF.
    drop(pair.slave);
    let pid = child.process_id().map(|p| p as i32).unwrap_or(-1);
    let reader = pair.master.try_clone_reader().map_err(|e| AppError::Spawn(e.to_string()))?;
    let writer = pair.master.take_writer().map_err(|e| AppError::Spawn(e.to_string()))?;
    Ok(Spawned { master: pair.master, child, reader, writer, pid })
}
