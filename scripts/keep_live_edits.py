#!/usr/bin/env python3
"""Do not let a warehouse copy roll back a file that was fixed on plaza.

First time a live file is seen, it is adopted. Later syncs keep it until the
warehouse is explicitly followed. A file edited on the server after that is
kept too. The log names the file instead of silently restoring an older copy.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MANIFEST = ROOT / "data" / "cache" / "live-edit-manifest.json"


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _key(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _load() -> dict:
    if not MANIFEST.is_file():
        return {"files": {}}
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"files": {}}
    if not isinstance(data, dict):
        return {"files": {}}
    files = data.get("files")
    if not isinstance(files, dict):
        data["files"] = {}
    return data


def _save(data: dict) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    tmp = MANIFEST.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(MANIFEST)


def apply(dest: Path, src: Path) -> str:
    """Return 'keep' or 'take'. Copy src onto dest only on 'take'."""
    data = _load()
    files: dict = data["files"]
    key = _key(dest)
    rec = files.get(key) if isinstance(files.get(key), dict) else None

    if not src.is_file() or src.stat().st_size == 0:
        print(f"keep {dest.name}: warehouse file is missing", flush=True)
        return "keep"
    if not dest.is_file() or dest.stat().st_size == 0:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        files[key] = {"sha256": _sha(dest), "origin": "warehouse"}
        _save(data)
        print(f"take {dest.name}: live file was missing", flush=True)
        return "take"

    live = _sha(dest)
    if rec is None:
        files[key] = {"sha256": live, "origin": "live"}
        _save(data)
        print(f"keep {dest.name}: принята серверная копия, склад её не затирает", flush=True)
        return "keep"

    origin = str(rec.get("origin") or "live")
    recorded = str(rec.get("sha256") or "")
    if live != recorded or origin != "warehouse":
        print(f"keep {dest.name}: на сервере своя правка, склад её не затирает", flush=True)
        return "keep"

    src_sha = _sha(src)
    if src_sha == live:
        return "keep"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    files[key] = {"sha256": _sha(dest), "origin": "warehouse"}
    _save(data)
    print(f"take {dest.name}: warehouse update applied", flush=True)
    return "take"


def follow(dest: Path) -> None:
    """After the warehouse file is the wanted copy, let the next sync take it."""
    if not dest.is_file():
        print(f"follow skip: {dest} missing", flush=True)
        return
    data = _load()
    data["files"][_key(dest)] = {"sha256": _sha(dest), "origin": "warehouse"}
    _save(data)
    print(f"follow {dest.name}: next warehouse copy may replace it", flush=True)


def main() -> int:
    if len(sys.argv) < 3 or sys.argv[1] not in ("apply", "follow"):
        print("usage: keep_live_edits.py apply DEST SRC | follow DEST", file=sys.stderr)
        return 2
    if sys.argv[1] == "follow":
        follow(Path(sys.argv[2]))
        return 0
    if len(sys.argv) < 4:
        print("usage: keep_live_edits.py apply DEST SRC", file=sys.stderr)
        return 2
    apply(Path(sys.argv[2]), Path(sys.argv[3]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
