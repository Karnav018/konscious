//! What each session costs in memory.
//!
//! A session is a process group — Claude spawns subagents and MCP servers of
//! its own, and a shell spawns whatever you run in it — so the honest figure
//! for a pane is the whole tree under its pid, not the pid alone. Claude Code
//! is also known to grow over a long session, which is the number this exists
//! to surface: the frontend shows it and offers a restart, and restarting
//! resumes the same conversation.
use std::collections::HashMap;

use serde::Serialize;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMemory {
    pub id: String,
    /// Resident bytes for the session's process and everything under it.
    pub bytes: u64,
    /// How many processes that covers (1 = just the shell or `claude` itself).
    pub processes: u32,
}

/// Resident bytes for every pid in `sessions`, counting descendants.
pub fn measure(sessions: &[(String, i32)]) -> Vec<SessionMemory> {
    if sessions.is_empty() {
        return Vec::new();
    }
    let mut sys = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing().with_memory()),
    );
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );

    // One pass over the table: every process's parent and its resident size.
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut resident: HashMap<u32, u64> = HashMap::new();
    for (pid, proc) in sys.processes() {
        let pid = pid.as_u32();
        resident.insert(pid, proc.memory());
        if let Some(parent) = proc.parent() {
            children.entry(parent.as_u32()).or_default().push(pid);
        }
    }

    sessions
        .iter()
        .map(|(id, pid)| {
            let (bytes, processes) = subtree(*pid as u32, &children, &resident);
            SessionMemory { id: id.clone(), bytes, processes }
        })
        .collect()
}

/// Resident bytes and process count for `root` and everything below it.
/// Iterative, and each pid is visited once: a parent table built from a live
/// system can contain a cycle after pid reuse, and recursion would not return.
fn subtree(root: u32, children: &HashMap<u32, Vec<u32>>, resident: &HashMap<u32, u64>) -> (u64, u32) {
    let mut seen = std::collections::HashSet::new();
    let mut stack = vec![root];
    let (mut bytes, mut count) = (0, 0);
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        if let Some(size) = resident.get(&pid) {
            bytes += size;
            count += 1;
        }
        if let Some(kids) = children.get(&pid) {
            stack.extend(kids);
        }
    }
    (bytes, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> (HashMap<u32, Vec<u32>>, HashMap<u32, u64>) {
        let children = HashMap::from([(1, vec![2, 3]), (2, vec![4])]);
        let resident = HashMap::from([(1, 100), (2, 200), (3, 300), (4, 400), (9, 999)]);
        (children, resident)
    }

    #[test]
    fn sums_the_whole_tree_under_a_session() {
        let (children, resident) = tree();
        assert_eq!(subtree(1, &children, &resident), (1000, 4));
        assert_eq!(subtree(2, &children, &resident), (600, 2));
        assert_eq!(subtree(9, &children, &resident), (999, 1));
    }

    #[test]
    fn a_pid_that_is_gone_costs_nothing() {
        let (children, resident) = tree();
        assert_eq!(subtree(404, &children, &resident), (0, 0));
    }

    #[test]
    fn a_cycle_from_pid_reuse_still_terminates() {
        let children = HashMap::from([(1, vec![2]), (2, vec![1])]);
        let resident = HashMap::from([(1, 10), (2, 20)]);
        assert_eq!(subtree(1, &children, &resident), (30, 2));
    }

    #[test]
    fn no_sessions_means_no_work() {
        assert!(measure(&[]).is_empty());
    }

    #[test]
    fn measures_this_process() {
        let me = std::process::id() as i32;
        let out = measure(&[("self".into(), me)]);
        assert_eq!(out.len(), 1);
        assert!(out[0].bytes > 0, "the test process must have resident memory");
        assert!(out[0].processes >= 1);
    }
}
