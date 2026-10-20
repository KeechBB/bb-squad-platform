# -*- coding: utf-8 -*-
"""Проверка тренировочных матчей: строки разбора сходятся с net.

На диске у матча нет общего events (их срезают после скоринга).
Скрипт идёт по player.matches и складывает килы, ноки, технику,
смерти, ресы и «меня нокнул» теми же знаками, что экран разбора.

  python scripts/check_train_rp_matches.py --last 2
  python scripts/check_train_rp_matches.py --ids 20-lashkar,20-sanxian

Код выхода 1, если у кого-то сумма строк не равна net.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLATFORM = HERE.parent
EPS = 0.15


def _candidates() -> list[Path]:
    env = (os.environ.get("TRAIN_RP_LEDGER") or "").strip()
    raw = [
        env,
        PLATFORM / "data" / "kv-cache" / "data" / "training" / "rp-ledger.json",
        Path("/var/www/bb-squad-platform/data/kv-cache/data/training/rp-ledger.json"),
        PLATFORM.parent / "KV" / "public" / "data" / "training" / "rp-ledger.json",
        Path("/var/www/blackberry-kv/data/training/rp-ledger.json"),
    ]
    out: list[Path] = []
    for p in raw:
        if not p:
            continue
        path = Path(p)
        if path.is_file() and path not in out:
            out.append(path)
    return out


def _mag(e: dict, field: str = "delta") -> float:
    return abs(float(e.get(field) or 0))


def victim_loss(e: dict) -> float:
    """Потеря жертвы. Die/TK/nok — victimDelta. TK-нок без него = 0."""
    if e.get("victimDelta") is not None:
        return abs(float(e.get("victimDelta") or 0))
    if e.get("teamkill") or e.get("kind") == "tk":
        return 0.0
    return _mag(e)


def _is_vehicle_loss(e: dict) -> bool:
    return str(e.get("kind") or "") in ("vehicle_loss", "vehicle_loss_driver")


def _is_share_nok(e: dict) -> bool:
    return e.get("kind") == "driver_share" and e.get("reason") == "nok"


def _is_share_vehicle(e: dict) -> bool:
    return e.get("kind") == "driver_share" and e.get("reason") == "vehicle_kill"


def column_sum(m: dict) -> tuple[float, dict]:
    """Сумма, которую должен показать детальный разбор."""
    raw_kills = list(m.get("kills") or [])
    share_noks = [e for e in raw_kills if _is_share_nok(e)]
    vehicle_from_kills = [
        e
        for e in raw_kills
        if e.get("kind") == "vehicle_kill" or _is_share_vehicle(e)
    ]
    kills = [
        e
        for e in raw_kills
        if not _is_share_nok(e)
        and e.get("kind") != "vehicle_kill"
        and not _is_share_vehicle(e)
    ]
    deaths_raw = list(m.get("deaths") or [])
    losses = [e for e in deaths_raw if _is_vehicle_loss(e)]
    deaths = [e for e in deaths_raw if not _is_vehicle_loss(e)]
    vehicles = list(m.get("vehicles") or [])

    def already(rows: list[dict], e: dict) -> bool:
        return any(
            v.get("time") == e.get("time")
            and v.get("kind") == e.get("kind")
            and v.get("victim") == e.get("victim")
            for v in rows
        )

    vehicle_events = list(vehicles)
    for e in vehicle_from_kills + losses:
        if not already(vehicle_events, e):
            vehicle_events.append(e)

    s = 0.0
    counts = {
        "noks": 0,
        "kills": 0,
        "vehicle_gain": 0,
        "vehicle_loss": 0,
        "deaths": 0,
        "revives": 0,
        "got": 0,
        "driver_share_die": 0,
        "driver_share_veh": 0,
    }
    for e in list(m.get("noks") or []) + share_noks:
        counts["noks"] += 1
        s += -_mag(e) if e.get("teamkill") else _mag(e)
    for e in kills:
        counts["kills"] += 1
        if e.get("kind") == "driver_share" and e.get("reason") == "die":
            counts["driver_share_die"] += 1
        if e.get("kind") == "tk" or e.get("teamkill") or _is_vehicle_loss(e):
            s -= _mag(e)
        else:
            s += _mag(e)
    for e in m.get("teamkills") or []:
        counts["kills"] += 1
        s -= _mag(e)
    for e in vehicle_events:
        if e.get("kind") == "vehicle_kill" or _is_share_vehicle(e):
            counts["vehicle_gain"] += 1
            if _is_share_vehicle(e):
                counts["driver_share_veh"] += 1
            s += _mag(e)
        elif _is_vehicle_loss(e):
            counts["vehicle_loss"] += 1
            s -= _mag(e)
    for e in deaths:
        counts["deaths"] += 1
        s -= victim_loss(e)
    for e in m.get("revives") or []:
        counts["revives"] += 1
        s += _mag(e)
    for e in m.get("gotNoks") or []:
        counts["got"] += 1
        s -= victim_loss(e)
    return round(s, 2), counts


def _match_index(data: dict) -> list[dict]:
    rows = []
    for m in data.get("matches") or []:
        rows.append(
            {
                "id": str(m.get("id") or ""),
                "date": str(m.get("date") or ""),
                "map": str(m.get("map") or ""),
            }
        )
    rows.sort(key=lambda r: (r["date"], r["id"]))
    return rows


def audit(data: dict, ids: list[str]) -> list[dict]:
    players = data.get("players") or {}
    bad: list[dict] = []
    for mid in ids:
        players_n = 0
        with_revives = 0
        share_die = 0
        share_veh = 0
        for pl in players.values():
            for m in pl.get("matches") or []:
                if str(m.get("id") or "") != mid:
                    continue
                players_n += 1
                got, counts = column_sum(m)
                claimed = round(float(m.get("net") or 0), 2)
                with_revives += 1 if counts["revives"] else 0
                share_die += counts["driver_share_die"]
                share_veh += counts["driver_share_veh"]
                if abs(got - claimed) > EPS:
                    bad.append(
                        {
                            "id": mid,
                            "nick": pl.get("nick") or "",
                            "net": claimed,
                            "sum": got,
                            "diff": round(got - claimed, 2),
                            **counts,
                        }
                    )
        print(
            f"{mid}: players={players_n} revives={with_revives} "
            f"gunner_kills={share_die} gunner_vehicles={share_veh} "
            f"mismatch={sum(1 for b in bad if b['id'] == mid)}"
        )
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description="Проверка RP тренировочных матчей")
    ap.add_argument("--ledger", default="", help="путь к rp-ledger.json")
    ap.add_argument("--ids", default="", help="id через запятую")
    ap.add_argument("--last", type=int, default=2, help="сколько последних матчей")
    args = ap.parse_args()

    path = Path(args.ledger) if args.ledger else None
    if path is None:
        found = _candidates()
        if not found:
            print("rp-ledger.json не найден", file=sys.stderr)
            return 2
        path = found[0]
    if not path.is_file():
        print(f"нет файла {path}", file=sys.stderr)
        return 2

    data = json.loads(path.read_text(encoding="utf-8"))
    index = _match_index(data)
    if args.ids.strip():
        ids = [x.strip() for x in args.ids.split(",") if x.strip()]
    else:
        ids = [r["id"] for r in index[-max(1, args.last) :]]
    by_id = {r["id"]: r for r in index}
    print(f"ledger {path}")
    for mid in ids:
        meta = by_id.get(mid) or {}
        print(f"  {mid}  {meta.get('date', '')}  {meta.get('map', '')}")

    bad = audit(data, ids)
    if not bad:
        print("OK: суммы строк равны net")
        return 0
    print(f"FAIL: {len(bad)}")
    for row in bad[:40]:
        print(
            f"  {row['id']} {row['nick']}: net {row['net']} sum {row['sum']} "
            f"diff {row['diff']}"
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
