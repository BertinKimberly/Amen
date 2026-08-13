use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Spawn a command on Windows without popping a console window.
/// Always pass arguments as an array — never via a shell string.
pub fn new_command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 0x08000000 == CREATE_NO_WINDOW
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// Run a command capturing combined output, with a timeout.
/// Returns None if the process could not be spawned.
pub fn run_capture(cmd: &mut Command, timeout_ms: u64) -> Option<String> {
    let mut child = match cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return None,
    };

    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        let _ = tx.send(s);
    });

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(_) => break,
        }
        if start.elapsed().as_millis() > timeout_ms as u128 {
            let _ = child.kill();
            let _ = child.wait();
            break;
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    let out = rx.recv_timeout(Duration::from_secs(2)).unwrap_or_default();
    Some(out)
}

/// Kill a process and its entire child tree on Windows.
/// Uses `taskkill /PID <pid> /T /F` with structured arguments (no shell interpolation).
pub fn kill_tree(pid: u32) {
    let mut cmd = new_command(Path::new("taskkill"));
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status();
}

