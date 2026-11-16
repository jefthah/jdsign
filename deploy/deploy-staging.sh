#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 1 && $1 =~ ^[0-9a-f]{40}$ ]] || exit 2
readonly release="$1" root=/opt/jdsign/staging
cd "$root"
exec 9>"$root/deploy.lock"
flock -w 900 9
archive=$(mktemp "$root/incoming/images.XXXXXXXX.tar.gz")
trap 'rm -f -- "$archive"' EXIT
# Bound upload size to 2 GiB. No files are extracted onto the host.
head -c 2147483649 > "$archive"
[[ $(stat -c %s "$archive") -le 2147483648 ]] || { echo 'Upload exceeds 2 GiB' >&2; exit 1; }
python3 - "$archive" "$release" <<'PY'
import json, sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    manifest = json.load(archive.extractfile('manifest.json'))
tags = [tag for item in manifest for tag in item.get('RepoTags', [])]
expected = sorted(['jdsign-api:' + sys.argv[2], 'jdsign-web:' + sys.argv[2]])
if len(manifest) != 2 or sorted(tags) != expected:
    raise SystemExit('Archive must contain only the two JD Sign release images')
PY
docker load --input "$archive"
export RELEASE_SHA="$release"
compose() { docker compose --env-file "$root/.env" -f "$root/compose.yml" "$@"; }
previous=$(cat "$root/current-release" 2>/dev/null || true)
compose up -d --wait --wait-timeout 120 postgres
if [[ -n "$previous" ]]; then
    compose exec -T postgres pg_dump -U jdsign -d jdsign -Fc > "$root/backups/$(date -u +%Y%m%dT%H%M%SZ)-$previous.dump"
fi
# Schema changes must remain compatible with the preceding release.
# A failed migration stops deployment. Never automatically roll a schema back.
compose run --rm --no-deps api migrate up
healthy=false
if compose up -d --wait --wait-timeout 120 api web; then
    if curl --fail --silent --max-time 15 http://127.0.0.1:18300/api/v1/health && \
       curl --fail --silent --max-time 15 http://127.0.0.1:18300/api/v1/categories > /dev/null && \
       curl --fail --silent --max-time 30 http://127.0.0.1:13300/ | grep -F 'Marketplace template website' > /dev/null; then
        healthy=true
    fi
fi
if [[ "$healthy" != true ]]; then
    compose ps
    if [[ "$previous" =~ ^[0-9a-f]{40}$ ]]; then
        echo "Deployment failed; restoring application images $previous" >&2
        export RELEASE_SHA="$previous"
        compose up -d --wait --wait-timeout 120 api web
    fi
    exit 1
fi
printf '%s\n' "$release" > "$root/current-release.tmp"
mv "$root/current-release.tmp" "$root/current-release"
printf '%s %s\n' "$(date -u +%FT%TZ)" "$release" >> "$root/releases.log"
echo "JD Sign staging deployed: $release"
