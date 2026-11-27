#!/bin/bash
# Force re-read _live logs so weapon/Wound rows land in cache.
set -euo pipefail
ROOT=/var/www/bb-squad-platform
cd "$ROOT"
python3 - <<'PY'
import json
from pathlib import Path
p = Path("data/cache/panelka-teamkills/_state.json")
if p.exists():
    st = json.loads(p.read_text(encoding="utf-8"))
    files = st.get("files") or {}
    drop = [k for k in files if "/_live/" in k.replace("\\", "/") or k.endswith("_live/SquadGame.log") or ":SquadGame.log" in k and "_live" in k]
    # keys look like "PB1:/var/www/.../_live/SquadGame.log"
    drop = [k for k in files if "_live" in k]
    for k in drop:
        del files[k]
    st["files"] = files
    p.write_text(json.dumps(st, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"cleared {len(drop)} live state keys")
else:
    print("no state")
PY
python3 scripts/build_panelka_teamkills.py --since 2026-11-01 --incremental
python3 - <<'PY'
import json
from pathlib import Path
p = Path("data/cache/panelka-teamkills/76561198698669745.json")
if p.exists():
    d = json.loads(p.read_text(encoding="utf-8"))
    print("felix_count", d.get("count"))
    for r in (d.get("rows") or [])[:6]:
        print(r)
else:
    print("felix no cache")
PY
