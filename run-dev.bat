@echo off
echo ===============================================
echo      AMEN - Starting Development Mode
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

echo Cargo found! Starting build...
echo.
echo NOTE: First build takes 8-10 minutes!
echo       Please be patient...
echo.

REM Run the dev server
npm run tauri:dev

pause
