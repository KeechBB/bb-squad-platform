#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unit + log smoke for vehicle RP (tickets×25, F2/driver, finisher)."""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rp_log_parse as R

assert R.vehicle_tickets("BP_T72S_GFI_C") == 15
assert R.vehicle_tickets("BP_BTR82A_RUS_C") == 10
assert R.vehicle_tickets("BP_AAVP7A1_Woodland_C") == 10
assert R.vehicle_tickets("BP_WPMC_Mobile_Hub_C") == 20
# logi stays 5 (=62.5); unarmed transport/util = 2 (=25); rate 12.5 RP/ticket
assert R.VEHICLE_RP_PER_TICKET == 12.5
assert R.vehicle_tickets("BP_US_Util_USMC_Woodland_Logi_C") == 5
assert R.vehicle_tickets("BP_Ural_375_Logi_MIL_C") == 5
assert R.vehicle_tickets("BP_US_Util_USMC_Woodland_C") == 2
assert R.vehicle_tickets("BP_CPV_Transport_C") == 2
assert R.vehicle_tickets("BP_Kamaz_5350_Desert_C") == 2
assert R.vehicle_tickets("BP_M1151_TOW_Woodland_C") == 5  # armed light
assert R.vehicle_tickets("BP_CPV_M134_C") == 5
assert R.vehicle_base_rp("BP_T72S_GFI_C") == 187.5
assert R.vehicle_base_rp("BP_US_Util_USMC_Woodland_C") == 25
assert R.vehicle_base_rp("BP_US_Util_USMC_Woodland_Logi_C") == 62.5
assert R.vehicle_class_ru("BP_US_Util_USMC_Woodland_C") == "транспорт"
assert R.vehicle_class_ru("BP_US_Util_USMC_Woodland_Logi_C") == "logi"
assert R.use_rp_vehicle("2026-10-16") is False
assert R.use_rp_vehicle("2026-10-17") is True

# Synthetic: tank loss F2+driver + LAT kill
rp: dict[str, float] = {"gunner": 2000.0, "driver": 2000.0, "lat": 2000.0}
disp = {"gunner": "Gunner", "driver": "Driver", "lat": "LAT"}
teams = {"gunner": "1", "driver": "1", "lat": "2"}
t0 = datetime(2026, 10, 17, 12, 0, 0, tzinfo=timezone.utc)


def at(sec: int):
    return t0.replace(second=sec % 60, minute=12 + sec // 60)


hull = "BP_T72S_GFI_C_100"
ops = [
    {
        "kind": "v_enter",
        "at_dt": at(1),
        "at_msk": "15:00:01",
        "nick": "Driver",
        "nickKey": "driver",
        "asset": "BP_T72S_GFI_C",
        "instance": hull,
        "seat": 0,
    },
    {
        "kind": "v_enter",
        "at_dt": at(2),
        "at_msk": "15:00:02",
        "nick": "Gunner",
        "nickKey": "gunner",
        "asset": "BP_T72S_GFI_C",
        "instance": "BP_T72S_GFI_Turret_C_90",
        "seat": 1,
    },
    {
        "kind": "v_exit",
        "at_dt": at(3),
        "at_msk": "15:00:03",
        "nick": "Gunner",
        "nickKey": "gunner",
        "asset": "BP_T72S_GFI_C",
        "instance": "BP_T72S_GFI_Turret_C_90",
        "fullpath": f"x.PersistentLevel.{hull}",
        "seat": 1,
    },
    {
        "kind": "v_exit",
        "at_dt": at(4),
        "at_msk": "15:00:04",
        "nick": "Driver",
        "nickKey": "driver",
        "asset": "BP_T72S_GFI_C",
        "instance": hull,
        "seat": 0,
    },
    {
        "kind": "v_burn",
        "at_dt": at(5),
        "at_msk": "15:00:05",
        "vid": hull,
    },
    {
        "kind": "v_dmg",
        "at_dt": at(5),
        "at_msk": "15:00:05",
        "vid": hull,
        "dmg": 10,
        "causer": "BP_AT4_Rocket_Proj2_C_1",
        "killer": "LAT",
        "killerKey": "lat",
        "health": 50,
        "burning": False,
    },
    {
        "kind": "v_dmg",
        "at_dt": at(6),
        "at_msk": "15:00:06",
        "vid": hull,
        "dmg": 2.5,
        "causer": hull,
        "killer": "LAT",
        "killerKey": "lat",
        "health": -1,
        "burning": True,
    },
]
events, net, *_ = R.score_match_rp(
    dies=[],
    wounds=[],
    revives=[],
    teams=teams,
    rp=rp,
    disp=disp,
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    vehicle_ops=ops,
)
kinds = [e["kind"] for e in events]
assert "vehicle_loss" in kinds, kinds
assert "vehicle_loss_driver" in kinds, kinds
assert "vehicle_kill" in kinds, kinds
loss = next(e for e in events if e["kind"] == "vehicle_loss")
loss_d = next(e for e in events if e["kind"] == "vehicle_loss_driver")
kill = next(e for e in events if e["kind"] == "vehicle_kill")
assert loss["delta"] == 187.5 and loss["victim"] == "Gunner"
assert abs(loss_d["delta"] - 131.25) < 0.01 and loss_d["victim"] == "Driver"
assert kill["delta"] == 187.5 and kill["killer"] == "LAT"
assert abs(net["gunner"] + 187.5) < 0.01
assert abs(net["driver"] + 131.25) < 0.01
assert abs(net["lat"] - 187.5) < 0.01
print("synthetic OK", net)

# Occupied hull: killing blow is logged on the driver nick, and Exited Vehicle
# is stamped a few ms earlier in the same second. Must be a vehicle loss, not an infantry die.
aavp = "BP_AAVP7A1_Woodland_C_900"
boom = datetime(2026, 10, 17, 12, 25, 43, tzinfo=timezone.utc)
occ_ops = [
    {
        "kind": "v_enter",
        "at_dt": boom - timedelta(minutes=5),
        "at_msk": "15:20:43",
        "nick": "Keech",
        "nickKey": "keech",
        "asset": "BP_AAVP7A1_Woodland_C",
        "instance": aavp,
        "seat": 0,
    },
    {
        "kind": "v_dmg",
        "at_dt": boom - timedelta(minutes=2),
        "at_msk": "15:23:43",
        "vid": aavp,
        "dmg": 1400,
        "causer": "BP_RPG7_Tandem_Heat_Proj2_C_1",
        "killer": "Walka",
        "killerKey": "walka",
        "health": 600,
        "burning": False,
    },
    {
        "kind": "v_exit",
        "at_dt": boom,
        "at_msk": "15:25:43",
        "nick": "Keech",
        "nickKey": "keech",
        "asset": "BP_AAVP7A1_Woodland_C",
        "fullpath": f"PersistentLevel.{aavp}",
        "instance": aavp,
        "seat": 0,
    },
    {
        "kind": "v_dmg_named",
        "at_dt": boom + timedelta(milliseconds=989),
        "at_msk": "15:25:43",
        "who": "Keech",
        "whoKey": "keech",
        "dmg": 1400,
        "causer": "BP_RPG7_Tandem_Heat_Proj2_C_2",
        "killer": "Filin",
        "killerKey": "filin",
        "health": -800,
        "burning": False,
    },
]
occ_dies = [
    {
        "killer": "Filin",
        "victim": "Keech",
        "killerKey": "filin",
        "victimKey": "keech",
        "at_dt": boom + timedelta(milliseconds=991),
        "at_msk": "15:25:43",
    }
]
occ_events, occ_net, occ_die_n, *_ = R.score_match_rp(
    dies=occ_dies,
    wounds=[],
    revives=[],
    teams={"keech": "1", "walka": "2", "filin": "2"},
    rp={"keech": 2000.0, "filin": 2000.0, "walka": 2000.0},
    disp={"keech": "Keech", "filin": "Filin", "walka": "Walka"},
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    vehicle_ops=occ_ops,
)
occ_kinds = [(e["kind"], e.get("victim"), e.get("time")) for e in occ_events]
assert ("vehicle_loss_driver", "Keech", "15:25:43") in occ_kinds, occ_kinds
assert not any(e["kind"] == "die" and e.get("victim") == "Keech" for e in occ_events), occ_kinds
assert occ_die_n == 0, occ_die_n
assert any(e["kind"] == "vehicle_kill" and e.get("killer") == "Filin" for e in occ_events)
print("occupied-hull kill OK", occ_net.get("keech"))

from rp_vehicle_engine import VehicleRpEngine

eng = VehicleRpEngine(soft_gain=False, teams={"keech": "1", "filin": "2"}, rp={"keech": 2000.0, "filin": 2000.0}, disp={"keech": "Keech", "filin": "Filin"})
eng_events = []
for op in sorted(occ_ops, key=R._event_sort_key):
    eng_events.extend(eng.handle(op))
assert any(e["kind"] == "vehicle_loss_driver" and e.get("victim") == "Keech" for e in eng_events), eng_events
assert eng.died_in_explosion("keech", boom + timedelta(milliseconds=991))
print("engine occupied-hull OK")

# Real log smoke (Kamaz burn-to-death by LordWolf)
log = (
    Path(__file__).resolve().parent
    / "_tmp_squad_logs"
    / "TR1"
    / "SquadGame.log"
)
if log.is_file():
    idx = R.index_log_combat(log, {})
    t0 = datetime(2026, 10, 11, 19, 0, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 10, 11, 19, 30, 0, tzinfo=timezone.utc)
    ops = R.vehicle_ops_in_window(idx, t0, t1, idx["steam_to_nick"], {})
    print(
        "log ops",
        len(ops),
        "enter",
        sum(1 for o in ops if o["kind"] == "v_enter"),
        "dmg",
        sum(1 for o in ops if o["kind"] == "v_dmg"),
        "burn",
        sum(1 for o in ops if o["kind"] == "v_burn"),
    )
    rp2: dict[str, float] = {}
    disp2: dict[str, str] = {}
    # Force cutover date so scoring runs on this older log window
    ev2, net2, *_ = R.score_match_rp(
        dies=[],
        wounds=[],
        revives=[],
        teams={},
        rp=rp2,
        disp=disp2,
        aliases={},
        new_formula=True,
        match_date="2026-10-17",
        vehicle_ops=ops,
    )
    vk = [e for e in ev2 if e["kind"] == "vehicle_kill"]
    vl = [e for e in ev2 if e["kind"] in ("vehicle_loss", "vehicle_loss_driver")]
    print("vehicle_kill", len(vk), "loss", len(vl))
    kamaz = [e for e in vk if "Kamaz" in str(e.get("vehicle") or e.get("victim") or "")]
    if kamaz:
        print("kamaz kill", kamaz[0]["killer"], kamaz[0]["delta"], kamaz[0].get("weapon"))
    else:
        # show any kill mentioning LordWolf
        lw = [e for e in vk if "LordWolf" in str(e.get("killer"))]
        print("LordWolf kills", len(lw), lw[:3])
    print("sample kills", vk[:5])
else:
    print("skip log smoke — no TR1 SquadGame.log")

print("ALL OK")
