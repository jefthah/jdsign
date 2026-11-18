#!/usr/bin/env bash
# One-time installation: sudo bash bootstrap-staging.sh PUBLIC_KEY_FILE
set -euo pipefail
[[ $EUID -eq 0 && $# -eq 1 ]] || { echo 'Run as root with a deploy public-key file.' >&2; exit 2; }
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
key=$(cat -- "$1")
[[ "$key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+([[:space:]].*)?$ ]] || exit 2
for command in docker caddy python3 curl openssl flock visudo; do command -v "$command" >/dev/null; done
docker compose version
root=/opt/jdsign/staging
if ! id jdsign >/dev/null 2>&1; then useradd --create-home --shell /bin/bash jdsign; fi
install -d -m 755 /opt/jdsign "$root"
install -d -m 700 "$root/incoming" "$root/backups"
bash "$src/deploy/apply-staging-config.sh"
install -m 755 "$src/deploy/deploy-staging.sh" /usr/local/sbin/jdsign-staging-deploy
install -d -m 755 /usr/local/libexec
install -m 755 "$src/deploy/receive.sh" /usr/local/libexec/jdsign-staging-receive
install -d -m 700 -o jdsign -g jdsign /home/jdsign/.ssh
authfile=/home/jdsign/.ssh/authorized_keys
if [[ -s "$authfile" ]] && ! grep -qF "$key" "$authfile"; then
    echo 'Existing jdsign authorized_keys differs; inspect before replacing.' >&2; exit 1
fi
printf 'restrict,command="/usr/local/libexec/jdsign-staging-receive" %s\n' "$key" > "$authfile"
chown jdsign:jdsign "$authfile"
chmod 600 "$authfile"
sudoers=$(mktemp)
printf 'jdsign ALL=(root) NOPASSWD: /usr/local/sbin/jdsign-staging-deploy *\n' > "$sudoers"
visudo -cf "$sudoers"
install -m 440 "$sudoers" /etc/sudoers.d/jdsign-staging
rm -f "$sudoers"
site=/etc/caddy/sites/jdsign-staging.caddy
backup="${site}.backup-$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -e "$site" ]]; then cp -p "$site" "$backup"; fi
install -m 644 "$src/deploy/staging.caddy" "$site"
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
    if [[ -f "$backup" ]]; then mv "$backup" "$site"; else rm -f "$site"; fi
    exit 1
fi
systemctl reload caddy
echo 'JD Sign staging bootstrap complete. GitHub Actions can deploy now.'
