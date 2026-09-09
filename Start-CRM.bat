@echo off
title Cold Call CRM
cd /d "%~dp0"

echo Starting Cold Call CRM...
echo (Close this window to stop the CRM)
echo.

REM A leftover server from a previous run holds port 4001, the new one dies on
REM EADDRINUSE, and concurrently -k then tears the client down too — which
REM looked like the window closing by itself. Clear the ports first.
for %%P in (4001 5173) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do (
    echo   freeing port %%P ^(pid %%A^)...
    taskkill /f /pid %%A >nul 2>&1
  )
)

start "" cmd /c "timeout /t 4 >nul && start http://localhost:5173"

call npm run dev

REM npm run dev only returns when something has gone wrong. Hold the window
REM open so the error is readable instead of flashing past on the way out.
echo.
echo ================================================
echo  The CRM stopped. The error above explains why.
echo ================================================
pause
