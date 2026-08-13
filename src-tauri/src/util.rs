use regex::Regex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Sanitize a single path component so it is safe on Windows:
/// - replaces characters invalid in Windows filenames
/// - collapses whitespace, trims trailing dots/spaces
/// - prefixes reserved device names
/// - limits length (bytes) to keep full paths under MAX_PATH
pub fn sanitize_filename_component(name: &str) -> String {
    let mut cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();

    // collapse repeated whitespace
    let mut out = String::with_capacity(cleaned.len());
    let mut prev_space = false;
    for ch in cleaned.chars() {
        if ch == ' ' {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    cleaned = out.trim().trim_end_matches(['.', ' ']).to_string();

    if cleaned.is_empty() {
        return String::new();
    }

    // Reserved device names (CON, PRN, AUX, NUL, COM1.., LPT1..)
    let stem = cleaned.split('.').next().unwrap_or("").to_uppercase();
    if RESERVED_NAMES.contains(&stem.as_str()) {
        cleaned = format!("_{cleaned}");
    }

    // Cap length to keep path + filename under Windows limits (allow long-path ext)
    let max_bytes = 170usize;
    let mut truncated = String::new();
    let mut bytes = 0usize;
    for ch in cleaned.chars() {
        let sz = ch.len_utf8();
        if bytes + sz > max_bytes {
            break;
        }
        truncated.push(ch);
        bytes += sz;
    }
    truncated.trim_end_matches(['.', ' ']).to_string()
}

/// Apply a yt-dlp style `%(field)s` filename template using provided fields.
/// Missing fields render as empty strings. `%(ext)s` is preserved as-is when
/// present so callers can substitute the actual extension.
pub fn apply_template(template: &str, fields: &HashMap<String, String>) -> String {
    let re = Regex::new(r"%\(([a-zA-Z0-9_]+)\)s").expect("valid regex");
    re.replace_all(template, |caps: &regex::Captures| {
        let key = &caps[1];
        fields
            .get(key)
            .map(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    })
    .to_string()
}

/// Expand `%VAR%` and `${VAR}` environment variables in a path string.
pub fn expand_env(input: &str) -> String {
    let re = Regex::new(r"%(?P<name>[A-Za-z_][A-Za-z0-9_]*)%").expect("valid regex");
    let mut s = re
        .replace_all(input, |caps: &regex::Captures| {
            std::env::var(&caps["name"]).unwrap_or_else(|_| format!("%{}%", &caps["name"]))
        })
        .to_string();
    let re2 = Regex::new(r"\$\{(?P<name>[A-Za-z_][A-Za-z0-9_]*)\}").expect("valid regex");
    s = re2
        .replace_all(&s, |caps: &regex::Captures| {
            std::env::var(&caps["name"]).unwrap_or_else(|_| format!("${{{}}}", &caps["name"]))
        })
        .to_string();
    s
}

/// Split the extension (if any) off a rendered filename component.
pub fn split_ext(name: &str) -> (String, Option<String>) {
    match name.rfind('.') {
        Some(idx) if idx > 0 => (
            name[..idx].to_string(),
            Some(name[idx + 1..].to_string()),
        ),
        _ => (name.to_string(), None),
    }
}

/// Build a safe absolute output path from a directory + filename template +
/// metadata fields + extension. Rejects path traversal; sanitizes each component.
pub fn build_output_path(
    output_dir: &str,
    template: &str,
    fields: &HashMap<String, String>,
    ext: &str,
) -> crate::error::AppResult<PathBuf> {
    let expanded_dir = expand_env(output_dir);
    let base = PathBuf::from(expanded_dir);

    let rendered = apply_template(template, fields);
    let mut rendered = rendered.trim().to_string();
    // Ensure the rendered name carries the requested extension
    let (stem, _) = split_ext(&rendered);
    if stem.is_empty() {
        rendered = format!("media.{ext}");
    } else if !rendered.to_lowercase().ends_with(&format!(".{ext}")) {
        // template already had %(ext)s replaced, or lacks an extension
        if !rendered.contains('.') {
            rendered = format!("{rendered}.{ext}");
        } else if !has_known_media_ext(&rendered) {
            rendered = format!("{rendered}.{ext}");
        }
    }

    let components: Vec<&str> = rendered
        .split(['/', '\\'])
        .filter(|s| !s.is_empty())
        .collect();
    if components.is_empty() {
        return Err(crate::error::AppError::config(
            "The filename template did not produce a filename.",
        ));
    }

    let mut path = base;
    for (i, comp) in components.iter().enumerate() {
        let is_last = i == components.len() - 1;
        if !is_last {
            let dir_component = sanitize_filename_component(comp);
            if dir_component == ".." || dir_component == "." || dir_component.is_empty() {
                return Err(crate::error::AppError::config(
                    "The filename template contains invalid path segments.",
                ));
            }
            path = path.join(dir_component);
        } else {
            let (stem, _) = split_ext(comp);
            let mut stem = sanitize_filename_component(&stem);
            if stem.is_empty() {
                stem = "media".to_string();
            }
            let fname = format!("{stem}.{ext}");
            path = path.join(fname);
        }
    }
    Ok(path)
}

fn has_known_media_ext(name: &str) -> bool {
    let lower = name.to_lowercase();
    ["mp3", "mp4", "m4a", "webm", "mkv", "ogg", "opus", "flac", "wav"]
        .iter()
        .any(|e| lower.ends_with(&format!(".{e}")))
}

/// If `path` already exists, return `path`, `name (1).ext`, `name (2).ext`, ...
/// so downloads never silently overwrite an existing file.
pub fn unique_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let (stem, ext) = split_ext(&file_name);
    for n in 1..10_000 {
        let candidate = parent.join(if let Some(e) = &ext {
            format!("{stem} ({n}).{e}")
        } else {
            format!("{stem} ({n})")
        });
        if !candidate.exists() {
            return candidate;
        }
    }
    path.to_path_buf()
}

/// Redact likely-sensitive query parameters from URLs before logging.
pub fn redact_url(url: &str) -> String {
    const SENSITIVE: &[&str] = &[
        "token", "access_token", "auth", "signature", "sig", "key", "api_key", "apikey", "secret",
        "password", "passwd", "cookie", "session", "code", "state", "credential", "refresh_token",
    ];
    let Some((before, after)) = url.split_once('?') else {
        return url.to_string();
    };
    let mut kept: Vec<String> = Vec::new();
    for pair in after.split('&') {
        let key = pair.split('=').next().unwrap_or("").to_lowercase();
        if SENSITIVE.iter().any(|s| key.starts_with(s)) {
            kept.push(format!("{key}=REDACTED"));
        } else {
            kept.push(pair.to_string());
        }
    }
    format!("{before}?{}", kept.join("&"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_removes_invalid_chars() {
        let s = sanitize_filename_component("Title: With <Bad> | Chars * ?");
        assert!(!s.contains(':'));
        assert!(!s.contains('<'));
        assert!(!s.contains('|'));
        assert!(!s.contains('*'));
    }

    #[test]
    fn sanitize_handles_reserved_names() {
        assert!(sanitize_filename_component("CON").starts_with('_'));
        assert!(sanitize_filename_component("com1.mp3").starts_with('_'));
        assert_eq!(sanitize_filename_component("normal"), "normal");
    }

    #[test]
    fn sanitize_trims_dots_and_spaces() {
        let s = sanitize_filename_component("  Leading and trailing   ");
        assert_eq!(s, "Leading and trailing");
        assert!(!s.ends_with('.'));
    }

    #[test]
    fn sanitize_empty_falls_back() {
        assert_eq!(sanitize_filename_component("///"), "");
    }

    #[test]
    fn template_replaces_fields() {
        let mut fields = HashMap::new();
        fields.insert("title".to_string(), "Hello World".to_string());
        fields.insert("ext".to_string(), "mp3".to_string());
        assert_eq!(
            apply_template("%(title)s.%(ext)s", &fields),
            "Hello World.mp3"
        );
    }

    #[test]
    fn template_missing_field_empty() {
        let fields = HashMap::new();
        assert_eq!(apply_template("a%(nope)sb", &fields), "ab");
    }

    #[test]
    fn template_with_subdirs() {
        let mut fields = HashMap::new();
        fields.insert("artist".to_string(), "Artist".to_string());
        fields.insert("album".to_string(), "Album".to_string());
        fields.insert("title".to_string(), "Track".to_string());
        fields.insert("ext".to_string(), "mp3".to_string());
        assert_eq!(
            apply_template("%(artist)s/%(album)s/%(title)s.%(ext)s", &fields),
            "Artist/Album/Track.mp3"
        );
    }

    #[test]
    fn build_output_path_subdirs() {
        let mut fields = HashMap::new();
        fields.insert("artist".to_string(), "A".to_string());
        fields.insert("album".to_string(), "B".to_string());
        fields.insert("title".to_string(), "T".to_string());
        fields.insert("ext".to_string(), "mp3".to_string());
        let p = build_output_path(
            "C:\\Music",
            "%(artist)s/%(album)s/%(title)s.%(ext)s",
            &fields,
            "mp3",
        )
        .unwrap();
        assert_eq!(p, PathBuf::from(r"C:\Music\A\B\T.mp3"));
    }

    #[test]
    fn build_output_path_rejects_traversal() {
        let mut fields = HashMap::new();
        fields.insert("title".to_string(), "T".to_string());
        let p = build_output_path("C:\\Music", "../%(title)s.%(ext)s", &fields, "mp3");
        assert!(p.is_err());
    }

    #[test]
    fn expand_env_windows_syntax() {
        std::env::set_var("TEST_VAR_LMS", "value");
        assert_eq!(expand_env("%TEST_VAR_LMS%/x"), "value/x");
        assert_eq!(expand_env("${TEST_VAR_LMS}/x"), "value/x");
    }

    #[test]
    fn unique_path_suffix() {
        let dir = std::env::temp_dir().join("lms_unique_test");
        std::fs::create_dir_all(&dir).unwrap();
        let f1 = dir.join("song.mp3");
        std::fs::write(&f1, b"x").unwrap();
        let u = unique_path(&f1);
        assert_ne!(u, f1);
        assert!(u.to_string_lossy().contains("(1)"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn redact_url_removes_tokens() {
        let u = redact_url("https://x.com/v?token=abc&v=1&sig=zzz");
        assert!(!u.contains("abc"));
        assert!(!u.contains("zzz"));
        assert!(u.contains("token=REDACTED"));
        assert!(u.contains("v=1"));
    }

    #[test]
    fn redact_url_passthrough_without_query() {
        assert_eq!(redact_url("https://youtube.com/watch?v=abc"), "https://youtube.com/watch?v=abc");
    }
}
