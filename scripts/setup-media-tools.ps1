# Installs yt-dlp + FFmpeg into the app's bundled tools directory.
# Uses only official sources: yt-dlp GitHub releases + gyan.dev FFmpeg builds.
# Run: powershell -ExecutionPolicy Bypass -File scripts\setup-media-tools.ps1

$ErrorActionPreference = "Stop"

$toolsDir = Join-Path $env:LOCALAPPDATA "Amen\tools"
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
Write-Host "Tools directory: $toolsDir"

# --- yt-dlp ----------------------------------------------------------------
$ytdlpTarget = Join-Path $toolsDir "yt-dlp.exe"
if (-not (Test-Path $ytdlpTarget)) {
    Write-Host "Downloading yt-dlp (official GitHub release)..."
    Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" `
        -OutFile (Join-Path $toolsDir "yt-dlp.exe.download") -UseBasicParsing
    Move-Item (Join-Path $toolsDir "yt-dlp.exe.download") $ytdlpTarget -Force
}
else {
    Write-Host "yt-dlp already present."
}
& $ytdlpTarget --version

# --- FFmpeg ----------------------------------------------------------------
if (-not (Test-Path (Join-Path $toolsDir "ffmpeg.exe")) -or -not (Test-Path (Join-Path $toolsDir "ffprobe.exe"))) {
    Write-Host "Downloading FFmpeg (official gyan.dev build)..."
    $zipPath = Join-Path $toolsDir "ffmpeg.zip"
    Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" `
        -OutFile $zipPath -UseBasicParsing
    Write-Host "Extracting ffmpeg.exe / ffprobe.exe..."
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName -replace '\\', '/'
            $base = ($name -split '/')[-1]
            if ($base -eq "ffmpeg.exe" -or $base -eq "ffprobe.exe") {
                $dest = Join-Path $toolsDir $base
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
                Write-Host "Extracted $base"
            }
        }
    }
    finally {
        $zip.Dispose()
    }
    Remove-Item $zipPath -Force
}
else {
    Write-Host "FFmpeg already present."
}

# --- Verify ----------------------------------------------------------------
Write-Host ""
Write-Host "Verifying..."
& (Join-Path $toolsDir "yt-dlp.exe") --version
& (Join-Path $toolsDir "ffmpeg.exe") -version | Select-Object -First 1
& (Join-Path $toolsDir "ffprobe.exe") -version | Select-Object -First 1
Write-Host ""
Write-Host "Done. Open Amen -> Diagnostics and re-check to confirm."
