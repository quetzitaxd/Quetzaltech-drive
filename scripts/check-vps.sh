#!/usr/bin/env bash
set -euo pipefail
# Diagnóstico de solo lectura; ejecutar en la VPS.
free -h
df -h /srv
docker version
docker compose version
docker network inspect proxy --format '{{.Name}}'
docker ps --format 'table {{.Names}}	{{.Status}}	{{.Ports}}'
