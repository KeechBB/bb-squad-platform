#!/usr/bin/env python3
"""Train accuracy: hits / shots * 100 — только по полным правдоподобным дням.

Shots: BBAcuracy players shots (EOS → сумма пиков по сессиям за день;
  сброс счётчика между катками = новая сессия).
Hits:  BBHitZone AttackerEOS (EOS → count за тот же день).

Откуда лог (Alex 26.10.2026): только архив, одна основная копия ночи.
  {BB_LOG_ARCHIVE_ROOT}/TR*/_live/SquadGame.log
  {BB_LOG_ARCHIVE_ROOT}/TR*/YYYY-MM/SquadGame-backup-*.log
Булавки pins/, рабочая копия scripts/_tmp_squad_logs и срез matches/…/layer.log
— те же байты под другими именами. Их не читаем, иначе попадания множатся.

Правило дней:
  брать только дни, где есть И выстрелы, И попадания;
  и hits <= shots (иначе BBAcuracy недописал выстрелы — день мусор);
  суммарно shots < MIN_SHOTS → accuracyPct = null (в таблице «—»);
  иначе accuracyPct = min(100, round(100 * hits / shots, 1)).

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
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SHOT_LINE = re.compile(r"BBAcuracy:\s*players?\s+shots:\s*(.+)$", re.I)
PAIR_RE = re.compile(
    r'"player_id"\s*:\s*"([^"]+)"\s*,\s*"shots"\s*:\s*(\d+)', re.I
)
# Live format: BBHitZone: AttackerEOS=<0002…> VictimEOS=<…> Zone=<…> …
HIT_EOS = re.compile(r"AttackerEOS=<\s*([0-9a-fA-F]{32})\s*>", re.I)
HIT_STEAM = re.compile(r"AttackerSteam=<\s*(7656\d{13})\s*>", re.I)
HIT_NICK = re.compile(r"Attacker(?:Name|Nick)=<\s*([^>]+?)\s*>", re.I)
EOS_STEAM = re.compile(
    r"EOS:\s*([0-9a-f]{32}).*?steam:\s*(7656\d{13})", re.I
)
# Canon nick bind: OnPossess(): PC=Nick (Online IDs: EOS: … steam: …)
ON_POSSESS = re.compile(
    r"OnPossess\(\):\s*PC=(\S+)\s*\(Online IDs:\s*EOS:\s*([0-9a-f]{32})\s*steam:\s*(7656\d{13})\)",
    re.I,
)
# Damage lines also carry nick + EOS + steam
DMG_IDS = re.compile(
    r"from\s+(.+?)\s*\(Online IDs:\s*EOS:\s*([0-9a-f]{32})\s*steam:\s*(7656\d{13})\)",
    re.I,
)
DATE_RE = re.compile(r"\[(\d{4})\.(\d{2})\.(\d{2})")

# Ниже порога — шум (1–2 выстрела в дампе BBAcuracy при десятках попаданий).
MIN_SHOTS_TOTAL = 20


def resolve_train() -> Path:
    env = (os.environ.get("BB_KV_PUBLIC") or "").strip()
    cands = []
    if env:
        cands += [Path(env) / "data" / "training", Path(env) / "public" / "data" / "training"]
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
    """Archive originals only: live mirror + one rotated backup per file.

    Pins, the script working copy and per-match slices repeat the same night.
    """
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
        for month in sorted(p for p in base.iterdir() if p.is_dir() and re.fullmatch(r"\d{4}-\d{2}", p.name)):
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-10-20")
    args = ap.parse_args()
    since = args.since
    train = resolve_train()

    # eos -> day -> chronological shot samples (for session peaks)
    shots_samples: dict[str, dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(list)
    )
    hits_day: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    eos_to_steam: dict[str, str] = {}
    steam_to_nick: dict[str, str] = {}
    eos_to_nick: dict[str, str] = {}

    logs = iter_logs(since)
    print(f"logs={len(logs)} since={since}", flush=True)

    for path in logs:
        opener = gzip.open if path.suffix == ".gz" else open
        try:
            with opener(path, "rt", encoding="utf-8", errors="replace") as fh:  # type: ignore
                day = "9999-99-99"
                for line in fh:
                    dm = DATE_RE.search(line)
                    if dm:
                        day = f"{dm.group(1)}-{dm.group(2)}-{dm.group(3)}"
                    if day < since:
                        continue

                    for em in EOS_STEAM.finditer(line):
                        eos_to_steam[em.group(1).lower()] = em.group(2)

                    om = ON_POSSESS.search(line)
                    if om:
                        nick, eos, steam = om.group(1), om.group(2).lower(), om.group(3)
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

                    sm = SHOT_LINE.search(line)
                    if sm:
                        blob = sm.group(1).strip()
                        # пустой дамп {} — граница сессии (сброс)
                        if blob in {"{}", ""}:
                            continue
                        for eos, shots in PAIR_RE.findall(blob):
                            e = eos.lower()
                            shots_samples[e][day].append(int(shots))
                        continue

                    if "BBHitZone:" not in line:
                        continue
                    m = HIT_EOS.search(line)
                    if m and day >= since:
                        hits_day[m.group(1).lower()][day] += 1
        except Exception as e:
            print("ERR", path, e, flush=True)

    def session_shot_total(samples: list[int]) -> int:
        """Сумма пиков сессий: при падении счётчика — новая катка/сброс."""
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

    shots_day: dict[str, dict[str, int]] = {}
    for eos, by_day in shots_samples.items():
        shots_day[eos] = {
            d: session_shot_total(samples) for d, samples in by_day.items()
        }

    for eos, steam in eos_to_steam.items():
        n = steam_to_nick.get(steam)
        if n:
            eos_to_nick.setdefault(eos, n)

    by_nick: dict[str, dict] = {}
    complete_days_total = 0
    skipped_hits_gt_shots = 0

    for eos, day_shots in shots_day.items():
        nick = eos_to_nick.get(eos)
        if not nick:
            continue
        day_hits = hits_day.get(eos) or {}
        # дни с обоими источниками и правдоподобным hits<=shots
        complete: list[str] = []
        for d in set(day_shots) | set(day_hits):
            sh = int(day_shots.get(d) or 0)
            hi = int(day_hits.get(d) or 0)
            if sh <= 0 or hi <= 0:
                continue
            if hi > sh:
                skipped_hits_gt_shots += 1
                continue
            complete.append(d)
        if not complete:
            continue
        sh = sum(int(day_shots[d]) for d in complete)
        hi = sum(int(day_hits[d]) for d in complete)
        if sh < MIN_SHOTS_TOTAL:
            continue
        complete_days_total += len(complete)
        k = nick_key(nick)
        row = by_nick.get(k)
        if not row:
            row = {
                "nick": nick,
                "shots": 0,
                "hits": 0,
                "days": 0,
                "accuracyPct": None,
            }
            by_nick[k] = row
        row["shots"] += sh
        row["hits"] += hi
        row["days"] += len(complete)

    for row in by_nick.values():
        sh = int(row["shots"] or 0)
        hi = int(row["hits"] or 0)
        if sh >= MIN_SHOTS_TOTAL and hi > 0:
            # потолок 100% — защита от остаточного шума BBAcuracy
            row["accuracyPct"] = min(100.0, round(100.0 * hi / sh, 1))
        else:
            row["accuracyPct"] = None

    # drop rows without a computable pct
    by_nick = {
        k: v for k, v in by_nick.items() if v.get("accuracyPct") is not None
    }

    out = {
        "meta": {
            "builtAt": datetime.now(timezone.utc).isoformat(),
            "since": since,
            "formula": (
                f"hits/shots*100; days with both and hits<=shots; "
                f"minShots={MIN_SHOTS_TOTAL}; cap 100; session-sum BBAcuracy"
            ),
            "shotEos": len(shots_day),
            "hitEos": len(hits_day),
            "completeDaySlots": complete_days_total,
            "skippedHitsGtShotsDays": skipped_hits_gt_shots,
            "minShots": MIN_SHOTS_TOTAL,
            "playersWithAccuracy": len(by_nick),
            "logs": len(logs),
        },
        "byNick": by_nick,
    }
    dest = train / "accuracy-stats.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # mirror
    for mirror in (
        Path("/var/www/blackberry-kv/data/training/accuracy-stats.json"),
        Path("/var/www/bb-squad-platform/data/kv-cache/data/training/accuracy-stats.json"),
    ):
        if mirror.parent.is_dir() and mirror != dest:
            try:
                mirror.write_text(dest.read_text(encoding="utf-8"), encoding="utf-8")
            except OSError:
                pass

    with_acc = sum(1 for v in out["byNick"].values() if v.get("accuracyPct") is not None)
    print(f"wrote {dest} players={len(out['byNick'])} with_accuracy={with_acc}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
