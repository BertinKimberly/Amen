# Amen 0.2.0 — Release Notes

## Fixed

- **YouTube downloads returning HTTP 403.** Root-caused to a stale bundled
  yt-dlp (2026.07.04): its fallback extraction client was being blocked by
  YouTube. Verified against the reported URL that updating to the current
  stable release (2026.08.19) resolves it end-to-end — metadata fetch,
  download, FFmpeg conversion, and a valid, playable MP3 output. The
  "HTTP 403" error message now points the user at Diagnostics → check for
  updates instead of only suggesting cookies/region-blocking.
- **Timeline zoom stuck at a tiny scale for long tracks.** The timeline's
  auto-fit-to-content ran once, ever, against whichever duration happened to
  be current at first mount — almost always an empty project — so placing a
  multi-minute clip later left the ruler at an unusably small scale. It now
  re-fits the first time content is placed on an untouched timeline, while
  still respecting a zoom level the user picked manually (mirroring the
  waveform view's existing behavior).

## Hardening / verification this pass

- Full dependency audit: `npm audit` (0 vulnerabilities), `cargo audit`
  (0 actual advisories — 17 "unmaintained/unsound" warnings, all in
  Windows-irrelevant transitive GTK3 bindings pulled in by the
  clipboard/dialog plugins). Cargo.lock refreshed to the latest versions
  allowed by existing version constraints; verified with a full release
  build and the complete Rust test suite.
- Added a throttled (once/24h), silent background check for yt-dlp updates
  on app startup, surfaced as a toast — never auto-installs, so it can't
  affect reproducibility, but it closes the gap where an installed copy
  could silently go stale for months with no prompt to update.
- Reviewed the download/render pipeline's subprocess and path handling:
  confirmed every yt-dlp/FFmpeg invocation uses structured argument arrays
  (never a shell string), filenames are sanitized against invalid/reserved
  Windows names, and output paths reject traversal — no changes needed.
- Reviewed the cookies workflow (Settings → Advanced): already an explicit,
  user-provided `cookies.txt` path, never auto-harvested from a browser —
  correct as-is; browser-cookie auto-extraction was deliberately not added.
- Reviewed the disabled Content-Security-Policy (`csp: null` in
  tauri.conf.json). Left unchanged this pass: the app loads no remote
  content, so the exploitable surface is low, and a CSP tightened without
  being able to manually click through every visual/audio code path risks
  silently breaking asset-protocol images or audio playback in a way the
  E2E suite might not catch pixel-for-pixel — exactly the kind of
  "unnecessary instability" a hardening pass should avoid introducing.
  Worth a dedicated, carefully-tested pass on its own.
- Full E2E and Rust regression suites re-run after every change (see below).

## Not changed (reviewed, deliberately deferred)

- React 18→19, Vite 6→8, TypeScript 5→7, Zustand 4→5, and a few other
  major-version bumps are available upstream. All are 0-vulnerability,
  pure major-version jumps with real breaking-change surface; deferred to
  a dedicated migration pass rather than bundled into a hardening release.

## Versioning

Bumped 0.1.0 → 0.2.0 (package.json, Cargo.toml, tauri.conf.json) to mark
this as the first verified, evidence-backed hardening release.
