# Amen - Quick Start Script
# This script helps you build and run the Amen application

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "     AMEN - Quick Start Script" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "[1/4] Checking Node.js..." -ForegroundColor Yellow
$nodeVersion = node --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Node.js found: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "  ✗ Node.js not found!" -ForegroundColor Red
    Write-Host "  Download from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check Cargo (Rust)
Write-Host "[2/4] Checking Rust..." -ForegroundColor Yellow
$cargoVersion = cargo --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Rust found: $cargoVersion" -ForegroundColor Green
} else {
    Write-Host "  ✗ Rust not found!" -ForegroundColor Red
    Write-Host "  " -ForegroundColor Yellow
    Write-Host "  To install Rust, run this command:" -ForegroundColor Yellow
    Write-Host "  " -ForegroundColor Yellow
    Write-Host "  Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile 'rustup-init.exe'; .\rustup-init.exe" -ForegroundColor Green
    Write-Host "  " -ForegroundColor Yellow
    Write-Host "  After installation:" -ForegroundColor Yellow
    Write-Host "  1. Close this terminal" -ForegroundColor Yellow
    Write-Host "  2. Open a new terminal" -ForegroundColor Yellow
    Write-Host "  3. Run this script again" -ForegroundColor Yellow
    exit 1
}

# Check if node_modules exists
Write-Host "[3/4] Checking dependencies..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    Write-Host "  ✓ Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  ! Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ Failed to install dependencies" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✓ Dependencies installed" -ForegroundColor Green
}

Write-Host "[4/4] Ready to build!" -ForegroundColor Yellow
Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Choose an option:" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Run in Development Mode (recommended)" -ForegroundColor White
Write-Host "   - Fast startup after first build" -ForegroundColor Gray
Write-Host "   - Hot reload enabled" -ForegroundColor Gray
Write-Host "   - Good for testing" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Build Production Installer" -ForegroundColor White
Write-Host "   - Creates .exe installer" -ForegroundColor Gray
Write-Host "   - Takes longer to build" -ForegroundColor Gray
Write-Host "   - Optimized performance" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Exit" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Enter your choice (1, 2, or 3)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "Starting development mode..." -ForegroundColor Green
        Write-Host ""
        Write-Host "NOTE: First build takes 8-10 minutes!" -ForegroundColor Yellow
        Write-Host "      Subsequent runs are much faster." -ForegroundColor Yellow
        Write-Host ""
        npm run tauri:dev
    }
    "2" {
        Write-Host ""
        Write-Host "Building production installer..." -ForegroundColor Green
        Write-Host ""
        Write-Host "NOTE: This takes 12-15 minutes!" -ForegroundColor Yellow
        Write-Host ""
        npm run tauri:build
        Write-Host ""
        Write-Host "===============================================" -ForegroundColor Cyan
        Write-Host "Build complete!" -ForegroundColor Green
        Write-Host "===============================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Installer location:" -ForegroundColor White
        Write-Host "src-tauri\target\release\bundle\nsis\Amen_0.1.0_x64-setup.exe" -ForegroundColor Green
    }
    "3" {
        Write-Host "Exiting..." -ForegroundColor Gray
        exit 0
    }
    default {
        Write-Host "Invalid choice. Exiting..." -ForegroundColor Red
        exit 1
    }
}
