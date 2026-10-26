#!/usr/bin/env python3
"""Train accuracy: hits / shots * 100.

Shots: BBAcuracy players shots lines (EOS id → shots; take max per id).
Hits:  BBHitZone lines (attacker nick / steam / eos).

Canon formula (Alex 26.10.2026):
  accuracyPct = round(100 * hits / shots, 1)  if shots > 0 else null

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


def iter_logs(since: str) -> list[Path]:
    roots = [
        Path("/var/www/bb-squad-logs"),
        Path(os.environ.get("BB_LOG_CACHE_ROOT") or "") ,
        HERE / "_tmp_squad_logs",
    ]
    out: list[Path] = []
    for root in roots:
        if not root or not root.exists():
            continue
        for srv in ("TR1", "TR2", "TR3", "TR4", "TR5"):
            base = root / srv
            if not base.exists():
                continue
            for f in list(base.rglob("*.log")) + list(base.rglob("*.gz")):
                # skip very old by name if possible
                name = f.name
                m = re.search(r"(20\d{2})[.\-](\d{2})[.\-](\d{2})", name)
                if m:
                    d = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
                    if d < since:
                        continue
                out.append(f)
    # unique
    seen = set()
    uniq = []
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

    # shots: eos -> day -> max shots that day (BBAcuracy is cumulative in-session)
    shots_day: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    hits_by_eos: dict[str, int] = defaultdict(int)
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
                        for eos, shots in PAIR_RE.findall(sm.group(1)):
                            e = eos.lower()
                            shots_day[e][day] = max(shots_day[e][day], int(shots))
                        continue

                    if "BBHitZone:" not in line:
                        continue
                    m = HIT_EOS.search(line)
                    if m:
                        hits_by_eos[m.group(1).lower()] += 1
                        continue
                    # steam/nick fallbacks only if EOS missing
                    m = HIT_STEAM.search(line)
                    if m:
                        # fold into eos via reverse map later — count by steam→nick
                        steam = m.group(1)
                        nick = steam_to_nick.get(steam)
                        if nick:
                            # stash under synthetic key
                            hits_by_eos[f"steam:{steam}"] += 1
                        continue
        except Exception as e:
            print("ERR", path, e, flush=True)

    # build eos→nick via steam
    for eos, steam in eos_to_steam.items():
        n = steam_to_nick.get(steam)
        if n:
            eos_to_nick[eos] = n

    by_nick: dict[str, dict] = {}

    def touch(nick: str) -> dict:
        k = nick_key(nick)
        if k not in by_nick:
            by_nick[k] = {
                "nick": nick,
                "shots": 0,
                "hits": 0,
                "accuracyPct": None,
            }
        return by_nick[k]

    shots_by_eos = {
        eos: int(sum(day_map.values())) for eos, day_map in shots_day.items()
    }

    for eos, shots in shots_by_eos.items():
        nick = eos_to_nick.get(eos)
        if not nick:
            continue
        row = touch(nick)
        row["shots"] += shots

    for eos, hits in hits_by_eos.items():
        if eos.startswith("steam:"):
            steam = eos.split(":", 1)[1]
            nick = steam_to_nick.get(steam)
        else:
            nick = eos_to_nick.get(eos)
        if not nick:
            continue
        row = touch(nick)
        row["hits"] += hits

    for row in by_nick.values():
        sh = int(row["shots"] or 0)
        hi = int(row["hits"] or 0)
        if sh > 0:
            # cap display at 100 if hits>shots (mod noise / multi-count)
            row["accuracyPct"] = round(min(100.0, 100.0 * hi / sh), 1)
        else:
            row["accuracyPct"] = None

    out = {
        "meta": {
            "builtAt": datetime.now(timezone.utc).isoformat(),
            "since": since,
            "formula": "hits / shots * 100",
            "shotPlayers": len(shots_by_eos),
            "mappedPlayers": len(by_nick),
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
