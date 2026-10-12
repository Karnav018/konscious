//! This machine's processor, memory, disk, temperature and graphics, for the
//! dock gauge.
//!
//! All four are read in one place and handed over as percentages, except the
//! temperature, which is degrees Celsius on a gauge that tops out at 105.
//! Temperature is an Option: on Apple silicon sysinfo often reports no
//! components at all, and a quarter of a gauge showing a made-up number would
//! be worse than one that says it cannot tell.
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use sysinfo::{Components, Disks, MemoryRefreshKind, RefreshKind, System};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// Processor use across all cores, 0–100.
    pub cpu: f32,
    /// Memory in use, 0–100.
    pub ram: f32,
    /// Space used on the volume the app runs from, 0–100.
    pub ssd: f32,
    /// Hottest component in °C, or None when this machine will not say.
    pub tmp: Option<f32>,
    /// Graphics use, 0–100, or None where we have no way to ask.
    pub gpu: Option<f32>,
    /// Graphics memory in use, in bytes, for the detail line.
    pub gpu_used: Option<u64>,
    /// Figures behind the percentages, for the detail lines.
    pub cores: usize,
    pub ram_total: u64,
    pub ram_used: u64,
    pub ssd_total: u64,
    pub ssd_used: u64,
}

fn pct(used: u64, total: u64) -> f32 {
    if total == 0 {
        return 0.0;
    }
    (used as f64 / total as f64 * 100.0) as f32
}

/// The hottest reading any component reports. None when there are none, which
/// is the normal answer on Apple silicon.
pub fn temperature(components: &Components) -> Option<f32> {
    components
        .iter()
        .filter_map(|c| c.temperature())
        .filter(|t| t.is_finite() && *t > 0.0 && *t < 150.0)
        .fold(None, |hottest: Option<f32>, t| Some(hottest.map_or(t, |h| h.max(t))))
}

pub fn read(sys: &mut System, disks: &mut Disks, components: &mut Components) -> Stats {
    sys.refresh_cpu_usage();
    sys.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
    disks.refresh(true);
    components.refresh(true);

    let cpus = sys.cpus();
    let cpu = if cpus.is_empty() {
        0.0
    } else {
        cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
    };

    // The volume the app runs from: the one the user means by "disk".
    let (ssd_total, ssd_used) = disks
        .iter()
        .filter(|d| d.mount_point() == std::path::Path::new("/") || d.mount_point().as_os_str() == "C:\\")
        .map(|d| (d.total_space(), d.total_space().saturating_sub(d.available_space())))
        .next()
        .or_else(|| {
            disks
                .iter()
                .max_by_key(|d| d.total_space())
                .map(|d| (d.total_space(), d.total_space().saturating_sub(d.available_space())))
        })
        .unwrap_or((0, 0));

    let (gpu, gpu_used) = graphics();
    Stats {
        cpu: cpu.clamp(0.0, 100.0),
        ram: pct(sys.used_memory(), sys.total_memory()),
        ssd: pct(ssd_used, ssd_total),
        tmp: temperature(components),
        gpu,
        gpu_used,
        cores: cpus.len(),
        ram_total: sys.total_memory(),
        ram_used: sys.used_memory(),
        ssd_total,
        ssd_used,
    }
}

/// The probes, built once and kept.
///
/// Rebuilding them per call meant re-enumerating the machine's temperature
/// sensors every few seconds, which on macOS goes through IOKit and the SMC.
/// Keeping them also means the processor has a previous sample to compare
/// against, so a reading no longer has to sleep for one.
struct Probes {
    sys: System,
    disks: Disks,
    components: Components,
}

static PROBES: OnceLock<Mutex<Probes>> = OnceLock::new();

fn probes() -> &'static Mutex<Probes> {
    PROBES.get_or_init(|| {
        let mut sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(sysinfo::CpuRefreshKind::nothing().with_cpu_usage())
                .with_memory(MemoryRefreshKind::nothing().with_ram()),
        );
        // Processor use is a difference between two samples, so the first
        // reading needs a baseline to measure from.
        sys.refresh_cpu_usage();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        Mutex::new(Probes {
            sys,
            disks: Disks::new_with_refreshed_list(),
            components: Components::new_with_refreshed_list(),
        })
    })
}

/// Everything the gauge needs. Cheap enough for the dock's few-second cycle.
pub fn snapshot() -> Stats {
    // A panic in another reader must not poison the gauge for good.
    let mut p = probes().lock().unwrap_or_else(|e| e.into_inner());
    let Probes { sys, disks, components } = &mut *p;
    read(sys, disks, components)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_percentage_of_nothing_is_nothing() {
        assert_eq!(pct(0, 0), 0.0);
        assert_eq!(pct(5, 0), 0.0);
        assert_eq!(pct(1, 2), 50.0);
    }

    #[test]
    fn no_components_means_no_temperature() {
        // What Apple silicon normally reports.
        assert_eq!(temperature(&Components::new()), None);
    }

    #[test]
    fn this_machine_reports_believable_figures() {
        let s = snapshot();
        assert!((0.0..=100.0).contains(&s.cpu), "cpu {} out of range", s.cpu);
        assert!((0.0..=100.0).contains(&s.ram), "ram {} out of range", s.ram);
        assert!((0.0..=100.0).contains(&s.ssd), "ssd {} out of range", s.ssd);
        assert!(s.ram_total > 0, "a machine with no memory");
        assert!(s.cores > 0, "a machine with no cores");
        if let Some(t) = s.tmp {
            assert!((0.0..150.0).contains(&t), "temperature {t} out of range");
        }
        // Printed so the build says what this platform can actually read.
        println!(
            "cpu {:.0}%  ram {:.0}%  ssd {:.0}%  temp {}",
            s.cpu,
            s.ram,
            s.ssd,
            s.tmp.map_or("not reported".into(), |t| format!("{t:.0}°C"))
        );
    }
}

/* ── graphics ─────────────────────────────────────────────────────── */

/// What the graphics chip is doing, and how much memory it holds.
///
/// sysinfo does not report this, and the usual macOS answer, `powermetrics`,
/// needs sudo — not something to ask of anyone for a dock gauge. The driver
/// publishes the same figures in the IO registry, readable by anyone, which
/// is what this reads. A read costs about ten milliseconds.
///
/// An Intel Mac has two accelerators, integrated and discrete; the busier one
/// is the honest answer, since that is the one doing the work.
#[cfg(target_os = "macos")]
pub fn graphics() -> (Option<f32>, Option<u64>) {
    let out = std::process::Command::new("/usr/sbin/ioreg")
        .args(["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"])
        .output();
    match out {
        Ok(o) if o.status.success() => parse_ioreg(&String::from_utf8_lossy(&o.stdout)),
        _ => (None, None),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn graphics() -> (Option<f32>, Option<u64>) {
    // Windows keeps this behind PDH's GPU engine counters, which need rather
    // more plumbing than a gauge is worth until someone asks. The gauge drops
    // a stat the machine will not report, so it simply shows four.
    (None, None)
}

/// Pulls the two figures out of ioreg's output. Kept apart from the command
/// so it can be tested against the real text on any platform.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_ioreg(text: &str) -> (Option<f32>, Option<u64>) {
    fn after<'a>(line: &'a str, key: &str) -> Option<&'a str> {
        let at = line.find(key)? + key.len();
        Some(line[at..].trim_start_matches(['=', ' ']))
    }
    fn number(rest: &str) -> Option<f64> {
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        digits.parse().ok()
    }
    let mut busiest: Option<f32> = None;
    let mut memory: Option<u64> = None;
    // The dictionary is one long line with comma-separated entries, so the
    // fields are found by key rather than by position.
    for field in text.split(',') {
        if field.contains("\"Device Utilization %\"") {
            if let Some(v) = after(field, "\"Device Utilization %\"").and_then(number) {
                let v = v.clamp(0.0, 100.0) as f32;
                busiest = Some(busiest.map_or(v, |b: f32| b.max(v)));
            }
        } else if field.contains("\"In use system memory\"") && !field.contains("(driver)") {
            if let Some(v) = after(field, "\"In use system memory\"").and_then(number) {
                let v = v as u64;
                memory = Some(memory.map_or(v, |m: u64| m.max(v)));
            }
        }
    }
    (busiest, memory)
}

#[cfg(test)]
mod gpu_tests {
    use super::*;

    /// Real output from an Apple silicon Mac, trimmed to the dictionary.
    const SAMPLE: &str = r#"    "PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=1981677568,"Tiler Utilization %"=31,"recoveryCount"=0,"Renderer Utilization %"=30,"Device Utilization %"=31,"In use system memory"=466354176}"#;

    #[test]
    fn reads_the_figures_the_driver_publishes() {
        let (used, mem) = parse_ioreg(SAMPLE);
        assert_eq!(used, Some(31.0));
        assert_eq!(mem, Some(466_354_176));
    }

    #[test]
    fn does_not_mistake_the_driver_s_own_memory_for_the_gpu_s() {
        // "In use system memory (driver)" is 0 and sits before the real one.
        assert_eq!(parse_ioreg(SAMPLE).1, Some(466_354_176));
    }

    #[test]
    fn takes_the_busier_of_two_accelerators() {
        // An Intel Mac reports integrated and discrete separately.
        let two = format!("{SAMPLE}\n{}", SAMPLE.replace("\"Device Utilization %\"=31", "\"Device Utilization %\"=74"));
        assert_eq!(parse_ioreg(&two).0, Some(74.0));
    }

    #[test]
    fn says_nothing_rather_than_guess_when_there_is_nothing_to_read() {
        assert_eq!(parse_ioreg(""), (None, None));
        assert_eq!(parse_ioreg("+-o AppleARMPE  <class IOPlatformExpertDevice>"), (None, None));
    }

    #[test]
    fn keeps_a_percentage_a_percentage() {
        let odd = SAMPLE.replace("\"Device Utilization %\"=31", "\"Device Utilization %\"=512");
        assert_eq!(parse_ioreg(&odd).0, Some(100.0));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn reads_this_machine() {
        let (used, mem) = graphics();
        if let Some(used) = used {
            assert!((0.0..=100.0).contains(&used), "implausible utilisation: {used}");
        } else {
            eprintln!("ioreg did not report GPU utilisation on this machine");
        }
        if let Some(mem) = mem {
            assert!(mem > 0, "a running machine holds some graphics memory");
        } else {
            eprintln!("ioreg did not report graphics memory on this machine");
        }
    }
}
