#!/usr/bin/env python3
"""Rifleman ladder 1..10. Rolling 14 calendar days MSK. No ids.

Writes data/rifle-ladder.json into the KV trees the site reads.
Roster = training rating, main role Стрелок, from the live kit-tiers API.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

WINDOW_DAYS = 14
MSK = timedelta(hours=3)
SINCE = datetime(2026, 10, 12, 21, 0, 0)
UNTIL = datetime(2026, 10, 26, 21, 0, 0)
ROOT = Path("/var/www/bb-squad-logs")
CONFIRM = 8.0
KNOCK_GAP = 4.0
MIN_MATCH = 8 * 60
MERGE_GAP = 15 * 60
NEED_DAYS = 5
SERVERS = ("TR1", "TR2", "TR3", "TR4", "TR5")

ROSTER = [
    "Barsik", "Hillfill", "Mighty", "Rindaye", "spartan", "T-800", "SHURUP",
    "iKEppA", "Taipan", "r4mp", "haq34", "Lt.Price", "ZensU", "Diray",
    "Mahorka", "p1XeL", "ART", "Hazzi", "KTO--TO", "JESTER", "Nickname",
    "ForNikIN", "CERBER", "Oguzok", "Gorbatiy", "yanchik", "MusKeR", "KALASH",
    "Tatarin", "uglyfromyoung",
]

# higher=True means bigger number is level 10
METRICS = [
    ("life", "Жизнь до нока, мин", True),
    ("kpm", "Ноки врагам в минуту", True),
    ("vital", "Голова+грудь+живот, %", True),
    ("kpg", "Убийства за игру", True),
    ("taken", "Ноки по нему за игру", False),
    ("dpg", "Смерти за игру", False),
    ("acc", "Точность, %", True),
    ("rifle", "Минуты на стрелке", True),
    ("kd", "KD", True),
    ("week", "Тренировок в неделю", True),
]

TS = re.compile(r"^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]")
MAP_RE = re.compile(r"/Game/Maps/([^/\s?]+)", re.I)
SPAWN = re.compile(r"RestartPlayer\(\):.*?PC=(?P<nick>\S+).*?DeployRole=(?P<role>\S+)", re.I)
WOUND = re.compile(
    r"Wound\(\):\s*Player:(?P<victim>.+?)\s+KillingDamage=.*?from\s+\S+\s+"
    r"\(Online IDs:\s*EOS:\s*[0-9a-fA-F]+\s+steam:\s*(?P<steam>7656\d+)",
    re.I,
)
DIE = re.compile(
    r"Die\(\):\s*Player:(?P<victim>.+?)\s+KillingDamage=.*?from\s+\S+\s+"
    r"\(Online IDs:\s*EOS:\s*[0-9a-fA-F]+\s+steam:\s*(?P<steam>7656\d+)",
    re.I,
)
INACTIVE = re.compile(
    r"ChangeState\(\):\s*PC=(?P<nick>.+?)\s+\(Online IDs:.*?steam:\s*(?P<steam>7656\d+)\).*?"
    r"OldState=Playing\s+NewState=Inactive",
    re.I,
)
REVIVE = re.compile(
    r"has revived\s+(?P<patient>.+?)\s*\(Online IDs:",
    re.I,
)
POSS = re.compile(
    r"OnPossess\(\):\s*PC=(?P<nick>\S+)\s*\(Online IDs:\s*EOS:\s*(?P<eos>[0-9a-fA-F]{32})\s*steam:\s*(?P<steam>7656\d+)",
    re.I,
)
SHOT_LINE = re.compile(r"BBAcuracy:\s*players?\s+shots:\s*(.+)$", re.I)
PAIR = re.compile(r'"player_id"\s*:\s*"([^"]+)"\s*,\s*"shots"\s*:\s*(\d+)', re.I)
HIT_ATT = re.compile(r"AttackerEOS=<\s*([0-9a-fA-F]{32})\s*>", re.I)
BONE = re.compile(r"Bone=<\s*([^>]+)\s*>", re.I)
ZONE = re.compile(r"Zone=<\s*([^>]+)\s*>", re.I)
STATE = re.compile(
    r"Match State Changed from \w+ to (?P<state>InProgress|WaitingPostMatch|LeavingMap)",
    re.I,
)
KIT_RULES = [
    (re.compile(r"^CQB(_|$)", re.I), "CQB"),
    (re.compile(r"Pilot", re.I), "Пилот"),
    (re.compile(r"Crewman.*(^|_)SL(_|$)|Crewman.*Lead|LeadCrewman|CrewLead", re.I), "Командир Мехводов"),
    (re.compile(r"Crewman|CrewMan", re.I), "Мехвод"),
    (re.compile(r"Medic|Corpsman", re.I), "Медик"),
    (re.compile(r"HeavyMachine|HMG", re.I), "Тяжелый Пулемет"),
    (re.compile(r"Autorifleman|LightMachine|LMG|MachineGun|Machinegunner", re.I), "Легкий Пулемет"),
    (re.compile(r"Sapper|CombatEngineer|Engineer|Pioneer", re.I), "Сапер/Инженер"),
    (re.compile(r"Grenadier", re.I), "Гранатомет подствольный"),
    (re.compile(r"HAT|HeavyAntiTank|Tandem", re.I), "Тандем"),
    (re.compile(r"LAT|LightAntiTank", re.I), "Легкая Труба"),
    (re.compile(r"Sniper", re.I), "Снайпер"),
    (re.compile(r"Marksman|Sharpshooter", re.I), "Марксман"),
    (re.compile(r"Scout|Recon", re.I), "Разведчик"),
    (re.compile(r"Raider", re.I), "Рейдер"),
    (re.compile(r"(^|_)SL(_|$)|SquadLead|SquadLeader|Officer|Commander", re.I), "Командир отряда"),
    (re.compile(r"Rifleman|Recruit", re.I), "Стрелок"),
]


def nick_key(raw: str) -> str:
    s = re.sub(r"\[[^\]]*\]", " ", raw or "")
    return re.sub(r"[^0-9a-zA-Z]", "", s).lower()


def cw_gate():
    """Clan-war slots on TR1–TR5. Those rounds stay in the ladder."""
    here = str(Path(__file__).resolve().parent)
    if here not in sys.path:
        sys.path.insert(0, here)
    from sync_train_from_tr1_logs import layer_is_cw_slot, load_cw_slot_windows

    return load_cw_slot_windows(), layer_is_cw_slot


def load_bracket_rounds():
    """Every round written into a tournament bracket. These always enter the ladder."""
    folder = Path("/var/www/bb-squad-platform/data/tournaments")
    rounds = []
    if not folder.is_dir():
        return rounds
    for path in sorted(folder.glob("*-live.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        matches = data.get("matches") or {}
        items = matches.items() if isinstance(matches, dict) else enumerate(matches)
        for mid, row in items:
            if not isinstance(row, dict):
                continue
            for rk in ("r1", "r2"):
                rr = row.get(rk) or {}
                start, end = rr.get("start"), rr.get("end")
                server = str(rr.get("server") or "").upper()
                if not start or not end or not server:
                    continue
                t0 = datetime.fromisoformat(str(start))
                t1 = datetime.fromisoformat(str(end))
                if t0.tzinfo is not None:
                    t0 = t0.astimezone(timezone.utc).replace(tzinfo=None)
                if t1.tzinfo is not None:
                    t1 = t1.astimezone(timezone.utc).replace(tzinfo=None)
                if t1 <= t0:
                    continue
                rounds.append(
                    {
                        "id": f"{mid}-{rk}",
                        "srv": server,
                        "t0": t0,
                        "t1": t1,
                        "map": str(rr.get("map") or ""),
                    }
                )
    return rounds


def overlaps_bracket(srv, t0, t1, rounds):
    for r in rounds:
        if r["srv"] == srv and t0 < r["t1"] and r["t0"] < t1:
            return True
    return False


def overlap_seconds(srv, t0, t1, r):
    if r["srv"] != srv:
        return 0.0
    a = max(t0, r["t0"])
    b = min(t1, r["t1"])
    return max(0.0, (b - a).total_seconds())


TRACK = {nick_key(n): n for n in ROSTER}


def rolling_window():
    now_msk = datetime.now(timezone.utc).replace(tzinfo=None) + MSK
    end_msk = datetime(now_msk.year, now_msk.month, now_msk.day) + timedelta(days=1)
    start_msk = end_msk - timedelta(days=WINDOW_DAYS)
    since = start_msk - MSK
    until = end_msk - MSK
    last = end_msk - timedelta(days=1)
    label = f"{start_msk.strftime('%d.%m')}–{last.strftime('%d.%m.%Y')}"
    return since, until, label, start_msk.date().isoformat(), last.date().isoformat()


def load_roster() -> list[str]:
    try:
        req = urllib.request.Request(
            "https://bb-squad.ru/api/public/kit-tiers",
            headers={"User-Agent": "bb-rifle-ladder"},
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        players = ((data.get("ranking") or {}).get("players")) or []
        names = []
        for p in players:
            levels = p.get("levels") or []
            kit = (levels[0] or {}).get("kit") if levels else None
            nick = str(p.get("nick") or "").strip()
            if nick and kit == "Стрелок":
                names.append(nick)
        if names:
            return names
    except Exception as exc:
        print("roster api failed, fallback", exc)
    return list(ROSTER)


OUT_PATHS = [
    Path("/var/www/bb-squad-platform/data/kv-cache/data/rifle-ladder.json"),
    Path("/var/www/blackberry-kv/data/rifle-ladder.json"),
    Path("/var/www/blackberry-kv/public/data/rifle-ladder.json"),
]


def who(raw: str):
    k = nick_key(raw)
    return k if k in TRACK else None


def kit_of(role: str) -> str:
    for rx, name in KIT_RULES:
        if rx.search(role or ""):
            return name
    return "Другое"


def team_of(role: str) -> str:
    role = (role or "").strip()
    return role.split("_", 1)[0].upper() if role else ""


def dead_map(name: str) -> bool:
    low = (name or "").lower()
    return "transition" in low or "jensen" in low or "seed" in low


def parse_ts(line: str):
    m = TS.match(line)
    if not m:
        return None, ""
    y, mo, d, h, mi, s, ms = map(int, m.groups())
    return datetime(y, mo, d, h, mi, s, ms * 1000), m.group(0)


def msk_day(ts: datetime) -> str:
    return (ts + MSK).date().isoformat()


def classify_hit(line: str) -> str:
    bm = BONE.search(line)
    bone = (bm.group(1) if bm else "").strip()
    zm = ZONE.search(line)
    zone = (zm.group(1) if zm else "").strip().lower()
    if bone == "Bip01_Head" or zone == "head":
        return "head"
    if bone == "Bip01_Spine2":
        return "chest"
    if bone == "Bip01_Spine":
        return "stomach"
    return "other"


def session_shot_total(samples: list[int]) -> int:
    if not samples:
        return 0
    total = session_max = prev = 0
    started = False
    for shots in samples:
        if not started:
            session_max = prev = shots
            started = True
            continue
        if shots < prev:
            total += session_max
            session_max = shots
        else:
            session_max = max(session_max, shots)
        prev = shots
    return total + session_max


def logs():
    months = set()
    cur = SINCE
    while cur < UNTIL:
        months.add(cur.strftime("%Y-%m"))
        months.add((cur + MSK).strftime("%Y-%m"))
        cur += timedelta(days=1)
    out = []
    for srv in SERVERS:
        live = ROOT / srv / "_live" / "SquadGame.log"
        if live.is_file():
            out.append((srv, live))
        for name in sorted(months):
            month = ROOT / srv / name
            if month.is_dir():
                out.extend((srv, p) for p in sorted(month.glob("SquadGame-backup-*.log")))
    return out


def blank():
    return {
        "games": 0,
        "game_days": set(),
        "life_sec": [],
        "life_days": set(),
        "eff_sec": 0.0,
        "eff_days": set(),
        "rifle_sec": 0.0,
        "rifle_days": set(),
        "enemy_knocks": 0,
        "enemy_kills": 0,
        "taken_knocks": 0,
        "own_deaths": 0,
        "hits": {"head": 0, "chest": 0, "stomach": 0, "other": 0},
        "hit_days": set(),
        "shot_days": set(),
        "shot_samples": defaultdict(list),
        "hit_by_match": defaultdict(int),
        "day_span": defaultdict(list),
    }


def level_of(value, worst, best, higher: bool) -> float:
    if best == worst:
        return 10.0
    if higher:
        t = (value - worst) / (best - worst)
    else:
        t = (worst - value) / (worst - best)
    t = max(0.0, min(1.0, t))
    return round(1 + 9 * t, 2)


def main() -> None:
    global SINCE, UNTIL, TRACK
    SINCE, UNTIL, window_label, day_from, day_to = rolling_window()
    roster = load_roster()
    TRACK = {nick_key(n): n for n in roster}
    cw_windows, is_cw = cw_gate()
    bracket = load_bracket_rounds()
    print("window", window_label, "roster", len(roster), "cw_slots", len(cw_windows))
    steam_to: dict[str, str] = {}
    eos_to: dict[str, str] = {}
    files = logs()
    for _srv, path in files:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if "OnPossess" not in line:
                    continue
                ts, _ = parse_ts(line)
                if ts is None or ts < SINCE or ts >= UNTIL:
                    continue
                pm = POSS.search(line)
                if not pm:
                    continue
                p = who(pm.group("nick"))
                if not p:
                    continue
                steam_to[pm.group("steam")] = p
                eos_to[pm.group("eos").lower()] = p

    seen = set()
    events = []
    for srv, path in files:
        last_map = ""
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                ts, ts_s = parse_ts(line)
                if ts is None or ts < SINCE or ts >= UNTIL:
                    continue
                if "/Game/Maps/" in line:
                    mm = MAP_RE.search(line)
                    if mm and mm.group(1) != last_map:
                        last_map = mm.group(1)
                        key = (srv, "map", last_map, int(ts.timestamp()) // 20)
                        if key not in seen:
                            seen.add(key)
                            events.append((ts, srv, "map", "", last_map))
                if "Match State Changed" in line:
                    sm = STATE.search(line)
                    if sm:
                        key = (srv, "state", sm.group("state"), int(ts.timestamp()))
                        if key not in seen:
                            seen.add(key)
                            events.append((ts, srv, "state", "", sm.group("state")))
                if "RestartPlayer():" in line and "DeployRole=" in line:
                    sm = SPAWN.search(line)
                    if sm:
                        k = nick_key(sm.group("nick"))
                        key = (srv, "spawn", k, ts_s)
                        if key not in seen:
                            seen.add(key)
                            events.append((ts, srv, "spawn", k, sm.group("role")))
                    continue
                if "Wound():" in line:
                    wm = WOUND.search(line)
                    if wm:
                        vk = nick_key(wm.group("victim"))
                        key = (srv, "wound", vk, wm.group("steam"), ts_s)
                        if key not in seen:
                            seen.add(key)
                            events.append((ts, srv, "wound", vk, wm.group("steam")))
                    continue
                if "Die():" in line:
                    dm = DIE.search(line)
                    if dm:
                        vk = nick_key(dm.group("victim"))
                        key = (srv, "die", vk, dm.group("steam"), ts_s)
                        if key not in seen:
                            seen.add(key)
                            events.append((ts, srv, "die", vk, dm.group("steam")))
                    continue
                if "NewState=Inactive" in line:
                    im = INACTIVE.search(line)
                    if im:
                        k = nick_key(im.group("nick"))
                        key = (srv, "inactive", k, ts_s)
                        if key not in seen:
                            seen.add(key)
                            events.append((ts, srv, "inactive", k, ""))
                    continue
                if "has revived" in line:
                    rm = REVIVE.search(line)
                    if rm:
                        k = nick_key(rm.group("patient"))
                        key = (srv, "revive", k, ts_s)
                        if key not in seen:
                            seen.add(key)
                            events.append((ts, srv, "revive", k, ""))
                    continue
                if "BBHitZone:" in line:
                    hm = HIT_ATT.search(line)
                    if hm:
                        p = eos_to.get(hm.group(1).lower())
                        if p:
                            part = classify_hit(line)
                            key = (srv, "hit", p, part, ts_s)
                            if key not in seen:
                                seen.add(key)
                                events.append((ts, srv, "hit", p, part))
                    continue
                if "BBAcuracy:" in line and "shots" in line and eos_to:
                    sm = SHOT_LINE.search(line)
                    if not sm:
                        continue
                    blob = sm.group(1)
                    if not any(e in blob.lower() for e in eos_to):
                        continue
                    for pid, shots in PAIR.findall(blob):
                        p = eos_to.get(pid.lower())
                        if not p:
                            continue
                        key = (srv, "shot", p, ts_s)
                        if key in seen:
                            continue
                        seen.add(key)
                        events.append((ts, srv, "shot", p, int(shots)))

    events.sort(key=lambda e: (e[1], e[0]))
    by_srv = defaultdict(list)
    for ev in events:
        by_srv[ev[1]].append(ev)

    kept = []
    included_cw = 0
    for srv, evs in by_srv.items():
        cur = None
        paused = False
        segs = []
        for ts, _s, kind, p, extra in evs:
            if kind == "map":
                if dead_map(extra):
                    paused = True
                    if cur is not None and not cur["closed"]:
                        cur["t1"] = ts
                    continue
                if (
                    cur is not None
                    and cur["layer"] == extra
                    and not cur["closed"]
                    and (ts - cur["t1"]).total_seconds() <= MERGE_GAP
                ):
                    paused = False
                    cur["t1"] = ts
                    continue
                if cur is not None:
                    segs.append(cur)
                cur = {"srv": srv, "layer": extra, "t0": ts, "t1": ts, "closed": False, "evs": []}
                paused = False
                continue
            if cur is None or paused:
                continue
            if kind == "state" and extra in ("WaitingPostMatch", "LeavingMap"):
                cur["closed"] = True
                cur["t1"] = ts
                continue
            cur["t1"] = ts
            cur["evs"].append((ts, kind, p, extra))
        if cur is not None:
            segs.append(cur)
        for m in segs:
            dur = (m["t1"] - m["t0"]).total_seconds()
            on_bracket = overlaps_bracket(m["srv"], m["t0"], m["t1"], bracket)
            if dur < MIN_MATCH and not on_bracket:
                continue
            if on_bracket:
                m["bracket"] = True
            hit = None if on_bracket else is_cw(m["t0"], m["layer"], m["srv"], cw_windows)
            if hit:
                included_cw += 1
                m["cw"] = hit.get("id")
                print(
                    "include cw",
                    m["srv"],
                    (m["t0"] + MSK).strftime("%d.%m %H:%M"),
                    str(m["layer"])[:36],
                    hit.get("id"),
                    hit.get("opp"),
                )
            m["dur"] = dur
            kept.append(m)
    kept = [
        m
        for m in kept
        if not any(overlap_seconds(m["srv"], m["t0"], m["t1"], r) >= 30 for r in bracket)
    ]
    added = 0
    for r in bracket:
        if not (SINCE <= r["t0"] < UNTIL):
            continue
        play = [
            (ts, kind, p, extra)
            for ts, _s, kind, p, extra in by_srv.get(r["srv"], [])
            if r["t0"] <= ts < r["t1"] and kind not in ("map", "state")
        ]
        if not play:
            print("bracket empty", r["id"], r["srv"], (r["t0"] + MSK).strftime("%d.%m %H:%M"))
        kept.append(
            {
                "srv": r["srv"],
                "layer": r["map"] or "tournament",
                "t0": r["t0"],
                "t1": r["t1"],
                "closed": True,
                "evs": play,
                "dur": (r["t1"] - r["t0"]).total_seconds(),
                "bracket": True,
            }
        )
        added += 1
    print("matches", len(kept), "cw_included", included_cw, "bracket_rounds", added)

    stats = {k: blank() for k in TRACK}
    for mi, m in enumerate(kept):
        evs = m["evs"]
        inactive_nick = defaultdict(list)
        for ts, kind, p, _x in evs:
            if kind == "inactive":
                inactive_nick[p].append(ts)
        team_now: dict[str, str] = {}
        st = {p: {"open": None, "kit": None, "down": False} for p in TRACK}
        knock_dedupe = set()
        taken_dedupe = set()
        played = set()

        def close_open(p, end, by_knock, st=st, stats=stats):
            s = st[p]
            if s["open"] is None or s["down"]:
                return
            dur = (end - s["open"]).total_seconds()
            if dur < 0 or dur > 3 * 3600:
                s["open"] = None
                return
            stats[p]["eff_sec"] += dur
            stats[p]["eff_days"].add(msk_day(s["open"]))
            if s["kit"] == "Стрелок":
                stats[p]["rifle_sec"] += dur
                stats[p]["rifle_days"].add(msk_day(s["open"]))
            if by_knock and dur >= 1:
                stats[p]["life_sec"].append(dur)
                stats[p]["life_days"].add(msk_day(s["open"]))
            s["open"] = None

        for ts, kind, p, extra in evs:
            if kind == "spawn":
                team_now[p] = team_of(extra)
                if p in st:
                    close_open(p, ts, False)
                    st[p]["open"] = ts
                    st[p]["kit"] = kit_of(extra)
                    st[p]["down"] = False
                    played.add(p)
                    stats[p]["day_span"][msk_day(ts)].append(ts)
            elif kind == "wound":
                victim, att_steam = p, extra
                att = steam_to.get(att_steam)
                att_team = team_now.get(att or "", "")
                vic_team = team_now.get(victim, "")
                is_tk = bool(att and att_team and vic_team and att_team == vic_team)
                if att in st and not is_tk and att != victim and att_team and vic_team:
                    bucket = int(ts.timestamp()) // int(KNOCK_GAP)
                    dk = (att, victim, bucket)
                    if dk not in knock_dedupe:
                        knock_dedupe.add(dk)
                        stats[att]["enemy_knocks"] += 1
                if victim in st:
                    bucket = int(ts.timestamp()) // int(KNOCK_GAP)
                    if (victim, bucket) not in taken_dedupe:
                        taken_dedupe.add((victim, bucket))
                        stats[victim]["taken_knocks"] += 1
                    if st[victim]["open"] is not None and not st[victim]["down"]:
                        close_open(victim, ts, True)
                    st[victim]["down"] = True
            elif kind == "die":
                victim, att_steam = p, extra
                att = steam_to.get(att_steam)
                att_team = team_now.get(att or "", "")
                vic_team = team_now.get(victim, "")
                is_tk = bool(att and att_team and vic_team and att_team == vic_team)
                confirmed = any(0 <= (t - ts).total_seconds() <= CONFIRM for t in inactive_nick.get(victim, []))
                if confirmed and att in st and not is_tk and att != victim and att_team and vic_team:
                    stats[att]["enemy_kills"] += 1
                if victim in st:
                    if st[victim]["open"] is not None and not st[victim]["down"]:
                        close_open(victim, ts, False)
                    st[victim]["down"] = True
                    if confirmed:
                        stats[victim]["own_deaths"] += 1
            elif kind == "revive" and p in st and st[p]["down"]:
                st[p]["down"] = False
                st[p]["open"] = ts
            elif kind == "hit" and p in TRACK:
                stats[p]["hits"][extra] += 1
                stats[p]["hit_by_match"][mi] += 1
                stats[p]["hit_days"].add(msk_day(ts))
            elif kind == "shot" and p in TRACK:
                stats[p]["shot_samples"][mi].append(int(extra))
                stats[p]["shot_days"].add(msk_day(ts))
        end = m["t1"]
        for p in played:
            if st[p]["open"] is not None and not st[p]["down"]:
                close_open(p, end, False)
            stats[p]["games"] += 1
            stats[p]["game_days"].add(msk_day(m["t0"]))

    rows = []
    for key, display in TRACK.items():
        s = stats[key]
        lives = s["life_sec"]
        eff = s["eff_sec"]
        hits = s["hits"]
        hit_n = sum(hits.values())
        sh_sum = hi_sum = 0
        for mi, samples in s["shot_samples"].items():
            sh = session_shot_total(samples)
            hi = int(s["hit_by_match"].get(mi) or 0)
            if sh <= 0 or hi <= 0 or hi > sh:
                continue
            sh_sum += sh
            hi_sum += hi
        raw = {
            "life": (round(sum(lives) / len(lives) / 60, 2) if lives else None, len(s["life_days"])),
            "kpm": (round(s["enemy_knocks"] / (eff / 60), 3) if eff >= 60 else None, len(s["eff_days"])),
            "vital": (
                round(100 * (hits["head"] + hits["chest"] + hits["stomach"]) / hit_n, 1) if hit_n else None,
                len(s["hit_days"]),
            ),
            "kpg": (round(s["enemy_kills"] / s["games"], 2) if s["games"] else None, len(s["game_days"])),
            "taken": (round(s["taken_knocks"] / s["games"], 2) if s["games"] else None, len(s["game_days"])),
            "dpg": (round(s["own_deaths"] / s["games"], 2) if s["games"] else None, len(s["game_days"])),
            "acc": (
                round(min(100.0, 100.0 * hi_sum / sh_sum), 1) if sh_sum >= 20 and hi_sum > 0 else None,
                len(s["shot_days"]),
            ),
            "rifle": (round(s["rifle_sec"] / 60, 1), len(s["rifle_days"])),
            "kd": (
                round(s["enemy_kills"] / s["own_deaths"], 2) if s["own_deaths"] else None,
                len(s["game_days"]),
            ),
            "week": (round(len(s["game_days"]) / (WINDOW_DAYS / 7), 2), len(s["game_days"])),
        }
        rows.append({
            "nick": display,
            "games": s["games"],
            "days": len(s["game_days"]),
            "raw": {k: {"v": v, "days": d, "ok": v is not None and d >= NEED_DAYS} for k, (v, d) in raw.items()},
        })

    anchors = {}
    for key, _title, higher in METRICS:
        vals = [r["raw"][key]["v"] for r in rows if r["raw"][key]["ok"]]
        if not vals:
            anchors[key] = {
                "best": None, "worst": None, "n": 0, "higher": higher,
                "bestNicks": [], "worstNicks": [],
            }
            for r in rows:
                r["raw"][key]["lvl"] = None
            continue
        best = max(vals) if higher else min(vals)
        worst = min(vals) if higher else max(vals)
        best_nicks = [r["nick"] for r in rows if r["raw"][key]["ok"] and r["raw"][key]["v"] == best]
        worst_nicks = [r["nick"] for r in rows if r["raw"][key]["ok"] and r["raw"][key]["v"] == worst]
        anchors[key] = {
            "best": best, "worst": worst, "n": len(vals), "higher": higher,
            "bestNicks": best_nicks, "worstNicks": worst_nicks,
        }
        for r in rows:
            cell = r["raw"][key]
            if not cell["ok"]:
                cell["lvl"] = None
                continue
            cell["lvl"] = level_of(cell["v"], worst, best, higher)

    for r in rows:
        parts = [
            r["raw"][k]["lvl"] * (0.5 if k in ("kpm", "dpg") else 1.0)
            for k, _t, _h in METRICS
            if r["raw"][k].get("lvl") is not None
        ]
        r["scored"] = len(parts)
        r["level"] = round(sum(parts) / len(METRICS), 2) if parts else None

    rows.sort(key=lambda r: (
        r["level"] is None,
        -(r["level"] or 0),
        -r["days"],
        r["nick"].lower(),
    ))
    out = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "window": window_label,
        "from": day_from,
        "to": day_to,
        "needDays": NEED_DAYS,
        "metricCount": len(METRICS),
        "title": "Стрелок · уровень 1–10",
        "foot": "Считаются тренировки и клановые войны на TR1–TR5. Раунды турнирной сетки считаются всегда. Дженсен и прочие раунды короче 8 минут не считаются. Окно — 14 дней, новый день заходит и старый выходит. Нет 5 дней по показателю — калибровка. Ноки врагам в минуту и смерти за игру в общий уровень входят наполовину: 10 в столбце даёт 5.",
        "metrics": [{"key": k, "title": t, "higher": h, "weight": 0.5 if k in ("kpm", "dpg") else 1} for k, t, h in METRICS],
        "anchors": anchors,
        "players": rows,
        "liveMatches": len(kept),
        "roster": len(rows),
    }
    payload = json.dumps(out, ensure_ascii=False)
    Path("/tmp/rifle_ladder.json").write_text(payload, encoding="utf-8")
    for dest in OUT_PATHS:
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(payload, encoding="utf-8")
            print("wrote", dest)
        except OSError as exc:
            print("skip", dest, exc)
    scored = sum(1 for r in rows if r["level"] is not None)
    print("players", len(rows), "with_level", scored, "live", len(kept))
    for r in rows:
        print(f"{r['level']}\t{r['scored']}\t{r['days']}\t{r['games']}\t{r['nick']}")


if __name__ == "__main__":
    main()
