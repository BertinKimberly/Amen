@echo off
echo ================================================
echo   FINAL ICON FIX - This WILL Work!
echo ================================================
echo.

echo [1/5] Stopping Amen process...
taskkill /f /im amen.exe 2>nul
timeout /t 2 >nul

echo [2/5] Killing Explorer to clear icon cache...
taskkill /f /im explorer.exe
timeout /t 2 >nul

echo [3/5] Deleting icon cache database...
del /f /q "%LOCALAPPDATA%\IconCache.db" 2>nul
del /f /q "%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db" 2>nul
del /f /q "%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db" 2>nul

echo [4/5] Restarting Explorer...
start explorer.exe
timeout /t 3 >nul

echo [5/5] Clean rebuild with correct icons...
echo.
echo IMPORTANT: The icon files have been fixed!
echo Your Amen logo was NOT in the icon.png file before.
echo Now it's been copied and all icons regenerated.
echo.
echo Starting rebuild (8-10 minutes)...
echo.

REM Clean build
cd src-tauri
if exist target (
    rmdir /s /q target 2>nul
)
cd ..

REM Add Cargo to PATH
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

REM Start dev build
npm run tauri:dev

pause
