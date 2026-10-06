#!/usr/bin/env bash
# Force-repair training UI/data on VPS after a bad deploy merge.
# Usage: bash scripts/repair_train_live.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${KV_LOCAL_DIR:-$ROOT/data/kv-cache}"
KV_REPO="${KV_REPO_DIR:-/var/www/blackberry-kv}"

echo "==> repair train live → $DEST"

if [[ -d "$KV_REPO/.git" ]]; then
  git -C "$KV_REPO" fetch origin main || true
  git -C "$KV_REPO" reset --hard origin/main || git -C "$KV_REPO" pull --ff-only || true
fi

SRC=""
for cand in "$KV_REPO" "$KV_REPO/public"; do
  if [[ -f "$cand/index.html" && -f "$cand/app.js" && -f "$cand/data/training/2026-10.json" ]]; then
    SRC="$cand"
    break
  fi
done
if [[ -z "$SRC" ]]; then
  echo "ERROR: no KV source" >&2
  exit 1
fi

echo "==> copy UI + Oct training from $SRC"
mkdir -p "$DEST/data/training/players"
cp -a "$SRC/index.html" "$DEST/index.html"
cp -a "$SRC/app.js" "$DEST/app.js"
cp -a "$SRC/data/training/2026-10.json" "$DEST/data/training/2026-10.json"
[[ -f "$SRC/data/training/_auto_matches.json" ]] && cp -a "$SRC/data/training/_auto_matches.json" "$DEST/data/training/_auto_matches.json"
[[ -f "$SRC/data/training/rp-ledger.json" ]] && cp -a "$SRC/data/training/rp-ledger.json" "$DEST/data/training/rp-ledger.json"
[[ -f "$SRC/data/training/rp-ladder.json" ]] && cp -a "$SRC/data/training/rp-ladder.json" "$DEST/data/training/rp-ladder.json"
[[ -f "$SRC/data/cache-bust.json" ]] && cp -a "$SRC/data/cache-bust.json" "$DEST/data/cache-bust.json"
[[ -f "$SRC/data/training-index.json" ]] && cp -a "$SRC/data/training-index.json" "$DEST/data/training-index.json"

for f in 06-cslfallujah.json 06-cslfallujah-2.json; do
  if [[ -f "$SRC/data/training/players/$f" ]]; then
    cp -a "$SRC/data/training/players/$f" "$DEST/data/training/players/$f"
  fi
done
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
d=json.loads(p.read_text(encoding="utf-8"))
ms=[m for m in d.get("matches") or [] if "yehorivka" not in str(m.get("id","")).lower() and "yehorivka" not in str(m.get("map","")).lower()]
d["matches"]=ms
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
day6=[m for m in ms if m.get("day")==6]
print("oct matches", len(ms), "day6", [(m["id"], m.get("timeMsk")) for m in day6])
html=Path("$DEST/index.html").read_text(encoding="utf-8", errors="replace")
print("time column", "Время" in html)
PY

echo "==> repair done — hard-refresh /tm"
exit 0
