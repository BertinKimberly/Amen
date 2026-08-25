# Generate test audio using FFmpeg
# Creates a simple tone for testing

$outputPath = Join-Path $PSScriptRoot "test-audio.wav"

# Check if ffmpeg is available
$ffmpegPath = Get-Command ffmpeg -ErrorAction SilentlyContinue

if (-not $ffmpegPath) {
    Write-Error "FFmpeg not found in PATH"
    exit 1
}

# Generate 30-second test audio with a 440Hz tone
ffmpeg -f lavfi -i "sine=frequency=440:duration=30" -ar 44100 -ac 2 -y $outputPath

if ($LASTEXITCODE -eq 0) {
    Write-Host "Test audio created: $outputPath"
    Write-Host "Duration: 30 seconds"
    Write-Host "Sample rate: 44100 Hz"
    Write-Host "Channels: 2 (stereo)"
} else {
    Write-Error "Failed to generate test audio"
    exit 1
}
