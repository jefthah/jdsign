#!/usr/bin/env bash
# Installs compose.staging.yml and adds any missing generated secrets to .env.
# Safe to re-run. Run as root after changing either: sudo bash deploy/apply-staging-config.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 2; }
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
root=/opt/jdsign/staging
env_file="$root/.env"
install -d -m 755 /opt/jdsign "$root"
umask 077
touch "$env_file"
chmod 600 "$env_file"
if [[ -s "$env_file" && -n "$(tail -c 1 "$env_file")" ]]; then
    printf '\n' >> "$env_file"
fi
for name in POSTGRES_PASSWORD LOGIN_CODE_SECRET; do
    if ! grep -q "^${name}=" "$env_file"; then
        printf '%s=%s\n' "$name" "$(openssl rand -hex 32)" >> "$env_file"
        echo "Generated $name in $env_file"
    fi
done
# Numbered AES-256 keys; the first one encrypts. Back up .env: without this key, admin
# authenticators (and later bank details) cannot be decrypted.
if ! grep -q '^ENCRYPTION_KEYS=' "$env_file"; then
    printf 'ENCRYPTION_KEYS=1:%s\n' "$(openssl rand -hex 32)" >> "$env_file"
    echo "Generated ENCRYPTION_KEYS in $env_file - back up this file"
fi
release=$(cat "$root/current-release" 2>/dev/null || printf '%040d' 0)
RELEASE_SHA="$release" docker compose --env-file "$env_file" -f "$src/compose.staging.yml" config --quiet
install -m 644 "$src/compose.staging.yml" "$root/compose.yml"
echo 'Staging configuration installed. The next deploy applies it.'
