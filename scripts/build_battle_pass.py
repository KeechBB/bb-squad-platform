#!/usr/bin/env python3
"""
Battle Pass «Фруктовый Сад» — прогресс по матчам паблика (TPUB1/PB1).

Считает только матчи ПОСЛЕ cutoverAfterMatchId (со следующей карты после включения).
Участники: User с profileComplete=true.

Запуск:
  python build_battle_pass.py              # sync from ledger + ensure cutover
  python build_battle_pass.py --from-blocks /tmp/bp_blocks.json
Вызывается из build_public_rp_ledger после скоринга новых матчей.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import rp_log_parse as R  # noqa: E402

OUT = Path(
    os.environ.get("BP_OUT")
    or (ROOT / "data" / "public" / "battle-pass.json")
)
LEDGER = Path(
    os.environ.get("PUBLIC_RP_LEDGER")
    or (ROOT / "data" / "public" / "rp-ledger.json")
)

TIERS = Path(
    os.environ.get("TIERS_JSON")
    or (ROOT / "data" / "kv-cache" / "data" / "tiers.json")
)
if not TIERS.is_file():
    TIERS = ROOT.parent / "KV" / "public" / "data" / "tiers.json"

SEASON_ID = "pb1-2026-10"
LEVEL_TARGETS = {
    1: 1,
    2: 15,
    3: 15,
    4: 15,
    5: 5,
    6: 3,
    7: 15,
    8: 3,
    9: 5,
    10: 3,
    11: 10,
    12: 100,
    13: 5,
    14: 5,
    15: 3,
    16: 15,
    17: 1,
    18: 1,
    19: 1,
    20: 1,
}

_HELI_RE = re.compile(
    r"(UH60|UH_60|MI8|MI_8|LOACH|CH146|RAVEN|MI17|MI24|KA52|AH.?64|AH.?1|"
    r"BLACKHAWK|HELI|HELICOPTER|MI28|Z10|Z19)",
    re.I,
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_alias_keys() -> dict[str, str]:
    out: dict[str, str] = {}
    if not TIERS.is_file():
        return out
    try:
        t = json.loads(TIERS.read_text(encoding="utf-8"))
    except Exception:
        return out
    for raw, canon in (t.get("aliases") or {}).items():
        ak, ck = R.nick_key(str(raw)), R.nick_key(str(canon))
        if ak and ck:
            out[ak] = ck
            out.setdefault(ck, ck)
    return out


def _psycopg_dsn(db: str) -> str:
    if not db or "://" not in db or "?" not in db:
        return db
    base, _, qs = db.partition("?")
    kept = [
        p
        for p in qs.split("&")
        if p and not p.lower().startswith("schema=")
    ]
    return f"{base}?{'&'.join(kept)}" if kept else base


def load_registered() -> dict[str, dict]:
    """nick_key(casefold) -> {nick, steamId, avatarUrl, name}"""
    out: dict[str, dict] = {}
    db = (os.environ.get("DATABASE_URL") or "").strip().strip("'").strip('"')
    if not db:
        env_path = ROOT / ".env"
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("DATABASE_URL="):
                    db = line.split("=", 1)[1].strip().strip("'").strip('"')
                    break
    if not db:
        print("BP: no DATABASE_URL — registered roster empty", flush=True)
        return out
    connect = None
    try:
        import psycopg2

        connect = psycopg2.connect
    except ImportError:
        try:
            import psycopg

            connect = psycopg.connect
        except ImportError:
            print("BP: no psycopg — registered roster empty", flush=True)
            return out
    try:
        conn = connect(_psycopg_dsn(db))
        cur = conn.cursor()
        cur.execute(
            """
            select nick, "steamId", "avatarUrl", name
            from "User"
            where "profileComplete" = true
              and nick is not null
              and length(trim(nick)) > 0
            """
        )
        for nick, steam, avatar, name in cur.fetchall():
            n = str(nick or "").strip()
            if not n:
                continue
            out[n.casefold()] = {
                "nick": n,
                "steamId": str(steam or "") or None,
                "avatarUrl": str(avatar or "") or None,
                "name": str(name or "") or "",
            }
        cur.close()
        conn.close()
    except Exception as e:
        print(f"BP: registered load failed: {type(e).__name__}: {e}", flush=True)
    print(f"BP: registered players={len(out)}", flush=True)
    return out


def is_tank(vehicle: str, tickets: int | None, label: str = "") -> bool:
    if tickets is not None and int(tickets) >= 15:
        return True
    a = str(vehicle or "")
    if R._VEH_TANK_RE.search(a):
        return True
    return "танк" in str(label or "").lower()


def is_heli(vehicle: str) -> bool:
    return bool(_HELI_RE.search(str(vehicle or "")))


def empty_player(reg: dict) -> dict:
    return {
        "nick": reg["nick"],
        "steamId": reg.get("steamId"),
        "avatarUrl": reg.get("avatarUrl"),
        "name": reg.get("name") or "",
        "currentLevel": 1,
        "current": 0,
        "target": LEVEL_TARGETS[1],
        "streak": 0,
        "window": [],
        "finished": False,
        "updatedAt": _utc_now(),
    }


def load_state() -> dict:
    if OUT.is_file():
        try:
            data = json.loads(OUT.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except Exception as e:
            print(f"BP: warn read {OUT}: {e}", flush=True)
    return {
        "seasonId": SEASON_ID,
        "enabled": True,
        "cutoverAfterMatchId": None,
        "scoredMatchIds": [],
        "players": {},
        "updatedAt": _utc_now(),
    }


def save_state(state: dict) -> None:
    state["updatedAt"] = _utc_now()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(state, ensure_ascii=False, indent=2) + "\n"
    OUT.write_text(text, encoding="utf-8")
    print(f"BP: wrote {OUT} ({OUT.stat().st_size} bytes)", flush=True)


def ensure_cutover(state: dict, ledger: dict) -> dict:
    """First run: cutover = last ledger match → считаем только следующие карты."""
    if state.get("cutoverAfterMatchId"):
        return state
    matches = ledger.get("matches") or []
    last_id = str(matches[-1]["id"]) if matches else ""
    state["cutoverAfterMatchId"] = last_id or "0"
    state["enabled"] = True
    state["seasonId"] = SEASON_ID
    print(
        f"BP: cutoverAfterMatchId={state['cutoverAfterMatchId']!r} "
        f"(next public match starts counting)",
        flush=True,
    )
    return state


def match_after_cutover(mid: str, cutover: str) -> bool:
    if not cutover:
        return False
    return str(mid) > str(cutover)


def per_player_stats(block: dict, aliases: dict) -> dict[str, dict]:
    """nick -> stats for one match block (from process_match)."""
    events = block.get("events") or []
    teams = block.get("teamsByKey") or {}
    net_by_nick = block.get("netByNick") or {}
    map_name = str(block.get("map") or "")
    s1 = int(block.get("score1") or 0)
    s2 = int(block.get("score2") or 0)
    winner = block.get("winnerTeam")
    try:
        winner_i = int(winner) if winner is not None else None
    except (TypeError, ValueError):
        winner_i = None

    nick_team: dict[str, int] = {}
    for nick in net_by_nick:
        k = R.canon_key(str(nick), aliases)
        if k in teams:
            try:
                nick_team[str(nick)] = int(teams[k])
            except (TypeError, ValueError):
                pass

    # seed all combatants
    stats: dict[str, dict] = {}

    def row(nick: str) -> dict:
        if nick not in stats:
            stats[nick] = {
                "kills": 0,
                "noks": 0,
                "revives": 0,
                "deaths": 0,
                "tk": 0,
                "vehicleKills": 0,
                "tankKills": 0,
                "heliKills": 0,
                "dmg": 0,
            }
        return stats[nick]

    for e in events:
        kind = e.get("kind")
        killer = str(e.get("killer") or "")
        victim = str(e.get("victim") or "")
        if kind == "die":
            if e.get("teamkill"):
                if killer:
                    row(killer)["tk"] += 1
                if victim:
                    row(victim)["deaths"] += 1
            else:
                if killer:
                    row(killer)["kills"] += 1
                if victim:
                    row(victim)["deaths"] += 1
        elif kind == "tk":
            if killer:
                row(killer)["tk"] += 1
            if victim:
                row(victim)["deaths"] += 1
        elif kind == "nok":
            if not e.get("teamkill") and killer:
                row(killer)["noks"] += 1
        elif kind == "revive":
            if killer:
                row(killer)["revives"] += 1
        elif kind == "vehicle_kill":
            if killer:
                r = row(killer)
                r["vehicleKills"] += 1
                veh = str(e.get("vehicle") or "")
                tickets = e.get("tickets")
                try:
                    tix = int(tickets) if tickets is not None else None
                except (TypeError, ValueError):
                    tix = None
                label = str(e.get("label") or "")
                if is_tank(veh, tix, label):
                    r["tankKills"] += 1
                if is_heli(veh):
                    r["heliKills"] += 1

    # MVP Killer / Medic (same rules as site pickMvps)
    pool = [
        {
            "nick": n,
            "kills": s["kills"],
            "noks": s["noks"],
            "res": s["revives"],
            "deaths": s["deaths"],
            "dmg": s["dmg"],
            "vehicleKills": s["vehicleKills"],
        }
        for n, s in stats.items()
        if s["kills"] + s["noks"] + s["revives"] + s["deaths"] + s["vehicleKills"] > 0
    ]
    mvp_killer = None
    mvp_medic = None
    if pool:
        top_k = max(p["kills"] for p in pool)
        if top_k > 0:
            tied = [p for p in pool if p["kills"] == top_k]
            tied.sort(
                key=lambda p: (
                    -p["noks"],
                    -(p["kills"] / p["deaths"] if p["deaths"] else p["kills"]),
                    p["nick"].casefold(),
                )
            )
            mvp_killer = tied[0]["nick"]
        top_r = max(p["res"] for p in pool)
        if top_r > 0:
            tied = [p for p in pool if p["res"] == top_r]
            tied.sort(key=lambda p: (-p["dmg"], p["nick"].casefold()))
            mvp_medic = tied[0]["nick"]

    out: dict[str, dict] = {}
    for nick, s in stats.items():
        team = nick_team.get(nick)
        won = None
        ticket_delta = None
        if winner_i in (1, 2) and team in (1, 2):
            won = team == winner_i
            if won:
                ticket_delta = (s1 - s2) if team == 1 else (s2 - s1)
            else:
                ticket_delta = (s2 - s1) if team == 1 else (s1 - s2)
        out[nick] = {
            **s,
            "won": won,
            "ticketDelta": ticket_delta,
            "map": map_name,
            "mvpKiller": bool(mvp_killer and mvp_killer.casefold() == nick.casefold()),
            "mvpMedic": bool(mvp_medic and mvp_medic.casefold() == nick.casefold()),
        }
    # Also include anyone in netByNick with zeros (played but no events?)
    for nick in net_by_nick:
        if nick not in out:
            team = nick_team.get(nick)
            won = None
            ticket_delta = None
            if winner_i in (1, 2) and team in (1, 2):
                won = team == winner_i
                if won:
                    ticket_delta = (s1 - s2) if team == 1 else (s2 - s1)
            out[nick] = {
                "kills": 0,
                "noks": 0,
                "revives": 0,
                "deaths": 0,
                "tk": 0,
                "vehicleKills": 0,
                "tankKills": 0,
                "heliKills": 0,
                "dmg": 0,
                "won": won,
                "ticketDelta": ticket_delta,
                "map": map_name,
                "mvpKiller": False,
                "mvpMedic": False,
            }
    return out


def advance_level(p: dict) -> None:
    lvl = int(p["currentLevel"])
    if lvl >= 20:
        p["finished"] = True
        p["current"] = LEVEL_TARGETS[20]
        p["target"] = LEVEL_TARGETS[20]
        return
    nxt = lvl + 1
    p["currentLevel"] = nxt
    p["current"] = 0
    p["target"] = LEVEL_TARGETS[nxt]
    p["streak"] = 0
    p["window"] = []
    if nxt > 20:
        p["currentLevel"] = 20
        p["finished"] = True


def apply_level(p: dict, st: dict) -> bool:
    """Apply one match to current level. Returns True if level completed."""
    lvl = int(p["currentLevel"])
    if p.get("finished") or lvl < 1 or lvl > 20:
        return False

    kills = int(st.get("kills") or 0)
    noks = int(st.get("noks") or 0)
    revs = int(st.get("revives") or 0)
    deaths = int(st.get("deaths") or 0)
    tk = int(st.get("tk") or 0)
    veh = int(st.get("vehicleKills") or 0)
    tanks = int(st.get("tankKills") or 0)
    helis = int(st.get("heliKills") or 0)
    won = st.get("won")
    ticket_delta = st.get("ticketDelta")
    map_name = str(st.get("map") or "")
    mutaha = "mutaha" in map_name.lower()

    done = False

    if lvl == 1:
        p["current"] = 1
        done = True
    elif lvl == 2:
        p["current"] = min(15, noks)
        done = noks >= 15
    elif lvl == 3:
        p["current"] = min(15, kills)
        done = kills >= 15
    elif lvl == 4:
        p["current"] = min(15, revs)
        done = revs >= 15
    elif lvl == 5:
        p["current"] = min(5, veh)
        done = veh >= 5
    elif lvl == 6:
        p["current"] = min(3, int(p["current"]) + 1)
        done = p["current"] >= 3
    elif lvl == 7:
        if mutaha:
            p["current"] = min(15, kills)
            done = kills >= 15
        # иначе катка не Mutaha — прогресс не трогаем

    elif lvl == 8:
        if revs >= 10:
            p["streak"] = int(p.get("streak") or 0) + 1
        else:
            p["streak"] = 0
        p["current"] = int(p["streak"])
        done = p["streak"] >= 3
    elif lvl == 9:
        p["current"] = min(5, int(p["current"]) + tanks)
        done = p["current"] >= 5
    elif lvl == 10:
        if st.get("mvpKiller"):
            p["current"] = min(3, int(p["current"]) + 1)
        done = p["current"] >= 3
    elif lvl == 11:
        p["current"] = min(10, int(p["current"]) + 1)
        done = p["current"] >= 10
    elif lvl == 12:
        window = list(p.get("window") or [])
        window.append(kills)
        if len(window) > 5:
            window = window[-5:]
        p["window"] = window
        total = sum(window)
        p["current"] = min(100, total)
        if len(window) >= 5:
            if total >= 100:
                done = True
            else:
                p["window"] = []
                p["current"] = 0
        else:
            done = total >= 100
    elif lvl == 13:
        p["current"] = min(5, int(p["current"]) + helis)
        done = p["current"] >= 5
    elif lvl == 14:
        if won is True:
            p["streak"] = int(p.get("streak") or 0) + 1
        elif won is False:
            p["streak"] = 0
        # won is None → don't break streak harshly? treat as no progress
        p["current"] = int(p.get("streak") or 0)
        done = p["current"] >= 5
    elif lvl == 15:
        if st.get("mvpMedic"):
            p["current"] = min(3, int(p["current"]) + 1)
        done = p["current"] >= 3
    elif lvl == 16:
        p["current"] = min(15, int(p["current"]) + 1)
        done = p["current"] >= 15
    elif lvl == 17:
        ok = kills >= 10 and deaths <= 1
        p["current"] = 1 if ok else 0
        done = ok
    elif lvl == 18:
        ok = revs >= 10 and kills >= 10 and veh >= 1
        p["current"] = 1 if ok else 0
        done = ok
    elif lvl == 19:
        ok = won is True and ticket_delta is not None and int(ticket_delta) > 300
        p["current"] = 1 if ok else 0
        done = ok
    elif lvl == 20:
        ok = kills > 30 and revs >= 10 and tk == 0 and deaths == 0
        p["current"] = 1 if ok else 0
        done = ok

    p["target"] = LEVEL_TARGETS[lvl]
    p["updatedAt"] = _utc_now()
    return done


def apply_match_to_players(
    state: dict,
    block: dict,
    registered: dict[str, dict],
    aliases: dict,
) -> int:
    mid = str(block.get("id") or "")
    scored = set(state.get("scoredMatchIds") or [])
    if mid in scored:
        return 0
    cut = str(state.get("cutoverAfterMatchId") or "")
    if not match_after_cutover(mid, cut):
        return 0

    per = per_player_stats(block, aliases)
    # index by casefold
    per_cf = {n.casefold(): (n, st) for n, st in per.items()}

    advanced = 0
    players = state.setdefault("players", {})
    for nk, reg in registered.items():
        if nk not in per_cf:
            continue
        _disp_nick, st = per_cf[nk]
        key = reg.get("steamId") or reg["nick"]
        p = players.get(key) or players.get(nk)
        if not p:
            p = empty_player(reg)
        else:
            # refresh identity
            p["nick"] = reg["nick"]
            p["steamId"] = reg.get("steamId")
            p["avatarUrl"] = reg.get("avatarUrl")
            p["name"] = reg.get("name") or ""
        if p.get("finished"):
            players[key] = p
            continue
        if apply_level(p, st):
            advance_level(p)
            advanced += 1
        players[key] = p

    scored.add(mid)
    state["scoredMatchIds"] = sorted(scored)
    return advanced


def leaderboard_rows(state: dict) -> list[dict]:
    rows = []
    for p in (state.get("players") or {}).values():
        if not isinstance(p, dict):
            continue
        lvl = int(p.get("currentLevel") or 1)
        cur = int(p.get("current") or 0)
        tgt = int(p.get("target") or LEVEL_TARGETS.get(lvl, 1))
        finished = bool(p.get("finished"))
        # sort key: finished first as 21, else level + fraction
        score = 21 if finished else lvl + (cur / max(1, tgt)) * 0.99
        rows.append(
            {
                "nick": p.get("nick"),
                "steamId": p.get("steamId"),
                "avatarUrl": p.get("avatarUrl"),
                "currentLevel": 20 if finished else lvl,
                "current": cur if not finished else tgt,
                "target": tgt,
                "finished": finished,
                "_sort": score,
            }
        )
    rows.sort(key=lambda r: (-r["_sort"], str(r["nick"] or "").casefold()))
    for r in rows:
        r.pop("_sort", None)
    return rows[:20]


def finalize(state: dict) -> dict:
    state["leaderboard"] = leaderboard_rows(state)
    state["enabled"] = True
    state["seasonId"] = SEASON_ID
    return state


def apply_blocks(blocks: list[dict], aliases: dict | None = None) -> dict:
    aliases = aliases if aliases is not None else load_alias_keys()
    ledger = {}
    if LEDGER.is_file():
        try:
            ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
        except Exception:
            ledger = {}
    state = ensure_cutover(load_state(), ledger)
    registered = load_registered()
    total_adv = 0
    for b in blocks:
        if not isinstance(b, dict):
            continue
        total_adv += apply_match_to_players(state, b, registered, aliases)
    state = finalize(state)
    save_state(state)
    print(
        f"BP: blocks={len(blocks)} advanced_levels={total_adv} "
        f"players={len(state.get('players') or {})}",
        flush=True,
    )
    return state


def sync_cutover_only() -> dict:
    ledger = {}
    if LEDGER.is_file():
        ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    state = ensure_cutover(load_state(), ledger)
    state = finalize(state)
    save_state(state)
    return state


def main() -> None:
    # Load DATABASE_URL from platform .env if needed
    if not (os.environ.get("DATABASE_URL") or "").strip():
        env_path = ROOT / ".env"
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("DATABASE_URL=") and "DATABASE_URL" not in os.environ:
                    os.environ["DATABASE_URL"] = (
                        line.split("=", 1)[1].strip().strip("'").strip('"')
                    )

    if "--from-blocks" in sys.argv:
        i = sys.argv.index("--from-blocks")
        path = Path(sys.argv[i + 1])
        blocks = json.loads(path.read_text(encoding="utf-8"))
        apply_blocks(blocks if isinstance(blocks, list) else [])
        return

    sync_cutover_only()
    print("BP: cutover ensured (no new blocks)", flush=True)


if __name__ == "__main__":
    main()
