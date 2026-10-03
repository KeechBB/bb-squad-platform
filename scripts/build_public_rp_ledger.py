#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build public (PB1/TPUB1) RP ledger.

Same Die/TK/Revive rules as training RP, but:
  - weight uses current public RP (not PWR)
  - SEED layers are skipped (BP_GameStateSquad_Seed / map name with Seed)

Matches are listed in MATCHES below (fill as we digitize public ladders).
Output: KV/public/data/public/rp-ledger.json
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / "_tmp_tpub1_logs_cache"
OUT_DIR = HERE.parents[1] / "KV" / "public" / "data" / "public"
OUT = OUT_DIR / "rp-ledger.json"

START_RP = 1000.0
REVIVE_COEF = 0.6
STEP = 150
RADIANT3_MAX = 4500

LINE_TS = re.compile(r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]")
SEED_RE = re.compile(r"Seed|SEED|BP_GameStateSquad_Seed", re.I)

# Fill when we lock public ladder matches (non-SEED only).
MATCHES: list[dict] = []


def nick_key(n: str) -> str:
    return re.sub(r"\s+", "", (n or "").strip().lower())


def hunt_delta(pk: float, pv: float, pmax: float) -> float:
    if pmax <= 1:
        return 1.0
    return 1.0 + 49.0 * (pv - pk + pmax - 1.0) / (2.0 * (pmax - 1.0))


def rp_rank(rp: float) -> dict:
    rp_i = int(round(rp))
    names = [
        ("Iron", "iron"),
        ("Bronze", "bronze"),
        ("Silver", "silver"),
        ("Gold", "gold"),
        ("Platinum", "platinum"),
        ("Diamond", "diamond"),
        ("Legend", "legend"),
        ("Immortal", "immortal"),
        ("Master", "master"),
        ("Radiant", "radiant"),
    ]
    roman = ["I", "II", "III"]
    if rp_i > RADIANT3_MAX:
        return {"label": "PREDATOR", "rankKey": "predator", "predator": True}
    idx = 0 if rp_i < 1 else min(29, (rp_i - 1) // STEP)
    name, key = names[idx // 3]
    return {
        "label": f"{name.upper()} {roman[idx % 3]}",
        "rankKey": key,
        "predator": False,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not MATCHES:
        payload = {
            "version": 1,
            "startRp": START_RP,
            "step": STEP,
            "radiant3Max": RADIANT3_MAX,
            "pMax": START_RP,
            "weight": "current_public_rp",
            "excludeSeed": True,
            "matches": [],
            "players": {},
            "leaderboard": [],
            "note": "PB1 ledger empty until MATCHES filled (non-SEED). Site shows attendance table meanwhile.",
        }
        OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"wrote empty public ledger → {OUT}")
        return

    # Future: process MATCHES with current-RP weights (see build_train_rp_ledger.py).
    raise SystemExit("MATCHES set — wire processing from train ledger (RP weight) before use")


if __name__ == "__main__":
    main()
