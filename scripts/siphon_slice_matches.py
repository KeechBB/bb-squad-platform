#!/usr/bin/env python3
"""Slice closed layers from siphon archive into matches/YYYY/MM/DD/<matchKey>/.

Layout (append under BB_LOG_ARCHIVE_ROOT):
  matches/2026/10/25/2026-10-25_tr1_cslmutaha_2329/
    meta.json
    layer.log          # lines in [start,end] when extract ok
    source.ref         # relative path to full archive log

Called from squad_log_archive.run_once (BB_SIPHON_SLICE=1 default).
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import bb_log_fleet as FLEET  # noqa: E402
import rp_log_parse as R  # noqa: E402
from canon_match_write import make_match_key, slug_map  # noqa: E402


def archive_root(env: dict[str, str]) -> Path:
    raw = (env.get("BB_LOG_ARCHIVE_ROOT") or "").strip()
    return Path(raw) if raw else Path("/var/www/bb-squad-logs")


def lookback_hours(env: dict[str, str]) -> int:
    try:
        return max(6, int(env.get("BB_SIPHON_SLICE_LOOKBACK_H") or "48"))
    except ValueError:
        return 48


def candidate_logs(root: Path, folders: list[str]) -> list[Path]:
    out: list[Path] = []
    for folder in folders:
        base = root / folder
        live = base / "_live" / "SquadGame.log"
        if live.is_file():
            out.append(live)
        # recent month dirs
        for month in sorted(base.glob("????-??"), reverse=True)[:2]:
            for p in sorted(month.glob("SquadGame-backup-*.log"))[-8:]:
                out.append(p)
            for p in sorted(month.glob("SquadGame-backup-*.log.gz"))[-4:]:
                # skip gz for slice (too heavy); backups usually still .log
                pass
    # unique by resolve
    seen: set[str] = set()
    uniq: list[Path] = []
    for p in out:
        k = str(p.resolve())
        if k in seen:
            continue
        seen.add(k)
        uniq.append(p)
    return uniq


def match_key_for(m: dict[str, Any], server: str) -> str:
    start: datetime = m["start"]
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    msk = start.astimezone(timezone(timedelta(hours=3)))
    layer = str(m.get("map") or m.get("layer") or "map")
    return make_match_key(
        msk.year,
        msk.month,
        msk.day,
        server,
        layer,
        msk.strftime("%H:%M"),
    )


def slice_dir(root: Path, key: str) -> Path:
    # key: 2026-10-25_tr1_...
    day = key[:10]
    y, mo, d = day.split("-")
    return root / "matches" / y / mo / d / key


def extract_window(log_path: Path, t0: datetime, t1: datetime, dest: Path) -> int:
    """Write lines with timestamps in [t0,t1] to dest. Returns line count."""
    if t0.tzinfo is None:
        t0 = t0.replace(tzinfo=timezone.utc)
    if t1.tzinfo is None:
        t1 = t1.replace(tzinfo=timezone.utc)
    n = 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    # Cap: skip extract if source huge and window long — still write meta+ref
    try:
        size = log_path.stat().st_size
    except OSError:
        return 0
    if size > 80 * 1024 * 1024:
        return 0
    try:
        with log_path.open("r", encoding="utf-8", errors="replace") as inf, tmp.open(
            "w", encoding="utf-8"
        ) as out:
            for line in inf:
                # Squad: [2026.10.25-20.29.01:...]
                if len(line) < 22 or line[0] != "[":
                    continue
                m = re.match(r"^\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})", line)
                if not m:
                    continue
                try:
                    ts = R.parse_ts(m.group(1))
                except Exception:
                    continue
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if ts < t0:
                    continue
                if ts > t1:
                    # logs are chronological — can break early for backups
                    if n > 100:
                        break
                    continue
                out.write(line)
                n += 1
        if n:
            os.replace(tmp, dest)
        else:
            tmp.unlink(missing_ok=True)
    except Exception as e:
        print(f"extract fail {log_path.name}: {e}", flush=True)
        tmp.unlink(missing_ok=True)
        return 0
    return n


def run_slice(env: dict[str, str] | None = None) -> dict[str, int]:
    env = env or {}
    if (env.get("BB_SIPHON_SLICE") or os.environ.get("BB_SIPHON_SLICE") or "1").lower() in (
        "0",
        "false",
        "no",
    ):
        return {"skipped": 1}

    root = archive_root(env)
    folders = FLEET.train_servers() or ["TR1", "TR2", "TR3"]
    # also PB1
    for extra in ("PB1", "TR4", "TR5"):
        if (root / extra).is_dir() and extra not in folders:
            folders.append(extra)

    logs = candidate_logs(root, folders)
    if not logs:
        print("siphon slice: no logs", flush=True)
        return {"logs": 0, "new": 0}

    cutoff = datetime.now(timezone.utc) - timedelta(hours=lookback_hours(env))
    grace = datetime.now(timezone.utc) - timedelta(minutes=2)

    discovered = R.discover_matches(logs)
    new = 0
    seen = 0
    for m in discovered:
        start: datetime = m["start"]
        end: datetime = m["end"]
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
            end = end.replace(tzinfo=timezone.utc)
        if end < cutoff or end > grace:
            continue
        if (end - start).total_seconds() < 10 * 60:
            continue
        layer = str(m.get("map") or m.get("layer") or "")
        if R.is_seed_layer(layer, str(m.get("level") or "")):
            continue
        log_path = Path(m["logPath"]) if m.get("logPath") else None
        if log_path is None or not log_path.is_file():
            continue
        server = FLEET.infer_server_from_path(log_path) or "TR1"
        try:
            top = log_path.resolve().relative_to(root.resolve()).parts[0].upper()
            if re.fullmatch(r"TR\d+", top) or top in ("PB1", "TPUB1"):
                server = top
        except ValueError:
            pass
        key = match_key_for(m, server)
        dest = slice_dir(root, key)
        meta_path = dest / "meta.json"
        if meta_path.is_file():
            seen += 1
            continue
        dest.mkdir(parents=True, exist_ok=True)
        try:
            rel = str(log_path.resolve().relative_to(root.resolve()))
        except ValueError:
            rel = str(log_path)
        (dest / "source.ref").write_text(rel + "\n", encoding="utf-8")
        n_lines = extract_window(log_path, start, end, dest / "layer.log")
        meta = {
            "matchKey": key,
            "server": server,
            "map": layer,
            "mapStem": slug_map(layer),
            "start": start.isoformat(),
            "end": end.isoformat(),
            "sourceLog": rel,
            "extractedLines": n_lines,
            "slicedAt": datetime.now(timezone.utc).isoformat(),
        }
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        new += 1
        print(f"siphon slice +{key} lines={n_lines}", flush=True)

    print(f"siphon slice done new={new} already={seen} scanned_logs={len(logs)}", flush=True)

    if new and (env.get("BB_SIPHON_SLICE_TG") or "").strip() in ("1", "true", "yes"):
        try:
            import bb_alerts as AL  # noqa: WPS433

            AL.send(
                kind="выгрузка",
                title="Siphon: срезы матчей",
                level="ok",
                lines=[f"новых папок: {new}", f"корень: {root}/matches"],
                force=False,
            )
        except Exception as e:
            print(f"slice tg skip: {e}", flush=True)

    # Phase 7: re-check unverified canon rows when new slices appear
    if new and (env.get("BB_VERIFY_AFTER_SLICE") or "1").strip().lower() not in (
        "0",
        "false",
        "no",
    ):
        try:
            import canon_verify_match as V  # noqa: WPS433

            for m in V.list_pending(25):
                V.verify_one(m)
        except Exception as e:
            print(f"verify after slice skip: {e}", flush=True)

    return {"logs": len(logs), "new": new, "already": seen}


if __name__ == "__main__":
    from squad_log_archive import load_env

    raise SystemExit(0 if run_slice(load_env()).get("new", 0) >= 0 else 1)
