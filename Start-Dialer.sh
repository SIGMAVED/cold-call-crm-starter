#!/usr/bin/env bash
# Linux/Ubuntu equivalent of Start-Dialer.ps1 (Windows PowerShell supervisor).
# Starts and *watches* both the app and the ngrok tunnel, restarting either
# within ~15s if it dies. Without the tunnel, Twilio can't reach the server
# and every call fails with "an application error has occurred" - which is
# why this babysits them.
#
# Run manually: ./Start-Dialer.sh
# Or register as a systemd user service / autostart entry to match the old
# "runs on login" behavior from the Windows Startup folder.
set -u

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

ngrok="$root/tools/ngrok"
ngrok_config="$root/tools/ngrok-crm.yml"
domain="your-static-domain.ngrok-free.dev"
log_dir="$root/logs"
mkdir -p "$log_dir"
dev_log="$log_dir/dev.log"

port_listening() {
  ss -ltn "( sport = :$1 )" 2>/dev/null | grep -q ":$1"
}

ngrok_up() {
  curl -sf --max-time 3 http://127.0.0.1:4040/api/tunnels >/dev/null 2>&1
}

echo "Cold Call Dialer supervisor started. Leave this terminal open while calling."

while true; do
  if ! port_listening 4001; then
    echo "$(date '+%H:%M:%S')  starting CRM server + web app..."
    {
      echo ""
      echo "----- $(date '+%Y-%m-%d %H:%M:%S') restart -----"
    } >> "$dev_log"
    (cd "$root" && nohup npm run dev >> "$dev_log" 2>&1 &)
    sleep 8
  fi

  if ! ngrok_up; then
    echo "$(date '+%H:%M:%S')  starting ngrok tunnel..."
    (cd "$root" && nohup "$ngrok" http 4001 --url "$domain" --config "$ngrok_config" >> "$log_dir/ngrok.log" 2>&1 &)
    sleep 5
  fi

  sleep 15
done
