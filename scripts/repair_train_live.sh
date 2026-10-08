#!/usr/bin/env bash
# Soft-repair training UI on VPS after a bad deploy merge.
# NEVER git reset --hard blackberry-kv (that wiped live Mutaha).
# NEVER overwrite live training/RP from GitHub if disk already has data.
# Usage: bash scripts/repair_train_live.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${KV_LOCAL_DIR:-$ROOT/data/kv-cache}"
KV_REPO="${KV_REPO_DIR:-/var/www/blackberry-kv}"

echo "==> repair train live → $DEST"

SRC=""
for cand in "$KV_REPO" "$KV_REPO/public"; do
  if [[ -f "$cand/index.html" && -f "$cand/app.js" ]]; then
    SRC="$cand"
    break
  fi
done
if [[ -z "$SRC" ]]; then
  echo "WARN: no KV UI source — only scrub local" >&2
else
  echo "==> copy UI only from $SRC (training untouched)"
  cp -a "$SRC/index.html" "$DEST/index.html"
  cp -a "$SRC/app.js" "$DEST/app.js"
  # Fill missing training files from warehouse, never replace richer live ones
  if [[ -d "$SRC/data/training" ]]; then
    python3 "$ROOT/scripts/merge_train_after_kv_sync.py" "$SRC/data/training" "$DEST" || true
  fi
fi

mkdir -p "$DEST/data/training/players"
rm -f "$DEST/data/training/players/06-yehorivka.json"

# bump bust so /tm iframe picks new v=
TAG="$(date -u +%Y%m%d-%H%M)"
python3 - "$DEST/data/cache-bust.json" "$TAG" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]); tag=sys.argv[2]
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps({"bust":tag,"updatedAt":tag,"note":"repair_train_live"},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("bust", tag)
PY

python3 - <<PY
import json
from pathlib import Path
p=Path("$DEST/data/training/2026-10.json")
if p.is_file():
    d=json.loads(p.read_text(encoding="utf-8"))
    ms=[m for m in d.get("matches") or [] if "yehorivka" not in str(m.get("id","")).lower() and "yehorivka" not in str(m.get("map","")).lower()]
    d["matches"]=ms
    p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("oct matches", len(ms))
html=Path("$DEST/index.html")
if html.is_file():
    print("time column", "Время" in html.read_text(encoding="utf-8", errors="replace"))
PY

echo "==> repair done — hard-refresh /tm"
exit 0
