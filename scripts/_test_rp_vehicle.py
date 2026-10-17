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
assert R.use_rp_vehicle("2026-10-17") is False  # no HHMM → pre-cutover safe
assert R.use_rp_vehicle("2026-10-17", "20261017-0059-x") is False
assert R.use_rp_vehicle("2026-10-17", "20261017-0100-x") is True
assert R.use_rp_vehicle("2026-10-18") is True

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
    match_id="20261017-1200-test",
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
    match_id="20261017-1200-test",
    vehicle_ops=occ_ops,
)
occ_kinds = [(e["kind"], e.get("victim"), e.get("time")) for e in occ_events]
assert ("vehicle_loss_driver", "Keech", "15:25:43") in occ_kinds, occ_kinds
assert any(e["kind"] == "die" and e.get("victim") == "Keech" for e in occ_events), occ_kinds
assert occ_die_n == 1, occ_die_n
assert any(e["kind"] == "vehicle_kill" and e.get("killer") == "Filin" for e in occ_events)
print("occupied-hull kill OK", occ_net.get("keech"))

# One-shot occupied kill WITHOUT prior BP_ health sample (Defstrouk/Kornet case).
oneshot_ops = [
    {
        "kind": "v_enter",
        "at_dt": boom,
        "at_msk": "15:39:40",
        "nick": "Rocker",
        "nickKey": "rocker",
        "asset": "BP_BFV_Woodland_C",
        "pawn": "BP_BFV_Woodland_C_100",
        "fullpath": "PersistentLevel.BP_BFV_Woodland_C_100",
        "instance": "BP_BFV_Woodland_C_100",
        "seat": 0,
    },
    {
        "kind": "v_dmg_named",
        "at_dt": boom + timedelta(seconds=7),
        "at_msk": "15:39:47",
        "who": "Rocker",
        "whoKey": "rocker",
        "dmg": 1800,
        "causer": "BP_Kornet_Proj2_C_1",
        "killer": "Defstrouk05",
        "killerKey": "defstrouk05",
        "health": -310,
        "burning": False,
    },
]
os_events, os_net, *_ = R.score_match_rp(
    dies=[],
    wounds=[],
    revives=[],
    teams={"rocker": "1", "defstrouk05": "2"},
    rp={"rocker": 1000.0, "defstrouk05": 1000.0},
    disp={"rocker": "Rocker", "defstrouk05": "Defstrouk05"},
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    match_id="20261017-1200-test",
    vehicle_ops=oneshot_ops,
)
assert any(
    e["kind"] == "vehicle_kill" and e.get("killer") == "Defstrouk05" for e in os_events
), [(e["kind"], e.get("killer"), e.get("label")) for e in os_events]
print("oneshot occupied-hull (no prior BP HP) OK", os_net.get("defstrouk05"))

# Continuity break (INVALID tick) then finishing blow — still credit.
brk_ops = [
    {
        "kind": "v_enter",
        "at_dt": boom,
        "at_msk": "15:43:00",
        "nick": "Enterial",
        "nickKey": "enterial",
        "asset": "BP_US_Util_Woodland_Logi_C",
        "pawn": "BP_US_Util_Woodland_Logi_C_200",
        "fullpath": "PersistentLevel.BP_US_Util_Woodland_Logi_C_200",
        "instance": "BP_US_Util_Woodland_Logi_C_200",
        "seat": 0,
    },
    {
        "kind": "v_dmg_named",
        "at_dt": boom + timedelta(seconds=1),
        "at_msk": "15:43:19",
        "who": "Enterial",
        "whoKey": "enterial",
        "dmg": 31.25,
        "causer": "BP_Projectile_30mm_HE_Green_C_1",
        "killer": "Defstrouk05",
        "killerKey": "defstrouk05",
        "health": 48.27,
        "burning": False,
    },
    {
        "kind": "v_dmg_named",
        "at_dt": boom + timedelta(seconds=2),
        "at_msk": "15:43:20",
        "who": "Enterial",
        "whoKey": "enterial",
        "dmg": 25.0,
        "causer": "BP_Projectile_30mm_HE_Green_C_2",
        "killer": "Defstrouk05",
        "killerKey": "defstrouk05",
        "health": 20.79,  # would fail continuity vs 48.27-25=23.27
        "burning": False,
    },
    {
        "kind": "v_dmg_named",
        "at_dt": boom + timedelta(seconds=2, milliseconds=1),
        "at_msk": "15:43:20",
        "who": "Enterial",
        "whoKey": "enterial",
        "dmg": 31.25,
        "causer": "BP_Projectile_30mm_HE_Green_C_3",
        "killer": "Defstrouk05",
        "killerKey": "defstrouk05",
        "health": -10.46,
        "burning": False,
    },
]
brk_events, brk_net, *_ = R.score_match_rp(
    dies=[],
    wounds=[],
    revives=[],
    teams={"enterial": "1", "defstrouk05": "2"},
    rp={"enterial": 1000.0, "defstrouk05": 1000.0},
    disp={"enterial": "Enterial", "defstrouk05": "Defstrouk05"},
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    match_id="20261017-1200-test",
    vehicle_ops=brk_ops,
)
assert any(
    e["kind"] == "vehicle_kill" and e.get("killer") == "Defstrouk05" for e in brk_events
), [(e["kind"], e.get("killer"), e.get("label")) for e in brk_events]
print("continuity-break occupied finish OK", brk_net.get("defstrouk05"))

from rp_vehicle_engine import VehicleRpEngine

eng = VehicleRpEngine(soft_gain=False, teams={"keech": "1", "filin": "2"}, rp={"keech": 2000.0, "filin": 2000.0}, disp={"keech": "Keech", "filin": "Filin"})
eng_events = []
for op in sorted(occ_ops, key=R._event_sort_key):
    eng_events.extend(eng.handle(op))
assert any(e["kind"] == "vehicle_loss_driver" and e.get("victim") == "Keech" for e in eng_events), eng_events
assert not eng.died_in_explosion("keech", boom + timedelta(milliseconds=991))
print("engine occupied-hull OK")

# A crew knock with no hull death is infantry. Burning or a repair
# dismount does not write off the vehicle.
knock_at = datetime(2026, 10, 17, 12, 39, 2, tzinfo=timezone.utc)
btr = "BP_BTR4_AFU_C_200"
turret = "BP_BTR4_Turret_C_190"
knock_ops = [
    {
        "kind": "v_enter",
        "at_dt": knock_at - timedelta(minutes=6),
        "at_msk": "15:33:02",
        "nick": "Driver",
        "nickKey": "driver",
        "asset": "BP_BTR4_AFU_C",
        "instance": btr,
        "seat": 0,
    },
    {
        "kind": "v_enter",
        "at_dt": knock_at - timedelta(minutes=6, seconds=-3),
        "at_msk": "15:33:05",
        "nick": "Moisha",
        "nickKey": "moisha",
        "asset": "BP_BTR4_AFU_C",
        "instance": turret,
        "pawn": turret,
        "seat": 1,
    },
    {
        "kind": "v_exit",
        "at_dt": knock_at,
        "at_msk": "15:39:02",
        "nick": "Moisha",
        "nickKey": "moisha",
        "asset": "BP_BTR4_AFU_C",
        "instance": turret,
        "fullpath": f"PersistentLevel.{turret}",
        "seat": 1,
    },
    {
        "kind": "v_exit",
        "at_dt": knock_at,
        "at_msk": "15:39:02",
        "nick": "Driver",
        "nickKey": "driver",
        "asset": "BP_BTR4_AFU_C",
        "instance": btr,
        "fullpath": f"PersistentLevel.{btr}",
        "seat": 0,
    },
]
knock_wounds = [
    {
        "killer": "Pr1meT1me",
        "victim": "Moisha",
        "killerKey": "primetime",
        "victimKey": "moisha",
        "at_dt": knock_at + timedelta(milliseconds=2),
        "at_msk": "15:39:02",
    }
]
k_events, k_net, _, _, _, k_noks = R.score_match_rp(
    dies=[],
    wounds=knock_wounds,
    revives=[],
    teams={"moisha": "1", "driver": "1", "primetime": "2"},
    rp={"moisha": 4000.0, "driver": 2000.0, "primetime": 2000.0},
    disp={"moisha": "Moisha", "driver": "Driver", "primetime": "Pr1meT1me"},
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    match_id="20261017-1200-test",
    vehicle_ops=knock_ops,
)
k_kinds = [(e["kind"], e.get("victim")) for e in k_events]
assert ("vehicle_loss", "Moisha") not in k_kinds, k_kinds
assert ("vehicle_loss_driver", "Driver") not in k_kinds, k_kinds
assert any(e["kind"] == "nok" and e.get("victim") == "Moisha" for e in k_events), k_kinds
print("crew knock without a dead hull is infantry OK", k_net.get("moisha"))

# ZBL turret pawn has its own asset name. One hull death = one kill,
# even if the gunner entered the turret before the driver entered the hull.
z_at = datetime(2026, 10, 17, 12, 31, 37, tzinfo=timezone.utc)
z_hull = "BP_ZBL08_HJ73C_Naval_C_2136887826"
z_turret = "BP_ZBL08_Turret_HJ73C_Naval_C_2136887810"
z_ops = [
    {
        "kind": "v_enter",
        "at_dt": z_at - timedelta(minutes=2),
        "at_msk": "15:29:37",
        "nick": "Nahimov",
        "nickKey": "nahimov",
        "asset": "BP_ZBL08_Turret_HJ73C_Naval_C",
        "instance": z_turret,
        "pawn": z_turret,
        "seat": 1,
    },
    {
        "kind": "v_enter",
        "at_dt": z_at - timedelta(minutes=1),
        "at_msk": "15:30:37",
        "nick": "DotaMax",
        "nickKey": "dotamax",
        "asset": "BP_ZBL08_HJ73C_Naval_C",
        "instance": z_hull,
        "seat": 0,
    },
    {
        "kind": "v_dmg_named",
        "at_dt": z_at,
        "at_msk": "15:31:37",
        "who": "DotaMax",
        "whoKey": "dotamax",
        "dmg": 30.0,
        "causer": "BP_BTR4_ZTM1_AP_C_1",
        "killer": "Moisha",
        "killerKey": "moisha",
        "health": -19.12,
        "burning": False,
    },
    {
        "kind": "v_exit",
        "at_dt": z_at,
        "at_msk": "15:31:37",
        "nick": "DotaMax",
        "nickKey": "dotamax",
        "asset": "BP_ZBL08_HJ73C_Naval_C",
        "instance": z_hull,
        "seat": 0,
    },
    {
        "kind": "v_exit",
        "at_dt": z_at,
        "at_msk": "15:31:37",
        "nick": "Nahimov",
        "nickKey": "nahimov",
        "asset": "BP_ZBL08_Turret_HJ73C_Naval_C",
        "instance": z_turret,
        "seat": 1,
    },
]
z_wounds = [
    {
        "killer": "Moisha",
        "victim": "DotaMax",
        "killerKey": "moisha",
        "victimKey": "dotamax",
        "at_dt": z_at + timedelta(milliseconds=3),
        "at_msk": "15:31:37",
    },
    {
        "killer": "Moisha",
        "victim": "Nahimov",
        "killerKey": "moisha",
        "victimKey": "nahimov",
        "at_dt": z_at + timedelta(milliseconds=4),
        "at_msk": "15:31:37",
    },
]
z_events, z_net, *_ = R.score_match_rp(
    dies=[],
    wounds=z_wounds,
    revives=[],
    teams={"dotamax": "2", "nahimov": "2", "moisha": "1"},
    rp={"dotamax": 1000.0, "nahimov": 1000.0, "moisha": 4000.0},
    disp={"dotamax": "DotaMax", "nahimov": "Nahimov", "moisha": "Moisha"},
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    match_id="20261017-1200-test",
    vehicle_ops=z_ops,
)
z_kills = [e for e in z_events if e["kind"] == "vehicle_kill"]
assert len(z_kills) == 1, [(e["kind"], e.get("killer"), e.get("victim"), e.get("label")) for e in z_events]
assert z_kills[0]["killer"] == "Moisha"
assert sum(1 for e in z_events if e["kind"] == "nok") == 2
print("turret pawn is not a second vehicle OK", z_net.get("moisha"))

# Crew give up a minute after the blast. Vehicle RP and the infantry
# life both count: nok, give-up, and the hull.
late = z_at + timedelta(seconds=80)
late_dies = [
    {
        "killer": "Moisha",
        "victim": "DotaMax",
        "killerKey": "moisha",
        "victimKey": "dotamax",
        "at_dt": late,
        "at_msk": "15:32:57",
        "dmg": -300,
    },
    {
        "killer": "Moisha",
        "victim": "Nahimov",
        "killerKey": "moisha",
        "victimKey": "nahimov",
        "at_dt": late + timedelta(seconds=2),
        "at_msk": "15:32:59",
        "dmg": -300,
    },
]
g_events, g_net, g_die, *_ = R.score_match_rp(
    dies=late_dies,
    wounds=z_wounds,
    revives=[],
    teams={"dotamax": "2", "nahimov": "2", "moisha": "1"},
    rp={"dotamax": 1000.0, "nahimov": 1000.0, "moisha": 4000.0},
    disp={"dotamax": "DotaMax", "nahimov": "Nahimov", "moisha": "Moisha"},
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    match_id="20261017-1200-test",
    vehicle_ops=z_ops,
)
assert g_die == 2, [(e["kind"], e.get("victim"), e.get("delta")) for e in g_events if e["kind"] == "die"]
assert sum(1 for e in g_events if e["kind"] == "nok") == 2
assert any(e["kind"] == "die" and e.get("victim") == "DotaMax" and e.get("victimDelta") for e in g_events)
assert any(e["kind"] == "vehicle_kill" for e in g_events)
assert any(e["kind"] == "vehicle_loss" and e.get("victim") == "Nahimov" for e in g_events)
# Revived, then a rifle. That death counts.
rifle_at = late + timedelta(minutes=3)
r_events, _, r_die, *_ = R.score_match_rp(
    dies=[
        {
            "killer": "Moisha",
            "victim": "Nahimov",
            "killerKey": "moisha",
            "victimKey": "nahimov",
            "at_dt": rifle_at,
            "at_msk": "15:35:59",
            "dmg": -300,
        }
    ],
    wounds=z_wounds
    + [
        {
            "killer": "Moisha",
            "victim": "Nahimov",
            "killerKey": "moisha",
            "victimKey": "nahimov",
            "at_dt": rifle_at - timedelta(seconds=20),
            "at_msk": "15:35:39",
        }
    ],
    revives=[
        {
            "killer": "DotaMax",
            "victim": "Nahimov",
            "at_dt": late + timedelta(seconds=30),
            "at_msk": "15:33:29",
        }
    ],
    teams={"dotamax": "2", "nahimov": "2", "moisha": "1"},
    rp={"dotamax": 1000.0, "nahimov": 1000.0, "moisha": 4000.0},
    disp={"dotamax": "DotaMax", "nahimov": "Nahimov", "moisha": "Moisha"},
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    match_id="20261017-1200-test",
    vehicle_ops=z_ops,
)
assert r_die == 1, [(e["kind"], e.get("victim")) for e in r_events]
assert any(e["kind"] == "nok" and e.get("victim") == "Nahimov" for e in r_events)
print("crew give-up counts on top of the vehicle OK", g_net.get("moisha"))

# Live Kamdesh layout: periscope of one ZBL is only ~18 ids from the next
# turret. The turret must follow its own hull (dist 8), and the knock of
# its gunner must not destroy the neighbour.
wave_at = datetime(2026, 10, 17, 12, 31, 37, tzinfo=timezone.utc)
scope = "BP_ZBL08_Commander_Periscope_Naval_C_2136887800"
turret_live = "BP_ZBL08_Turret_HJ73C_Naval_C_2136887818"
other_hull = "BP_ZBL08_HJ73C_Naval_C_2136887784"
real_hull = "BP_ZBL08_HJ73C_Naval_C_2136887826"
wave_ops = [
    {
        "kind": "v_enter",
        "at_dt": wave_at - timedelta(minutes=11),
        "at_msk": "15:20:37",
        "nick": "Nahimov",
        "nickKey": "nahimov",
        "asset": "BP_ZBL08_HJ73C_Naval_C",
        "instance": scope,
        "pawn": scope,
        "seat": 2,
    },
    {
        "kind": "v_exit",
        "at_dt": wave_at - timedelta(minutes=10, seconds=40),
        "at_msk": "15:20:57",
        "nick": "Nahimov",
        "nickKey": "nahimov",
        "asset": "BP_ZBL08_Commander_Periscope_Naval_C",
        "instance": scope,
        "seat": 1,
    },
    {
        "kind": "v_enter",
        "at_dt": wave_at - timedelta(minutes=10, seconds=40),
        "at_msk": "15:20:57",
        "nick": "Nahimov",
        "nickKey": "nahimov",
        "asset": "BP_ZBL08_HJ73C_Naval_C",
        "instance": turret_live,
        "pawn": turret_live,
        "seat": 1,
    },
    {
        "kind": "v_enter",
        "at_dt": wave_at - timedelta(minutes=10),
        "at_msk": "15:21:37",
        "nick": "Farvort",
        "nickKey": "farvort",
        "asset": "BP_ZBL08_HJ73C_Naval_C",
        "instance": other_hull,
        "seat": 0,
    },
    {
        "kind": "v_enter",
        "at_dt": wave_at - timedelta(minutes=9, seconds=50),
        "at_msk": "15:21:47",
        "nick": "DotaMax",
        "nickKey": "dotamax",
        "asset": "BP_ZBL08_HJ73C_Naval_C",
        "instance": real_hull,
        "seat": 0,
    },
    {
        "kind": "v_dmg_named",
        "at_dt": wave_at,
        "at_msk": "15:31:37",
        "who": "DotaMax",
        "whoKey": "dotamax",
        "dmg": 30.0,
        "causer": "BP_BTR4_ZTM1_AP_C_1",
        "killer": "Moisha",
        "killerKey": "moisha",
        "health": -19.12,
        "burning": False,
    },
    {
        "kind": "v_exit",
        "at_dt": wave_at,
        "at_msk": "15:31:37",
        "nick": "DotaMax",
        "nickKey": "dotamax",
        "instance": real_hull,
        "asset": "BP_ZBL08_HJ73C_Naval_C",
        "seat": 0,
    },
    {
        "kind": "v_exit",
        "at_dt": wave_at,
        "at_msk": "15:31:37",
        "nick": "Nahimov",
        "nickKey": "nahimov",
        "instance": turret_live,
        "asset": "BP_ZBL08_Turret_HJ73C_Naval_C",
        "seat": 1,
    },
]
wave_wounds = [
    {
        "killer": "Moisha",
        "victim": "DotaMax",
        "killerKey": "moisha",
        "victimKey": "dotamax",
        "at_dt": wave_at + timedelta(milliseconds=3),
        "at_msk": "15:31:37",
    },
    {
        "killer": "Moisha",
        "victim": "Nahimov",
        "killerKey": "moisha",
        "victimKey": "nahimov",
        "at_dt": wave_at + timedelta(milliseconds=4),
        "at_msk": "15:31:37",
    },
]
w_events, w_net, *_ = R.score_match_rp(
    dies=[],
    wounds=wave_wounds,
    revives=[],
    teams={"dotamax": "2", "nahimov": "2", "moisha": "1", "farvort": "2"},
    rp={"dotamax": 1000.0, "nahimov": 1000.0, "moisha": 4000.0, "farvort": 1000.0},
    disp={
        "dotamax": "DotaMax",
        "nahimov": "Nahimov",
        "moisha": "Moisha",
        "farvort": "Farvort",
    },
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    match_id="20261017-1200-test",
    vehicle_ops=wave_ops,
)
w_kills = [e for e in w_events if e["kind"] == "vehicle_kill"]
w_losses = [e for e in w_events if e["kind"].startswith("vehicle_loss")]
assert len(w_kills) == 1, [(e["kind"], e.get("victim"), e.get("label")) for e in w_events]
assert not any(e.get("victim") == "Farvort" for e in w_losses), w_losses
assert sum(1 for e in w_events if e["kind"] == "nok") == 2
print("spawn-wave turret stays on its own hull OK", w_net.get("moisha"))

# Killing blow is logged on the driver after both crew already exited.
# F2 must still lose the BTR; the kill is credited once.
both_at = datetime(2026, 10, 17, 12, 33, 19, tzinfo=timezone.utc)
btr_hull = "BP_BTR4_AFU_C_2136894020"
btr_tur = "BP_BTR4_Turret_C_2136894009"
both_ops = [
    {
        "kind": "v_enter",
        "at_dt": both_at - timedelta(minutes=12),
        "at_msk": "15:21:19",
        "nick": "Moisha",
        "nickKey": "moisha",
        "asset": "BP_BTR4_AFU_C",
        "instance": btr_tur,
        "pawn": btr_tur,
        "seat": 1,
    },
    {
        "kind": "v_enter",
        "at_dt": both_at - timedelta(minutes=10),
        "at_msk": "15:23:19",
        "nick": "Golub",
        "nickKey": "golub",
        "asset": "BP_BTR4_AFU_C",
        "instance": btr_hull,
        "seat": 0,
    },
    {
        "kind": "v_exit",
        "at_dt": both_at,
        "at_msk": "15:33:19",
        "nick": "Golub",
        "nickKey": "golub",
        "instance": btr_hull,
        "asset": "BP_BTR4_AFU_C",
        "seat": 0,
    },
    {
        "kind": "v_exit",
        "at_dt": both_at,
        "at_msk": "15:33:19",
        "nick": "Moisha",
        "nickKey": "moisha",
        "instance": btr_tur,
        "asset": "BP_BTR4_Turret_C",
        "seat": 1,
    },
    {
        "kind": "v_dmg_named",
        "at_dt": both_at,
        "at_msk": "15:33:19",
        "who": "Golub",
        "whoKey": "golub",
        "dmg": 30.0,
        "causer": "BP_ZBL08_ZPT99_APFSDS_C_1",
        "killer": "Pr1meT1me",
        "killerKey": "primetime",
        "health": -19.0,
        "burning": False,
    },
]
both_wounds = [
    {
        "killer": "Pr1meT1me",
        "victim": "Moisha",
        "killerKey": "primetime",
        "victimKey": "moisha",
        "at_dt": both_at + timedelta(milliseconds=2),
        "at_msk": "15:33:19",
    },
    {
        "killer": "Pr1meT1me",
        "victim": "Golub",
        "killerKey": "primetime",
        "victimKey": "golub",
        "at_dt": both_at + timedelta(milliseconds=2),
        "at_msk": "15:33:19",
    },
]
b_events, b_net, *_ = R.score_match_rp(
    dies=[],
    wounds=both_wounds,
    revives=[],
    teams={"moisha": "1", "golub": "1", "primetime": "2"},
    rp={"moisha": 4000.0, "golub": 1000.0, "primetime": 2000.0},
    disp={"moisha": "Moisha", "golub": "Golub", "primetime": "Pr1meT1me"},
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    match_id="20261017-1200-test",
    vehicle_ops=both_ops,
)
assert sum(1 for e in b_events if e["kind"] == "vehicle_kill") == 1, b_events
assert any(e["kind"] == "vehicle_loss" and e.get("victim") == "Moisha" for e in b_events), [
    (e["kind"], e.get("victim")) for e in b_events
]
assert any(e["kind"] == "vehicle_loss_driver" and e.get("victim") == "Golub" for e in b_events)
assert sum(1 for e in b_events if e["kind"] == "nok") == 2
print("gunner still liable after driver-named kill OK", b_net.get("moisha"))

# The hull pool can be written on the gunner, not only the driver.
# Both still lose. A Bradley round that names the F2 is the same death.
gun_at = datetime(2026, 10, 17, 12, 39, 2, tzinfo=timezone.utc)
gun_hull = "BP_BTR4_AFU_C_2145106980"
gun_tur = "BP_BTR4_Turret_C_2145106969"
gun_ops = [
    {
        "kind": "v_enter",
        "at_dt": gun_at - timedelta(minutes=6),
        "at_msk": "15:33:02",
        "nick": "Keech",
        "nickKey": "keech",
        "asset": "BP_BTR4_AFU_C",
        "instance": gun_tur,
        "pawn": gun_tur,
        "seat": 1,
    },
    {
        "kind": "v_enter",
        "at_dt": gun_at - timedelta(minutes=5),
        "at_msk": "15:34:02",
        "nick": "Mount",
        "nickKey": "mount",
        "asset": "BP_BTR4_AFU_C",
        "instance": gun_hull,
        "seat": 0,
    },
    {
        "kind": "v_exit",
        "at_dt": gun_at,
        "at_msk": "15:39:02",
        "nick": "Mount",
        "nickKey": "mount",
        "instance": gun_hull,
        "asset": "BP_BTR4_AFU_C",
        "seat": 0,
    },
    {
        "kind": "v_exit",
        "at_dt": gun_at,
        "at_msk": "15:39:02",
        "nick": "Keech",
        "nickKey": "keech",
        "instance": gun_tur,
        "asset": "BP_BTR4_Turret_C",
        "seat": 1,
    },
    {
        "kind": "v_dmg_named",
        "at_dt": gun_at,
        "at_msk": "15:39:02",
        "who": "Keech",
        "whoKey": "keech",
        "dmg": 35.0,
        "causer": "BFV_M252_AP_Woodland_C_1",
        "killer": "Android",
        "killerKey": "android",
        "health": -21.3,
        "burning": False,
    },
]
gun_wounds = [
    {
        "killer": "Android",
        "victim": "Keech",
        "killerKey": "android",
        "victimKey": "keech",
        "at_dt": gun_at + timedelta(milliseconds=3),
        "at_msk": "15:39:02",
    },
    {
        "killer": "Android",
        "victim": "Mount",
        "killerKey": "android",
        "victimKey": "mount",
        "at_dt": gun_at + timedelta(milliseconds=3),
        "at_msk": "15:39:02",
    },
]
g_events, g_net, *_ = R.score_match_rp(
    dies=[],
    wounds=gun_wounds,
    revives=[],
    teams={"keech": "1", "mount": "1", "android": "2"},
    rp={"keech": 2000.0, "mount": 1000.0, "android": 2000.0},
    disp={"keech": "Keech", "mount": "Mount", "android": "Android"},
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    match_id="20261017-1200-test",
    vehicle_ops=gun_ops,
)
assert any(e["kind"] == "vehicle_loss" and e.get("victim") == "Keech" for e in g_events), [
    (e["kind"], e.get("victim")) for e in g_events
]
assert any(e["kind"] == "vehicle_loss_driver" and e.get("victim") == "Mount" for e in g_events)
assert sum(1 for e in g_events if e["kind"] == "vehicle_kill") == 1
assert sum(1 for e in g_events if e["kind"] == "nok") == 2
print("gunner-named hull death charges both crew OK", g_net.get("keech"))

# Driver hopped out to repair and was knocked. Hull never reached 0.
repair_at = datetime(2026, 10, 17, 12, 40, 0, tzinfo=timezone.utc)
repair_ops = [
    {
        "kind": "v_enter",
        "at_dt": repair_at - timedelta(minutes=2),
        "at_msk": "15:38:00",
        "nick": "Driver",
        "nickKey": "driver",
        "asset": "BP_BTR4_AFU_C",
        "instance": "BP_BTR4_AFU_C_300",
        "seat": 0,
    },
    {
        "kind": "v_dmg_named",
        "at_dt": repair_at - timedelta(seconds=30),
        "at_msk": "15:39:30",
        "who": "Driver",
        "whoKey": "driver",
        "dmg": 40.0,
        "causer": "BFV_M252_AP_Woodland_C_2",
        "killer": "Android",
        "killerKey": "android",
        "health": 600.0,
        "burning": False,
    },
    {
        "kind": "v_exit",
        "at_dt": repair_at,
        "at_msk": "15:40:00",
        "nick": "Driver",
        "nickKey": "driver",
        "instance": "BP_BTR4_AFU_C_300",
        "asset": "BP_BTR4_AFU_C",
        "seat": 0,
    },
]
repair_wounds = [
    {
        "killer": "Android",
        "victim": "Driver",
        "killerKey": "android",
        "victimKey": "driver",
        "at_dt": repair_at + timedelta(seconds=8),
        "at_msk": "15:40:08",
    }
]
r_events, *_ = R.score_match_rp(
    dies=[],
    wounds=repair_wounds,
    revives=[],
    teams={"driver": "1", "android": "2"},
    rp={"driver": 1000.0, "android": 2000.0},
    disp={"driver": "Driver", "android": "Android"},
    aliases={},
    new_formula=True,
    match_date="2026-10-17",
    match_id="20261017-1200-test",
    vehicle_ops=repair_ops,
)
assert not any(e["kind"].startswith("vehicle_loss") for e in r_events), [
    (e["kind"], e.get("victim")) for e in r_events
]
assert any(e["kind"] == "nok" for e in r_events)
print("dismounted repair death leaves the hull alive OK")

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
    match_id="20261017-1200-test",
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
