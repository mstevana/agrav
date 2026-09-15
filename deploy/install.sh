#!/usr/bin/env bash
# Installs the AGRAV games server on Ubuntu 22.04 / 24.04.
#   sudo bash deploy/install.sh [git-url] [domain]
# What it does: Node 22 from NodeSource, a system user, the checkout in
# /opt/agrav, production dependencies, the systemd unit, nginx + the site
# config, ufw. TLS: run certbot afterwards (printed at the end).
set -euo pipefail
REPO="${1:-https://github.com/mstevana/agrav.git}"
DOMAIN="${2:-games.example.com}"
DEST=/opt/agrav

if [ "$(id -u)" -ne 0 ]; then echo "run as root (sudo)"; exit 1; fi

echo "== packages"
apt-get update -y
apt-get install -y ca-certificates curl git nginx ufw
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== user + checkout"
id -u agrav >/dev/null 2>&1 || useradd --system --home "$DEST" --shell /usr/sbin/nologin agrav
if [ -d "$DEST/.git" ]; then git -C "$DEST" pull --ff-only; else git clone "$REPO" "$DEST"; fi
cd "$DEST"
npm install --omit=dev --no-audit --no-fund
chown -R agrav:agrav "$DEST"

echo "== systemd"
cp deploy/agrav.service /etc/systemd/system/agrav.service
systemctl daemon-reload
systemctl enable --now agrav
sleep 1
systemctl --no-pager --lines=5 status agrav || true

echo "== nginx"
sed "s/games.example.com/$DOMAIN/g" deploy/nginx.conf > /etc/nginx/sites-available/agrav
ln -sf /etc/nginx/sites-available/agrav /etc/nginx/sites-enabled/agrav
rm -f /etc/nginx/sites-enabled/default
# until certbot has issued a certificate, serve plain http on 80
sed -i 's/^\s*return 301 https.*$/    root \/opt\/agrav; index index.html; location \/api\/ { proxy_pass http:\/\/127.0.0.1:8080; } location \/ws { proxy_pass http:\/\/127.0.0.1:8080; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 3600s; }/' /etc/nginx/sites-available/agrav
nginx -t && systemctl reload nginx

echo "== firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo
echo "Installed. Health: curl -s http://127.0.0.1:8080/api/health"
echo "TLS:      apt-get install -y certbot python3-certbot-nginx && certbot --nginx -d $DOMAIN"
echo "Update:   cd $DEST && git pull && npm install --omit=dev && systemctl restart agrav"
