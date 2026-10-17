#!/usr/bin/env python3
"""Extract Vanilla minimaps from AllMaps_Minimaps.zip into public/replay-maps/.

Usage:
  python scripts/sync_replay_minimaps.py "C:\\Users\\...\\AllMaps_Minimaps.zip"
  python scripts/sync_replay_minimaps.py path/to.zip --only Narva,Mutaha,Chora
"""

from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "data" / "replay-maps" / "registry.json"
OUT = ROOT / "public" / "replay-maps"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("zip_path", type=Path)
    ap.add_argument("--only", default="", help="Comma-separated map keys")
    args = ap.parse_args()
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    OUT.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(args.zip_path, "r") as zf:
        names = set(zf.namelist())
        for key, meta in reg["maps"].items():
            if only and key not in only:
                continue
            pack = meta.get("packPath")
            if not pack:
                print(f"skip {key}: no packPath")
                continue
            if pack not in names:
                print(f"MISS {key}: {pack}")
                continue
            dest_name = Path(meta["image"]).name
            dest = OUT / dest_name
            data = zf.read(pack)
            dest.write_bytes(data)
            print(f"ok {key} -> {dest} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
