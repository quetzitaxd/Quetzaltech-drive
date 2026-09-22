#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="/srv/backups/quetzaltech-drive"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

for path in "$project_dir/data" "$project_dir/.env" "$project_dir/compose.yaml"; do
  if [[ ! -e "$path" ]]; then
    printf 'Falta el elemento requerido para respaldar: %s\n' "${path##*/}" >&2
    exit 1
  fi
done

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$backup_dir/quetzaltech-drive-$stamp.tar.gz"
temporary="$archive.partial"
was_running=0
if docker compose -f "$project_dir/compose.yaml" -p quetzaltech-drive ps --status running --services | grep -Fxq app; then
  was_running=1
fi
restart_app() {
  if (( was_running )); then
    docker compose -f "$project_dir/compose.yaml" -p quetzaltech-drive start app
  fi
}
cleanup() {
  rm -f -- "$temporary"
  restart_app
}
trap cleanup EXIT INT TERM

# Stop only this project's app so SQLite, WAL/SHM, and files form a consistent snapshot.
if (( was_running )); then
  docker compose -f "$project_dir/compose.yaml" -p quetzaltech-drive stop --timeout 30 app
fi
tar -czf "$temporary" -C "$project_dir" data .env compose.yaml
chmod 600 "$temporary"
mv -- "$temporary" "$archive"
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive.sha256"
printf 'Copia creada: %s\n' "$archive"
