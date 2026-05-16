@echo off
setlocal
cd /d "%~dp0"

title AI Video Creator

REM Make sure setup ran at least once.
if not exist "node_modules\electron\package.json" (
    echo node_modules is missing or incomplete.
    echo Run setup.bat first.
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not on PATH. Run setup.bat first, or install Node.js LTS
    echo from https://nodejs.org/ and reopen this window.
    pause
    exit /b 1
)

echo Launching AI Video Creator...
echo (Keep this window open while the app is running - closing it kills the app.)
echo.

call npm run dev
set EXITCODE=%ERRORLEVEL%

if not %EXITCODE%==0 (
    echo.
    echo The app exited with code %EXITCODE%.
    pause
)

endlocal
