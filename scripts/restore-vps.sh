#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
allowed_dir="/srv/backups/quetzaltech-drive"
archive="${1:-}"
if [[ -z "$archive" || "$archive" != "$allowed_dir"/* || ! -f "$archive" || ! -f "$archive.sha256" ]]; then
  printf 'Indica una copia existente dentro de %s (sin extensión .sha256).\n' "$allowed_dir" >&2
  exit 2
fi
(cd "$allowed_dir" && sha256sum --check "${archive##*/}.sha256")

# Accept only regular files/directories in the backup's known layout; never extract config or links.
while IFS= read -r entry; do
  case "$entry" in
    data|data/|data/*|.env|compose.yaml) ;;
    *) printf 'Miembro inesperado en la copia: %s\n' "$entry" >&2; exit 1 ;;
  esac
done < <(tar -tzf "$archive")
while IFS= read -r entry; do
  kind="${entry:0:1}"
  if [[ "$kind" == l || "$kind" == h ]]; then
    printf 'La copia contiene enlaces; se rechaza por seguridad.\n' >&2
    exit 1
  fi
done < <(tar -tvzf "$archive")

restore_dir="$(mktemp -d /srv/quetzaltech-drive-restore.XXXXXX)"
chmod 700 "$restore_dir"
tar -xzf "$archive" -C "$restore_dir" --no-same-owner data
image_id="$(docker compose -f "$project_dir/compose.yaml" -p quetzaltech-drive images -q app | head -n 1)"
if [[ -z "$image_id" ]]; then
  printf 'No hay imagen local de este proyecto para ejecutar la verificación aislada.\n' >&2
  exit 1
fi
docker run --rm --network none -e NODE_ENV=production \
  -e PUBLIC_URL=https://drive.quetzaltech.shop -e ANDROID_ORIGINS=https://localhost \
  -v "$restore_dir/data:/restore/data:rw" \
  --entrypoint node "$image_id" /app/scripts/verify-restore.mjs /restore/data
printf 'Restauración aislada verificada y conservada en: %s\n' "$restore_dir"
