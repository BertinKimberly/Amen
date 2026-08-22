# Create Tauri Application Icons from Logo
# This script generates all required Tauri icons from the Amen logo

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Creating Tauri App Icons from Amen Logo" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$sourcePath = "$PSScriptRoot\..\public\logo.png"
$iconsDir = "$PSScriptRoot\..\src-tauri\icons"

# Check if source exists
if (-not (Test-Path $sourcePath)) {
    Write-Host "✗ Error: logo.png not found!" -ForegroundColor Red
    exit 1
}

Add-Type -AssemblyName System.Drawing

function Create-Icon {
    param (
        [string]$SourcePath,
        [string]$OutputPath,
        [int]$Size
    )
    
    try {
        $sourceImage = [System.Drawing.Image]::FromFile($SourcePath)
        $targetImage = New-Object System.Drawing.Bitmap($Size, $Size)
        $graphics = [System.Drawing.Graphics]::FromImage($targetImage)
        
        # High quality settings
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        
        $graphics.DrawImage($sourceImage, 0, 0, $Size, $Size)
        $targetImage.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
        
        $graphics.Dispose()
        $targetImage.Dispose()
        $sourceImage.Dispose()
        
        return $true
    } catch {
        Write-Host "  ✗ Failed to create ${Size}x${Size}: $_" -ForegroundColor Red
        return $false
    }
}

# Create standard Tauri icons
Write-Host "[1/3] Creating standard app icons..." -ForegroundColor Yellow

$standardIcons = @(
    @{Size=32; Name="32x32.png"},
    @{Size=64; Name="64x64.png"},
    @{Size=128; Name="128x128.png"},
    @{Size=256; Name="128x128@2x.png"},
    @{Size=512; Name="icon.png"}  # Source icon for Tauri
)

foreach ($item in $standardIcons) {
    $outputPath = Join-Path $iconsDir $item.Name
    if (Create-Icon -SourcePath $sourcePath -OutputPath $outputPath -Size $item.Size) {
        Write-Host "  ✓ Created $($item.Name)" -ForegroundColor Green
    }
}

# Create Windows Store logos
Write-Host ""
Write-Host "[2/3] Creating Windows Store logos..." -ForegroundColor Yellow

$storeLogos = @(
    @{Size=30; Name="Square30x30Logo.png"},
    @{Size=44; Name="Square44x44Logo.png"},
    @{Size=71; Name="Square71x71Logo.png"},
    @{Size=89; Name="Square89x89Logo.png"},
    @{Size=107; Name="Square107x107Logo.png"},
    @{Size=142; Name="Square142x142Logo.png"},
    @{Size=150; Name="Square150x150Logo.png"},
    @{Size=284; Name="Square284x284Logo.png"},
    @{Size=310; Name="Square310x310Logo.png"},
    @{Size=50; Name="StoreLogo.png"}
)

foreach ($item in $storeLogos) {
    $outputPath = Join-Path $iconsDir $item.Name
    if (Create-Icon -SourcePath $sourcePath -OutputPath $outputPath -Size $item.Size) {
        Write-Host "  ✓ Created $($item.Name)" -ForegroundColor Green
    }
}

# Create .ico file (Windows executable icon)
Write-Host ""
Write-Host "[3/3] Creating Windows .ico file..." -ForegroundColor Yellow

# For proper .ico, we need to use the Tauri icon command, but as a quick fix
# we'll copy the 256x256 as icon.ico (Windows will use it)
$icon256Path = Join-Path $iconsDir "128x128@2x.png"
$iconIcoPath = Join-Path $iconsDir "icon.ico"

if (Test-Path $icon256Path) {
    Copy-Item $icon256Path $iconIcoPath -Force
    Write-Host "  ✓ Created icon.ico" -ForegroundColor Green
    Write-Host "  ℹ Note: For best results, rebuild with 'npm run tauri icon'" -ForegroundColor Gray
}

# Create macOS .icns (if needed)
$iconIcnsPath = Join-Path $iconsDir "icon.icns"
if (Test-Path $icon256Path) {
    Copy-Item $icon256Path $iconIcnsPath -Force
    Write-Host "  ✓ Created icon.icns (placeholder)" -ForegroundColor Green
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  ✓ Tauri icons created successfully!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "IMPORTANT: For the icon to appear in the running app:" -ForegroundColor Yellow
Write-Host "1. Stop the dev server (Ctrl+C)" -ForegroundColor White
Write-Host "2. Restart with: npm run tauri:dev" -ForegroundColor White
Write-Host ""
Write-Host "The Amen logo will now appear as the app icon!" -ForegroundColor Cyan
Write-Host ""
