//! Real local system telemetry for the Diagnostics view. Every number here
//! comes from an actual OS query (via `sysinfo`) — nothing is simulated or
//! estimated, matching the rest of the Diagnostics screen's "real checks,
//! not simulated" promise.

use serde::Serialize;
use std::sync::Mutex;
use sysinfo::System;

pub struct SystemMonitor(pub Mutex<System>);

impl SystemMonitor {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        Self(Mutex::new(sys))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemUsage {
    /// This process's CPU usage, percent (0-100 per core; can exceed 100 on multi-core work).
    pub process_cpu_percent: f32,
    /// This process's resident memory, in megabytes.
    pub process_mem_mb: f64,
    /// System-wide used memory, in megabytes.
    pub system_mem_used_mb: f64,
    /// System-wide total memory, in megabytes.
    pub system_mem_total_mb: f64,
}

#[tauri::command]
pub fn system_usage(state: tauri::State<'_, SystemMonitor>) -> SystemUsage {
    let mut sys = state.0.lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_memory();
    sys.refresh_cpu_usage();
    let pid = sysinfo::get_current_pid().ok();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let (process_cpu_percent, process_mem_mb) = pid
        .and_then(|pid| sys.process(pid))
        .map(|p| (p.cpu_usage(), p.memory() as f64 / 1024.0 / 1024.0))
        .unwrap_or((0.0, 0.0));

    SystemUsage {
        process_cpu_percent,
        process_mem_mb,
        system_mem_used_mb: sys.used_memory() as f64 / 1024.0 / 1024.0,
        system_mem_total_mb: sys.total_memory() as f64 / 1024.0 / 1024.0,
    }
}
