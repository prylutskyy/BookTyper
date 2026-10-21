@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Потрібен Node.js. На цьому комп'ютері він був установлений під час розробки.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
if not exist dist\index.html (
  call npm.cmd run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node scripts\serve.mjs --open
if errorlevel 1 pause
