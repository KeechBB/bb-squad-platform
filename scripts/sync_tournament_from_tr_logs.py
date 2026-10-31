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

# Planned bracket server for each QF (must match fruitStrikeSchedule)
MATCH_SERVER = {
    "q1": "TR1",
    "q2": "TR3",
    "q3": "TR4",
    "q4": "TR5",
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


def nick_key(n: str) -> str:
    return re.sub(r"\s+", "", (n or "").strip().lower())


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


def save_live(data: dict[str, Any]) -> None:
    p = live_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
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
        if early > TIME_EARLY_MIN:
            return -1.0
        if late > TIME_LATE_MIN:
            return -1.0
        time_score = max(0.0, 30.0 - abs(min(0.0, -early) + max(0.0, late)) / 3.0)
    return fac_ok * 3.0 + people * 2.0 + time_score


def planned_start_for(match_id: str) -> datetime | None:
    """QF all open 19:00; later rounds paced after."""
    if match_id in ("q1", "q2", "q3", "q4"):
        return PLAY_DAY
    order = ["s1", "s2", "l1", "l2", "wf", "r1", "r2", "ls", "lf", "gf"]
    try:
        i = order.index(match_id)
    except ValueError:
        return PLAY_DAY
    return PLAY_DAY + timedelta(minutes=40 + 20 * i)


def orient_tickets(layer: dict) -> tuple[int, int]:
    """Orient tickets to team_a / team_b using USA=left preference."""
    f1, f2 = str(layer.get("faction1") or ""), str(layer.get("faction2") or "")
    s1, s2 = int(layer.get("score1") or 0), int(layer.get("score2") or 0)
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
    }


def finalize_meeting(r1: dict, r2: dict, team_a: dict, team_b: dict) -> dict:
    """Orient tickets to team_a / team_b using USA=left preference + roster."""
    a1, b1 = orient_tickets(r1)
    a2, b2 = orient_tickets(r2)
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


def rebuild_stats(matches: dict[str, dict]) -> tuple[list, list, list]:
    history = []
    player_acc: dict[str, dict] = {}
    team_acc: dict[str, dict] = {}
    for mid, row in matches.items():
        if row.get("status") != "done":
            continue
        wa, wb = row["winner"], row["loser"]
        history.append(
            {
                "id": mid,
                "dateLabel": (row.get("r2") or row.get("r1") or {}).get("end", "")[:10],
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
    teams = sorted(team_acc.values(), key=lambda x: (-x["wins"], -x["matches"], x["name"]))
    return history, list(player_acc.values()), teams


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
        if done.get(mid, {}).get("status") == "done":
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
            a1, b1 = orient_tickets(r1_layer)
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

        meeting = finalize_meeting(r1_layer, r2_layer, team_a, team_b)
        if prev_r1:
            meeting["r1"] = prev_r1
            meeting["sumA"] = int(prev_r1["ticketsA"]) + int(meeting["r2"]["ticketsA"])
            meeting["sumB"] = int(prev_r1["ticketsB"]) + int(meeting["r2"]["ticketsB"])
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

    history, player_stats, team_stats = rebuild_stats(done)
    live["matches"] = done
    live["history"] = history
    live["playerStats"] = player_stats
    live["teamStats"] = team_stats
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

