#!/usr/bin/env bash
# Rebuild PB1 RP/combat ledger from VPS Postgres PublicMatch + TPUB1 logs.
# Run on VPS: bash scripts/rebuild_public_rp_now.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PY=""
for cand in \
  "$ROOT/scripts/.venv-collector/bin/python" \
  "$ROOT/.venv-collector/bin/python"
do
  if [[ -x "$cand" ]]; then
    PY="$cand"
    break
  fi
done
if [[ -z "$PY" ]]; then
  PY="$(command -v python3)"
fi
echo "==> python: $PY"
"$PY" -c "import paramiko; print('==> paramiko ok')" 2>/dev/null \
  || echo "==> paramiko missing in this python (will use log cache / install in venv)"
echo "==> history source: DATABASE_URL → local Postgres (PublicMatch)"
echo "==> rebuilding rp-ledger…"
"$PY" scripts/build_public_rp_ledger.py
echo "==> ledger matches:"
"$PY" - <<'PY'
import json
from pathlib import Path
p = Path("data/public/rp-ledger.json")
d = json.loads(p.read_text(encoding="utf-8"))
print("  players", len(d.get("players") or {}), "matches", len(d.get("matches") or []), "updated", d.get("updatedAt"))
PY
pm2 restart bb-squad || true
echo "==> done"
