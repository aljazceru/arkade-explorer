#!/usr/bin/env bash
# Cron on ungovernable: refresh /ark/observation/*.json every 15 minutes.
# Offset from markets (minute 17 every 3h) — this job uses minutes 7,22,37,52.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${OBSERVATION_OUT:-/home/exedev/ark-site/observation}"
LOG="${OBSERVATION_LOG:-/home/exedev/ark-observer/last-run.log}"
mkdir -p "$OUT" "$(dirname "$LOG")"
exec 9>/tmp/ark-observation.lock
flock -n 9 || { echo "already running"; exit 0; }
ulimit -v 512000  # 512 MiB virtual mem cap — indexer is light (curl+json)
export OBSERVATION_OUT="$OUT"
# Prefer system python3; no venv required
timeout 4m python3 ./observation-indexer.py >"$LOG" 2>&1
