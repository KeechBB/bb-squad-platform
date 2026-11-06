#!/usr/bin/env python3
"""Medic ladder 1..10. Rolling 14 calendar days MSK. Stats only while the kit is medic.

Same match window and calibration as the rifleman ladder: 5 days inside the window,
best = 10, worst = 1, player level = sum of metric levels / metric count.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import paramiko

WINDOW_DAYS = 14
MSK = timedelta(hours=3)
NEED_DAYS = 5
SERVERS = ("TR1", "TR2", "TR3", "TR4", "TR5")
CONFIRM = 8.0
MIN_MATCH = 8 * 60
MERGE_GAP = 15 * 60
ROOT = Path("/var/www/bb-squad-logs")

METRICS = [
    ("res_pg", "Ресов за игру", True),
    ("res_total", "Всего ресов", True),
    ("hp_min", "ХП в минуту", True),
    ("no_hp", "Не дал хп, %", False),
    ("hp_res", "ХП на рес", True),
    ("variety", "Стиль", False),
    ("dpg", "Смерти за игру", False),
    ("kpg", "Убийства за игру", True),
    ("noks", "Ноки за игру", True),
    ("res_min", "Ресов в минуту", True),
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
    r"LogSquad:\s*(?P<medic>.+?)\s*\(Online IDs:\s*EOS:\s*(?P<meos>[0-9a-fA-F]{32})\s+steam:\s*7656\d+\)\s+"
    r"has revived\s+(?P<patient>.+?)\s*\(Online IDs:\s*EOS:\s*(?P<peos>[0-9a-fA-F]{32})",
    re.I,
)
HEAL = re.compile(
    r"BBHealTracker:\s*Player\s+(?P<patient>[0-9a-fA-F]{32})\s+got\s+(?P<amount>[0-9]+(?:\.[0-9]+)?)\s+health\s+from\s+(?P<healer>[0-9a-fA-F]{32})",
    re.I,
)
POSS = re.compile(
    r"OnPossess\(\):\s*PC=(?P<nick>\S+)\s*\(Online IDs:\s*EOS:\s*(?P<eos>[0-9a-fA-F]{32})\s*steam:\s*(?P<steam>7656\d+)",
    re.I,
)
STATE = re.compile(
    r"Match State Changed from \w+ to (?P<state>InProgress|WaitingPostMatch|LeavingMap)",
    re.I,
)
MEDIC_ROLE = re.compile(r"Medic|Corpsman", re.I)

OUT_PATHS = [
    Path("/var/www/bb-squad-platform/data/kv-cache/data/medic-ladder.json"),
    Path("/var/www/blackberry-kv/data/medic-ladder.json"),
    Path("/var/www/blackberry-kv/public/data/medic-ladder.json"),
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


def rolling_window():
    now_msk = datetime.now(timezone.utc).replace(tzinfo=None) + MSK
    end_msk = datetime(now_msk.year, now_msk.month, now_msk.day) + timedelta(days=1)
    start_msk = end_msk - timedelta(days=WINDOW_DAYS)
    since = start_msk - MSK
    until = end_msk - MSK
    last = end_msk - timedelta(days=1)
    label = f"{start_msk.strftime('%d.%m')}–{last.strftime('%d.%m.%Y')}"
    return since, until, label, start_msk.date().isoformat(), last.date().isoformat()


# Носит кит медика, но это не медик: RWS на M-RAP.
NOT_MEDIC = {"tankist"}


def load_roster() -> list[str]:
    req = urllib.request.Request(
        "https://bb-squad.ru/api/public/kit-tiers",
        headers={"User-Agent": "bb-medic-ladder"},
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    players = ((data.get("ranking") or {}).get("players")) or []
    names = []
    for p in players:
        levels = p.get("levels") or []
        kit = (levels[0] or {}).get("kit") if levels else None
        nick = str(p.get("nick") or "").strip()
        if nick and kit == "Медик" and nick_key(nick) not in NOT_MEDIC:
            names.append(nick)
    return names


def logs(since: datetime, until: datetime):
    months = set()
    cur = since
    while cur < until:
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


def parse_ts(line: str):
    m = TS.match(line)
    if not m:
        return None, ""
    y, mo, d, h, mi, s, ms = map(int, m.groups())
    return datetime(y, mo, d, h, mi, s, ms * 1000), m.group(0)


def msk_day(ts: datetime) -> str:
    return (ts + MSK).date().isoformat()


def dead_map(name: str) -> bool:
    low = (name or "").lower()
    return "transition" in low or "jensen" in low or "seed" in low


def team_of(role: str) -> str:
    role = (role or "").strip()
    return role.split("_", 1)[0].upper() if role else ""


def is_medic_role(role: str) -> bool:
    return bool(MEDIC_ROLE.search(role or ""))


def level_of(value, worst, best, higher: bool) -> float:
    if best == worst:
        return 10.0
    if higher:
        t = (value - worst) / (best - worst)
    else:
        t = (worst - value) / (worst - best)
    t = max(0.0, min(1.0, t))
    return round(1 + 9 * t, 2)


def pocket_share(counts: list[int]):
    """Largest share of one patient in this medic's revives.

    20 and above = Покет, below = Отрядный.
    """
    total = sum(counts)
    if total <= 0:
        return None
    return round(100.0 * max(counts) / total, 1)


def blank():
    return {
        "games": 0,
        "game_days": set(),
        "minutes": 0.0,
        "res": 0,
        "no_hp": 0,
        "hp": 0.0,
        "res_days": set(),
        "res_by_day": defaultdict(int),
        "patients": defaultdict(int),
        "deaths": 0,
        "kills": 0,
        "knocks": 0,
    }


def load_remote_heals(since: datetime, until: datetime, eos_to: dict[str, str]):
    env = {}
    for line in Path("/var/www/bb-squad-platform/scripts/.squad-collector.env").read_text(errors="ignore").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    remote = r'''
import json, re
from datetime import datetime, timezone
from pathlib import Path
TS = re.compile(r"^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]")
HEAL = re.compile(r"BBHealTracker:\s*Player\s+([0-9a-fA-F]{32})\s+got\s+([0-9]+(?:\.[0-9]+)?)\s+health\s+from\s+([0-9a-fA-F]{32})", re.I)
since, until = json.loads(Path("/tmp/bb_medic_heal_window.json").read_text())
def stamp(line):
    m = TS.match(line)
    if not m:
        return None
    y, mo, d, h, mi, s, ms = map(int, m.groups())
    return datetime(y, mo, d, h, mi, s, ms * 1000, tzinfo=timezone.utc).isoformat()
rows = []
for srv in ("TR1", "TR2"):
    d = Path("/home/squad/servers") / srv / "SquadGame/Saved/Logs"
    if not d.is_dir():
        continue
    for path in d.glob("*.log"):
        with path.open("rb") as fh:
            for raw in fh:
                if b"BBHealTracker: Player" not in raw:
                    continue
                line = raw.decode("utf-8", "replace")
                hm = HEAL.search(line)
                m = TS.match(line)
                if not hm or not m:
                    continue
                y, mo, d0, h, mi, s, ms = map(int, m.groups())
                at = datetime(y, mo, d0, h, mi, s, ms * 1000, tzinfo=timezone.utc)
                if at.isoformat() < since or at.isoformat() >= until:
                    continue
                rows.append([at.isoformat(), srv, hm.group(3).lower(), hm.group(1).lower(), float(hm.group(2))])
print(json.dumps(rows))
'''
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        hostname=env["SQUAD_SSH_HOST"],
        port=int(env.get("SQUAD_SSH_PORT") or "2022"),
        username=env["SQUAD_SSH_USER"],
        password=env["SQUAD_SSH_PASSWORD"],
        timeout=30,
    )
    sftp = c.open_sftp()
    with sftp.file("/tmp/bb_medic_heal_window.json", "w") as fh:
        fh.write(json.dumps([since.replace(tzinfo=timezone.utc).isoformat(), until.replace(tzinfo=timezone.utc).isoformat()]))
    with sftp.file("/tmp/bb_medic_heals.py", "w") as fh:
        fh.write(remote)
    sftp.close()
    _in, out, err = c.exec_command("python3 /tmp/bb_medic_heals.py", timeout=240)
    text = out.read().decode("utf-8", "replace")
    e = err.read().decode("utf-8", "replace")
    c.close()
    if e.strip():
        print("heal ssh", e[:400])
    raw = json.loads(text or "[]")
    rows = []
    for iso, srv, healer, patient, amount in raw:
        at = datetime.fromisoformat(iso).replace(tzinfo=None)
        rows.append((at, srv, eos_to.get(healer, ""), eos_to.get(patient, ""), amount))
    print("remote_heals", len(raw), "mapped", sum(1 for r in rows if r[2]))
    return rows


def main() -> None:
    since, until, window_label, day_from, day_to = rolling_window()
    roster = load_roster()
    track = {nick_key(n): n for n in roster}
    cw_windows, is_cw = cw_gate()
    bracket = load_bracket_rounds()
    print("window", window_label, "roster", len(roster), "cw_slots", len(cw_windows))
    files = logs(since, until)
    eos_to: dict[str, str] = {}
    steam_to: dict[str, str] = {}
    for _srv, path in files:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if "OnPossess" not in line:
                    continue
                ts, _ = parse_ts(line)
                if ts is None or ts < since or ts >= until:
                    continue
                pm = POSS.search(line)
                if not pm:
                    continue
                key = nick_key(pm.group("nick"))
                eos_to[pm.group("eos").lower()] = key
                steam_to[pm.group("steam")] = key

    seen = set()
    events = []
    heal_n = revive_n = 0
    for srv, path in files:
        last_map = ""
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                ts, ts_s = parse_ts(line)
                if ts is None or ts < since or ts >= until:
                    continue
                if "/Game/Maps/" in line:
                    mm = MAP_RE.search(line)
                    if mm and mm.group(1) != last_map:
                        last_map = mm.group(1)
                        key = (srv, "map", last_map, int(ts.timestamp()) // 20)
                        if key not in seen:
                            seen.add(key)
                            events.append((ts, srv, "map", "", last_map))
                    continue
                if "Match State Changed" in line:
                    sm = STATE.search(line)
                    if sm:
                        key = (srv, "state", sm.group("state"), int(ts.timestamp()))
                        if key not in seen:
                            seen.add(key)
                            events.append((ts, srv, "state", "", sm.group("state")))
                    continue
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
                        revive_n += 1
                        mk = nick_key(rm.group("medic"))
                        pk = nick_key(rm.group("patient"))
                        key = (srv, "revive", mk, pk, ts_s)
                        if key not in seen:
                            seen.add(key)
                            events.append((ts, srv, "revive", mk, pk))
                    continue
                if "BBHealTracker: Player" in line:
                    if HEAL.search(line):
                        heal_n += 1
    print("events", len(events), "revive_lines", revive_n, "heal_lines", heal_n)

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
        if not (since <= r["t0"] < until):
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
    remote_heals = load_remote_heals(since, until, eos_to)
    for m in kept:
        extra = [
            (at, "heal", healer, (patient, amount))
            for at, srv, healer, patient, amount in remote_heals
            if srv == m["srv"] and healer and m["t0"] <= at < m["t1"]
        ]
        if extra:
            m["evs"] = sorted(m["evs"] + extra, key=lambda ev: ev[0])

    stats = {k: blank() for k in track}

    def kit_at(timeline, nick, ts):
        role = ""
        for dt, role_name in timeline.get(nick, []):
            if dt <= ts:
                role = role_name
            else:
                break
        return role

    for m in kept:
        evs = m["evs"]
        timeline = defaultdict(list)
        team_now = {}
        inactive = defaultdict(list)
        downs = defaultdict(list)
        heals = defaultdict(list)
        for ts, kind, p, extra in evs:
            if kind == "spawn":
                timeline[p].append((ts, extra))
                team_now[p] = team_of(extra)
            elif kind == "inactive":
                inactive[p].append(ts)
            elif kind in ("wound", "die"):
                downs[p].append(ts)
            elif kind == "heal":
                patient, amount = extra
                heals[(p, patient)].append((ts, amount))
        for key in heals:
            heals[key].sort()
        for key in downs:
            downs[key].sort()

        played = set()
        for ts, kind, p, extra in evs:
            role = kit_at(timeline, p, ts) if kind != "spawn" else extra
            medic = is_medic_role(role)
            if kind == "spawn" and p in stats and medic:
                played.add(p)
            elif kind == "heal" and p in stats and medic:
                _patient, amount = extra
                if amount > 0:
                    stats[p]["hp"] += amount
            elif kind == "revive" and p in stats and medic and p != extra:
                patient = extra
                st = stats[p]
                st["res"] += 1
                day = msk_day(ts)
                st["res_days"].add(day)
                st["res_by_day"][day] += 1
                st["patients"][patient] += 1
                limit = m["t1"]
                switched = [dt for dt, role_name in timeline.get(p, []) if dt > ts and not is_medic_role(role_name)]
                if switched and switched[0] < limit:
                    limit = switched[0]
                nxt = [t for t in downs.get(patient, []) if t > ts + timedelta(seconds=1)]
                if nxt and nxt[0] < limit:
                    limit = nxt[0]
                own = 0.0
                for ht, amount in heals.get((p, patient), []):
                    if ht < ts - timedelta(seconds=1):
                        continue
                    if ht > limit:
                        break
                    if amount >= 1:
                        own += amount
                patient_medic = is_medic_role(kit_at(timeline, patient, ts))
                if not patient_medic and own < 1:
                    st["no_hp"] += 1
            elif kind == "wound":
                att = steam_to.get(extra)
                if att in stats and is_medic_role(kit_at(timeline, att, ts)):
                    att_team = team_now.get(att, "")
                    vic_team = team_now.get(p, "")
                    if att != p and att_team and vic_team and att_team != vic_team:
                        stats[att]["knocks"] += 1
            elif kind == "die":
                att = steam_to.get(extra)
                confirmed = any(0 <= (t - ts).total_seconds() <= CONFIRM for t in inactive.get(p, []))
                if confirmed and att in stats and is_medic_role(kit_at(timeline, att, ts)):
                    att_team = team_now.get(att, "")
                    vic_team = team_now.get(p, "")
                    if att != p and att_team and vic_team and att_team != vic_team:
                        stats[att]["kills"] += 1
                if confirmed and p in stats and is_medic_role(kit_at(timeline, p, ts)) and att != p:
                    stats[p]["deaths"] += 1

        minutes = m["dur"] / 60.0
        day = msk_day(m["t0"])
        for p in played:
            stats[p]["games"] += 1
            stats[p]["game_days"].add(day)
            stats[p]["minutes"] += minutes

    rows = []
    for key, display in track.items():
        s = stats[key]
        games = s["games"]
        minutes = s["minutes"]
        res = s["res"]
        # Heal lines only exist for the last day of this window. Without them,
        # "no HP" and "HP per revive" just measure the missing log.
        heal_ok = bool(res) and s["hp"] >= 15 * res
        heal_days = len(s["res_days"]) if heal_ok else 0
        raw = {
            "res_pg": (round(res / games, 2) if games else None, len(s["game_days"])),
            "res_total": (res if games else None, len(s["game_days"])),
            "hp_min": (round(s["hp"] / minutes, 1) if minutes and heal_ok else None, heal_days),
            "no_hp": (round(100.0 * s["no_hp"] / res, 1) if res and heal_ok else None, heal_days),
            "hp_res": (round(s["hp"] / res, 1) if res and heal_ok else None, heal_days),
            "variety": (pocket_share(list(s["patients"].values())), len(s["res_days"])),
            "dpg": (round(s["deaths"] / games, 2) if games else None, len(s["game_days"])),
            "kpg": (round(s["kills"] / games, 2) if games else None, len(s["game_days"])),
            "noks": (round(s["knocks"] / games, 2) if games else None, len(s["game_days"])),
            "res_min": (round(res / minutes, 2) if minutes else None, len(s["game_days"])),
            "week": (round(len(s["game_days"]) / (WINDOW_DAYS / 7), 2), len(s["game_days"])),
        }
        rows.append({
            "nick": display,
            "games": games,
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
        anchors[key] = {
            "best": best,
            "worst": worst,
            "n": len(vals),
            "higher": higher,
            "bestNicks": [r["nick"] for r in rows if r["raw"][key]["ok"] and r["raw"][key]["v"] == best],
            "worstNicks": [r["nick"] for r in rows if r["raw"][key]["ok"] and r["raw"][key]["v"] == worst],
        }
        for r in rows:
            cell = r["raw"][key]
            if not cell["ok"]:
                cell["lvl"] = None
                continue
            cell["lvl"] = level_of(cell["v"], worst, best, higher)

    scored_metrics = [m for m in METRICS if m[0] != "variety"]
    for r in rows:
        r["raw"]["variety"]["lvl"] = None
        parts = [
            r["raw"][k]["lvl"] * (0.5 if k == "hp_res" else 1.0)
            for k, _t, _h in scored_metrics
            if r["raw"][k].get("lvl") is not None
        ]
        r["scored"] = len(parts)
        r["level"] = round(sum(parts) / len(scored_metrics), 2) if parts else None

    rows.sort(key=lambda r: (r["level"] is None, -(r["level"] or 0), -r["days"], r["nick"].lower()))
    out = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "window": window_label,
        "from": day_from,
        "to": day_to,
        "needDays": NEED_DAYS,
        "metricCount": sum(1 for k, _t, _h in METRICS if k != "variety"),
        "title": "Медик · уровень 1–10",
        "foot": "Считаются тренировки и клановые войны на TR1–TR5. Раунды турнирной сетки считаются всегда. Дженсен и прочие раунды короче 8 минут не считаются. Окно — 14 дней, новый день заходит и старый выходит. Нет 5 дней по показателю — калибровка. ХП на рес в общий уровень входит наполовину: 10 в столбце даёт 5. Убийство — гивап, нок — сбитие. Стиль: Покет — один игрок забрал 20% всех ресов и больше, иначе Отрядный. Хил в лестницу встанет, когда строка хила закроет 5 дней.",
        "metrics": [
            {"key": k, "title": t, "higher": h, "scored": k != "variety", "weight": 0.5 if k == "hp_res" else 1}
            for k, t, h in METRICS
        ],
        "anchors": anchors,
        "players": rows,
        "liveMatches": len(kept),
        "roster": len(rows),
    }
    payload = json.dumps(out, ensure_ascii=False)
    Path("/tmp/medic_ladder.json").write_text(payload, encoding="utf-8")
    for dest in OUT_PATHS:
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(payload, encoding="utf-8")
            print("wrote", dest)
        except OSError as exc:
            print("skip", dest, exc)
    for label in ("lepurple", "killreal"):
        guy = stats.get(nick_key(label))
        if not guy:
            print(label, "missing")
            continue
        counts = list(guy["patients"].values())
        total = sum(counts)
        ordered = sorted(guy["patients"].items(), key=lambda kv: (-kv[1], kv[0]))
        top6 = sum(n for _name, n in ordered[:6])
        core = sum(n for n in counts if n >= 3)
        print(
            label,
            "res", total,
            "nicks", len(counts),
            "top6", round(100 * top6 / total, 1) if total else None,
            "core3", round(100 * core / total, 1) if total else None,
        )
        for name, n in ordered:
            if n < 2:
                break
            print(f"  {n} {name}")
        if label == "lepurple":
            by_day = guy["res_by_day"]
            from20 = sum(n for day, n in by_day.items() if day >= "2026-10-20")
            before = sum(n for day, n in by_day.items() if day < "2026-10-20")
            print("lepurple by day, from20", from20, "before20", before)
            for day in sorted(by_day):
                print(f"  {day} {by_day[day]}")
    print("--- pair20 ---")
    for key, display in sorted(track.items(), key=lambda kv: kv[1].lower()):
        guy = stats.get(key)
        if not guy or not guy["res"]:
            continue
        total = guy["res"]
        ordered = sorted(guy["patients"].items(), key=lambda kv: (-kv[1], kv[0]))
        heavy = [(n, c) for n, c in ordered if 100.0 * c / total > 20]
        top = ordered[:2]
        pair = sum(c for _n, c in top)
        shown = ", ".join(f"{n} {c} ({round(100.0 * c / total, 1)}%)" for n, c in top)
        print(
            f"{display}\tres {total}\tpair {round(100.0 * pair / total, 1)}\t"
            f"over20 {len(heavy)}\t{shown}"
        )
    print("players", len(rows), "with_level", sum(1 for r in rows if r["level"] is not None))
    for r in rows:
        print(f"{r['level']}\t{r['scored']}\t{r['days']}\t{r['games']}\t{r['nick']}")


if __name__ == "__main__":
    main()
