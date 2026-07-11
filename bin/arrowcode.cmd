@echo off
setlocal
set "ROOT=%~dp0.."
where bun >nul 2>nul
if errorlevel 1 (
  echo ArrowCode requires Bun. Install: https://bun.sh
  exit /b 1
)
bun "%ROOT%\src\index.ts" %*
