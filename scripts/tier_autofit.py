#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Автосистема тиров (Fit A).

- «почти» (90–95% ↑ / 75–85% ↓) → кандидаты на главную
- «сильно» (≥95% ↑ / <75% ↓) → watch 2 дня, потом автоперевод ±1
- Переводы держатся на табло 2 дня
- Пишет: KV/public/data/tier-autofit-state.json + tier-board.json
- При apply: правит tiers.json (±1), не трогает aliases

Запуск:
  python scripts/tier_autofit.py           # dry-run + обновить board
  python scripts/tier_autofit.py --apply   # применить созревшие переводы
"""
from __future__ import annotations

import argparse
import json
from copy import deepcopy
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
KV_DATA = ROOT / "KV" / "public" / "data"
FIT_PATH = KV_DATA / "tfs-fit.json"
TIERS_PATH = KV_DATA / "tiers.json"
STATE_PATH = KV_DATA / "tier-autofit-state.json"
BOARD_PATH = KV_DATA / "tier-board.json"

HOLD_DAYS = 2
DISPLAY_DAYS = 2
PROMOTE_STRONG = 95.0
PROMOTE_ALMOST = 90.0
DEMOTE_HARD = 75.0
DEMOTE_WARN = 85.0  # <85 and >=75 = warn zone; <75 = demote candidate


def today() -> date:
    return date.today()


def parse_ymd(s: str) -> date:
    return date.fromisoformat(s[:10])


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def nick_key(n: str) -> str:
    return n.strip().lower()


def tier_lists(tiers: dict) -> dict[int, list[str]]:
    return {
        1: list(tiers.get("tier1") or []),
        2: list(tiers.get("tier2") or []),
        3: list(tiers.get("tier3") or []),
    }


def find_tier(tiers: dict, nick: str) -> int:
    k = nick_key(nick)
    for t, key in ((1, "tier1"), (2, "tier2"), (3, "tier3")):
        for n in tiers.get(key) or []:
            if nick_key(n) == k:
                return t
    return 4


def move_tier(tiers: dict, nick: str, to_tier: int) -> tuple[int, int]:
    """Remove from all lists, add to to_tier (1–3). Tier 4 = remove only. Returns (from, to)."""
    from_tier = find_tier(tiers, nick)
    canon = nick
    for key in ("tier1", "tier2", "tier3"):
        lst = list(tiers.get(key) or [])
        kept = []
        for n in lst:
            if nick_key(n) == nick_key(nick):
                canon = n
            else:
                kept.append(n)
        tiers[key] = kept
    if to_tier in (1, 2, 3):
        key = f"tier{to_tier}"
        lst = list(tiers.get(key) or [])
        if not any(nick_key(n) == nick_key(canon) for n in lst):
            lst.append(canon)
        tiers[key] = lst
    return from_tier, to_tier


def empty_state() -> dict[str, Any]:
    return {
        "updatedAt": today().isoformat(),
        "holdDays": HOLD_DAYS,
        "displayDays": DISPLAY_DAYS,
        "watches": [],
        "transfers": [],
    }


def seed_recent_transfers(state: dict[str, Any]) -> None:
    """One-time seed: пакет 02.10.2026, если ещё пусто."""
    if state.get("transfers"):
        return
    batch = [
        ("AkiN", 2, 1, "Пакет повышений ORR/КВ"),
        ("KillReal", 2, 1, "Пакет повышений ORR/КВ"),
        ("Tankist", 3, 2, "Пакет повышений ORR/КВ"),
        ("freak", 3, 2, "Пакет повышений ORR/КВ"),
        ("Radislave", 3, 2, "Пакет повышений ORR/КВ"),
        ("Kroasawn", 3, 2, "Пакет повышений ORR/КВ"),
        ("VET", 3, 2, "Пакет повышений ORR/КВ"),
        ("MrChaykaa", 3, 2, "Пакет повышений ORR/КВ"),
        ("Barsik", 3, 2, "Пакет повышений ORR/КВ"),
        ("Otto", 3, 2, "Пакет повышений ORR/КВ"),
        ("Azure", 3, 2, "Пакет повышений ORR/КВ"),
        ("Trixx", 3, 2, "Пакет повышений ORR/КВ"),
        ("akin0v", 4, 2, "Из тир 4 / резерва"),
        ("yanchik", 4, 2, "Из тир 4 / вне среза"),
        ("Forks", 4, 3, "Пакет повышений"),
        ("ADUN", 4, 3, "Пакет повышений"),
        ("Varyag", 4, 3, "Пакет повышений"),
        ("GAD", 1, 2, "Активность / форма"),
    ]
    day = "2026-10-02"
    for nick, fr, to, note in batch:
        state["transfers"].append(
            {
                "nick": nick,
                "fromTier": fr,
                "toTier": to,
                "dir": "up" if to < fr else "down",
                "at": day,
                "fit": None,
                "note": note,
                "actor": "система",
            }
        )


def snapshot_candidates(fit: dict) -> tuple[list[dict], list[dict], list[dict]]:
    snap = fit.get("snapshot") or {}
    cands = snap.get("candidates") or {}
    return (
        list(cands.get("promote") or []),
        list(cands.get("demote") or []),
        list(cands.get("warn") or []),
    )


def watch_key(kind: str, nick: str, to_tier: int) -> str:
    return f"{kind}:{nick_key(nick)}:{to_tier}"


def run(apply: bool) -> dict[str, Any]:
    if not FIT_PATH.is_file():
        raise SystemExit(f"Missing {FIT_PATH} — run tier_fit_build.py first")
    fit = load_json(FIT_PATH)
    tiers = load_json(TIERS_PATH)
    state = load_json(STATE_PATH) if STATE_PATH.is_file() else empty_state()
    seed_recent_transfers(state)

    promote, demote, warn = snapshot_candidates(fit)
    now = today()
    state["updatedAt"] = now.isoformat()
    state["holdDays"] = HOLD_DAYS
    state["displayDays"] = DISPLAY_DAYS

    # Index current Fit signals
    strong_up: dict[str, dict] = {}
    almost_up: dict[str, dict] = {}
    for row in promote:
        nick = row["nick"]
        key = watch_key("promote", nick, int(row["toTier"]))
        payload = {
            "nick": nick,
            "kind": "promote",
            "fromTier": int(row["fromTier"]),
            "toTier": int(row["toTier"]),
            "fit": float(row["fit"]),
            "band": row.get("band") or "almost",
            "role": row.get("roleLabel") or row.get("role"),
        }
        if row.get("band") == "strong" or float(row["fit"]) >= PROMOTE_STRONG:
            payload["band"] = "strong"
            strong_up[key] = payload
        else:
            almost_up[key] = payload

    hard_down: dict[str, dict] = {}
    soft_down: dict[str, dict] = {}
    for row in demote:
        nick = row["nick"]
        key = watch_key("demote", nick, int(row["toTier"]))
        hard_down[key] = {
            "nick": nick,
            "kind": "demote",
            "fromTier": int(row["fromTier"]),
            "toTier": int(row["toTier"]),
            "fit": float(row["fit"]),
            "band": "hard",
            "role": row.get("roleLabel") or row.get("role"),
        }
    for row in warn:
        nick = row["nick"]
        key = watch_key("demote", nick, int(row["fromTier"]) + 1)
        soft_down[key] = {
            "nick": nick,
            "kind": "demote",
            "fromTier": int(row["fromTier"]),
            "toTier": int(row["fromTier"]) + 1,
            "fit": float(row["fit"]),
            "band": "warn",
            "role": row.get("roleLabel") or row.get("role"),
        }

    old_watches = {watch_key(w["kind"], w["nick"], w["toTier"]): w for w in state.get("watches") or []}
    new_watches: list[dict] = []
    applied: list[dict] = []

    def retain_or_start(signal: dict, days_needed: int) -> None:
        key = watch_key(signal["kind"], signal["nick"], signal["toTier"])
        prev = old_watches.get(key)
        since = parse_ymd(prev["since"]) if prev and prev.get("since") else now
        age = (now - since).days
        entry = {
            **signal,
            "since": since.isoformat(),
            "daysHeld": age,
            "ready": age >= days_needed,
        }
        if apply and entry["ready"]:
            fr, to = move_tier(tiers, signal["nick"], int(signal["toTier"]))
            if fr == to:
                return
            transfer = {
                "nick": signal["nick"],
                "fromTier": fr,
                "toTier": to,
                "dir": "up" if signal["kind"] == "promote" else "down",
                "at": now.isoformat(),
                "fit": signal["fit"],
                "note": f"Авто Fit {signal['fit']:.1f}% · удержание {age}д",
                "actor": "автофит",
            }
            applied.append(transfer)
            state.setdefault("transfers", []).append(transfer)
            print(f"APPLY {transfer['dir']} {transfer['nick']}: T{transfer['fromTier']}→T{transfer['toTier']}")
            return  # do not keep watch after apply
        new_watches.append(entry)

    for sig in strong_up.values():
        retain_or_start(sig, HOLD_DAYS)
    for sig in hard_down.values():
        retain_or_start(sig, HOLD_DAYS)

    state["watches"] = new_watches

    # Prune old transfers
    cutoff = now - timedelta(days=DISPLAY_DAYS)
    kept_transfers = []
    for tr in state.get("transfers") or []:
        try:
            at = parse_ymd(str(tr.get("at") or ""))
        except ValueError:
            continue
        if at >= cutoff:
            kept_transfers.append(tr)
    state["transfers"] = kept_transfers

    # Candidates for board: almost up + warn down + strong/hard still holding
    candidates: list[dict] = []
    for sig in almost_up.values():
        candidates.append(
            {
                "nick": sig["nick"],
                "fromTier": sig["fromTier"],
                "toTier": sig["toTier"],
                "dir": "up",
                "band": "almost",
                "fit": sig["fit"],
                "role": sig.get("role"),
                "note": "Почти · Fit ≥90%",
            }
        )
    for sig in soft_down.values():
        candidates.append(
            {
                "nick": sig["nick"],
                "fromTier": sig["fromTier"],
                "toTier": sig["toTier"],
                "dir": "down",
                "band": "warn",
                "fit": sig["fit"],
                "role": sig.get("role"),
                "note": "Жёлтая зона · Fit 75–85%",
            }
        )
    for w in new_watches:
        candidates.append(
            {
                "nick": w["nick"],
                "fromTier": w["fromTier"],
                "toTier": w["toTier"],
                "dir": "up" if w["kind"] == "promote" else "down",
                "band": "strong" if w["kind"] == "promote" else "hard",
                "fit": w["fit"],
                "role": w.get("role"),
                "since": w["since"],
                "daysHeld": w["daysHeld"],
                "ready": w["ready"],
                "note": (
                    f"{'Сильный ↑' if w['kind'] == 'promote' else 'Форма ↓'} · "
                    f"удержание {w['daysHeld']}/{HOLD_DAYS}д"
                ),
            }
        )

    # Sort candidates: strong/hard first, then by fit
    def cand_sort(c: dict) -> tuple:
        band_rank = {"strong": 0, "hard": 0, "almost": 1, "warn": 2}.get(c.get("band") or "", 3)
        fit = float(c.get("fit") or 0)
        # up: higher fit first; down: lower fit first
        return (band_rank, -fit if c.get("dir") == "up" else fit, c.get("nick") or "")

    candidates.sort(key=cand_sort)

    board = {
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": "tier-autofit · Fit CW-only",
        "holdDays": HOLD_DAYS,
        "displayDays": DISPLAY_DAYS,
        "transfers": [
            {
                "nick": t["nick"],
                "fromTier": t["fromTier"],
                "toTier": t["toTier"],
                "dir": t.get("dir") or ("up" if t["toTier"] < t["fromTier"] else "down"),
                "at": t["at"],
                "fit": t.get("fit"),
                "note": t.get("note"),
            }
            for t in kept_transfers
        ],
        "candidates": candidates,
        "appliedNow": applied,
    }

    if apply and applied:
        note = tiers.get("note") or ""
        stamp = f"Автофит {now.isoformat()}"
        if stamp not in note:
            tiers["note"] = (note + f" · {stamp}").strip(" ·")
        dump_json(TIERS_PATH, tiers)

    dump_json(STATE_PATH, state)
    dump_json(BOARD_PATH, board)

    print(
        f"Board: transfers={len(board['transfers'])} candidates={len(board['candidates'])} "
        f"watches={len(new_watches)} applied={len(applied)} apply={apply}"
    )
    return board


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Execute matured strong/hard watches")
    args = ap.parse_args()
    run(apply=args.apply)


if __name__ == "__main__":
    main()
