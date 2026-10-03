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
echo "==> history source: DATABASE_URL host local Postgres (PublicMatch)"
echo "==> rebuilding rp-ledger…"
python3 scripts/build_public_rp_ledger.py
echo "==> ledger matches:"
python3 - <<'PY'
import json
from pathlib import Path
p = Path("data/public/rp-ledger.json")
d = json.loads(p.read_text(encoding="utf-8"))
print("  players", len(d.get("players") or {}), "matches", len(d.get("matches") or []), "updated", d.get("updatedAt"))
PY
pm2 restart bb-squad || true
echo "==> done"
