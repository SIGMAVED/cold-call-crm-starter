# Starts everything the dialer needs and keeps it running:
#   - CRM API server + web app (npm run dev)
#   - ngrok tunnel on the static domain Twilio is configured to call
#
# Both are watched in a loop: if either dies, it's restarted within ~15s.
# Without the tunnel, Twilio can't reach the server and every call fails with
# "an application error has occurred" — which is why this babysits them.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
# Lives here, not the WinGet-managed install — Quick Heal's Behavior Detection
# repeatedly deleted the WinGet copy as "Trojan.Ngrok" (a known false positive
# for ngrok binaries) every time it self-updated. Named crm-tunnel-agent.exe,
# not ngrok.exe — keep this name; it's whitelisted under Quick Heal's Advanced
# Settings exclusion, and a plain "ngrok.exe" landing back in this folder is
# not guaranteed to be covered by the same rule. ngrokConfig below points at a
# project-only ngrok account so it never fights with other ngrok usage (e.g.
# n8n) for the same tunnel session.
$ngrok = Join-Path $root 'tools\crm-tunnel-agent.exe'
$ngrokConfig = Join-Path $root 'tools\ngrok-crm.yml'
$domain = 'your-static-domain.ngrok-free.dev'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$devLog = Join-Path $logDir 'dev.log'

function Test-Port($port) {
  $null -ne (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Test-Ngrok {
  try { $null = Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3; $true } catch { $false }
}

Write-Host 'Cold Call Dialer supervisor started. Leave this window open while calling.' -ForegroundColor Cyan

while ($true) {
  if (-not (Test-Port 4001)) {
    Write-Host "$(Get-Date -Format 'HH:mm:ss')  starting CRM server + web app..." -ForegroundColor Yellow
    "`n----- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') restart -----" | Add-Content -Path $devLog
    # >> $devLog 2>&1 inside the cmd.exe command so a crash actually leaves a
    # trail — previously this ran in a minimized window with output nowhere,
    # so every past crash was invisible.
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npm run dev >> `"$devLog`" 2>&1" -WorkingDirectory $root -WindowStyle Minimized
    Start-Sleep -Seconds 8
  }

  if (-not (Test-Ngrok)) {
    Write-Host "$(Get-Date -Format 'HH:mm:ss')  starting ngrok tunnel..." -ForegroundColor Yellow
    # A bad/missing path here previously threw a TERMINATING exception that
    # killed the whole supervisor loop (and its window) — the exact bug that
    # made the dialer stop "for no reason": the CRM would come up fine on the
    # first pass, then this line silently took down the thing watching it.
    try {
      # Passed as one pre-quoted string, not a separate -ArgumentList element —
      # this path contains a space ("VED's AI") and Start-Process has been
      # observed splitting it into two arguments otherwise, which ngrok then
      # rejects as "too many arguments".
      $ngrokArgs = "http 4001 --url $domain --config `"$ngrokConfig`""
      Start-Process -FilePath $ngrok -ArgumentList $ngrokArgs -WindowStyle Minimized
    } catch {
      Write-Host "$(Get-Date -Format 'HH:mm:ss')  ngrok failed to start: $_" -ForegroundColor Red
    }
    Start-Sleep -Seconds 5
  }

  Start-Sleep -Seconds 15
}
