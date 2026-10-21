#!/usr/bin/env python3
"""
Battle Pass «Фруктовый Сад» — прогресс по матчам паблика (TPUB1/PB1).

Считает только матчи ПОСЛЕ cutoverAfterMatchId (со следующей карты после включения).
Участники: User с profileComplete=true.
«Сыграть матч» (ур. 1/6/11/16): ≥80% длительности в игре (Login/Remove + deploy fallback).
Победа/поражение (ур. 14/19): смена стороны после 5-й минуты → матч не в зачёт.
SEED / Jensen — не игра, в Battle Pass не идут (прогресс не пишем).

Запуск:
  python build_battle_pass.py              # sync from ledger + ensure cutover
  python build_battle_pass.py --from-blocks /tmp/bp_blocks.json
  python build_battle_pass.py --rebuild-from-ledger  # полный пересчёт после cutover
  python build_battle_pass.py --audit --last 5
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
    2: 5,
    3: 5,
    4: 5,
    5: 2,
    6: 3,
    7: 5,
    8: 2,
    9: 1,
    10: 1,
    11: 5,
    12: 30,
    13: 1,
    14: 3,
    15: 1,
    16: 5,
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
    """nick_key (spaces stripped) -> {nick, steamId, avatarUrl, name}.

    Must use nick_key, not str.casefold(): ledger often has «One Attack»
    while the site account is «OneAttack» — both → oneattack.
    """
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
            nk = R.nick_key(n)
            if not nk:
                continue
            out[nk] = {
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


BP_L5_PROFILE_BG = "bp-l5-gold"
BP_L10_NICK_STYLE = "bp-l10-aurum-clean"
BP_L15_PATCH = "bp-l15-keech"
BP_L15_CUSTOMIZE = "pb1-profile-customize"


def persist_l5_backgrounds(state: dict) -> None:
    """Золотой фон ур. 5 — в инвентарь навсегда. Повторный запуск ничего не снимает."""
    nicks: list[str] = []
    steams: list[str] = []
    for p in (state.get("players") or {}).values():
        if not isinstance(p, dict):
            continue
        lvl = 20 if p.get("finished") else int(p.get("currentLevel") or 1)
        if lvl < 5:
            continue
        nick = str(p.get("nick") or "").strip()
        steam = str(p.get("steamId") or "").strip()
        if nick:
            nicks.append(nick.casefold())
        if steam:
            steams.append(steam)
    if not nicks and not steams:
        print("BP bg: nobody at level 5+", flush=True)
        return
    db = (os.environ.get("DATABASE_URL") or "").strip().strip("'").strip('"')
    if not db:
        env_path = ROOT / ".env"
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("DATABASE_URL="):
                    db = line.split("=", 1)[1].strip().strip("'").strip('"')
                    break
    if not db:
        print("BP bg: no DATABASE_URL — skip inventory", flush=True)
        return
    connect = None
    try:
        import psycopg2

        connect = psycopg2.connect
    except ImportError:
        try:
            import psycopg

            connect = psycopg.connect
        except ImportError:
            print("BP bg: no psycopg — skip inventory", flush=True)
            return
    try:
        conn = connect(_psycopg_dsn(db))
        cur = conn.cursor()
        cur.execute(
            """
            update "User"
            set "unlockedProfileBgs" = array_append(
              coalesce("unlockedProfileBgs", '{}'),
              %s
            )
            where not (%s = any(coalesce("unlockedProfileBgs", '{}')))
              and (
                lower(nick) = any(%s)
                or "steamId" = any(%s)
              )
            """,
            (BP_L5_PROFILE_BG, BP_L5_PROFILE_BG, nicks or [""], steams or [""]),
        )
        print(f"BP bg: granted {BP_L5_PROFILE_BG} to {cur.rowcount} accounts", flush=True)
        conn.commit()
        cur.close()
        conn.close()
    except Exception as exc:
        print(f"BP bg: inventory skip ({exc})", flush=True)
    persist_l10_nick_styles(state)
    persist_l15_patches(state)


def persist_l10_nick_styles(state: dict) -> None:
    """L10 Aurum Clean — стиль ника в инвентарь навсегда."""
    nicks: list[str] = []
    steams: list[str] = []
    for p in (state.get("players") or {}).values():
        if not isinstance(p, dict):
            continue
        lvl = 20 if p.get("finished") else int(p.get("currentLevel") or 1)
        if lvl < 10:
            continue
        nick = str(p.get("nick") or "").strip()
        steam = str(p.get("steamId") or "").strip()
        if nick:
            nicks.append(nick.casefold())
        if steam:
            steams.append(steam)
    if not nicks and not steams:
        print("BP nick style: nobody at level 10+", flush=True)
        return
    db = (os.environ.get("DATABASE_URL") or "").strip().strip("'").strip('"')
    if not db:
        env_path = ROOT / ".env"
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("DATABASE_URL="):
                    db = line.split("=", 1)[1].strip().strip("'").strip('"')
                    break
    if not db:
        print("BP nick style: no DATABASE_URL — skip", flush=True)
        return
    connect = None
    try:
        import psycopg2

        connect = psycopg2.connect
    except ImportError:
        try:
            import psycopg

            connect = psycopg.connect
        except ImportError:
            print("BP nick style: no psycopg — skip", flush=True)
            return
    try:
        conn = connect(_psycopg_dsn(db))
        cur = conn.cursor()
        cur.execute(
            """
            update "User"
            set "unlockedNickStyles" = array_append(
              coalesce("unlockedNickStyles", '{}'),
              %s
            )
            where not (%s = any(coalesce("unlockedNickStyles", '{}')))
              and (
                lower(nick) = any(%s)
                or "steamId" = any(%s)
              )
            """,
            (
                BP_L10_NICK_STYLE,
                BP_L10_NICK_STYLE,
                nicks or [""],
                steams or [""],
            ),
        )
        print(
            f"BP nick style: granted {BP_L10_NICK_STYLE} "
            f"to {cur.rowcount} accounts",
            flush=True,
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as exc:
        print(f"BP nick style: inventory skip ({exc})", flush=True)


def persist_l15_patches(state: dict) -> None:
    """L15 кастомизация — нашивка в инвентарь навсегда."""
    nicks: list[str] = []
    steams: list[str] = []
    for p in (state.get("players") or {}).values():
        if not isinstance(p, dict):
            continue
        lvl = 20 if p.get("finished") else int(p.get("currentLevel") or 1)
        if lvl < 15:
            continue
        nick = str(p.get("nick") or "").strip()
        steam = str(p.get("steamId") or "").strip()
        if nick:
            nicks.append(nick.casefold())
        if steam:
            steams.append(steam)
    if not nicks and not steams:
        print("BP patch: nobody at level 15+", flush=True)
        return
    db = (os.environ.get("DATABASE_URL") or "").strip().strip("'").strip('"')
    if not db:
        env_path = ROOT / ".env"
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("DATABASE_URL="):
                    db = line.split("=", 1)[1].strip().strip("'").strip('"')
                    break
    if not db:
        print("BP patch: no DATABASE_URL — skip", flush=True)
        return
    connect = None
    try:
        import psycopg2

        connect = psycopg2.connect
    except ImportError:
        try:
            import psycopg

            connect = psycopg.connect
        except ImportError:
            print("BP patch: no psycopg — skip", flush=True)
            return
    try:
        conn = connect(_psycopg_dsn(db))
        cur = conn.cursor()
        for token in (BP_L15_PATCH, BP_L15_CUSTOMIZE):
            cur.execute(
                """
                update "User"
                set "unlockedNickPatches" = array_append(
                  coalesce("unlockedNickPatches", '{}'),
                  %s
                )
                where not (%s = any(coalesce("unlockedNickPatches", '{}')))
                  and (
                    lower(nick) = any(%s)
                    or "steamId" = any(%s)
                  )
                """,
                (token, token, nicks or [""], steams or [""]),
            )
            print(f"BP patch: granted {token} to {cur.rowcount} accounts", flush=True)
        conn.commit()
        cur.close()
        conn.close()
    except Exception as exc:
        print(f"BP patch: inventory skip ({exc})", flush=True)


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


def is_seed_block(block: dict) -> bool:
    """SEED / Jensen — подготовка, не матч."""
    blob = " ".join(
        str(block.get(k) or "")
        for k in ("map", "level", "layer", "id")
    )
    return bool(R.is_seed_layer(blob, ""))


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
    presence_by_key = block.get("presenceByKey") or {}
    # Old blocks without presence metadata: don't invent attendance.
    has_presence_meta = isinstance(block.get("presenceByKey"), dict)
    late_switch_keys = {
        str(k) for k in (block.get("teamSwitchLateKeys") or []) if k
    }
    try:
        winner_i = int(winner) if winner is not None else None
    except (TypeError, ValueError):
        winner_i = None

    nick_team: dict[str, int] = {}
    nick_key_of: dict[str, str] = {}
    for nick in net_by_nick:
        k = R.canon_key(str(nick), aliases)
        nick_key_of[str(nick)] = k
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

    def enrich(nick: str, s: dict) -> dict:
        kk = nick_key_of.get(nick) or R.canon_key(nick, aliases)
        nick_key_of[nick] = kk
        team = nick_team.get(nick)
        if team is None and kk in teams:
            try:
                team = int(teams[kk])
            except (TypeError, ValueError):
                team = None
        presence = float(presence_by_key.get(kk) or 0.0)
        if has_presence_meta:
            played_ok = presence >= float(getattr(R, "PRESENCE_MIN_RATIO", 0.80))
        else:
            # Legacy blocks (до правила 80%) — считаем как полное присутствие.
            played_ok = True
            presence = 1.0
        team_switch_late = kk in late_switch_keys
        won = None
        ticket_delta = None
        if (
            winner_i in (1, 2)
            and team in (1, 2)
            and played_ok
            and not team_switch_late
        ):
            won = team == winner_i
            if won:
                ticket_delta = (s1 - s2) if team == 1 else (s2 - s1)
            else:
                ticket_delta = (s2 - s1) if team == 1 else (s1 - s2)
        return {
            **s,
            "won": won,
            "ticketDelta": ticket_delta,
            "map": map_name,
            "mvpKiller": bool(mvp_killer and mvp_killer.casefold() == nick.casefold()),
            "mvpMedic": bool(mvp_medic and mvp_medic.casefold() == nick.casefold()),
            "playedOk": played_ok,
            "presenceRatio": round(presence, 4),
            "teamSwitchLate": team_switch_late,
        }

    out: dict[str, dict] = {}
    for nick, s in stats.items():
        out[nick] = enrich(nick, s)
    # Also include anyone in netByNick with zeros (played but no events?)
    for nick in net_by_nick:
        if nick not in out:
            out[nick] = enrich(
                nick,
                {
                    "kills": 0,
                    "noks": 0,
                    "revives": 0,
                    "deaths": 0,
                    "tk": 0,
                    "vehicleKills": 0,
                    "tankKills": 0,
                    "heliKills": 0,
                    "dmg": 0,
                },
            )
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
    played_ok = bool(st.get("playedOk", True))

    done = False

    if lvl == 1:
        # Сыграть матч: только при ≥80% времени в игре
        if played_ok:
            p["current"] = 1
            done = True
    elif lvl == 2:
        # Best single-match progress (don't let a later weak game wipe a strong one)
        tgt = LEVEL_TARGETS[2]
        p["current"] = max(int(p.get("current") or 0), min(tgt, noks))
        done = p["current"] >= tgt
    elif lvl == 3:
        tgt = LEVEL_TARGETS[3]
        p["current"] = max(int(p.get("current") or 0), min(tgt, kills))
        done = p["current"] >= tgt
    elif lvl == 4:
        tgt = LEVEL_TARGETS[4]
        p["current"] = max(int(p.get("current") or 0), min(tgt, revs))
        done = p["current"] >= tgt
    elif lvl == 5:
        tgt = LEVEL_TARGETS[5]
        p["current"] = max(int(p.get("current") or 0), min(tgt, veh))
        done = p["current"] >= tgt
    elif lvl == 6:
        if played_ok:
            p["current"] = min(3, int(p["current"]) + 1)
            done = p["current"] >= 3
    elif lvl == 7:
        if mutaha:
            tgt = LEVEL_TARGETS[7]
            p["current"] = max(int(p.get("current") or 0), min(tgt, kills))
            done = p["current"] >= tgt
        # иначе катка не Mutaha — прогресс не трогаем

    elif lvl == 8:
        tgt = LEVEL_TARGETS[8]
        if revs >= 10:
            p["streak"] = int(p.get("streak") or 0) + 1
        else:
            p["streak"] = 0
        p["current"] = int(p["streak"])
        done = p["streak"] >= tgt
    elif lvl == 9:
        tgt = LEVEL_TARGETS[9]
        p["current"] = min(tgt, int(p["current"]) + tanks)
        done = p["current"] >= tgt
    elif lvl == 10:
        tgt = LEVEL_TARGETS[10]
        if st.get("mvpKiller"):
            p["current"] = min(tgt, int(p["current"]) + 1)
        done = p["current"] >= tgt
    elif lvl == 11:
        tgt = LEVEL_TARGETS[11]
        if played_ok:
            p["current"] = min(tgt, int(p["current"]) + 1)
            done = p["current"] >= tgt
    elif lvl == 12:
        tgt = LEVEL_TARGETS[12]
        window = list(p.get("window") or [])
        window.append(kills)
        if len(window) > 5:
            window = window[-5:]
        p["window"] = window
        total = sum(window)
        p["current"] = min(tgt, total)
        if len(window) >= 5:
            if total >= tgt:
                done = True
            else:
                p["window"] = []
                p["current"] = 0
        else:
            done = total >= tgt
    elif lvl == 13:
        tgt = LEVEL_TARGETS[13]
        p["current"] = min(tgt, int(p["current"]) + helis)
        done = p["current"] >= tgt
    elif lvl == 14:
        # won is None: <80% / смена команды после 5 мин → матч не в зачёт
        tgt = LEVEL_TARGETS[14]
        if won is True:
            p["streak"] = int(p.get("streak") or 0) + 1
        elif won is False:
            p["streak"] = 0
        p["current"] = int(p.get("streak") or 0)
        done = p["current"] >= tgt
    elif lvl == 15:
        tgt = LEVEL_TARGETS[15]
        if st.get("mvpMedic"):
            p["current"] = min(tgt, int(p["current"]) + 1)
        done = p["current"] >= tgt
    elif lvl == 16:
        tgt = LEVEL_TARGETS[16]
        if played_ok:
            p["current"] = min(tgt, int(p["current"]) + 1)
            done = p["current"] >= tgt
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
        ok = kills > 20 and revs >= 10 and tk == 0 and deaths == 0
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
    if is_seed_block(block):
        print(f"BP: skip SEED {mid}", flush=True)
        return 0

    per = per_player_stats(block, aliases)
    # Index by nick_key / canon_key — NOT str.casefold().
    # «One Attack» (logs) and «OneAttack» (site) must hit the same bucket.
    per_by_key: dict[str, dict] = {}
    for n, st in per.items():
        ck = R.canon_key(str(n), aliases)
        if not ck:
            continue
        prev = per_by_key.get(ck)
        if prev is None:
            per_by_key[ck] = st
            continue
        # Keep the richer combat row if duplicates collapse.
        prev_score = sum(
            int(prev.get(k) or 0)
            for k in ("kills", "noks", "revives", "deaths", "vehicleKills")
        )
        cur_score = sum(
            int(st.get(k) or 0)
            for k in ("kills", "noks", "revives", "deaths", "vehicleKills")
        )
        if cur_score > prev_score or (
            cur_score == prev_score
            and float(st.get("presenceRatio") or 0) > float(prev.get("presenceRatio") or 0)
        ):
            per_by_key[ck] = st

    advanced = 0
    players = state.setdefault("players", {})
    for nk, reg in registered.items():
        st = per_by_key.get(nk) or per_by_key.get(
            R.canon_key(str(reg.get("nick") or ""), aliases)
        )
        if not st:
            continue
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
        # Canon: 1 match → at most 1 level (no cascade).
        if apply_level(p, st):
            advance_level(p)
            advanced += 1
        players[key] = p

    scored.add(mid)
    state["scoredMatchIds"] = sorted(scored)
    return advanced


def ensure_all_registered(state: dict, registered: dict[str, dict]) -> None:
    """Все зареганные на сайте есть в players (даже без прогресса)."""
    players = state.setdefault("players", {})
    by_steam = {
        str(p.get("steamId") or ""): key
        for key, p in players.items()
        if isinstance(p, dict) and p.get("steamId")
    }
    by_nick = {
        R.nick_key(str(p.get("nick") or "")): key
        for key, p in players.items()
        if isinstance(p, dict) and p.get("nick") and R.nick_key(str(p.get("nick") or ""))
    }
    for _nk, reg in registered.items():
        steam = str(reg.get("steamId") or "")
        nick = str(reg.get("nick") or "")
        key = by_steam.get(steam) or by_nick.get(R.nick_key(nick))
        if key and key in players:
            p = players[key]
            p["nick"] = nick or p.get("nick")
            p["steamId"] = steam or p.get("steamId")
            p["avatarUrl"] = reg.get("avatarUrl") or p.get("avatarUrl")
            p["name"] = reg.get("name") or p.get("name") or ""
            continue
        new_key = steam or nick
        if not new_key:
            continue
        players[new_key] = empty_player(reg)


def reconcile_level_targets(state: dict) -> int:
    """Sync targets from LEVEL_TARGETS; advance if current already meets new threshold."""
    advanced = 0
    for p in (state.get("players") or {}).values():
        if not isinstance(p, dict) or not p.get("nick"):
            continue
        if p.get("finished"):
            p["currentLevel"] = 20
            p["target"] = LEVEL_TARGETS[20]
            p["current"] = LEVEL_TARGETS[20]
            continue
        guard = 0
        while guard < 25:
            guard += 1
            lvl = int(p.get("currentLevel") or 1)
            if lvl < 1 or lvl > 20:
                break
            tgt = int(LEVEL_TARGETS.get(lvl, 1))
            p["target"] = tgt
            cur = int(p.get("current") or 0)
            if cur >= tgt and lvl < 20:
                advance_level(p)
                advanced += 1
                continue
            if cur > tgt:
                p["current"] = tgt
            break
    return advanced


def leaderboard_rows(state: dict) -> list[dict]:
    rows = []
    for p in (state.get("players") or {}).values():
        if not isinstance(p, dict):
            continue
        if not p.get("nick"):
            continue
        lvl = int(p.get("currentLevel") or 1)
        finished = bool(p.get("finished"))
        tgt = int(LEVEL_TARGETS.get(20 if finished else lvl, 1))
        cur = int(p.get("current") or 0)
        if not finished:
            cur = min(cur, tgt)
        # sort key: finished first as 21, else level + fraction
        score = 21 if finished else lvl + (cur / max(1, tgt)) * 0.99
        rows.append(
            {
                "nick": p.get("nick"),
                "steamId": p.get("steamId"),
                "avatarUrl": p.get("avatarUrl"),
                "currentLevel": 20 if finished else lvl,
                "current": tgt if finished else cur,
                "target": tgt,
                "finished": finished,
                "_sort": score,
            }
        )
    rows.sort(key=lambda r: (-r["_sort"], str(r["nick"] or "").casefold()))
    for r in rows:
        r.pop("_sort", None)
    return rows[:10]


def finalize(state: dict, registered: dict[str, dict] | None = None) -> dict:
    if registered is not None:
        ensure_all_registered(state, registered)
    n = reconcile_level_targets(state)
    if n:
        print(f"BP: reconciled targets, advanced={n}", flush=True)
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
    state = finalize(state, registered)
    save_state(state)
    persist_l5_backgrounds(state)
    print(
        f"BP: blocks={len(blocks)} advanced_levels={total_adv} "
        f"players={len(state.get('players') or {})} "
        f"leaderboard={len(state.get('leaderboard') or [])}",
        flush=True,
    )
    return state


def sync_cutover_only() -> dict:
    ledger = {}
    if LEDGER.is_file():
        ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    state = ensure_cutover(load_state(), ledger)
    registered = load_registered()
    state = finalize(state, registered)
    save_state(state)
    persist_l5_backgrounds(state)
    return state


def rebuild_from_ledger() -> dict:
    """Full BP replay from public rp-ledger after cutover.

    Use after nick-key matching fixes so already-scored matches are re-applied
    without double-counting (progress is reset first).
    """
    ledger: dict = {}
    if LEDGER.is_file():
        try:
            ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
        except Exception:
            ledger = {}
    state = ensure_cutover(load_state(), ledger)
    cut = str(state.get("cutoverAfterMatchId") or "")
    registered = load_registered()
    aliases = load_alias_keys()

    players: dict[str, dict] = {}
    for _nk, reg in registered.items():
        key = reg.get("steamId") or reg["nick"]
        players[str(key)] = empty_player(reg)
    state["players"] = players
    state["scoredMatchIds"] = []

    blocks = [
        m
        for m in (ledger.get("matches") or [])
        if isinstance(m, dict)
        and match_after_cutover(str(m.get("id") or ""), cut)
    ]
    blocks.sort(key=lambda m: str(m.get("id") or ""))
    total_adv = 0
    for b in blocks:
        total_adv += apply_match_to_players(state, b, registered, aliases)
    state = finalize(state, registered)
    save_state(state)
    persist_l5_backgrounds(state)
    print(
        f"BP: rebuild_from_ledger matches={len(blocks)} advanced_levels={total_adv} "
        f"players={len(state.get('players') or {})} "
        f"scored={len(state.get('scoredMatchIds') or [])}",
        flush=True,
    )
    return state


def audit_bp_vs_ledger(*, last: int = 5) -> dict:
    """Check recent public ledger matches are in BP scoredMatchIds."""
    ledger: dict = {}
    if LEDGER.is_file():
        try:
            ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
        except Exception:
            ledger = {}
    state = load_state()
    cut = str(state.get("cutoverAfterMatchId") or "")
    scored = {str(x) for x in (state.get("scoredMatchIds") or [])}
    pool = [
        m
        for m in (ledger.get("matches") or [])
        if isinstance(m, dict)
        and str(m.get("id") or "")
        and match_after_cutover(str(m.get("id")), cut)
        and (m.get("events") or m.get("netByNick"))
    ]
    pool.sort(key=lambda m: str(m.get("id") or ""))
    recent = pool[-max(1, int(last)) :] if pool else []
    missing = [str(m.get("id")) for m in recent if str(m.get("id")) not in scored]
    # Nick-join smoke: last match must credit ≥1 registered player when presence≥80%.
    join_ok = True
    join_detail = "n/a"
    if recent:
        aliases = load_alias_keys()
        registered = load_registered()
        last_m = recent[-1]
        per = per_player_stats(last_m, aliases)
        present_reg = 0
        for n, st in per.items():
            ck = R.canon_key(str(n), aliases)
            if ck in registered and bool(st.get("playedOk", True)):
                present_reg += 1
        # Recount with the same index the scorer uses
        credited = 0
        per_by_key: dict[str, dict] = {}
        for n, st in per.items():
            ck = R.canon_key(str(n), aliases)
            if ck:
                per_by_key[ck] = st
        for nk, _reg in registered.items():
            st = per_by_key.get(nk)
            if st and bool(st.get("playedOk", True)):
                credited += 1
        join_detail = (
            f"match={last_m.get('id')} present_reg={present_reg} credited={credited}"
        )
        if present_reg > 0 and credited == 0:
            join_ok = False
    ok = not missing and join_ok
    return {
        "ok": ok,
        "cutoverAfterMatchId": cut,
        "checked": [str(m.get("id")) for m in recent],
        "missingIds": missing,
        "joinOk": join_ok,
        "joinDetail": join_detail,
        "scoredCount": len(scored),
        "enabled": bool(state.get("enabled")),
    }


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

    if "--grant-bgs-only" in sys.argv:
        persist_l5_backgrounds(load_state())
        return

    if "--rebuild-from-ledger" in sys.argv:
        rebuild_from_ledger()
        return

    if "--audit" in sys.argv:
        last = 5
        if "--last" in sys.argv:
            i = sys.argv.index("--last")
            last = int(sys.argv[i + 1])
        rep = audit_bp_vs_ledger(last=last)
        print(json.dumps(rep, ensure_ascii=False, indent=2), flush=True)
        raise SystemExit(0 if rep.get("ok") else 2)

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
