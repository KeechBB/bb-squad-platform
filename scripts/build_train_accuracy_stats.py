#!/usr/bin/env python3
"""Train accuracy: hits / shots * 100 — по полным окнам каток из календаря.

Не режем по календарным суткам UTC (катка 23:29→00:24 иначе рвётся).
Окно = timeMsk … timeMsk+duration из 2026-MM.json (полная длина катки).

Shots: BBAcuracy players shots внутри окна (сумма пиков сессий).
Hits:  BBHitZone AttackerEOS=… внутри того же окна (только атакующий).

  accuracyPct = min(100, round(100 * hits / shots, 1))
  если shots < MIN_SHOTS или hits > shots → null («—»).

Откуда лог: только архив TR*/_live + rotated backup (без pins/срезов).

Writes: data/training/accuracy-stats.json
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SHOT_LINE = re.compile(r"BBAcuracy:\s*players?\s+shots:\s*(.+)$", re.I)
PAIR_RE = re.compile(
    r'"player_id"\s*:\s*"([^"]+)"\s*,\s*"shots"\s*:\s*(\d+)', re.I
)
HIT_EOS = re.compile(r"AttackerEOS=<\s*([0-9a-fA-F]{32})\s*>", re.I)
EOS_STEAM = re.compile(
    r"EOS:\s*([0-9a-f]{32}).*?steam:\s*(7656\d{13})", re.I
)
ON_POSSESS = re.compile(
    r"OnPossess\(\):\s*PC=(\S+)\s*\(Online IDs:\s*EOS:\s*([0-9a-f]{32})\s*steam:\s*(7656\d{13})\)",
    re.I,
)
DMG_IDS = re.compile(
    r"from\s+(.+?)\s*\(Online IDs:\s*EOS:\s*([0-9a-f]{32})\s*steam:\s*(7656\d{13})\)",
    re.I,
)
LINE_TS = re.compile(
    r"^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]"
)

MIN_SHOTS_TOTAL = 20
# Небольшой запас на рассинхрон часов; длительность катки не режем.
PAD_START_SEC = 60
PAD_END_SEC = 120
MSK = timezone(timedelta(hours=3))


@dataclass
class MatchWin:
    id: str
    map: str
    gte: datetime  # aware UTC
    lt: datetime


def resolve_train() -> Path:
    env = (os.environ.get("BB_KV_PUBLIC") or "").strip()
    cands = []
    if env:
        cands += [
            Path(env) / "data" / "training",
            Path(env) / "public" / "data" / "training",
        ]
    cands += [
        Path("/var/www/bb-squad-platform/data/kv-cache/data/training"),
        Path("/var/www/blackberry-kv/data/training"),
    ]
    for c in cands:
        if c.is_dir():
            return c
    raise SystemExit("training dir not found")


def archive_root() -> Path:
    raw = (os.environ.get("BB_LOG_ARCHIVE_ROOT") or "").strip()
    return Path(raw) if raw else Path("/var/www/bb-squad-logs")


def iter_logs(since: str) -> list[Path]:
    root = archive_root()
    out: list[Path] = []
    if not root.is_dir():
        return out
    for srv in ("TR1", "TR2", "TR3", "TR4", "TR5"):
        base = root / srv
        if not base.is_dir():
            continue
        live = base / "_live" / "SquadGame.log"
        if live.is_file():
            out.append(live)
        for month in sorted(
            p for p in base.iterdir() if p.is_dir() and re.fullmatch(r"\d{4}-\d{2}", p.name)
        ):
            plain = list(month.glob("SquadGame-backup-*.log"))
            plain_names = {p.name for p in plain}
            files = list(plain)
            for gz in month.glob("SquadGame-backup-*.log.gz"):
                if gz.name[:-3] in plain_names:
                    continue
                files.append(gz)
            for f in files:
                m = re.search(r"(20\d{2})[.\-](\d{2})[.\-](\d{2})", f.name)
                if m:
                    d = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
                    if d < since:
                        continue
                out.append(f)
    seen: set[str] = set()
    uniq: list[Path] = []
    for p in out:
        k = str(p.resolve()) if p.exists() else str(p)
        if k in seen:
            continue
        seen.add(k)
        uniq.append(p)
    return uniq


def nick_key(n: str) -> str:
    return "".join(str(n or "").strip().lower().split())


def parse_duration_sec(raw: str) -> int | None:
    s = str(raw or "").strip()
    if not s or s in {"—", "-"}:
        return None
    parts = s.split(":")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    if len(nums) == 3:
        return nums[0] * 3600 + nums[1] * 60 + nums[2]
    if len(nums) == 2:
        return nums[0] * 60 + nums[1]
    return None


def parse_ts(m: re.Match) -> datetime:
    y, mo, d, h, mi, s, _ms = map(int, m.groups())
    return datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)


def load_match_windows(train: Path, since: str) -> list[MatchWin]:
    """Полные окна каток из month JSON (timeMsk + duration)."""
    out: list[MatchWin] = []
    for month_path in sorted(train.glob("20??-??.json")):
        try:
            data = json.loads(month_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        ym = str(data.get("month") or month_path.stem)
        if not re.fullmatch(r"\d{4}-\d{2}", ym):
            continue
        y, mo = map(int, ym.split("-"))
        for match in data.get("matches") or []:
            if match.get("status") and match.get("status") != "done":
                continue
            day = match.get("day")
            if day is None:
                continue
            ymd = f"{y:04d}-{mo:02d}-{int(day):02d}"
            if ymd < since:
                continue
            t_raw = str(match.get("timeMsk") or "").strip()
            hm = re.match(r"^(\d{1,2}):(\d{2})$", t_raw)
            dur = parse_duration_sec(str(match.get("duration") or ""))
            if not hm or not dur or dur < 60:
                continue
            hh, mi = int(hm.group(1)), int(hm.group(2))
            start_msk = datetime(y, mo, int(day), hh, mi, 0, tzinfo=MSK)
            end_msk = start_msk + timedelta(seconds=dur)
            gte = (start_msk - timedelta(seconds=PAD_START_SEC)).astimezone(
                timezone.utc
            )
            lt = (end_msk + timedelta(seconds=PAD_END_SEC)).astimezone(timezone.utc)
            out.append(
                MatchWin(
                    id=str(match.get("id") or f"{ymd}"),
                    map=str(match.get("map") or ""),
                    gte=gte,
                    lt=lt,
                )
            )
    out.sort(key=lambda w: w.gte)
    return out


def find_match(wins: list[MatchWin], ts: datetime) -> MatchWin | None:
    """Линейный поиск ок — каток мало; при росте можно bipartite."""
    for w in wins:
        if w.gte <= ts < w.lt:
            return w
    return None


def session_shot_total(samples: list[int]) -> int:
    if not samples:
        return 0
    total = 0
    session_max = 0
    prev = 0
    started = False
    for shots in samples:
        if not started:
            session_max = shots
            prev = shots
            started = True
            continue
        if shots < prev:
            total += session_max
            session_max = shots
        else:
            session_max = max(session_max, shots)
        prev = shots
    total += session_max
    return total


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-10-20")
    args = ap.parse_args()
    since = args.since
    train = resolve_train()

    wins = load_match_windows(train, since)
    print(f"matches={len(wins)} since={since}", flush=True)
    if not wins:
        raise SystemExit("no match windows")

    # eos -> matchId -> hits / shot samples
    hits_m: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    shots_m: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    eos_to_steam: dict[str, str] = {}
    steam_to_nick: dict[str, str] = {}
    eos_to_nick: dict[str, str] = {}

    logs = iter_logs(since)
    print(f"logs={len(logs)}", flush=True)
    t_min = wins[0].gte - timedelta(hours=2)
    t_max = wins[-1].lt + timedelta(hours=2)

    for path in logs:
        opener = gzip.open if path.suffix == ".gz" else open
        try:
            with opener(path, "rt", encoding="utf-8", errors="replace") as fh:  # type: ignore
                for line in fh:
                    tm = LINE_TS.match(line)
                    ts = parse_ts(tm) if tm else None

                    for em in EOS_STEAM.finditer(line):
                        eos_to_steam[em.group(1).lower()] = em.group(2)

                    om = ON_POSSESS.search(line)
                    if om:
                        nick, eos, steam = (
                            om.group(1),
                            om.group(2).lower(),
                            om.group(3),
                        )
                        if nick.lower() not in {"newplayer", "none", "null"}:
                            eos_to_nick[eos] = nick
                            eos_to_steam[eos] = steam
                            steam_to_nick[steam] = nick

                    dm = DMG_IDS.search(line)
                    if dm:
                        nick = dm.group(1).strip()
                        eos, steam = dm.group(2).lower(), dm.group(3)
                        if nick and "NewPlayer" not in nick:
                            eos_to_nick.setdefault(eos, nick)
                            eos_to_steam.setdefault(eos, steam)
                            steam_to_nick.setdefault(steam, nick)

                    if ts is None or ts < t_min or ts > t_max:
                        continue
                    win = find_match(wins, ts)
                    if not win:
                        continue

                    sm = SHOT_LINE.search(line)
                    if sm:
                        blob = sm.group(1).strip()
                        if blob not in {"{}", ""}:
                            for eos, shots in PAIR_RE.findall(blob):
                                shots_m[eos.lower()][win.id].append(int(shots))
                        continue

                    if "BBHitZone:" not in line:
                        continue
                    m = HIT_EOS.search(line)
                    if m:
                        hits_m[m.group(1).lower()][win.id] += 1
        except Exception as e:
            print("ERR", path, e, flush=True)

    for eos, steam in eos_to_steam.items():
        n = steam_to_nick.get(steam)
        if n:
            eos_to_nick.setdefault(eos, n)

    by_nick: dict[str, dict] = {}
    complete_slots = 0
    skipped_gt = 0

    all_eos = set(hits_m) | set(shots_m)
    for eos in all_eos:
        nick = eos_to_nick.get(eos)
        if not nick:
            continue
        match_ids = set(hits_m.get(eos, {})) | set(shots_m.get(eos, {}))
        sh_sum = 0
        hi_sum = 0
        days = 0
        for mid in match_ids:
            hi = int((hits_m.get(eos) or {}).get(mid) or 0)
            samples = (shots_m.get(eos) or {}).get(mid) or []
            sh = session_shot_total(samples)
            if sh <= 0 or hi <= 0:
                continue
            if hi > sh:
                skipped_gt += 1
                continue
            sh_sum += sh
            hi_sum += hi
            days += 1
        if sh_sum < MIN_SHOTS_TOTAL or hi_sum <= 0:
            continue
        complete_slots += days
        k = nick_key(nick)
        row = by_nick.get(k)
        if not row:
            row = {
                "nick": nick,
                "shots": 0,
                "hits": 0,
                "matches": 0,
                "accuracyPct": None,
            }
            by_nick[k] = row
        row["shots"] += sh_sum
        row["hits"] += hi_sum
        row["matches"] += days

    for row in by_nick.values():
        sh = int(row["shots"] or 0)
        hi = int(row["hits"] or 0)
        if sh >= MIN_SHOTS_TOTAL and hi > 0:
            row["accuracyPct"] = min(100.0, round(100.0 * hi / sh, 1))
        else:
            row["accuracyPct"] = None
        # compat with UI that may read .days
        row["days"] = row.get("matches") or 0

    by_nick = {
        k: v for k, v in by_nick.items() if v.get("accuracyPct") is not None
    }

    out = {
        "meta": {
            "builtAt": datetime.now(timezone.utc).isoformat(),
            "since": since,
            "formula": (
                "hits/shots*100 per full calendar match window "
                f"(timeMsk+duration, pad ±{PAD_START_SEC}/{PAD_END_SEC}s); "
                f"AttackerEOS only; minShots={MIN_SHOTS_TOTAL}; "
                "skip match if hits>shots; cap 100"
            ),
            "matches": len(wins),
            "completeMatchSlots": complete_slots,
            "skippedHitsGtShotsMatches": skipped_gt,
            "minShots": MIN_SHOTS_TOTAL,
            "playersWithAccuracy": len(by_nick),
            "logs": len(logs),
        },
        "byNick": by_nick,
    }
    dest = train / "accuracy-stats.json"
    dest.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    for mirror in (
        Path("/var/www/blackberry-kv/data/training/accuracy-stats.json"),
        Path(
            "/var/www/bb-squad-platform/data/kv-cache/data/training/accuracy-stats.json"
        ),
    ):
        if mirror.parent.is_dir() and mirror != dest:
            try:
                mirror.write_text(dest.read_text(encoding="utf-8"), encoding="utf-8")
            except OSError:
                pass

    print(
        f"wrote {dest} players={len(by_nick)} "
        f"slots={complete_slots} skipped_gt={skipped_gt}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
