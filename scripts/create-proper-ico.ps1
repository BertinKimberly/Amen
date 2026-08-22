# Create a proper multi-resolution .ico file from logo.png
# This uses ImageMagick if available, otherwise creates a simple .ico

Write-Host "Creating proper Windows .ico file..." -ForegroundColor Cyan

$logoPath = "$PSScriptRoot\..\public\logo.png"
$outputPath = "$PSScriptRoot\..\src-tauri\icons\icon.ico"

# Check if ImageMagick is available
$magickPath = (Get-Command magick -ErrorAction SilentlyContinue).Source

if ($magickPath) {
    Write-Host "Using ImageMagick to create multi-resolution .ico..." -ForegroundColor Yellow
    & $magickPath $logoPath -define icon:auto-resize=256,128,64,48,32,16 $outputPath
    Write-Host "✓ Created with ImageMagick" -ForegroundColor Green
} else {
    Write-Host "ImageMagick not found, using Tauri icon generator..." -ForegroundColor Yellow
    Set-Location "$PSScriptRoot\.."
    npm run tauri -- icon "$PSScriptRoot\..\src-tauri\icons\icon.png" --output "$PSScriptRoot\..\src-tauri\icons"
}

Write-Host ""
Write-Host "Icon file info:" -ForegroundColor White
Get-Item $outputPath | Select-Object Name, Length, LastWriteTime | Format-List
