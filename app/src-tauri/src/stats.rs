//! This machine's processor, memory, disk and temperature, for the dock gauge.
//!
//! All four are read in one place and handed over as percentages, except the
//! temperature, which is degrees Celsius on a gauge that tops out at 105.
//! Temperature is an Option: on Apple silicon sysinfo often reports no
//! components at all, and a quarter of a gauge showing a made-up number would
//! be worse than one that says it cannot tell.
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

    Stats {
        cpu: cpu.clamp(0.0, 100.0),
        ram: pct(sys.used_memory(), sys.total_memory()),
        ssd: pct(ssd_used, ssd_total),
        tmp: temperature(components),
        cores: cpus.len(),
        ram_total: sys.total_memory(),
        ram_used: sys.used_memory(),
        ssd_total,
        ssd_used,
    }
}

/// Everything the gauge needs, refreshed per call. Cheap enough for the
/// dock's few-second cycle; the handles are rebuilt because the gauge is only
/// read while the dock is on screen.
pub fn snapshot() -> Stats {
    let mut sys = System::new_with_specifics(RefreshKind::nothing().with_cpu(sysinfo::CpuRefreshKind::nothing().with_cpu_usage()).with_memory(MemoryRefreshKind::nothing().with_ram()));
    // CPU usage needs two samples; the first read is always zero otherwise.
    sys.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    let mut disks = Disks::new_with_refreshed_list();
    let mut components = Components::new_with_refreshed_list();
    read(&mut sys, &mut disks, &mut components)
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
