#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fruit Strike tournament auto-digitize from TR1…TR5 logs.

- Only naturally finished layers (InProgress → WaitingPostMatch + won/lost tickets).
- Reject AdminEndMatch / ForceEndMatch / rcon endmatch in the window (warmup / force).
- Match a closed layer to a bracket slot by map + time + factions + roster overlap.
- Each bracket match = R1+R2 on the same map; winner = ticket sum.

Writes: platform/data/tournaments/fruit-strike-s1-live.json
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import bb_log_fleet as FLEET  # noqa: E402
import rp_log_parse as R  # noqa: E402

TOURNAMENT_ID = "fruit-strike-s1"
MSK = timezone(timedelta(hours=3))
MIN_LAYER_SEC = int(float(os.environ.get("FS_MIN_LAYER_SEC", str(8 * 60))))
MIN_PLAYERS = int(os.environ.get("FS_MIN_PLAYERS", "10"))
TIME_EARLY_MIN = int(os.environ.get("FS_TIME_EARLY_MIN", "5"))
TIME_LATE_MIN = int(os.environ.get("FS_TIME_LATE_MIN", "50"))
LOOKBACK_H = int(os.environ.get("FS_LOOKBACK_H", "36"))

# Planned bracket server (must match fruitStrikeSchedule wave assignment)
MATCH_SERVER = {
    "q1": "TR1",
    "q2": "TR3",
    "q3": "TR4",
    "q4": "TR5",
    "s1": "TR1",
    "s2": "TR3",
    "l1": "TR4",
    "l2": "TR5",
}

FORCE_END_RE = re.compile(
    r"AdminEndMatch|ForceEndMatch|Execute:\s*EndMatch|\bendmatch\b|RCON:.*[Ee]nd\s*Match",
    re.I,
)

# Planned server label → TR folder
SERVER_TO_TR = {
    "BLACKBERRY #1": "TR1",
    "BLACKBERRY#1": "TR1",
    "BLACKBERRIES #1": "TR1",
    # #2 лёг — слоты турнира переехали на #3 (TR3)
    "FCL ARENA #2": "TR3",
    "FCL ARENA 2": "TR3",
    "FCL ARENA #3": "TR3",
    "FCL ARENA 3": "TR3",
    "FCL ARENA #4": "TR4",
    "FCL ARENA 4": "TR4",
    "FCL ARENA #5": "TR5",
    "FCL ARENA 5": "TR5",
}

# Bracket seed (registration order 1..8) — keep in sync with fruitStrikeBracket.ts
TEAMS = [
    {"name": "SUNRISE", "tag": "SR"},
    {"name": "PHOENIX AMETHYST", "tag": "PA"},
    {"name": "PHOENIX", "tag": "PX"},
    {"name": "PHOENIX SKY MIST", "tag": "PSM"},
    {"name": "DANON", "tag": "DN"},
    {"name": "ALPHA", "tag": "A"},
    {"name": "Ritual Agency", "tag": "RA"},
    {"name": "EMERGENCY", "tag": "BBEG"},
]

QF = {
    "q1": (TEAMS[0], TEAMS[7]),
    "q2": (TEAMS[3], TEAMS[4]),
    "q3": (TEAMS[1], TEAMS[6]),
    "q4": (TEAMS[2], TEAMS[5]),
}

MAP_BY_MATCH = {
    "q1": "FCL_AlBasrah_v1",
    "q2": "FCL_BlackCoast_v1",
    "q3": "FCL_Fallujah_v1",
    "q4": "FCL_GooseBay_v1",
    "s1": "FCL_Harju_v1",
    "s2": "FCL_Kamdesh_v1",
    "wf": "FCL_Kokan_v1",
    "l1": "FCL_Lashkar_v1",
    "l2": "FCL_Mutaha_v1",
    "r1": "FCL_Mutaha_v2",
    "r2": "FCL_Narva_v1",
    "ls": "FCL_Narva_v2",
    "lf": "FCL_Sanxian_v1",
    "gf": "FCL_Sumari_v1",
}

# From fruitStrikeSchedule START + plan order (approx clocks for matching)
# Recomputed lightly: tournament day 31.10.2026 19:00 MSK
PLAY_DAY = datetime(2026, 10, 31, 19, 0, tzinfo=MSK)

# Double-elim feed: which match fills which side of a later match
FEEDS = {
    "s1": (("q1", "W"), ("q2", "W")),
    "s2": (("q3", "W"), ("q4", "W")),
    "wf": (("s1", "W"), ("s2", "W")),
    "l1": (("q1", "L"), ("q2", "L")),
    "l2": (("q3", "L"), ("q4", "L")),
    "r1": (("l1", "W"), ("s2", "L")),
    "r2": (("l2", "W"), ("s1", "L")),
    "ls": (("r1", "W"), ("r2", "W")),
    "lf": (("ls", "W"), ("wf", "L")),
    "gf": (("wf", "W"), ("lf", "W")),
}


def live_path() -> Path:
    return HERE.parent / "data" / "tournaments" / "fruit-strike-s1-live.json"


_INVISIBLE_RE = re.compile(
    r"[\u200b-\u200f\u202a-\u202e\ufeff\U000e0000-\U000e007f]+"
)


def clean_nick(n: str) -> str:
    return _INVISIBLE_RE.sub("", (n or "")).strip()


def nick_key(n: str) -> str:
    return re.sub(r"\s+", "", clean_nick(n).lower())


# Log nick → roster nick_key (Fruit Strike night fixes)
TOURNAMENT_NICK_ALIASES = {
    "isaiah": "иcaйя",  # site nick is И + latin c + aйя
    "исайя": "иcaйя",
    "trixx": "trix",
}


def map_stem(layer: str) -> str:
    s = (layer or "").replace("\\", "/")
    s = s.split("/")[-1]
    s = re.sub(r"\.(umap|UMap)$", "", s, flags=re.I)
    s = re.sub(r"^FCL_", "", s, flags=re.I)
    return s.lower().replace("-", "_")


def maps_compatible(planned: str, found: str) -> bool:
    a = map_stem(planned)
    b = map_stem(found)
    if not a or not b:
        return False
    # Never treat Skirmish/Small as the planned 8x8 layer.
    if re.search(r"skirmish|small|_tc\b", b) and not re.search(
        r"skirmish|small|_tc\b", a
    ):
        return False
    # FCL_Mutaha_v1 vs Mutaha / FCL_Mutaha_v2
    a0 = re.sub(r"_v\d+$", "", a)
    b0 = re.sub(r"_v\d+$", "", b)
    if a == b or a0 == b0:
        # if planned has v2, require v2 in found when possible
        if "_v2" in a and "_v2" not in b and "v2" not in b:
            return False
        if "_v1" in a and "_v2" in b:
            return False
        return True
    return a0 in b or b0 in a


def faction_is_usa(name: str) -> bool:
    u = (name or "").upper()
    if not u:
        return False
    if "USA" in u or "USMC" in u or "UNITED STATES" in u or u == "US":
        return True
    # FCL / vanilla US display names
    if "10TH MOUNTAIN" in u or "MARINE EXPEDITIONARY" in u or "101ST" in u:
        return True
    if "BP_SOLDIER_USA" in u:
        return True
    return False


def faction_is_rgf(name: str) -> bool:
    u = (name or "").upper()
    if not u:
        return False
    if "RGF" in u or "RUSSIA" in u or "VDV" in u or "MSV" in u or "RU_" in u:
        return True
    # FCL Russian display names
    if "1398" in u or "RECONNAISSANCE BATTALION" in u or "21ST DIVISION" in u:
        return True
    if "BP_SOLDIER_RU" in u:
        return True
    return False


def load_live() -> dict[str, Any]:
    p = live_path()
    if p.is_file():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "tournamentId": TOURNAMENT_ID,
        "updatedAt": None,
        "rules": {
            "winBy": "ticketSum",
            "roundsPerMeeting": 2,
            "factionLeft": "USA",
            "factionRight": "RGF",
            "naturalEndOnly": True,
        },
        "matches": {},
        "history": [],
        "playerStats": [],
        "teamStats": [],
    }


def save_live(data: dict[str, Any], *, preserve_owned: bool = True) -> None:
    p = live_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    lock = p.with_suffix(".lock")
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    with lock.open("a+", encoding="utf-8") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        if preserve_owned and p.is_file():
            try:
                cur = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                cur = {}
            owned = data.setdefault("matches", {})
            for mid, row in (cur.get("matches") or {}).items():
                if row.get("watch") or row.get("locked"):
                    owned[mid] = row
            if cur.get("playerStats") and not data.get("playerStats"):
                data["playerStats"] = cur.get("playerStats")
        history, players, teams = rebuild_stats(data.get("matches") or {})
        if history:
            data["history"] = history
            data["playerStats"] = players
            data["teamStats"] = teams
        tmp = p.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        tmp.replace(p)


def load_rosters() -> dict[str, set[str]]:
    """tag → set(nickKey) from Postgres TournamentEntry."""
    out: dict[str, set[str]] = {t["tag"]: set() for t in TEAMS}
    def run_sql(sql: str) -> str:
        proc = subprocess.run(
            [
                "sudo",
                "-u",
                "postgres",
                "psql",
                "-d",
                "bb_squad",
                "-At",
                "-F",
                "|",
                "-c",
                sql,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        if proc.returncode != 0:
            print("roster sql fail", proc.stderr[-300:], flush=True)
            return ""
        return proc.stdout

    try:
        text = run_sql(
            """
SELECT t.tag, u.nick
FROM "TournamentEntry" e
JOIN "TournamentTeam" t ON t.id = e."teamId"
JOIN "TournamentEntryPlayer" ep ON ep."entryId" = e.id
JOIN "User" u ON u.id = ep."userId"
WHERE e."tournamentId" = 'fruit-strike-s1' AND e.status = 'CONFIRMED';
"""
        )
        for line in text.splitlines():
            if "|" not in line:
                continue
            tag, nick = line.split("|", 1)
            tag = tag.strip().upper()
            if tag in out:
                out[tag].add(nick_key(nick))
        text2 = run_sql(
            """
SELECT t.tag, u.nick
FROM "TournamentTeamMember" m
JOIN "TournamentTeam" t ON t.id = m."teamId"
JOIN "User" u ON u.id = m."userId"
WHERE t.id IN (
  SELECT e."teamId" FROM "TournamentEntry" e
  WHERE e."tournamentId" = 'fruit-strike-s1' AND e.status = 'CONFIRMED'
);
"""
        )
        for line in text2.splitlines():
            if "|" not in line:
                continue
            tag, nick = line.split("|", 1)
            tag = tag.strip().upper()
            if tag in out:
                out[tag].add(nick_key(nick))
    except Exception as e:
        print("roster load error", e, flush=True)
    for tag, nicks in out.items():
        print(f"roster {tag}: {len(nicks)}", flush=True)
    return out


def force_ended(log_path: Path, t0: datetime, t1: datetime) -> bool:
    if not log_path.is_file():
        return False
    if t0.tzinfo is None:
        t0 = t0.replace(tzinfo=timezone.utc)
    if t1.tzinfo is None:
        t1 = t1.replace(tzinfo=timezone.utc)
    try:
        with log_path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if not FORCE_END_RE.search(line):
                    continue
                m = re.match(r"^\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})", line)
                if not m:
                    continue
                ts = R.parse_ts(m.group(1))
                if t0 <= ts <= t1 + timedelta(minutes=2):
                    return True
    except OSError:
        return False
    return False


def player_keys_in_window(log_path: Path, t0: datetime, t1: datetime) -> set[str]:
    """Nicks seen joining / combat in window — coarse roster signal."""
    keys: set[str] = set()
    if not log_path.is_file():
        return keys
    join_re = re.compile(r"Name=(?P<name>[^?\s]+)")
    try:
        with log_path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                m = re.match(r"^\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})", line)
                if not m:
                    continue
                ts = R.parse_ts(m.group(1))
                if ts < t0 or ts > t1:
                    continue
                if "Login request" in line:
                    jm = join_re.search(line)
                    if jm:
                        keys.add(nick_key(jm.group("name")))
                # combat nick patterns are heavy — joins are enough for overlap
    except OSError:
        pass
    return keys


CREATE_SQUAD_RE = re.compile(
    r"LogSquad:\s*(?P<nick>.+?)\s*\(Online IDs:.*?steam:\s*7656\d+\)\s+"
    r"has created Squad\s+\d+\s+\(Squad Name:.*?\)\s+on\s+(?P<faction>.+)$"
)
POSSESS_SIDE_RE = re.compile(
    r"OnPossess\(\):\s*PC=(?P<nick>.+?)\s*\(Online IDs:.*?steam:\s*7656\d+\).*?"
    r"Pawn=BP_Soldier_(?P<side>USA|RU)_",
    re.I,
)


def side_nicks_in_window(
    log_path: Path, t0: datetime, t1: datetime, faction1: str, faction2: str
) -> tuple[set[str], set[str]]:
    """Split nicks onto score team1 / team2 via CreateSquad faction + USA/RU possess."""
    t1_keys: set[str] = set()
    t2_keys: set[str] = set()
    if not log_path.is_file():
        return t1_keys, t2_keys
    f1u = (faction1 or "").upper()
    f2u = (faction2 or "").upper()
    try:
        with log_path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                m = re.match(r"^\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})", line)
                if not m:
                    continue
                ts = R.parse_ts(m.group(1))
                if ts < t0 or ts > t1:
                    continue
                cm = CREATE_SQUAD_RE.search(line)
                if cm:
                    nick = nick_key(cm.group("nick"))
                    fac = (cm.group("faction") or "").strip().upper()
                    if not nick or not fac:
                        continue
                    if f1u and (fac == f1u or fac in f1u or f1u in fac):
                        t1_keys.add(nick)
                        continue
                    if f2u and (fac == f2u or fac in f2u or f2u in fac):
                        t2_keys.add(nick)
                        continue
                    # fallback by USA/RGF family
                    if faction_is_usa(fac):
                        if faction_is_usa(f1u):
                            t1_keys.add(nick)
                        elif faction_is_usa(f2u):
                            t2_keys.add(nick)
                    elif faction_is_rgf(fac):
                        if faction_is_rgf(f1u):
                            t1_keys.add(nick)
                        elif faction_is_rgf(f2u):
                            t2_keys.add(nick)
                    continue
                pm = POSSESS_SIDE_RE.search(line)
                if pm:
                    nick = nick_key(pm.group("nick"))
                    side = (pm.group("side") or "").upper()
                    if not nick:
                        continue
                    if side == "USA":
                        if faction_is_usa(f1u):
                            t1_keys.add(nick)
                        elif faction_is_usa(f2u):
                            t2_keys.add(nick)
                    elif side == "RU":
                        if faction_is_rgf(f1u):
                            t1_keys.add(nick)
                        elif faction_is_rgf(f2u):
                            t2_keys.add(nick)
    except OSError:
        pass
    return t1_keys, t2_keys


def discover_natural_layers(servers: list[str]) -> list[dict[str, Any]]:
    env = FLEET.load_env()
    root = FLEET.archive_root(env)
    out: list[dict[str, Any]] = []
    if root is None or not root.is_dir():
        print("no archive root", flush=True)
        return out
    since = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_H)
    for srv in servers:
        folder = FLEET.archive_folder_name(srv)
        base = root / folder
        logs: list[Path] = []
        live = base / "_live" / "SquadGame.log"
        if live.is_file():
            logs.append(live)
        for month in sorted(base.glob("????-??"), reverse=True)[:2]:
            logs.extend(sorted(month.glob("SquadGame-backup-*.log"))[-6:])
        for path in logs:
            try:
                matches = R.discover_matches([path], min_sec=MIN_LAYER_SEC)
            except Exception as e:
                print("discover fail", path, e, flush=True)
                continue
            for m in matches:
                start: datetime = m["start"]
                end: datetime = m["end"]
                if start.tzinfo is None:
                    start = start.replace(tzinfo=timezone.utc)
                if end.tzinfo is None:
                    end = end.replace(tzinfo=timezone.utc)
                if end < since:
                    continue
                if m.get("score1") is None or m.get("score2") is None:
                    continue
                if not m.get("winnerTeam"):
                    continue
                lp = Path(m.get("logPath") or path)
                if force_ended(lp, start, end):
                    print(
                        f"skip force-end {srv} {m.get('map')} {start.astimezone(MSK)}",
                        flush=True,
                    )
                    continue
                players = player_keys_in_window(lp, start, end)
                # Tournament: tickets+winner already prove a real round. Join-window
                # nick count is often tiny (players joined before InProgress).
                if len(players) < MIN_PLAYERS:
                    if m.get("score1") is None or m.get("winnerTeam") is None:
                        print(
                            f"skip tiny roster {srv} {m.get('map')} n={len(players)}",
                            flush=True,
                        )
                        continue
                    print(
                        f"weak roster ok {srv} {m.get('map')} n={len(players)} "
                        f"score={m.get('score1')}:{m.get('score2')}",
                        flush=True,
                    )
                out.append(
                    {
                        **m,
                        "server": srv,
                        "start": start,
                        "end": end,
                        "players": players,
                        "logPath": str(lp),
                        "faction1": m.get("faction1") or "",
                        "faction2": m.get("faction2") or "",
                    }
                )
    out.sort(key=lambda x: x["start"])
    print(f"natural layers: {len(out)}", flush=True)
    return out


def resolve_sides(match_id: str, done: dict[str, dict]) -> tuple[dict, dict] | None:
    if match_id in QF:
        return QF[match_id]
    feed = FEEDS.get(match_id)
    if not feed:
        return None
    left_src, right_src = feed
    sides = []
    for mid, wl in (left_src, right_src):
        row = done.get(mid)
        if not row or row.get("status") != "done":
            return None
        team = row["winner"] if wl == "W" else row["loser"]
        sides.append(team)
    return sides[0], sides[1]


def seed_advanced_sides(done: dict[str, dict]) -> None:
    """Put a known winner on the upper bracket and the loser on the red drop,
    even when the other feeder match is still open."""
    for mid, feed in FEEDS.items():
        row = dict(done.get(mid) or {})
        if row.get("locked") or row.get("status") == "done":
            continue
        left_src, right_src = feed

        def pick(src: tuple[str, str]) -> dict | None:
            src_id, kind = src
            src_row = done.get(src_id) or {}
            if src_row.get("status") != "done":
                return None
            team = src_row.get("winner") if kind == "W" else src_row.get("loser")
            if not isinstance(team, dict) or not team.get("tag"):
                return None
            return {"name": team.get("name"), "tag": team.get("tag")}

        left, right = pick(left_src), pick(right_src)
        if not left and not right:
            continue
        if left:
            row["teamA"] = left
        if right:
            row["teamB"] = right
        row.setdefault("status", "pending")
        row["map"] = row.get("map") or MAP_BY_MATCH.get(mid)
        done[mid] = row


def roster_score(players: set[str], tag: str, rosters: dict[str, set[str]]) -> int:
    want = rosters.get(tag) or set()
    if not want:
        return 0
    return len(players & want)


def layer_fits_slot(
    layer: dict[str, Any],
    match_id: str,
    team_a: dict,
    team_b: dict,
    rosters: dict[str, set[str]],
    planned_start: datetime | None,
) -> float:
    planned_map = MAP_BY_MATCH[match_id]
    if not maps_compatible(planned_map, str(layer.get("map") or "")):
        return -1.0
    want_srv = MATCH_SERVER.get(match_id)
    if want_srv and layer.get("server") != want_srv:
        return -1.0
    # factions: left USA / right RGF preferred
    f1 = str(layer.get("faction1") or "")
    f2 = str(layer.get("faction2") or "")
    fac_ok = 0.0
    if faction_is_usa(f1) and faction_is_rgf(f2):
        fac_ok = 2.0
    elif faction_is_usa(f2) and faction_is_rgf(f1):
        fac_ok = 1.0  # swapped — still usable
    else:
        fac_ok = 0.2
    sa = roster_score(layer["players"], team_a["tag"], rosters)
    sb = roster_score(layer["players"], team_b["tag"], rosters)
    if sa + sb < 3:
        # weak people signal — still allow if map+time strong
        people = float(sa + sb) * 0.5
    else:
        people = float(sa + sb)
    time_score = 0.0
    if planned_start is not None:
        start_m = layer["start"].astimezone(MSK)
        early = (planned_start - start_m).total_seconds() / 60.0
        late = (start_m - planned_start).total_seconds() / 60.0
        # Reject warmups that start too early / too late vs slot clock.
        late_limit = 120 if match_id in ("s1", "s2", "l1", "l2") else TIME_LATE_MIN
        if early > TIME_EARLY_MIN:
            return -1.0
        if late > late_limit:
            return -1.0
        time_score = max(0.0, 30.0 - abs(min(0.0, -early) + max(0.0, late)) / 3.0)
    return fac_ok * 3.0 + people * 2.0 + time_score


def planned_start_for(match_id: str) -> datetime | None:
    """QF all open 19:00; later rounds paced after."""
    if match_id in ("q1", "q2", "q3", "q4"):
        return PLAY_DAY
    if match_id in ("s1", "s2", "l1", "l2"):
        return PLAY_DAY + timedelta(minutes=60)
    order = ["s1", "s2", "l1", "l2", "wf", "r1", "r2", "ls", "lf", "gf"]
    try:
        i = order.index(match_id)
    except ValueError:
        return PLAY_DAY
    return PLAY_DAY + timedelta(minutes=40 + 20 * i)


def orient_tickets(
    layer: dict,
    team_a: dict | None = None,
    team_b: dict | None = None,
    rosters: dict[str, set[str]] | None = None,
) -> tuple[int, int]:
    """Orient tickets to team_a / team_b.

    Prefer nick∩roster on each score-side (CreateSquad / Possess).
    Fallback: USA=left / RGF=right.
    """
    f1, f2 = str(layer.get("faction1") or ""), str(layer.get("faction2") or "")
    s1, s2 = int(layer.get("score1") or 0), int(layer.get("score2") or 0)

    if team_a and team_b and rosters is not None:
        lp = Path(str(layer.get("logPath") or ""))
        t0, t1 = layer.get("start"), layer.get("end")
        if lp.is_file() and isinstance(t0, datetime) and isinstance(t1, datetime):
            side1, side2 = side_nicks_in_window(lp, t0, t1, f1, f2)
            ra = rosters.get(team_a["tag"]) or set()
            rb = rosters.get(team_b["tag"]) or set()
            a_on_1 = len(side1 & ra)
            a_on_2 = len(side2 & ra)
            b_on_1 = len(side1 & rb)
            b_on_2 = len(side2 & rb)
            # team_a should map to the side where its roster dominates
            score_a_on_1 = a_on_1 - a_on_2
            score_b_on_1 = b_on_1 - b_on_2
            score_a_on_2 = a_on_2 - a_on_1
            score_b_on_2 = b_on_2 - b_on_1
            if score_a_on_1 > 0 and score_b_on_1 <= 0:
                print(
                    f"orient nicks {team_a['tag']}→T1({a_on_1}) {team_b['tag']}→T2({b_on_2}) "
                    f"{s1}:{s2}",
                    flush=True,
                )
                return s1, s2
            if score_a_on_2 > 0 and score_b_on_2 <= 0:
                print(
                    f"orient nicks {team_a['tag']}→T2({a_on_2}) {team_b['tag']}→T1({b_on_1}) "
                    f"flip {s2}:{s1}",
                    flush=True,
                )
                return s2, s1
            # weaker signal: whichever side has more of team_a
            if a_on_1 + a_on_2 + b_on_1 + b_on_2 >= 2:
                if a_on_1 >= a_on_2:
                    return s1, s2
                return s2, s1

    if faction_is_usa(f1) and faction_is_rgf(f2):
        return s1, s2
    if faction_is_usa(f2) and faction_is_rgf(f1):
        return s2, s1
    return s1, s2


def round_payload(layer: dict, tickets_a: int, tickets_b: int) -> dict:
    return {
        "ticketsA": tickets_a,
        "ticketsB": tickets_b,
        "start": layer["start"].astimezone(MSK).isoformat(),
        "end": layer["end"].astimezone(MSK).isoformat(),
        "server": layer.get("server"),
        "layer": layer.get("map"),
        "naturalEnd": True,
        "logPath": layer.get("logPath"),
    }


def finalize_meeting(
    r1: dict,
    r2: dict,
    team_a: dict,
    team_b: dict,
    rosters: dict[str, set[str]] | None = None,
) -> dict:
    """Orient tickets to team_a / team_b using nick overlap + USA/RGF fallback."""
    a1, b1 = orient_tickets(r1, team_a, team_b, rosters)
    a2, b2 = orient_tickets(r2, team_a, team_b, rosters)
    sum_a, sum_b = a1 + a2, b1 + b2
    if sum_a == sum_b:
        # rare: ask captain — mark draw pending (still pick higher R2 as tiebreak)
        winner, loser = (team_a, team_b) if a2 >= b2 else (team_b, team_a)
    elif sum_a > sum_b:
        winner, loser = team_a, team_b
    else:
        winner, loser = team_b, team_a
    return {
        "status": "done",
        "teamA": team_a,
        "teamB": team_b,
        "map": MAP_BY_MATCH.get(r1.get("matchId") or "", r1.get("map")),
        "r1": round_payload(r1, a1, b1),
        "r2": round_payload(r2, a2, b2),
        "sumA": sum_a,
        "sumB": sum_b,
        "scoreLabel": f"{sum_a}:{sum_b}",
        "winner": winner,
        "loser": loser,
    }


def _blank_player(nick: str) -> dict:
    return {
        "nick": clean_nick(nick) or nick,
        "noks": 0,
        "kills": 0,
        "deaths": 0,
        "vehicles": 0,
        "res": 0,
        "matches": 0,
        "wins": 0,
        "winPct": 0,
        "mvpKiller": 0,
        "mvpMedic": 0,
        "mvpArmor": 0,
        "kd": 0.0,
    }


def _canonical_player_nick(raw: str, display: dict[str, str], aliases: dict[str, str]) -> tuple[str, str]:
    """Return (merge_key, display_nick) for rating table."""
    nick = clean_nick(raw)
    key = nick_key(nick)
    key = TOURNAMENT_NICK_ALIASES.get(key, key)
    key = aliases.get(key, key)
    if key in display:
        return key, display[key]
    return key, nick or raw.strip()


def _top_nick(rows: list, key: str) -> str | None:
    best_v = 0
    best = None
    for p in rows:
        v = int(p.get(key) or 0)
        if v > best_v:
            best_v = v
            best = str(p.get("nick") or "").strip()
    return best or None


def _load_train_helpers():
    """Reuse training combat aggregation (dies/wounds → player rows)."""
    import sync_train_from_tr1_logs as TRAIN  # noqa: WPS433

    return TRAIN.load_aliases, TRAIN.agg_players, TRAIN.stamp_vehicle_kills


def _resolve_round_log(rr: dict) -> Path | None:
    raw = str(rr.get("logPath") or "")
    if raw:
        p = Path(raw)
        if p.is_file():
            return p
    srv = str(rr.get("server") or "")
    if not srv:
        return None
    try:
        env = FLEET.load_env()
        root = FLEET.archive_root(env)
        if root is None:
            return None
        folder = FLEET.archive_folder_name(srv)
        live = root / folder / "_live" / "SquadGame.log"
        if live.is_file():
            return live
    except Exception:
        return None
    return None


def combat_rows_for_round(rr: dict, aliases: dict[str, str]) -> tuple[list[dict], list[dict]]:
    """Parse one stored round → (log team1 rows, log team2 rows)."""
    load_aliases, agg_players, stamp_vehicle_kills = _load_train_helpers()
    if not aliases:
        aliases = load_aliases()
    lp = _resolve_round_log(rr)
    if lp is None or not rr.get("start") or not rr.get("end"):
        return [], []
    try:
        start = datetime.fromisoformat(str(rr["start"]))
        end = datetime.fromisoformat(str(rr["end"]))
    except Exception:
        return [], []
    if start.tzinfo is None:
        start = start.replace(tzinfo=MSK)
    if end.tzinfo is None:
        end = end.replace(tzinfo=MSK)
    try:
        idx = R.index_log_combat(lp, aliases)
        steam = dict(idx.get("steam_to_nick") or {})
        teams = R.teams_in_window(idx, start, end, {})
        dies, _ = R.dies_in_window(idx, start, end, steam, aliases)
        wounds = R.wounds_in_window(idx, start, end, steam, aliases)
        revives = R.revives_in_window(idx, start, end)
        disp = {R.canon_key(n, aliases): n for n in steam.values()}
        t1, t2 = agg_players(dies, wounds, revives, teams, disp, aliases=aliases)
        stamp_vehicle_kills(
            t1,
            t2,
            idx=idx,
            start=start,
            end=end,
            steam=steam,
            aliases=aliases,
            teams=teams,
            disp=disp,
            dies=dies,
            wounds=wounds,
            revives=revives,
        )
        return t1, t2
    except Exception as e:
        print(f"combat parse fail {lp}: {e}", flush=True)
        return [], []


def _roster_overlap(rows: list[dict], tag: str, rosters: dict[str, set[str]]) -> int:
    want = rosters.get(tag) or set()
    if not want or not rows:
        return 0
    n = 0
    for p in rows:
        if nick_key(str(p.get("nick") or "")) in want:
            n += 1
    return n


def _roster_display_by_key(rosters: dict[str, set[str]]) -> dict[str, str]:
    """nick_key → preferred display nick from TournamentEntry / members.

    Rosters currently store only keys — reload display map from Postgres when needed.
    """
    # Built lazily in enrich via load_roster_display().
    return {}


_ROSTER_DISPLAY: dict[str, str] = {}


def load_roster_display() -> dict[str, str]:
    """nick_key → site nick (for Isaiah→Исайя merge in UI)."""
    global _ROSTER_DISPLAY
    if _ROSTER_DISPLAY:
        return _ROSTER_DISPLAY
    out: dict[str, str] = {}

    def run_sql(sql: str) -> str:
        proc = subprocess.run(
            ["sudo", "-u", "postgres", "psql", "-d", "bb_squad", "-At", "-F", "|", "-c", sql],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        return proc.stdout if proc.returncode == 0 else ""

    try:
        text = run_sql(
            """
SELECT u.nick
FROM "TournamentEntry" e
JOIN "TournamentEntryPlayer" ep ON ep."entryId" = e.id
JOIN "User" u ON u.id = ep."userId"
WHERE e."tournamentId" = 'fruit-strike-s1' AND e.status = 'CONFIRMED'
UNION
SELECT u.nick
FROM "TournamentTeamMember" m
JOIN "TournamentTeam" t ON t.id = m."teamId"
JOIN "User" u ON u.id = m."userId"
WHERE t.id IN (
  SELECT e."teamId" FROM "TournamentEntry" e
  WHERE e."tournamentId" = 'fruit-strike-s1' AND e.status = 'CONFIRMED'
);
"""
        )
        for nick in text.splitlines():
            nick = (nick or "").strip()
            if not nick:
                continue
            out[nick_key(nick)] = nick
    except Exception as e:
        print("roster display load error", e, flush=True)
    _ROSTER_DISPLAY = out
    print(f"roster display nicks: {len(out)}", flush=True)
    return out


def _map_nicks_to_roster(
    rows: list[dict],
    tag: str,
    rosters: dict[str, set[str]],
    display: dict[str, str] | None = None,
) -> list[dict]:
    """Rewrite log nicks to site roster spelling when keys match."""
    disp = display or _ROSTER_DISPLAY
    out = []
    for p in rows:
        q = dict(p)
        raw = str(q.get("nick") or "").strip()
        nk = nick_key(raw)
        if nk and nk in disp:
            q["nick"] = disp[nk]
        out.append(q)
    return out


def attach_sheet(
    row: dict,
    rosters: dict[str, set[str]],
    aliases: dict[str, str] | None = None,
) -> bool:
    """Fill row['sheet'] from TR logs for R1/R2. Returns True if any players found."""
    if row.get("status") != "done":
        return False
    team_a = row.get("teamA") or {}
    team_b = row.get("teamB") or {}
    tag_a = team_a.get("tag") or ""
    tag_b = team_b.get("tag") or ""
    sheet: dict[str, list] = {"r1": [], "r2": [], "oppR1": [], "oppR2": []}
    found = False
    for rk, sk_a, sk_b in (("r1", "r1", "oppR1"), ("r2", "r2", "oppR2")):
        rr = row.get(rk) or {}
        if not rr.get("start"):
            continue
        t1, t2 = combat_rows_for_round(rr, aliases or {})
        if not t1 and not t2:
            continue
        # Assign log sides → bracket teamA / teamB via roster overlap.
        a_on_1 = _roster_overlap(t1, tag_a, rosters)
        a_on_2 = _roster_overlap(t2, tag_a, rosters)
        b_on_1 = _roster_overlap(t1, tag_b, rosters)
        b_on_2 = _roster_overlap(t2, tag_b, rosters)
        if a_on_1 + b_on_2 >= a_on_2 + b_on_1 and (a_on_1 + b_on_2) > 0:
            left, right = t1, t2
        elif a_on_2 + b_on_1 > 0:
            left, right = t2, t1
        else:
            # Fallback: USA=left using faction names stored on round if any
            # else keep log order (team1=left).
            left, right = t1, t2
        disp = load_roster_display()
        sheet[sk_a] = _map_nicks_to_roster(left, tag_a, rosters, disp)
        sheet[sk_b] = _map_nicks_to_roster(right, tag_b, rosters, disp)
        if sheet[sk_a] or sheet[sk_b]:
            found = True
            print(
                f"sheet {tag_a}vs{tag_b} {rk}: A={len(sheet[sk_a])} B={len(sheet[sk_b])} "
                f"(overlap a1={a_on_1} a2={a_on_2} b1={b_on_1} b2={b_on_2})",
                flush=True,
            )
    if found:
        row["sheet"] = sheet
    return found


def enrich_sheets(
    matches: dict[str, dict],
    rosters: dict[str, set[str]],
    *,
    force: bool = False,
) -> int:
    load_aliases, _, _ = _load_train_helpers()
    aliases = load_aliases()
    n = 0
    for mid, row in matches.items():
        if row.get("status") != "done":
            continue
        # Skip already-filled sheets on the hot 45s poll — full reparse is minutes.
        sheet = row.get("sheet") or {}
        if not force and any(sheet.get(k) for k in ("r1", "r2", "oppR1", "oppR2")):
            continue
        if attach_sheet(row, rosters, aliases):
            n += 1
        else:
            print(f"sheet miss {mid}", flush=True)
    return n


def rebuild_stats(matches: dict[str, dict]) -> tuple[list, list, list]:
    history = []
    player_acc: dict[str, dict] = {}
    team_acc: dict[str, dict] = {}
    team_kd: dict[str, list[int]] = {}
    display = load_roster_display()
    try:
        load_aliases, _, _ = _load_train_helpers()
        aliases = load_aliases()
    except Exception:
        aliases = {}
    for mid, row in matches.items():
        if row.get("status") != "done":
            continue
        wa, wb = row["winner"], row["loser"]
        end = str((row.get("r2") or row.get("r1") or {}).get("end") or "")
        history.append(
            {
                "id": mid,
                "dateLabel": end[:10] or "2026-10-31",
                "teamA": row["teamA"]["name"],
                "teamB": row["teamB"]["name"],
                "map": row.get("map") or MAP_BY_MATCH.get(mid, ""),
                "score": row.get("scoreLabel") or f"{row.get('sumA')}:{row.get('sumB')}",
                "result": "done",
                "winner": wa["name"],
                "loser": wb["name"],
            }
        )
        for t, won in ((wa, True), (wb, False)):
            tag = t["tag"]
            slot = team_acc.setdefault(
                tag,
                {
                    "tag": tag,
                    "name": t["name"],
                    "matches": 0,
                    "wins": 0,
                    "winPct": 0,
                    "avgKd": 0,
                    "tournamentsPlayed": 1,
                    "titles": 0,
                },
            )
            slot["matches"] += 1
            if won:
                slot["wins"] += 1
            slot["winPct"] = round(100.0 * slot["wins"] / max(1, slot["matches"]))

        sheet = row.get("sheet") or {}
        winner_tag = (row.get("winner") or {}).get("tag")
        side_meta = {
            "A": ("r1", "r2", (row.get("teamA") or {}).get("tag")),
            "B": ("oppR1", "oppR2", (row.get("teamB") or {}).get("tag")),
        }
        buckets: dict[str, dict[str, dict]] = {"A": {}, "B": {}}
        for side_name, (k1, k2, tag) in side_meta.items():
            if not tag:
                continue
            for key in (k1, k2):
                rows = sheet.get(key) or []
                killer = _top_nick(rows, "kills")
                medic = _top_nick(rows, "res")
                armor = _top_nick(rows, "vehicleKills")
                for p in rows:
                    raw = str(p.get("nick") or "").strip()
                    if not raw or raw == "—":
                        continue
                    merge_key, disp_nick = _canonical_player_nick(raw, display, aliases)
                    s = buckets[side_name].setdefault(merge_key, _blank_player(disp_nick))
                    s["nick"] = disp_nick
                    s["noks"] += int(p.get("nok") or 0)
                    s["kills"] += int(p.get("kills") or 0)
                    s["deaths"] += int(p.get("deaths") or 0)
                    s["vehicles"] += int(p.get("vehicleKills") or 0)
                    s["res"] += int(p.get("res") or 0)
                    if killer and clean_nick(raw) == clean_nick(killer):
                        s["mvpKiller"] += 1
                    if medic and clean_nick(raw) == clean_nick(medic):
                        s["mvpMedic"] += 1
                    if armor and clean_nick(raw) == clean_nick(armor):
                        s["mvpArmor"] += 1

        def _load(s: dict) -> int:
            return s["kills"] + s["deaths"] + s["noks"] + s["res"] + s["vehicles"]

        for key in set(buckets["A"]) | set(buckets["B"]):
            left = buckets["A"].get(key)
            right = buckets["B"].get(key)
            tag_a = side_meta["A"][2]
            tag_b = side_meta["B"][2]
            if left and right:
                if _load(right) > _load(left) and tag_b:
                    chosen, tag = right, tag_b
                else:
                    chosen, tag = left, tag_a
            elif left and tag_a:
                chosen, tag = left, tag_a
            elif right and tag_b:
                chosen, tag = right, tag_b
            else:
                continue
            acc = player_acc.setdefault(key, _blank_player(chosen["nick"]))
            acc["nick"] = chosen["nick"]
            for fld in ("noks", "kills", "deaths", "vehicles", "res", "mvpKiller", "mvpMedic", "mvpArmor"):
                acc[fld] += chosen[fld]
            acc["matches"] += 1
            if tag == winner_tag:
                acc["wins"] += 1
            kd_slot = team_kd.setdefault(tag, [0, 0])
            kd_slot[0] += chosen["kills"]
            kd_slot[1] += chosen["deaths"]

    for acc in player_acc.values():
        deaths = acc["deaths"]
        acc["kd"] = round(acc["kills"] / deaths, 2) if deaths else float(acc["kills"])
        acc["winPct"] = round(100.0 * acc["wins"] / max(1, acc["matches"]))
        acc.pop("res", None)
        acc.pop("wins", None)
    for tag, (kills, deaths) in team_kd.items():
        if tag in team_acc:
            team_acc[tag]["avgKd"] = round(kills / deaths, 2) if deaths else float(kills)
    players = sorted(player_acc.values(), key=lambda x: (-x["kills"], x["nick"].lower()))
    teams = sorted(team_acc.values(), key=lambda x: (-x["wins"], -x["matches"], x["name"]))
    return history, players, teams


def run(dry_run: bool = False, reset: bool = False) -> int:
    live = load_live()
    done: dict[str, dict] = {} if reset else dict(live.get("matches") or {})
    if reset:
        print("reset: cleared matches for rebuild", flush=True)
    rosters = load_rosters()
    servers = ["TR1", "TR2", "TR3", "TR4", "TR5"]
    layers = discover_natural_layers(servers)
    used_layer_ids: set[str] = set()
    for mid, row in done.items():
        for rk in ("r1", "r2"):
            rr = row.get(rk) or {}
            if rr.get("start"):
                used_layer_ids.add(f"{rr.get('server')}|{rr.get('start')}")

    order = ["q1", "q2", "q3", "q4", "s1", "s2", "l1", "l2", "wf", "r1", "r2", "ls", "lf", "gf"]
    changed = False
    for mid in order:
        row0 = done.get(mid) or {}
        if row0.get("locked") or row0.get("watch") or row0.get("status") == "done":
            continue
        sides = resolve_sides(mid, done)
        if not sides:
            continue
        team_a, team_b = sides
        planned = planned_start_for(mid)
        scored: list[tuple[float, dict]] = []
        for layer in layers:
            lid = f"{layer.get('server')}|{layer['start'].astimezone(MSK).isoformat()}"
            if lid in used_layer_ids:
                continue
            sc = layer_fits_slot(layer, mid, team_a, team_b, rosters, planned)
            if sc >= 0:
                scored.append((sc, layer))
        scored.sort(key=lambda x: (-x[0], x[1]["start"]))
        prev = done.get(mid) or {}
        prev_r1 = prev.get("r1") if prev.get("status") != "done" else None

        def layer_id(L: dict) -> str:
            return f"{L.get('server')}|{L['start'].astimezone(MSK).isoformat()}"

        if not scored and not prev_r1:
            if mid not in done:
                done[mid] = {
                    "status": "pending",
                    "teamA": team_a,
                    "teamB": team_b,
                    "map": MAP_BY_MATCH[mid],
                }
                changed = True
            continue

        top = [L for _, L in scored[:8]]
        top.sort(key=lambda x: x["start"])

        r1_layer: dict | None = None
        r2_layer: dict | None = None
        if prev_r1 and top:
            r2_layer = None
            r1_end = datetime.fromisoformat(str(prev_r1.get("end") or prev_r1.get("start")))
            if r1_end.tzinfo is None:
                r1_end = r1_end.replace(tzinfo=MSK)
            for cand in top:
                if cand["start"] <= r1_end:
                    continue
                if maps_compatible(MAP_BY_MATCH[mid], str(cand.get("map") or "")):
                    r2_layer = cand
                    break
            if r2_layer is None:
                continue
            r1_layer = {
                "map": prev_r1.get("layer") or MAP_BY_MATCH[mid],
                "start": datetime.fromisoformat(prev_r1["start"]),
                "end": datetime.fromisoformat(prev_r1["end"]),
                "server": prev_r1.get("server"),
                "score1": prev_r1.get("ticketsA"),
                "score2": prev_r1.get("ticketsB"),
                "faction1": "USA",
                "faction2": "RGF",
            }
        elif len(top) >= 1:
            # Always write R1 first. Only finalize R2 on a later poll after R1 is stored,
            # so warmups + official R1 never collapse into a fake DONE in one pass.
            r1_layer = top[0]
            r2_layer = None

        if r1_layer is not None and r2_layer is None and not prev_r1:
            a1, b1 = orient_tickets(r1_layer, team_a, team_b, rosters)
            done[mid] = {
                "status": "pending",
                "teamA": team_a,
                "teamB": team_b,
                "map": MAP_BY_MATCH[mid],
                "r1": round_payload(r1_layer, a1, b1),
            }
            used_layer_ids.add(layer_id(r1_layer))
            changed = True
            print(
                f"R1 {mid}: {team_a['tag']} vs {team_b['tag']} "
                f"{a1}:{b1} (waiting R2)",
                flush=True,
            )
            continue

        if r1_layer is None or r2_layer is None:
            if mid not in done:
                done[mid] = {
                    "status": "pending",
                    "teamA": team_a,
                    "teamB": team_b,
                    "map": MAP_BY_MATCH[mid],
                }
                changed = True
            continue

        meeting = finalize_meeting(r1_layer, r2_layer, team_a, team_b, rosters)
        if prev_r1:
            meeting["r1"] = prev_r1
            # Re-orient R2 with nicks; keep stored R1 tickets.
            a2, b2 = orient_tickets(r2_layer, team_a, team_b, rosters)
            meeting["r2"] = round_payload(r2_layer, a2, b2)
            meeting["sumA"] = int(prev_r1["ticketsA"]) + a2
            meeting["sumB"] = int(prev_r1["ticketsB"]) + b2
            sa, sb = meeting["sumA"], meeting["sumB"]
            if sa > sb:
                meeting["winner"], meeting["loser"] = team_a, team_b
            elif sb > sa:
                meeting["winner"], meeting["loser"] = team_b, team_a
            else:
                print(f"SKIP equal sum {mid} {sa}:{sb}", flush=True)
                continue
            meeting["scoreLabel"] = f"{sa}:{sb}"
        meeting["map"] = MAP_BY_MATCH[mid]
        done[mid] = meeting
        if not prev_r1:
            used_layer_ids.add(layer_id(r1_layer))
        used_layer_ids.add(layer_id(r2_layer))
        changed = True
        print(
            f"DONE {mid}: {team_a['tag']} vs {team_b['tag']} "
            f"{meeting['scoreLabel']} → {meeting['winner']['tag']}",
            flush=True,
        )

    seed_advanced_sides(done)
    force_sheets = "--force-sheets" in set(sys.argv[1:])
    sheets_n = enrich_sheets(done, rosters, force=force_sheets)
    print(f"sheets enriched: {sheets_n}", flush=True)
    history, player_stats, team_stats = rebuild_stats(done)
    live["matches"] = done
    live["history"] = history
    live["playerStats"] = player_stats
    live["teamStats"] = team_stats
    print(f"playerStats: {len(player_stats)} teamStats: {len(team_stats)}", flush=True)
    if dry_run:
        print("DRY-RUN — not writing", flush=True)
        for mid in order:
            row = done.get(mid)
            if not row:
                continue
            r1 = row.get("r1") or {}
            r2 = row.get("r2") or {}
            print(
                mid,
                row.get("status"),
                (
                    f"r1={r1.get('ticketsA')}:{r1.get('ticketsB')}"
                    if r1
                    else "r1=-"
                ),
                (
                    f"r2={r2.get('ticketsA')}:{r2.get('ticketsB')}"
                    if r2
                    else "r2=-"
                ),
                flush=True,
            )
        return 0
    save_live(live)
    print(f"wrote {live_path()}", flush=True)
    return 0


if __name__ == "__main__":
    args = set(sys.argv[1:])
    raise SystemExit(run(dry_run="--dry-run" in args, reset="--reset" in args))

