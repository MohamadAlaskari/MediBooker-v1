@echo off
rem The control menu of the Docker stacks: double-click it or run it in a terminal.
rem Arguments go through: medibooker dev up. It needs Node.js and Docker Desktop.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt. Bitte Node.js 26 installieren: https://nodejs.org
  pause
  exit /b 1
)
node scripts\medibooker.ts %*
set "code=%errorlevel%"
rem A double-click closes the window at once; keep a failure readable.
if not "%code%"=="0" if "%~1"=="" pause
exit /b %code%
