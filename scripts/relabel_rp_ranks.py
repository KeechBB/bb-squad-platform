#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Recompute rankLabel/rankKey/predatorPlace from RP after Eclipse insert.
Does not rescore match nets — only badge fields + slim ladders.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rp_log_parse as R

ROOT = Path(__file__).resolve().parents[1]

# Canonical only — do not relabel stale mirrors (they are overwritten from canon).
LEDGERS = [
    ROOT / "data" / "public" / "rp-ledger.json",
    ROOT / "data" / "training" / "rp-ledger.json",
]

LADDERS = [
    ROOT / "data" / "public" / "rp-ladder.json",
    ROOT / "data" / "training" / "rp-ladder.json",
]


def relabel_ledger(path: Path) -> bool:
    if not path.is_file():
        return False
    data = json.loads(path.read_text(encoding="utf-8"))
    players = data.get("players") or {}
    if not isinstance(players, dict):
        return False

    data["radiant3Max"] = R.RADIANT3_MAX

    ranked = sorted(
        (
            (k, float(p.get("rp") or R.START_RP))
            for k, p in players.items()
            if isinstance(p, dict)
        ),
        key=lambda x: -x[1],
    )
    predator_place: dict[str, int] = {}
    place = 0
    for k, val in ranked:
        info = R.rp_rank(val)
        if info["predator"]:
            place += 1
            predator_place[k] = place

    for k, p in players.items():
        if not isinstance(p, dict):
            continue
        try:
            rp = float(p.get("rp") or R.START_RP)
        except (TypeError, ValueError):
            rp = R.START_RP
        info = R.rp_rank(rp)
        p["rp"] = round(max(R.MIN_RP, rp), 1)
        p["rankLabel"] = info["label"]
        p["rankKey"] = info["rankKey"]
        p["roman"] = info.get("roman") or ""
        p["predator"] = bool(info.get("predator"))
        p["predatorPlace"] = predator_place.get(k)

    data["leaderboard"] = [
        {
            "nick": players[k].get("nick") or k,
            "rp": players[k]["rp"],
            "rankLabel": players[k]["rankLabel"],
            "rankKey": players[k]["rankKey"],
            "predatorPlace": players[k].get("predatorPlace"),
        }
        for k, _ in ranked
    ]

    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"relabeled ledger {path} players={len(players)} predator={place}")
    return True


def write_slim_from_ledger(ledger_path: Path, ladder_path: Path) -> None:
    if not ledger_path.is_file():
        return
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    players_out = ledger.get("players") or {}
    slim_players: dict = {}
    for k, p in players_out.items():
        if not isinstance(p, dict):
            continue
        slim_ms = []
        for m in p.get("matches") or []:
            slim_ms.append(
                {
                    "id": m.get("id"),
                    "kills": len(m.get("kills") or []),
                    "deaths": len(m.get("deaths") or []),
                    "noks": len(m.get("noks") or []),
                    "revives": len(m.get("revives") or []),
                    "dmg": int(round(float(m.get("dmg") or 0))),
                    "net": round(float(m.get("net") or 0), 1),
                    "won": m.get("won"),
                }
            )
        slim_players[k] = {
            "nick": p.get("nick"),
            "rp": p.get("rp"),
            "rankLabel": p.get("rankLabel"),
            "rankKey": p.get("rankKey"),
            "predatorPlace": p.get("predatorPlace"),
            "matches": slim_ms,
        }
    slim = {
        "version": ledger.get("version", 1),
        "updatedAt": ledger.get("updatedAt"),
        "startRp": ledger.get("startRp", R.START_RP),
        "step": ledger.get("step", R.STEP),
        "radiant3Max": R.RADIANT3_MAX,
        "weight": ledger.get("weight"),
        "excludeSeed": True,
        "historyOnly": True,
        "epoch": ledger.get("epoch"),
        "formula": ledger.get("formula"),
        "pMax": ledger.get("pMax"),
        "slim": True,
        "matches": [
            {
                "id": m.get("id"),
                "date": m.get("date"),
                "map": m.get("map"),
                "score1": m.get("score1"),
                "score2": m.get("score2"),
                "winnerTeam": m.get("winnerTeam"),
            }
            for m in (ledger.get("matches") or [])
            if isinstance(m, dict)
        ],
        "players": slim_players,
        "leaderboard": ledger.get("leaderboard") or [],
    }
    ladder_path.parent.mkdir(parents=True, exist_ok=True)
    ladder_path.write_text(
        json.dumps(slim, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"wrote slim {ladder_path} ({ladder_path.stat().st_size} bytes)")


def main() -> None:
    done = set()
    for p in LEDGERS:
        try:
            rp = p.resolve()
        except Exception:
            rp = p
        if str(rp) in done:
            continue
        if relabel_ledger(p):
            done.add(str(rp))
            # paired slim next to ledger
            slim = p.with_name("rp-ladder.json")
            try:
                write_slim_from_ledger(p, slim)
            except Exception as e:
                print(f"slim skip {slim}: {e}")


if __name__ == "__main__":
    main()
