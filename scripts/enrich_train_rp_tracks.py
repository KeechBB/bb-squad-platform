#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
One-shot: stamp infantry|vehicle tracks on existing train rp-ledger events
and compute rpInfantry / rpVehicle without re-parsing game logs.

Die/nok while seated in armor need a TRAIN_RP_FULL re-score for perfect split;
vehicle_kill / driver_share / vehicle_loss already have tickets/vehicle.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import rp_log_parse as R  # noqa: E402

START_RP = float(getattr(R, "START_RP", 1000) or 1000)
MIN_RP = float(getattr(R, "MIN_RP", 0) or 0)


def _ledger_paths() -> list[Path]:
    """Prefer platform kv-cache (source of truth), then live site mirror."""
    env = (os.environ.get("BB_KV_PUBLIC") or "").strip()
    cands = []
    if env:
        cands.append(Path(env) / "data" / "training" / "rp-ledger.json")
    cands += [
        Path("/var/www/bb-squad-platform/data/kv-cache/data/training/rp-ledger.json"),
        Path("/var/www/blackberry-kv/data/training/rp-ledger.json"),
        HERE.parents[1] / "KV" / "public" / "data" / "training" / "rp-ledger.json",
    ]
    return cands


def infer_tracks(e: dict) -> tuple[str, str]:
    tr = e.get("track")
    vtr = e.get("victimTrack")
    if tr in ("infantry", "vehicle") and vtr in ("infantry", "vehicle"):
        return str(tr), str(vtr)
    kind = e.get("kind")
    asset = str(e.get("vehicle") or "")
    tickets = e.get("tickets")
    armor = R.is_train_armor_vehicle(asset) if asset else tickets in (10, 15)
    if kind in ("vehicle_loss", "vehicle_loss_driver", "driver_share"):
        t = "vehicle" if armor else "infantry"
        return t, t
    if kind == "vehicle_kill":
        # without seat stamp assume pech LAT → infantry
        return "infantry", "infantry"
    return "infantry", "infantry"


def canon(nick: str) -> str:
    return R.canon_key(nick or "", {})


def apply_delta(store: dict[str, float], key: str, signed: float) -> None:
    if not key:
        return
    cur = store.get(key, START_RP)
    nxt = cur + float(signed)
    if nxt < MIN_RP:
        nxt = MIN_RP
    store[key] = nxt


def main() -> int:
    path = None
    for p in _ledger_paths():
        if p.is_file():
            path = p
            break
    if path is None:
        print("no rp-ledger.json found")
        return 1
    doc = json.loads(path.read_text(encoding="utf-8"))
    players = doc.get("players") or {}
    aliases: dict[str, str] = {}
    rp_inf: dict[str, float] = {}
    rp_veh: dict[str, float] = {}

    # chronological by player matches already sorted
    for _pk, pl in players.items():
        if not isinstance(pl, dict):
            continue
        nick = str(pl.get("nick") or _pk)
        key = canon(nick)
        aliases[key] = key
        rp_inf.setdefault(key, START_RP)
        rp_veh.setdefault(key, START_RP)

    # Re-walk all events in global chrono order across players is hard;
    # approximate: per-player chronological sum of signed deltas (softcap already baked).
    for _pk, pl in players.items():
        if not isinstance(pl, dict):
            continue
        key = canon(str(pl.get("nick") or _pk))
        for hm in pl.get("matches") or []:
            if not isinstance(hm, dict):
                continue
            net_i = 0.0
            net_v = 0.0
            for arr_name, as_victim_default in (
                ("kills", False),
                ("noks", False),
                ("revives", False),
                ("teamkills", False),
                ("deaths", True),
                ("gotNoks", True),
            ):
                for e in hm.get(arr_name) or []:
                    if not isinstance(e, dict):
                        continue
                    tr, vtr = infer_tracks(e)
                    e["track"] = tr
                    e["victimTrack"] = vtr
                    kind = e.get("kind")
                    delta = abs(float(e.get("delta") or 0))
                    vdelta = e.get("victimDelta")
                    kk = canon(str(e.get("killer") or ""))
                    vk = canon(str(e.get("victim") or ""))
                    tk = bool(e.get("teamkill")) or kind == "tk"

                    def bucket(track: str) -> str:
                        return "v" if track == "vehicle" else "i"

                    if not as_victim_default and kk == key:
                        if kind in ("vehicle_loss", "vehicle_loss_driver"):
                            pass
                        elif tk:
                            if bucket(tr) == "v":
                                net_v -= delta
                            else:
                                net_i -= delta
                        elif kind in (
                            "die",
                            "nok",
                            "revive",
                            "vehicle_kill",
                            "driver_share",
                        ):
                            if bucket(tr) == "v":
                                net_v += delta
                            else:
                                net_i += delta
                    if as_victim_default and vk == key:
                        if kind in ("vehicle_loss", "vehicle_loss_driver"):
                            if bucket(vtr) == "v":
                                net_v -= delta
                            else:
                                net_i -= delta
                        elif kind in ("die", "tk") or (
                            kind == "nok" and vdelta is not None
                        ):
                            pen = abs(float(vdelta) if vdelta is not None else delta)
                            if bucket(vtr) == "v":
                                net_v -= pen
                            else:
                                net_i -= pen
            hm["netInfantry"] = round(net_i, 2)
            hm["netVehicle"] = round(net_v, 2)
            # vehicleKills only armor-seat finishes
            hm["vehicleKills"] = sum(
                1
                for e in (hm.get("kills") or [])
                if isinstance(e, dict)
                and e.get("kind") == "vehicle_kill"
                and e.get("track") == "vehicle"
            )
            apply_delta(rp_inf, key, net_i)
            apply_delta(rp_veh, key, net_v)

    def rank_info(val: float) -> dict:
        return R.rp_rank(val)

    def predator_map(store: dict[str, float]) -> dict[str, int]:
        out: dict[str, int] = {}
        place = 0
        for k, val in sorted(store.items(), key=lambda x: -x[1]):
            if rank_info(val).get("predator"):
                place += 1
                out[k] = place
        return out

    pred_i = predator_map(rp_inf)
    pred_v = predator_map(rp_veh)

    for _pk, pl in players.items():
        if not isinstance(pl, dict):
            continue
        key = canon(str(pl.get("nick") or _pk))
        vi = rank_info(rp_inf.get(key, START_RP))
        vv = rank_info(rp_veh.get(key, START_RP))
        pl["rpInfantry"] = round(max(MIN_RP, rp_inf.get(key, START_RP)), 1)
        pl["rankLabelInfantry"] = vi["label"]
        pl["rankKeyInfantry"] = vi["rankKey"]
        pl["predatorPlaceInfantry"] = pred_i.get(key)
        pl["rpVehicle"] = round(max(MIN_RP, rp_veh.get(key, START_RP)), 1)
        pl["rankLabelVehicle"] = vv["label"]
        pl["rankKeyVehicle"] = vv["rankKey"]
        pl["predatorPlaceVehicle"] = pred_v.get(key)

    doc["leaderboardInfantry"] = [
        {
            "nick": pl["nick"],
            "rp": pl["rpInfantry"],
            "rankLabel": pl["rankLabelInfantry"],
            "rankKey": pl["rankKeyInfantry"],
            "predatorPlace": pl.get("predatorPlaceInfantry"),
        }
        for pl in sorted(
            (p for p in players.values() if isinstance(p, dict)),
            key=lambda p: -float(p.get("rpInfantry") or 0),
        )
    ]
    veh_players = []
    for pl in players.values():
        if not isinstance(pl, dict):
            continue
        has_veh = abs(float(pl.get("rpVehicle") or START_RP) - START_RP) > 0.05
        if not has_veh:
            has_veh = any(
                abs(float(hm.get("netVehicle") or 0)) > 0.05
                for hm in (pl.get("matches") or [])
                if isinstance(hm, dict)
            )
        if has_veh:
            veh_players.append(pl)
    veh_players.sort(key=lambda p: -float(p.get("rpVehicle") or 0))
    doc["leaderboardVehicle"] = [
        {
            "nick": pl["nick"],
            "rp": pl["rpVehicle"],
            "rankLabel": pl["rankLabelVehicle"],
            "rankKey": pl["rankKeyVehicle"],
            "predatorPlace": pl.get("predatorPlaceVehicle"),
        }
        for pl in veh_players
    ]

    path.write_text(
        json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"enriched {path}")
    print(f"vehicle board: {len(doc['leaderboardVehicle'])} players")
    # mirror ladder if sibling exists
    ladder = path.with_name("rp-ladder.json")
    if ladder.is_file():
        try:
            ld = json.loads(ladder.read_text(encoding="utf-8"))
            for k, pl in (ld.get("players") or {}).items():
                src = players.get(k) or next(
                    (
                        p
                        for p in players.values()
                        if isinstance(p, dict)
                        and canon(str(p.get("nick") or "")) == canon(str(pl.get("nick") or k))
                    ),
                    None,
                )
                if not isinstance(src, dict) or not isinstance(pl, dict):
                    continue
                for fld in (
                    "rpInfantry",
                    "rankLabelInfantry",
                    "rankKeyInfantry",
                    "predatorPlaceInfantry",
                    "rpVehicle",
                    "rankLabelVehicle",
                    "rankKeyVehicle",
                    "predatorPlaceVehicle",
                ):
                    if fld in src:
                        pl[fld] = src[fld]
                # slim match nets
                by_id = {
                    str(hm.get("id")): hm
                    for hm in (src.get("matches") or [])
                    if isinstance(hm, dict)
                }
                for hm in pl.get("matches") or []:
                    if not isinstance(hm, dict):
                        continue
                    src_hm = by_id.get(str(hm.get("id")))
                    if not src_hm:
                        continue
                    hm["netInfantry"] = src_hm.get("netInfantry")
                    hm["netVehicle"] = src_hm.get("netVehicle")
                    hm["vehicleKills"] = src_hm.get("vehicleKills", hm.get("vehicleKills"))
            ld["leaderboardInfantry"] = doc["leaderboardInfantry"]
            ld["leaderboardVehicle"] = doc["leaderboardVehicle"]
            ladder.write_text(
                json.dumps(ld, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            print(f"enriched {ladder}")
        except Exception as e:
            print(f"ladder skip: {e}")
    # copy to kv-cache if we wrote blackberry-kv
    cache = Path("/var/www/bb-squad-platform/data/kv-cache/data/training")
    if path.resolve() != (cache / "rp-ledger.json").resolve() and cache.is_dir():
        import shutil

        shutil.copy2(path, cache / "rp-ledger.json")
        if ladder.is_file():
            shutil.copy2(ladder, cache / "rp-ladder.json")
        print("mirrored to kv-cache")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
