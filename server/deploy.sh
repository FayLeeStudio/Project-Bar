#!/usr/bin/env bash
# Sand Together — deploy for a fresh Ubuntu/Debian overseas VPS.
# Run ON the VPS as root (sudo). The repo must already be here (git clone it,
# then run from inside the repo root). Two modes:
#
#   sudo server/deploy.sh
#       → pure-IP TEST mode: node + systemd on :8090, no TLS. Open :8090 in your
#         cloud security group, then from any browser:  http://<vps-ip>:8090/?room=TEST
#
#   sudo server/deploy.sh titb.example.com
#       → PRODUCTION: also installs Caddy (auto Let's Encrypt TLS + wss reverse
#         proxy). The domain's A record must already point at this VPS.
#
# (If you scp'd the repo and bash trips on '\r', run:  sed -i 's/\r$//' server/deploy.sh)
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # repo root (this script lives in server/)
PORT=8090
echo "==> app: $APP_DIR   domain: ${DOMAIN:-<none — pure-IP test>}   port: $PORT"

# 1) Node.js LTS (22.x)
if ! command -v node >/dev/null 2>&1; then
  echo "==> installing Node.js 22.x"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# 2) dependencies (just ws)
echo "==> npm install --omit=dev"
cd "$APP_DIR" && npm install --omit=dev

# 3) systemd unit — keep node running, restart on crash, start on boot
echo "==> writing /etc/systemd/system/titb.service"
cat >/etc/systemd/system/titb.service <<UNIT
[Unit]
Description=Sand Together authoritative server
After=network.target

[Service]
ExecStart=/usr/bin/node $APP_DIR/server/index.js
Environment=PORT=$PORT
WorkingDirectory=$APP_DIR
Restart=always
RestartSec=2
User=root

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable titb
systemctl restart titb   # restart so a fresh git pull's code is actually picked up

# 4) Caddy only when a domain is given (auto HTTPS + wss reverse proxy)
if [ -n "$DOMAIN" ]; then
  if ! command -v caddy >/dev/null 2>&1; then
    echo "==> installing Caddy"
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update && apt-get install -y caddy
  fi
  echo "==> writing /etc/caddy/Caddyfile for $DOMAIN"
  cat >/etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    reverse_proxy 127.0.0.1:$PORT
}
CADDY
  systemctl restart caddy
  cat <<DONE

==> done (PRODUCTION). verify:
    systemctl status titb --no-pager
    curl -s https://$DOMAIN/            # → "Sand Together authoritative server"
Then set index.html PROD_HOST = "$DOMAIN" (wss) and redeploy (git pull + systemctl restart titb).
DONE
else
  cat <<DONE

==> done (PURE-IP TEST). verify:
    systemctl status titb --no-pager
    curl -s http://127.0.0.1:$PORT/ | head -c 40    # → "<!DOCTYPE html..."
Open port $PORT in your cloud security group, then from any browser (you + friends):
    http://<this-vps-public-ip>:$PORT/?room=TEST
DONE
fi
