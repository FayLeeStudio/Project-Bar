#!/usr/bin/env bash
# Time in the Bottle — one-shot deploy for a fresh Ubuntu/Debian overseas VPS.
# Run ON the VPS as root (or with sudo). Prereqs:
#   1) the repo is already here — clone it, then run this script from inside it:
#        git clone <repo-url> /opt/titb && cd /opt/titb && sudo server/deploy.sh <domain>
#      (git clone keeps this script LF via .gitattributes; if you scp instead and
#       bash complains about '\r', run:  sed -i 's/\r$//' server/deploy.sh)
#   2) your domain's A record already points at THIS VPS's public IP
# Usage:  sudo server/deploy.sh titb.indiegames.design
set -euo pipefail

DOMAIN="${1:?usage: sudo server/deploy.sh <domain>   e.g. titb.indiegames.design}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # repo root (this script lives in server/)
PORT=8090

echo "==> app dir: $APP_DIR    domain: $DOMAIN    port: $PORT"

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
Description=Time in the Bottle authoritative server
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
systemctl enable --now titb

# 4) Caddy — automatic HTTPS (Let's Encrypt) + reverse proxy; upgrades WebSocket
if ! command -v caddy >/dev/null 2>&1; then
  echo "==> installing Caddy"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update && apt-get install -y caddy
fi
echo "==> writing /etc/caddy/Caddyfile"
cat >/etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    reverse_proxy 127.0.0.1:$PORT
}
CADDY
systemctl restart caddy

cat <<DONE

==> done. verify:
    systemctl status titb --no-pager
    curl -s https://$DOMAIN/            # → "Time in the Bottle authoritative server"
Then in index.html set:  PROD_HOST = "$DOMAIN"   (wss), and push to Pages.
NOTE: open port 443 (and 22) in your cloud provider's security group.
DONE
