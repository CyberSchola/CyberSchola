#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 24.04 server for the staging demo.
#
#   sudo DOMAIN=api.example.com EMAIL=you@example.com ./bootstrap-host.sh
#
# Installs Docker from Docker's own apt repository, Nginx and Certbot from
# Ubuntu's, adds swap so a 2 GB server can compile the API, installs the Nginx
# site, obtains a Let's Encrypt certificate, and schedules the nightly demo
# reset. Safe to run again: every step checks before it acts.
set -euo pipefail

DOMAIN="${DOMAIN:?DOMAIN is required, such as api.example.com}"
EMAIL="${EMAIL:?EMAIL is required for certificate expiry notices}"
HERE="$(cd "$(dirname "$0")" && pwd)"

export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg nginx certbot python3-certbot-nginx git openssl

if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

echo "== swap"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== nginx site"
sed "s/__DOMAIN__/${DOMAIN}/g" "$HERE/nginx.conf.template" > /etc/nginx/sites-available/cyberschola
ln -sf /etc/nginx/sites-available/cyberschola /etc/nginx/sites-enabled/cyberschola
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "== certificate"
if [ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
fi

echo "== nightly demo reset, 03:00 UTC"
cat > /etc/cron.d/cyberschola-demo-reset <<CRON
0 3 * * * root docker compose --env-file /opt/cyberschola/staging.env -f ${HERE}/docker-compose.yml --profile tasks run --rm seed >> /var/log/cyberschola-demo-reset.log 2>&1
CRON
chmod 644 /etc/cron.d/cyberschola-demo-reset

echo "== done. Next: sudo DOMAIN=${DOMAIN} ${HERE}/deploy.sh"
