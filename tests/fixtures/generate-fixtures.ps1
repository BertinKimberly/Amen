# Regenerates the real (ffmpeg-synthesized, not hand-authored) audio fixtures
# used by the Playwright E2E suite in tests/*.spec.ts.
#
# source-a-440hz-8s.wav, source-b-660hz-5s.wav, and source-long-40s.wav are
# committed to the repo (tiny, ~9 MB total). source-3min.wav, source-5min.wav,
# and source-12min.wav back the realistic-duration performance tests
# (tests/studio-performance.spec.ts) — at 100+ MB combined they are NOT
# committed (see .gitignore); run this script once after cloning, or whenever
# they go missing, to regenerate them locally in a couple of seconds.

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
    $bundled = "$env:LOCALAPPDATA\Amen\tools\ffmpeg.exe"
    if (Test-Path $bundled) { $ffmpeg = $bundled } else {
        Write-Error "ffmpeg not found on PATH or at $bundled"
        exit 1
    }
} else {
    $ffmpeg = $ffmpeg.Source
}

$fixtures = @(
    @{ Name = "source-a-440hz-8s.wav";  Freq = 440; Duration = 8 },
    @{ Name = "source-b-660hz-5s.wav";  Freq = 660; Duration = 5 },
    @{ Name = "source-long-40s.wav";    Freq = 440; Duration = 40 },
    @{ Name = "source-3min.wav";        Freq = 220; Duration = 180 },
    @{ Name = "source-5min.wav";        Freq = 330; Duration = 300 },
    @{ Name = "source-12min.wav";       Freq = 440; Duration = 720 }
)

foreach ($f in $fixtures) {
    $outPath = Join-Path $PSScriptRoot $f.Name
    if (Test-Path $outPath) {
        Write-Host "Exists, skipping: $($f.Name)"
        continue
    }
    Write-Host "Generating $($f.Name) ($($f.Duration)s @ $($f.Freq)Hz)..."
    & $ffmpeg -y -f lavfi -i "sine=frequency=$($f.Freq):duration=$($f.Duration)" $outPath 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to generate $($f.Name)"
        exit 1
    }
}

Write-Host "All fixtures present in $PSScriptRoot"
