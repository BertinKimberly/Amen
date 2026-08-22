# Create All Favicons and App Icons from Logo
# This script creates favicons and app icons in multiple sizes

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Creating Favicons from Amen Logo" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$sourcePath = "$PSScriptRoot\..\public\logo.png"
$publicDir = "$PSScriptRoot\..\public"

# Check if source exists
if (-not (Test-Path $sourcePath)) {
    Write-Host "✗ Error: logo.png not found!" -ForegroundColor Red
    exit 1
}

Add-Type -AssemblyName System.Drawing

function Create-Favicon {
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

# Create standard favicon sizes
Write-Host "[1/4] Creating favicon PNG files..." -ForegroundColor Yellow

$sizes = @(
    @{Size=16; Name="favicon-16x16.png"},
    @{Size=32; Name="favicon-32x32.png"},
    @{Size=48; Name="favicon-48x48.png"},
    @{Size=64; Name="favicon-64x64.png"}
)

foreach ($item in $sizes) {
    $outputPath = Join-Path $publicDir $item.Name
    if (Create-Favicon -SourcePath $sourcePath -OutputPath $outputPath -Size $item.Size) {
        Write-Host "  ✓ Created $($item.Name)" -ForegroundColor Green
    }
}

# Create Apple Touch Icon (180x180)
Write-Host ""
Write-Host "[2/4] Creating Apple Touch Icon..." -ForegroundColor Yellow
$appleTouchPath = Join-Path $publicDir "apple-touch-icon.png"
if (Create-Favicon -SourcePath $sourcePath -OutputPath $appleTouchPath -Size 180) {
    Write-Host "  ✓ Created apple-touch-icon.png (180x180)" -ForegroundColor Green
}

# Create Android Chrome icons
Write-Host ""
Write-Host "[3/4] Creating Android Chrome icons..." -ForegroundColor Yellow

$androidSizes = @(192, 512)
foreach ($size in $androidSizes) {
    $outputPath = Join-Path $publicDir "android-chrome-${size}x${size}.png"
    if (Create-Favicon -SourcePath $sourcePath -OutputPath $outputPath -Size $size) {
        Write-Host "  ✓ Created android-chrome-${size}x${size}.png" -ForegroundColor Green
    }
}

# Create a simple favicon.ico (16x16 + 32x32)
Write-Host ""
Write-Host "[4/4] Creating favicon.ico..." -ForegroundColor Yellow

# For .ico, we'll just copy the 32x32 version and rename it
# A proper .ico would need multiple sizes embedded, but this works for most browsers
$favicon32Path = Join-Path $publicDir "favicon-32x32.png"
$faviconIcoPath = Join-Path $publicDir "favicon.ico"

if (Test-Path $favicon32Path) {
    Copy-Item $favicon32Path $faviconIcoPath -Force
    Write-Host "  ✓ Created favicon.ico (32x32)" -ForegroundColor Green
    Write-Host "  ℹ Note: This is a PNG renamed as .ico" -ForegroundColor Gray
    Write-Host "         Modern browsers support this format" -ForegroundColor Gray
}

# Create a web app manifest
Write-Host ""
Write-Host "[5/5] Creating site.webmanifest..." -ForegroundColor Yellow

$manifest = @{
    name = "Amen"
    short_name = "Amen"
    description = "Premium local audio downloader and studio"
    icons = @(
        @{
            src = "/android-chrome-192x192.png"
            sizes = "192x192"
            type = "image/png"
        },
        @{
            src = "/android-chrome-512x512.png"
            sizes = "512x512"
            type = "image/png"
        }
    )
    theme_color = "#3385ff"
    background_color = "#0a0a11"
    display = "standalone"
    start_url = "/"
}

$manifestPath = Join-Path $publicDir "site.webmanifest"
$manifest | ConvertTo-Json -Depth 10 | Set-Content $manifestPath -Encoding UTF8

Write-Host "  ✓ Created site.webmanifest" -ForegroundColor Green

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  ✓ All favicons created successfully!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Files created:" -ForegroundColor White
Write-Host "  • favicon-16x16.png" -ForegroundColor Gray
Write-Host "  • favicon-32x32.png" -ForegroundColor Gray
Write-Host "  • favicon-48x48.png" -ForegroundColor Gray
Write-Host "  • favicon-64x64.png" -ForegroundColor Gray
Write-Host "  • favicon.ico" -ForegroundColor Gray
Write-Host "  • apple-touch-icon.png (180x180)" -ForegroundColor Gray
Write-Host "  • android-chrome-192x192.png" -ForegroundColor Gray
Write-Host "  • android-chrome-512x512.png" -ForegroundColor Gray
Write-Host "  • site.webmanifest" -ForegroundColor Gray
Write-Host ""
