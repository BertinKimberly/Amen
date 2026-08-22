# Create Favicon from Logo
# This script creates a 32x32 favicon from the logo.png

Write-Host "Creating favicon from logo..." -ForegroundColor Cyan

$sourcePath = "$PSScriptRoot\..\public\logo.png"
$outputPath = "$PSScriptRoot\..\public\favicon-32x32.png"
$size = 32

# Load the image
Add-Type -AssemblyName System.Drawing

try {
    # Load source image
    $sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
    
    # Create new bitmap with target size
    $targetImage = New-Object System.Drawing.Bitmap($size, $size)
    
    # Create graphics object
    $graphics = [System.Drawing.Graphics]::FromImage($targetImage)
    
    # Set high quality rendering
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    # Draw resized image
    $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
    
    # Save as PNG
    $targetImage.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    # Cleanup
    $graphics.Dispose()
    $targetImage.Dispose()
    $sourceImage.Dispose()
    
    Write-Host "✓ Favicon created successfully!" -ForegroundColor Green
    Write-Host "  Location: $outputPath" -ForegroundColor Gray
    Write-Host "  Size: 32x32 pixels" -ForegroundColor Gray
    
    # Also create 16x16 version for browser tab
    $size16 = 16
    $output16Path = "$PSScriptRoot\..\public\favicon-16x16.png"
    
    $sourceImage2 = [System.Drawing.Image]::FromFile($sourcePath)
    $targetImage16 = New-Object System.Drawing.Bitmap($size16, $size16)
    $graphics16 = [System.Drawing.Graphics]::FromImage($targetImage16)
    
    $graphics16.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics16.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics16.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics16.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    $graphics16.DrawImage($sourceImage2, 0, 0, $size16, $size16)
    $targetImage16.Save($output16Path, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $graphics16.Dispose()
    $targetImage16.Dispose()
    $sourceImage2.Dispose()
    
    Write-Host "✓ 16x16 favicon created!" -ForegroundColor Green
    Write-Host "  Location: $output16Path" -ForegroundColor Gray
    
} catch {
    Write-Host "✗ Error creating favicon: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Done! Your favicon is ready." -ForegroundColor Cyan
