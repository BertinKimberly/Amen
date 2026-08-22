@echo off
echo ================================================
echo   AMEN - Clean Rebuild with New Icon
echo ================================================
echo.

REM Add Cargo to PATH
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

echo [1/4] Stopping any running Amen processes...
taskkill /f /im amen.exe 2>nul
timeout /t 2 >nul

echo [2/4] Clearing Windows icon cache...
taskkill /f /im explorer.exe 2>nul
timeout /t 2 >nul
start explorer.exe
timeout /t 2 >nul

echo [3/4] Cleaning build cache...
cd src-tauri
if exist target (
    echo Removing old build files...
    rmdir /s /q target 2>nul
)
cd ..

echo [4/4] Starting clean build...
echo.
echo NOTE: This will take 8-10 minutes since we're rebuilding from scratch.
echo       But the new icon will definitely be applied!
echo.
npm run tauri:dev

pause
