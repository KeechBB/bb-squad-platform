#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build training RP (Respect Points) ledger from TR1 logs.

- Only final deaths: Die() that puts victim Inactive (not Wound/nok).
- Enemy Die(): zero-sum — killer +delta, victim -delta.
- Teamkill Die(): BOTH lose — killer -delta, victim -delta (no + for TK).
- Revive (has revived): medic gains +delta*0.6 only (patient not charged).
- Weight: delta=1+49*(Pv-Pk+Pmax-1)/(2*(Pmax-1))
  Pk = actor PWR (killer or medic), Pv = other PWR (victim or patient)
- Wound()/nok = 0. PWR stays hidden weight.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / "_tmp_tr1_logs_cache"
TRAIN = HERE.parents[1] / "KV" / "public" / "data" / "training"
PLAYERS = TRAIN / "players"
TIERS = HERE.parents[1] / "KV" / "public" / "data" / "tiers.json"
OUT = TRAIN / "rp-ledger.json"

START_RP = 1000.0
# Revive gives the same weight formula as Die, then scaled — medics shouldn't leapfrog tops
REVIVE_COEF = 0.6
LINE_TS = re.compile(r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]")
PC_STEAM = re.compile(
    r"PC=(?P<nick>[^\s(]+)\s*\(Online IDs:\s*EOS:\s*(?P<eos>[0-9a-fA-F]+)\s+steam:\s*(?P<steam>7656\d+)",
    re.I,
)
DIE_RE = re.compile(
    r"Die\(\):\s*Player:(?P<victim>.+?)\s+KillingDamage=(?P<dmg>[-\d.]+)\s+from\s+\S+\s+"
    r"\(Online IDs:\s*EOS:\s*(?P<eos>[0-9a-fA-F]+)\s+steam:\s*(?P<steam>7656\d+)",
    re.I,
)
REVIVE_RE = re.compile(
    r"LogSquad:\s*(?P<medic>.+?)\s*\(Online IDs:\s*EOS:\s*[0-9a-fA-F]+\s+steam:\s*(?P<msteam>7656\d+)\)\s+"
    r"has revived\s+(?P<patient>.+?)\s*\(Online IDs:\s*EOS:\s*[0-9a-fA-F]+\s+steam:\s*(?P<psteam>7656\d+)\)",
    re.I,
)
TAG_RE = re.compile(r"^\[(?:BB|BBCOP|BBC|BBr)\]\s*", re.I)
INACTIVE_RE = re.compile(
    r"ChangeState\(\):\s*PC=(?P<nick>.+?)\s+\(Online IDs:.*?steam:\s*(?P<steam>7656\d+)\).*?"
    r"OldState=Playing\s+NewState=Inactive",
    re.I,
)

# chronological
MATCHES = [
    {
        "id": "29-albasrah",
        "map": "SEC 26 AlBasrah AAS v1",
        "date": "2026-09-29",
        "log": "SquadGame-backup-2026.09.30-03.00.27.log",
        "start": datetime(2026, 9, 29, 19, 56, 44, tzinfo=timezone.utc),
        "end": datetime(2026, 9, 29, 20, 35, 50, tzinfo=timezone.utc),
    },
    {
        "id": "29-albasrah-2",
        "map": "SEC 26 AlBasrah AAS v1",
        "date": "2026-09-29",
        "log": "SquadGame-backup-2026.09.30-03.00.27.log",
        "start": datetime(2026, 9, 29, 20, 35, 50, tzinfo=timezone.utc),
        "end": datetime(2026, 9, 29, 21, 20, 13, tzinfo=timezone.utc),
    },
    {
        "id": "30-mutaha",
        "map": "Mutaha AAS v1",
        "date": "2026-09-30",
        "log": "SquadGame-backup-2026.10.01-03.00.20.log",
        "start": datetime(2026, 9, 30, 19, 23, 28, tzinfo=timezone.utc),
        "end": datetime(2026, 9, 30, 20, 10, 31, tzinfo=timezone.utc),
    },
    {
        "id": "30-narva",
        "map": "Narva AAS v2",
        "date": "2026-09-30",
        "log": "SquadGame-backup-2026.10.01-03.00.20.log",
        "start": datetime(2026, 9, 30, 20, 10, 31, tzinfo=timezone.utc),
        "end": datetime(2026, 9, 30, 20, 53, 3, tzinfo=timezone.utc),
    },
    {
        "id": "02-gorodok",
        "map": "Gorodok AAS v1",
        "date": "2026-10-02",
        "log": "SquadGame-2026.10.02-gorodok.log",
        # InProgress → WaitingPostMatch (после 21:30 МСК, >10 мин, не Jensen)
        "start": datetime(2026, 10, 2, 18, 45, 39, tzinfo=timezone.utc),
        "end": datetime(2026, 10, 2, 19, 34, 25, tzinfo=timezone.utc),
    },
    {
        "id": "02-mutaha",
        "map": "Mutaha RAAS v1",
        "date": "2026-10-02",
        "log": "SquadGame-2026.10.02-mutaha.log",
        # InProgress 22:48:25 → WaitingPostMatch 23:27:00 МСК
        "start": datetime(2026, 10, 2, 19, 48, 25, tzinfo=timezone.utc),
        "end": datetime(2026, 10, 2, 20, 27, 0, tzinfo=timezone.utc),
    },
    {
        "id": "02-fallujah",
        "map": "Fallujah AAS v1",
        "date": "2026-10-02",
        "log": "SquadGame-2026.10.02-fallujah.log",
        # InProgress 23:29:49 → WaitingPostMatch 00:32:42 МСК (+1)
        "start": datetime(2026, 10, 2, 20, 29, 49, tzinfo=timezone.utc),
        "end": datetime(2026, 10, 2, 21, 32, 42, tzinfo=timezone.utc),
    },
    {
        "id": "03-kokan",
        "map": "Kokan AAS v2",
        "date": "2026-10-03",
        "log": "SquadGame-2026.10.03-kokan.log",
        # InProgress 21:40:55 → WaitingPostMatch 22:38:06 МСК · RGF 44–0
        "start": datetime(2026, 10, 3, 18, 40, 55, tzinfo=timezone.utc),
        "end": datetime(2026, 10, 3, 19, 38, 6, tzinfo=timezone.utc),
    },
    {
        "id": "03-chora",
        "map": "Chora AAS v3",
        "date": "2026-10-03",
        "log": "SquadGame-2026.10.03-chora.log",
        # InProgress 22:39:16 → WaitingPostMatch ~23:30:53 МСК · RGF 100–0 · 51:37
        "start": datetime(2026, 10, 3, 19, 39, 16, tzinfo=timezone.utc),
        "end": datetime(2026, 10, 3, 20, 30, 53, tzinfo=timezone.utc),
    },
    {
        "id": "03-foolsroad",
        "map": "Fool's Road RAAS v1",
        "date": "2026-10-03",
        "log": "SquadGame-2026.10.03-foolsroad.log",
        # InProgress 23:33:21 → WaitingPostMatch 00:40:11 МСК · PLA 3–0 · 66:50
        "start": datetime(2026, 10, 3, 20, 33, 21, tzinfo=timezone.utc),
        "end": datetime(2026, 10, 3, 21, 40, 11, tzinfo=timezone.utc),
    },
]

RANK_NAMES = [
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
ROMAN = ("I", "II", "III")
STEP = 150
RADIANT3_MAX = 1 + 30 * STEP - 1  # 4500


def strip_tag(n: str) -> str:
    n = (n or "").strip()
    if "?" in n:
        n = n.split("?", 1)[0]
    n = TAG_RE.sub("", n).strip()
    n = re.sub(r"^\[[^\]]+\]\s*", "", n).strip()
    return n


def nick_key(n: str) -> str:
    return re.sub(r"\s+", "", strip_tag(n).lower())


def load_alias_keys() -> dict[str, str]:
    """alias nick_key → canon nick_key (from tiers.json)."""
    out: dict[str, str] = {}
    if not TIERS.is_file():
        return out
    t = json.loads(TIERS.read_text(encoding="utf-8"))
    for raw, canon in (t.get("aliases") or {}).items():
        ak, ck = nick_key(str(raw)), nick_key(str(canon))
        if ak and ck:
            out[ak] = ck
            out.setdefault(ck, ck)
    return out


def canon_key(n: str, aliases: dict[str, str]) -> str:
    k = nick_key(n)
    return aliases.get(k, k)


def parse_ts(raw: str) -> datetime:
    raw = raw.rsplit(":", 1)[0] if re.search(r":\d{3}$", raw) else raw
    y, mo, d = raw[:10].split(".")
    h, mi, s = raw[11:].split(".")
    return datetime(int(y), int(mo), int(d), int(h), int(mi), int(s), tzinfo=timezone.utc)


def soft_sat(x: float, mid: float) -> float:
    v = max(0.0, x)
    return v / (v + (mid or 1.0))


def calc_pwr(g, w, r, n, k, d, c, tier: int) -> float:
    g = max(1, g)
    rr, nn, kk, dd, cc = r / g, n / g, k / g, d / g, c / g
    ww = w / g
    R, N, K, C = soft_sat(rr, 4), soft_sat(nn, 3), soft_sat(kk, 2.5), soft_sat(cc, 150)
    Surv = 1 - soft_sat(dd, 6)
    Support = 0.7 * R + 0.15 * N + 0.15 * C
    Fight = 0.35 * K + 0.25 * N + 0.3 * C + 0.1 * R
    Role = 0.65 * max(Support, Fight) + 0.35 * ((Support + Fight) / 2)
    Impact = 0.55 * Role + 0.2 * Surv + 0.25 * ww
    Conf = g / (g + 5)
    tm = {1: 1.4, 2: 1.3, 3: 1.2, 4: 1.1}.get(tier, 1.1)
    kd = (k / d) if d > 0 else (k if k > 0 else 1.0)
    return max(0.0, min(1000.0, 1000 * Impact * Conf * tm * (0.9 if kd < 1 else 1.0)))


def hunt_delta(pk: float, pv: float, pmax: float) -> float:
    """Pk = actor (killer/medic), Pv = other (victim/patient)."""
    pk = min(max(float(pk), 1.0), pmax)
    pv = min(max(float(pv), 1.0), pmax)
    if pmax <= 1:
        return 25.5
    return 1 + 49 * (pv - pk + pmax - 1) / (2 * (pmax - 1))


def rp_rank(rp: float) -> dict:
    rp_i = int(round(rp))
    if rp_i > RADIANT3_MAX:
        return {
            "label": "PREDATOR",
            "rankKey": "predator",
            "roman": "",
            "level": 30,
            "predator": True,
        }
    idx = 0 if rp_i < 1 else min(29, (rp_i - 1) // STEP)
    name, key = RANK_NAMES[idx // 3]
    roman = ROMAN[idx % 3]
    return {
        "label": f"{name.upper()} {roman}",
        "rankKey": key,
        "roman": roman,
        "level": idx,
        "predator": False,
    }


def load_pwr_map() -> tuple[dict[str, float], dict[str, str]]:
    tier_of: dict[str, int] = {}
    if TIERS.is_file():
        t = json.loads(TIERS.read_text(encoding="utf-8"))
        for i, field in enumerate(("tier1", "tier2", "tier3"), start=1):
            for n in t.get(field) or []:
                tier_of[nick_key(str(n))] = i
    agg: dict[str, dict] = {}
    disp: dict[str, str] = {}
    for fp in PLAYERS.glob("*.json"):
        dataj = json.loads(fp.read_text(encoding="utf-8"))
        rows = list(dataj.get("teamA") or []) + list(dataj.get("teamB") or [])
        for row in rows:
            if not isinstance(row, dict):
                continue
            nick = str(row.get("nick") or "").strip()
            if not nick:
                continue
            k = nick_key(nick)
            disp[k] = nick
            a = agg.setdefault(
                k, {"games": 0, "wins": 0, "res": 0, "nok": 0, "kills": 0, "deaths": 0, "dmg": 0}
            )
            a["games"] += 1
            if row.get("won") is True:
                a["wins"] += 1
            for f in ("res", "nok", "kills", "deaths", "dmg"):
                a[f] += float(row.get(f) or 0)
    pwr = {
        k: calc_pwr(
            a["games"], a["wins"], a["res"], a["nok"], a["kills"], a["deaths"], a["dmg"], tier_of.get(k, 4)
        )
        for k, a in agg.items()
    }
    # site freeze for known leaders
    pwr["diray"] = 737.0
    pwr["mukuru"] = 705.0
    return pwr, disp


def build_steam_map(log_paths: list[Path]) -> dict[str, str]:
    steam_to_nick: dict[str, str] = {}
    for path in log_paths:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                for m in PC_STEAM.finditer(line):
                    steam_to_nick[m.group("steam")] = strip_tag(m.group("nick"))
    return steam_to_nick


def parse_inactive_times(
    log_path: Path, t0: datetime, t1: datetime
) -> dict[str, list[datetime]]:
    """nick_key / steam → times of Playing→Inactive (final death / leave-to-respawn)."""
    by_nick: dict[str, list[datetime]] = {}
    by_steam: dict[str, list[datetime]] = {}
    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if "NewState=Inactive" not in line or "ChangeState():" not in line:
                continue
            tm = LINE_TS.match(line)
            im = INACTIVE_RE.search(line)
            if not tm or not im:
                continue
            at = parse_ts(tm.group("ts"))
            if not (t0 <= at < t1):
                continue
            nick = strip_tag(im.group("nick"))
            steam = im.group("steam")
            by_nick.setdefault(nick_key(nick), []).append(at)
            by_steam.setdefault(steam, []).append(at)
    for d in (by_nick, by_steam):
        for k in d:
            d[k].sort()
    return by_nick


def _has_inactive_soon(
    times: list[datetime], at: datetime, pad_sec: float = 8.0
) -> bool:
    """True if Playing→Inactive within pad_sec after Die()."""
    lo = at
    hi = at + timedelta(seconds=pad_sec)
    for t in times:
        if t < lo:
            continue
        if t <= hi:
            return True
        return False
    return False


def parse_dies(
    log_path: Path,
    t0: datetime,
    t1: datetime,
    steam_to_nick: dict[str, str],
    aliases: dict[str, str],
) -> list[dict]:
    """Final deaths only: Die() confirmed by victim Playing→Inactive shortly after."""
    inactive_by_nick = parse_inactive_times(log_path, t0, t1)
    # also index inactive by scanning steam from same ChangeState lines
    inactive_by_steam: dict[str, list[datetime]] = {}
    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if "NewState=Inactive" not in line or "ChangeState():" not in line:
                continue
            tm = LINE_TS.match(line)
            im = INACTIVE_RE.search(line)
            if not tm or not im:
                continue
            at = parse_ts(tm.group("ts"))
            if not (t0 <= at < t1):
                continue
            inactive_by_steam.setdefault(im.group("steam"), []).append(at)
    for k in inactive_by_steam:
        inactive_by_steam[k].sort()

    # victim nick → steam from possess/PC lines inside window
    victim_steam: dict[str, str] = {}
    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if "PC=" not in line or "steam:" not in line:
                continue
            tm = LINE_TS.match(line)
            if not tm:
                continue
            at = parse_ts(tm.group("ts"))
            if at < t0 - timedelta(minutes=30) or at >= t1:
                continue
            for m in PC_STEAM.finditer(line):
                victim_steam[canon_key(m.group("nick"), aliases)] = m.group("steam")

    out = []
    skipped_nok = 0
    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if "Die():" not in line:
                continue
            tm = LINE_TS.match(line)
            dm = DIE_RE.search(line)
            if not tm or not dm:
                continue
            at = parse_ts(tm.group("ts"))
            if not (t0 <= at < t1):
                continue
            victim = strip_tag(dm.group("victim"))
            vk = canon_key(victim, aliases)
            vsteam = victim_steam.get(vk, "")
            times = inactive_by_nick.get(vk) or []
            if vsteam and inactive_by_steam.get(vsteam):
                times = inactive_by_steam[vsteam]
            if not _has_inactive_soon(times, at):
                # Die without going Inactive ≈ not a ticket/final death (ignore)
                skipped_nok += 1
                continue
            steam = dm.group("steam")
            killer = steam_to_nick.get(steam, f"?{steam[-6:]}")
            kk = canon_key(killer, aliases)
            out.append(
                {
                    "kind": "die",
                    "at": at.isoformat(),
                    "at_msk": (at + timedelta(hours=3)).strftime("%H:%M:%S"),
                    "killer": strip_tag(killer),
                    "killerKey": kk,
                    "victim": victim,
                    "victimKey": vk,
                    "steam": steam,
                }
            )
    if skipped_nok:
        print(f"  skipped {skipped_nok} Die() without Inactive (not final)")
    return out


def load_match_teams(match_id: str, aliases: dict[str, str]) -> dict[str, str]:
    """nick_key → 'A' | 'B' from players JSON."""
    fp = PLAYERS / f"{match_id}.json"
    if not fp.is_file():
        return {}
    pj = json.loads(fp.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for side, rows in (("A", pj.get("teamA") or []), ("B", pj.get("teamB") or [])):
        for row in rows:
            if not isinstance(row, dict):
                continue
            nick = str(row.get("nick") or "").strip()
            if not nick:
                continue
            out[canon_key(nick, aliases)] = side
    return out


def parse_revives(log_path: Path, t0: datetime, t1: datetime) -> list[dict]:
    out = []
    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if " has revived " not in line:
                continue
            tm = LINE_TS.match(line)
            rm = REVIVE_RE.search(line)
            if not tm or not rm:
                continue
            at = parse_ts(tm.group("ts"))
            if not (t0 <= at < t1):
                continue
            medic = strip_tag(rm.group("medic"))
            patient = strip_tag(rm.group("patient"))
            out.append(
                {
                    "kind": "revive",
                    "at": at.isoformat(),
                    "at_msk": (at + timedelta(hours=3)).strftime("%H:%M:%S"),
                    # same fields as die: killer=medic, victim=patient
                    "killer": medic,
                    "killerKey": nick_key(medic),
                    "victim": patient,
                    "victimKey": nick_key(patient),
                    "steam": rm.group("msteam"),
                }
            )
    return out


def main() -> None:
    pwr, disp = load_pwr_map()
    aliases = load_alias_keys()
    # re-key pwr/disp through aliases
    pwr2: dict[str, float] = {}
    disp2: dict[str, str] = {}
    for k, v in pwr.items():
        ck = aliases.get(k, k)
        pwr2[ck] = max(pwr2.get(ck, 0.0), v)
    for k, n in disp.items():
        ck = aliases.get(k, k)
        disp2.setdefault(ck, n)
    pwr, disp = pwr2, disp2

    log_paths = sorted({CACHE / m["log"] for m in MATCHES})
    for p in log_paths:
        if not p.is_file():
            raise SystemExit(f"missing log {p}")
    steam_to_nick = build_steam_map(log_paths)
    print(f"steam map {len(steam_to_nick)}, pwr nicks {len(pwr)}, aliases {len(aliases)}")

    pmax_global = max(pwr.values()) if pwr else 737.0
    print(f"P_max (hidden PWR leader) = {pmax_global:.1f}")

    rp: dict[str, float] = {}
    match_blocks = []

    for m in MATCHES:
        log_path = CACHE / m["log"]
        teams = load_match_teams(m["id"], aliases)
        dies = parse_dies(log_path, m["start"], m["end"], steam_to_nick, aliases)
        revives = parse_revives(log_path, m["start"], m["end"])
        events = []
        net: dict[str, float] = {}
        die_n = 0
        tk_n = 0
        rev_n = 0

        def ensure(key: str, nick: str) -> None:
            ck = aliases.get(key, key)
            if ck not in disp:
                disp[ck] = nick
            rp.setdefault(ck, START_RP)

        for d in dies:
            kk, vk = d["killerKey"], d["victimKey"]
            if not kk or not vk or kk == vk or kk.startswith("?"):
                continue
            pk = pwr.get(kk, 250.0)
            pv = pwr.get(vk, 250.0)
            ensure(kk, d["killer"])
            ensure(vk, d["victim"])
            delta = round(hunt_delta(pk, pv, pmax_global), 2)
            same_team = (
                kk in teams and vk in teams and teams[kk] == teams[vk]
            )
            if same_team:
                # TK: killer loses, victim loses (final death)
                rp[kk] = rp.get(kk, START_RP) - delta
                rp[vk] = rp.get(vk, START_RP) - delta
                net[kk] = round(net.get(kk, 0.0) - delta, 2)
                net[vk] = round(net.get(vk, 0.0) - delta, 2)
                events.append(
                    {
                        "kind": "tk",
                        "time": d["at_msk"],
                        "killer": disp[kk],
                        "victim": disp[vk],
                        "killerPwr": round(pk, 1),
                        "victimPwr": round(pv, 1),
                        "delta": delta,
                        "teamkill": True,
                    }
                )
                tk_n += 1
            else:
                rp[kk] = rp.get(kk, START_RP) + delta
                rp[vk] = rp.get(vk, START_RP) - delta
                net[kk] = round(net.get(kk, 0.0) + delta, 2)
                net[vk] = round(net.get(vk, 0.0) - delta, 2)
                events.append(
                    {
                        "kind": "die",
                        "time": d["at_msk"],
                        "killer": disp[kk],
                        "victim": disp[vk],
                        "killerPwr": round(pk, 1),
                        "victimPwr": round(pv, 1),
                        "delta": delta,
                        "teamkill": False,
                    }
                )
                die_n += 1

        for d in revives:
            kk = canon_key(d["killer"], aliases)
            vk = canon_key(d["victim"], aliases)
            if not kk or not vk or kk == vk or kk.startswith("?"):
                continue
            pk = pwr.get(kk, 250.0)
            pv = pwr.get(vk, 250.0)
            ensure(kk, d["killer"])
            ensure(vk, d["victim"])
            delta = round(hunt_delta(pk, pv, pmax_global) * REVIVE_COEF, 2)
            # medic gains only — patient not charged
            rp[kk] = rp.get(kk, START_RP) + delta
            net[kk] = round(net.get(kk, 0.0) + delta, 2)
            net.setdefault(vk, 0.0)
            events.append(
                {
                    "kind": "revive",
                    "time": d["at_msk"],
                    "killer": disp[kk],  # medic
                    "victim": disp[vk],  # patient
                    "killerPwr": round(pk, 1),
                    "victimPwr": round(pv, 1),
                    "delta": delta,
                }
            )
            rev_n += 1

        # chronological within match
        events.sort(key=lambda e: e["time"])

        players_file = PLAYERS / f"{m['id']}.json"
        if players_file.is_file():
            pj = json.loads(players_file.read_text(encoding="utf-8"))
            for row in list(pj.get("teamA") or []) + list(pj.get("teamB") or []):
                nick = str(row.get("nick") or "").strip()
                if not nick:
                    continue
                k = canon_key(nick, aliases)
                disp.setdefault(k, nick)
                rp.setdefault(k, START_RP)
                net.setdefault(k, 0.0)

        match_blocks.append(
            {
                "id": m["id"],
                "map": m["map"],
                "date": m["date"],
                "giveUpKills": die_n,
                "teamkills": tk_n,
                "revives": rev_n,
                "events": events,
                "netByNick": {
                    disp.get(k, k): v
                    for k, v in sorted(net.items(), key=lambda x: -abs(x[1]))
                },
                "netByKey": net,
            }
        )
        print(
            f"{m['id']}: {die_n} enemy Die, {tk_n} TK, {rev_n} revives, {len(net)} players"
        )

    ranked = sorted(rp.items(), key=lambda x: -x[1])
    predator_place: dict[str, int] = {}
    place = 0
    for k, val in ranked:
        info = rp_rank(val)
        if info["predator"]:
            place += 1
            predator_place[k] = place

    players_out = {}
    for k, val in ranked:
        info = rp_rank(val)
        match_hist = []
        for mb in match_blocks:
            if k in mb["netByKey"]:
                match_hist.append(
                    {
                        "id": mb["id"],
                        "map": mb["map"],
                        "date": mb["date"],
                        "net": mb["netByKey"][k],
                        "kills": [
                            e
                            for e in mb["events"]
                            if e.get("kind") == "die"
                            and canon_key(e["killer"], aliases) == k
                        ],
                        "deaths": [
                            e
                            for e in mb["events"]
                            if e.get("kind") in ("die", "tk")
                            and canon_key(e["victim"], aliases) == k
                        ],
                        "teamkills": [
                            e
                            for e in mb["events"]
                            if e.get("kind") == "tk"
                            and canon_key(e["killer"], aliases) == k
                        ],
                        "revives": [
                            e
                            for e in mb["events"]
                            if e.get("kind") == "revive"
                            and canon_key(e["killer"], aliases) == k
                        ],
                    }
                )
        players_out[k] = {
            "nick": disp.get(k, k),
            "rp": round(val, 1),
            "rankLabel": info["label"],
            "rankKey": info["rankKey"],
            "roman": info["roman"],
            "predator": info["predator"],
            "predatorPlace": predator_place.get(k),
            "matches": match_hist,
        }

    public_matches = []
    for mb in match_blocks:
        public_matches.append({k: v for k, v in mb.items() if k != "netByKey"})

    ledger = {
        "version": 3,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "startRp": START_RP,
        "step": STEP,
        "radiant3Max": RADIANT3_MAX,
        "formula": (
            "delta=1+49*(Pv-Pk+Pmax-1)/(2*(Pmax-1)); "
            "final Die(+Inactive): enemy zero-sum; TK both -delta; "
            "Revive medic +delta*0.6; Wound/nok=0; PWR hidden weight"
        ),
        "reviveCoef": REVIVE_COEF,
        "pMax": round(pmax_global, 1),
        "matches": public_matches,
        "players": players_out,
        "leaderboard": [
            {
                "nick": players_out[k]["nick"],
                "rp": players_out[k]["rp"],
                "rankLabel": players_out[k]["rankLabel"],
                "rankKey": players_out[k]["rankKey"],
                "predatorPlace": players_out[k]["predatorPlace"],
            }
            for k, _ in ranked
        ],
    }
    OUT.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")
    print("TOP 10:")
    for i, row in enumerate(ledger["leaderboard"][:10], 1):
        print(f"  {i}. {row['nick']:20} RP {row['rp']:7.1f}  {row['rankLabel']}")


if __name__ == "__main__":
    main()
