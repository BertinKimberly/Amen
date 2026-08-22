@echo off
echo ===============================================
echo   AMEN - Building Production Installer
echo ===============================================
echo.

REM Add Cargo to PATH
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

REM Verify Cargo is available
cargo --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Rust/Cargo not found!
    echo.
    echo Please install Rust from: https://rustup.rs/
    echo Then restart this script.
    pause
    exit /b 1
)

echo Cargo found! Starting production build...
echo.
echo NOTE: This takes 12-15 minutes!
echo       Please be patient...
echo.

REM Build the production installer
npm run tauri:build

echo.
echo ===============================================
echo Build Complete!
echo ===============================================
echo.
echo Installer location:
echo src-tauri\target\release\bundle\nsis\Amen_0.1.0_x64-setup.exe
echo.

pause
