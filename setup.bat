@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

title AI Video Creator - Setup

echo ============================================================
echo   AI Video Creator - one-click setup
echo ============================================================
echo.
echo This will:
echo   1. Make sure Node.js is installed (uses winget if missing).
echo   2. Install npm dependencies.
echo   3. Rebuild native modules for Electron.
echo   4. Install the HeyGen Hyperframes CLI skill.
echo.
echo Working folder: %CD%
echo.
pause

REM ------------------------------------------------------------
REM 1. Node.js check
REM ------------------------------------------------------------
echo.
echo [1/4] Checking for Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo   Node.js NOT found.
    echo   Trying to install Node.js LTS via winget...
    where winget >nul 2>nul
    if errorlevel 1 (
        echo.
        echo   winget is not available on this PC.
        echo   Please install Node.js LTS manually from https://nodejs.org/
        echo   then re-run this setup script.
        echo.
        pause
        exit /b 1
    )
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo   winget failed to install Node.js. Install it manually from https://nodejs.org/
        echo   then re-run this setup script.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo   Node.js installed. You may need to CLOSE this window and re-run
    echo   setup.bat so the new PATH is picked up.
    echo.
    pause
    exit /b 0
) else (
    for /f "delims=" %%v in ('node --version') do set NODE_VER=%%v
    echo   OK: Node.js !NODE_VER!
)

where npm >nul 2>nul
if errorlevel 1 (
    echo   npm is not on PATH. Close this window and reopen, then re-run setup.bat.
    pause
    exit /b 1
)

REM ------------------------------------------------------------
REM 2. npm install
REM ------------------------------------------------------------
echo.
echo [2/4] Installing npm dependencies (this can take a few minutes)...
call npm install
if errorlevel 1 (
    echo.
    echo   npm install FAILED. Scroll up to see why.
    echo   Common cause: missing Microsoft C++ Build Tools - install from
    echo   https://visualstudio.microsoft.com/visual-cpp-build-tools/ and retry.
    pause
    exit /b 1
)

REM ------------------------------------------------------------
REM 3. Rebuild native modules
REM ------------------------------------------------------------
echo.
echo [3/4] Rebuilding native modules for Electron...
call npm run rebuild
if errorlevel 1 (
    echo.
    echo   Native rebuild FAILED. better-sqlite3 may not load.
    echo   You can still try running start.bat - if it crashes, install
    echo   Microsoft C++ Build Tools and re-run setup.bat.
    pause
)

REM ------------------------------------------------------------
REM 4. Hyperframes skill
REM ------------------------------------------------------------
echo.
echo [4/4] Installing HeyGen Hyperframes CLI skill...
call npx --yes skills add heygen-com/hyperframes
if errorlevel 1 (
    echo.
    echo   Hyperframes install FAILED. The app will still launch, but rendering
    echo   will not work until 'npx hyperframes --help' succeeds. Retry:
    echo     npx skills add heygen-com/hyperframes
    pause
)

echo.
echo ============================================================
echo   Setup complete.
echo ============================================================
echo.
echo   Double-click start.bat to launch AI Video Creator.
echo.
pause
endlocal
