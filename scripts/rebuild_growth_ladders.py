#!/usr/bin/env python3
"""Rebuild Развитие ladders after a match is poured, only if a round finished.

Looks at TR1–TR5 Squad logs. A round counts when a new "has won/lost the match"
line appeared since the last check, or a new backup log landed. Chat and an
unfinished round do not trigger a rebuild.

Rifle stays on /var/www/bb-jobs/build_rifle_ladder.py (the hourly job that
still writes the minday column). Medic and LAT are the platform scripts.
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

SERVERS = ("TR1", "TR2", "TR3", "TR4", "TR5")
LOG_ROOT = Path("/var/www/bb-squad-logs")
STATE = Path("/var/www/bb-jobs/growth-ladder-state.json")
LOCK = Path("/var/www/bb-jobs/growth-ladder.lock")
LADDERS = (
    Path("/var/www/bb-squad-platform/data/kv-cache/data/rifle-ladder.json"),
    Path("/var/www/bb-squad-platform/data/kv-cache/data/medic-ladder.json"),
    Path("/var/www/bb-squad-platform/data/kv-cache/data/lat-ladder.json"),
)
RIFLE = Path("/var/www/bb-jobs/build_rifle_ladder.py")
MEDIC = Path("/var/www/bb-squad-platform/scripts/build_medic_ladder.py")
LAT = Path("/var/www/bb-squad-platform/scripts/build_lat_ladder.py")

TS = re.compile(r"\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]")
FINISH = ("has won the match", "has lost the match")
TAIL = 6 * 1024 * 1024


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(line: str) -> datetime | None:
    m = TS.search(line)
    if not m:
        return None
    try:
        return datetime(
            int(m.group(1)),
            int(m.group(2)),
            int(m.group(3)),
            int(m.group(4)),
            int(m.group(5)),
            int(m.group(6)),
            int(m.group(7)) * 1000,
            tzinfo=timezone.utc,
        )
    except ValueError:
        return None


def months(now: datetime) -> set[str]:
    marks = [now, now - timedelta(days=32), now + timedelta(hours=3)]
    marks.append(marks[2] - timedelta(days=32))
    return {m.strftime("%Y-%m") for m in marks}


def log_files(now: datetime) -> list[Path]:
    found: list[Path] = []
    names = months(now)
    for srv in SERVERS:
        live = LOG_ROOT / srv / "_live" / "SquadGame.log"
        if live.is_file():
            found.append(live)
        root = LOG_ROOT / srv
        if not root.is_dir():
            continue
        for name in names:
            month = root / name
            if not month.is_dir():
                continue
            found.extend(sorted(month.glob("SquadGame-backup-*.log")))
    return found


def snapshot(files: list[Path]) -> dict[str, int]:
    out: dict[str, int] = {}
    for path in files:
        try:
            out[str(path)] = path.stat().st_size
        except OSError:
            continue
    return out


def load_state() -> dict:
    if not STATE.is_file():
        return {}
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(checked_until: datetime, sizes: dict[str, int]) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "checked_until": checked_until.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "files": sizes,
    }
    tmp = STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, STATE)


def has_finish(path: Path, start: int, after: datetime) -> datetime | None:
    try:
        size = path.stat().st_size
    except OSError:
        return None
    pos = max(0, size - TAIL) if start <= 0 else max(0, start)
    found: datetime | None = None
    carry = b""
    try:
        with path.open("rb") as fh:
            fh.seek(pos)
            while True:
                blob = fh.read(4 * 1024 * 1024)
                if not blob:
                    break
                parts = (carry + blob).split(b"\n")
                carry = parts.pop() if parts else b""
                for raw in parts:
                    if b"has won the match" not in raw and b"has lost the match" not in raw:
                        continue
                    ts = parse_ts(raw.decode("utf-8", "replace"))
                    if ts is not None and ts > after and (found is None or ts > found):
                        found = ts
    except OSError:
        return found
    if carry and (b"has won the match" in carry or b"has lost the match" in carry):
        ts = parse_ts(carry.decode("utf-8", "replace"))
        if ts is not None and ts > after and (found is None or ts > found):
            found = ts
    return found


def newest_finish(files: list[Path], prev: dict[str, int], after: datetime) -> tuple[datetime | None, str]:
    best: datetime | None = None
    where = ""
    first = not prev
    for path in files:
        key = str(path)
        try:
            size = path.stat().st_size
        except OSError:
            continue
        old = prev.get(key)
        if not first and old == size:
            continue
        if old is None or old > size:
            start = 0
        else:
            start = max(0, old - 400)
        ts = has_finish(path, start, after)
        if ts is not None and (best is None or ts > best):
            best = ts
            where = key
    return best, where


def ladder_floor() -> datetime:
    times = []
    for path in LADDERS:
        try:
            times.append(datetime.fromtimestamp(path.stat().st_mtime, timezone.utc))
        except OSError:
            continue
    if not times:
        return utcnow() - timedelta(hours=3)
    return min(times)


def rebuild() -> int:
    steps = [
        [sys.executable, str(RIFLE)],
        [sys.executable, str(MEDIC)],
        [sys.executable, str(LAT)],
    ]
    for cmd in steps:
        print("run", " ".join(cmd), flush=True)
        proc = subprocess.run(cmd, cwd="/var/www/bb-squad-platform")
        if proc.returncode != 0:
            print("fail", cmd[-1], proc.returncode, flush=True)
            return proc.returncode
    return 0


def one_pass() -> int:
    """0 = nothing new, 1 = rebuilt, 2 = a builder failed."""
    now = utcnow()
    files = log_files(now)
    sizes = snapshot(files)
    state = load_state()
    prev = state.get("files") or {}
    raw_until = state.get("checked_until")
    if raw_until:
        after = datetime.fromisoformat(raw_until)
        if after.tzinfo is None:
            after = after.replace(tzinfo=timezone.utc)
    else:
        after = ladder_floor()
        print("no stamp, floor", after.strftime("%Y-%m-%d %H:%M:%S"), "UTC", flush=True)

    if raw_until:
        scan = files
        known = prev
    else:
        scan = []
        for path in files:
            try:
                fresh = "_live" in path.parts or path.stat().st_mtime >= after.timestamp()
            except OSError:
                fresh = False
            if fresh:
                scan.append(path)
        known = {}
    ts, where = newest_finish(scan, known, after)
    if ts is None:
        save_state(now, sizes)
        print(
            "skip no new round since",
            after.strftime("%Y-%m-%d %H:%M:%S"),
            "UTC",
            flush=True,
        )
        return 0

    print(
        "new round",
        ts.strftime("%Y-%m-%d %H:%M:%S"),
        "UTC",
        where,
        flush=True,
    )
    code = rebuild()
    if code != 0:
        print("stamp kept, next pour retries", flush=True)
        return 2
    save_state(now, sizes)
    print("rebuilt", now.strftime("%Y-%m-%d %H:%M:%S"), "UTC", flush=True)
    return 1


def main() -> int:
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open("a+") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("skip busy", flush=True)
            return 0
        # A round can end while the rebuild is still reading logs. One more
        # pass picks it up, so a second pour during the run is not lost.
        for _ in range(4):
            code = one_pass()
            if code != 1:
                return 0 if code == 0 else code
        print("stop after 4 rebuilds", flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
