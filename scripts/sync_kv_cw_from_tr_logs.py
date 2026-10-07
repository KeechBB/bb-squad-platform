#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto-digitize CW matches hosted on TR1/TR2 → KV players (BB + opp) + opponent clan card.

Canon: .cursor/rules/kv-tr-both-teams-auto.mdc
- calendar server is BB / TR1 / TR2 / Blackberry Training…
- match closed layer by time + map, duration ≥ 10 min
- both teams; RP not applied
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import rp_log_parse as R  # noqa: E402
from sync_train_from_tr1_logs import (  # noqa: E402
    _resolve_kv_public,
    agg_players,
    bump_cache_bust,
    load_aliases,
    _load_collector_env,
    layer_mode,
    _map_stem,
)

KV_PUBLIC = _resolve_kv_public()
CW_PLAYERS = KV_PUBLIC / "data" / "players"
AUTO_CW = KV_PUBLIC / "data" / "_auto_cw_matches.json"
LOOKBACK_DAYS = int(os.environ.get("CW_TR_LOOKBACK_DAYS", "5"))
MIN_LAYER_SEC = 10 * 60
TIME_SLACK_MIN = int(os.environ.get("CW_TR_TIME_SLACK_MIN", "45"))

OUR_SERVER_RE = re.compile(
    r"\bTR\s*[12]\b|Blackberry\s*\|?\s*Training|Blackberry\s+Training|"
    r"Blackberries\s*#|\bBB\b",
    re.I,
)


def _server_is_ours(server: str, note: str = "") -> bool:
    blob = f"{server} {note}"
    if OUR_SERVER_RE.search(blob):
        return True
    s = (server or "").strip().upper()
    return s in {"BB", "TR1", "TR2", "BB TRAINING", "BLACKBERRY"}


def sync_tr_logs(server_key: str) -> list[Path]:
    """Download SquadGame.log + backups for TR1 or TR2 into per-server cache."""
    env = _load_collector_env()
    cache = Path(
        os.environ.get(
            f"{server_key}_LOG_CACHE",
            str(HERE / f"_tmp_{server_key.lower()}_logs_cache"),
        )
    )
    cache.mkdir(parents=True, exist_ok=True)
    try:
        import paramiko
    except ImportError as e:
        local = sorted(cache.glob("*.log"))
        if local:
            print(f"paramiko missing — using local {server_key} cache", flush=True)
            return local
        print(f"paramiko missing and no {server_key} cache: {e}", flush=True)
        return []

    host = env.get("SQUAD_SSH_HOST")
    user = env.get("SQUAD_SSH_USER")
    password = env.get("SQUAD_SSH_PASSWORD")
    if not host or not user or not password:
        print(f"SSH env missing — local {server_key} cache only", flush=True)
        return sorted(cache.glob("*.log"))

    port = int(env.get("SQUAD_SSH_PORT") or "2022")
    root = (env.get("SQUAD_LOG_ROOT") or "/home/squad/servers").rstrip("/")
    remote_dir = f"{root}/{server_key}/SquadGame/Saved/Logs"

    last_err: Exception | None = None
    for attempt in range(4):
        transport = None
        try:
            transport = paramiko.Transport((host, port))
            transport.banner_timeout = 120
            transport.connect(username=user, password=password)
            sftp = paramiko.SFTPClient.from_transport(transport)
            assert sftp is not None
            names = sftp.listdir(remote_dir)
            backups = sorted(
                [n for n in names if n.startswith("SquadGame.log") and n != "SquadGame.log"],
                reverse=True,
            )[:8]
            want = ["SquadGame.log"] + backups
            for name in want:
                if name not in names:
                    continue
                remote = f"{remote_dir}/{name}"
                local = cache / (name if name != "SquadGame.log" else f"{server_key}-SquadGame.log")
                try:
                    st = sftp.stat(remote)
                    if local.is_file() and local.stat().st_size == st.st_size:
                        continue
                    sftp.get(remote, str(local))
                    print(f"{server_key} sftp ← {name} ({st.st_size})", flush=True)
                except Exception as e:
                    print(f"{server_key} skip {name}: {e}", flush=True)
            sftp.close()
            transport.close()
            return sorted(cache.glob("*.log"))
        except Exception as e:
            last_err = e
            print(f"{server_key} ssh fail {attempt+1}: {type(e).__name__}: {e}", flush=True)
            try:
                if transport:
                    transport.close()
            except Exception:
                pass
            import time

            time.sleep(2 + attempt)
    print(f"{server_key} ssh gave up: {last_err}", flush=True)
    return sorted(cache.glob("*.log"))


def load_bb_nick_keys(aliases: dict[str, str]) -> set[str]:
    """Known BB roster keys from tiers + aliases."""
    keys: set[str] = set()
    tiers_path = KV_PUBLIC / "data" / "tiers.json"
    if not tiers_path.is_file():
        tiers_path = HERE.parents[1] / "KV" / "public" / "data" / "tiers.json"
    if tiers_path.is_file():
        t = json.loads(tiers_path.read_text(encoding="utf-8"))
        for p in t.get("players") or []:
            n = str(p.get("nick") or "").strip()
            if n:
                keys.add(R.canon_key(n, aliases))
        for a, c in (t.get("aliases") or {}).items():
            keys.add(R.canon_key(str(a), aliases))
            keys.add(R.canon_key(str(c), aliases))
        for tier in t.get("tiers") or []:
            if isinstance(tier, dict):
                for n in tier.get("players") or tier.get("nicks") or []:
                    if isinstance(n, str) and n.strip():
                        keys.add(R.canon_key(n, aliases))
                    elif isinstance(n, dict) and n.get("nick"):
                        keys.add(R.canon_key(str(n["nick"]), aliases))
    return keys


def looks_bb_nick(nick: str) -> bool:
    u = (nick or "").upper()
    return bool(re.search(r"(?:^|[\[\|\s])BB(?:[\]\|\s]|$)", u) or u.startswith("[BB]"))


def load_cw_slots() -> list[dict]:
    """Upcoming + recently played CW rows that are on our TR servers."""
    out: list[dict] = []
    for path in sorted((KV_PUBLIC / "data").glob("20??-??.json")):
        if "training" in str(path):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        month = str(data.get("month") or path.stem)
        try:
            y, mo = map(int, month.split("-")[:2])
        except Exception:
            continue
        for m in data.get("matches") or []:
            if not _server_is_ours(str(m.get("server") or ""), str(m.get("note") or "")):
                continue
            st = str(m.get("status") or "")
            # upcoming always; also re-check recent win/lose if players missing opp
            if st not in ("upcoming", "win", "lose"):
                continue
            out.append({**m, "_year": y, "_month": mo, "_monthKey": month})
    return out


def slot_start_utc(slot: dict) -> datetime | None:
    y, mo, day = slot["_year"], slot["_month"], int(slot.get("day") or 0)
    tm = str(slot.get("timeUtc") or "").strip()
    if tm and ":" in tm:
        try:
            hh, mm = map(int, tm.split(":")[:2])
            return datetime(y, mo, day, hh, mm, tzinfo=timezone.utc)
        except Exception:
            pass
    tm = str(slot.get("timeMsk") or "").strip()
    if tm and ":" in tm:
        try:
            hh, mm = map(int, tm.split(":")[:2])
            return datetime(y, mo, day, hh, mm, tzinfo=timezone.utc) - timedelta(hours=3)
        except Exception:
            pass
    return None


def map_fuzzy_match(slot_map: str, layer: str) -> bool:
    a = _map_stem(slot_map).lower()
    b = _map_stem(layer).lower()
    if not a or not b:
        return False
    if a == b:
        return True
    if a in b or b in a:
        return True
    # HotDrop Narva vs Narva AAS …
    ta = re.sub(r"[^a-z0-9]", "", a)
    tb = re.sub(r"[^a-z0-9]", "", b)
    return bool(ta and tb and (ta in tb or tb in ta))


def split_bb_opp(
    team_a: list[dict],
    team_b: list[dict],
    bb_keys: set[str],
    aliases: dict[str, str],
) -> tuple[list[dict], list[dict]]:
    def score(rows: list[dict]) -> int:
        s = 0
        for r in rows:
            nick = str(r.get("nick") or "")
            k = R.canon_key(nick, aliases)
            if k in bb_keys or looks_bb_nick(nick):
                s += 1
        return s

    sa, sb = score(team_a), score(team_b)
    if sa >= sb:
        return team_a, team_b
    return team_b, team_a


def attach_steam(
    rows: list[dict], steam_to_nick: dict[str, str], aliases: dict[str, str]
) -> list[dict]:
    nick_to_steam: dict[str, str] = {}
    for steam, nick in steam_to_nick.items():
        nick_to_steam[R.canon_key(nick, aliases)] = steam
    out = []
    for r in rows:
        nr = {
            "nick": r["nick"],
            "res": int(r.get("res") or 0),
            "nok": int(r.get("nok") or 0),
            "kills": int(r.get("kills") or 0),
            "deaths": int(r.get("deaths") or 0),
            "dmg": int(r.get("dmg") or 0),
        }
        steam = nick_to_steam.get(R.canon_key(r["nick"], aliases))
        if steam:
            nr["steamId"] = steam
        out.append(nr)
    return out


def tickets_for_side(
    m: dict, bb_is_team1: bool
) -> tuple[int, int]:
    """Return (bb_tickets, opp_tickets)."""
    t1 = int(m.get("score1") or 0)
    t2 = int(m.get("score2") or 0)
    if bb_is_team1:
        return t1, t2
    return t2, t1


def post_opponent_clan(opp: str, players: list[dict], match_id: str) -> None:
    env = _load_collector_env()
    secret = (
        os.environ.get("SQUAD_INGEST_SECRET")
        or env.get("SQUAD_INGEST_SECRET")
        or ""
    ).strip()
    base = (
        os.environ.get("BB_SITE_URL")
        or env.get("BB_SITE_URL")
        or env.get("NEXTAUTH_URL")
        or "https://bb-squad.ru"
    ).rstrip("/")
    if not secret:
        print("no SQUAD_INGEST_SECRET — skip clan API", flush=True)
        # still write pending JSON for agent / later
        pending_dir = KV_PUBLIC / "data" / "opponent-clans"
        pending_dir.mkdir(parents=True, exist_ok=True)
        path = pending_dir / f"{re.sub(r'[^A-Za-z0-9]+', '', opp).upper() or 'OPP'}.json"
        doc = {"opp": opp, "matchId": match_id, "players": players, "updatedAt": datetime.now(timezone.utc).isoformat()}
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return

    body = {
        "opp": opp,
        "players": [
            {
                "nick": p["nick"],
                "steamId": p.get("steamId"),
                "matchId": match_id,
            }
            for p in players
        ],
    }
    req = urllib.request.Request(
        f"{base}/api/ingest/opponent-clan",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            print(f"opponent-clan API: {raw[:240]}", flush=True)
    except urllib.error.HTTPError as e:
        print(f"opponent-clan HTTP {e.code}: {e.read()[:200]}", flush=True)
    except Exception as e:
        print(f"opponent-clan fail: {type(e).__name__}: {e}", flush=True)


def update_calendar_row(slot: dict, patch: dict) -> None:
    month_key = slot["_monthKey"]
    path = KV_PUBLIC / "data" / f"{month_key}.json"
    if not path.is_file():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    mid = slot.get("id")
    changed = False
    for m in data.get("matches") or []:
        if m.get("id") != mid:
            continue
        for k, v in patch.items():
            if m.get(k) != v:
                m[k] = v
                changed = True
        break
    if changed:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"calendar {mid} ← {patch}", flush=True)


def process_slot(
    slot: dict,
    discovered: list[dict],
    bb_keys: set[str],
    aliases: dict[str, str],
    auto: list[dict],
) -> bool:
    mid = str(slot.get("id") or "")
    if any(a.get("id") == mid and not a.get("skip") for a in auto):
        # already auto-filled
        return False

    t0 = slot_start_utc(slot)
    if not t0:
        return False
    slot_map = str(slot.get("map") or "")
    window_end = t0 + timedelta(hours=4)

    candidates = []
    for m in discovered:
        start: datetime = m["start"]
        end: datetime = m["end"]
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
            end = end.replace(tzinfo=timezone.utc)
        if start < t0 - timedelta(minutes=TIME_SLACK_MIN):
            continue
        if start > window_end:
            continue
        layer = str(m.get("layer") or m.get("map") or "")
        if R.is_seed_layer(layer, str(m.get("level") or "")):
            continue
        if (end - start).total_seconds() < MIN_LAYER_SEC:
            continue
        if not map_fuzzy_match(slot_map, layer):
            continue
        candidates.append({**m, "start": start, "end": end, "layer": layer})

    candidates.sort(key=lambda x: x["start"])
    if not candidates:
        return False

    # take up to 2 rounds
    rounds = candidates[:2]
    bb_rounds: list[list[dict]] = []
    opp_rounds: list[list[dict]] = []
    ticket_pairs: list[tuple[int, int]] = []
    layer_names: list[str] = []
    server_label = "Blackberry | Training"

    for i, m in enumerate(rounds):
        log_path = Path(m["logPath"]) if m.get("logPath") else Path(m.get("log") or "")
        if not log_path.is_file():
            continue
        idx = R.index_log_combat(log_path, aliases)
        steam = dict(idx.get("steam_to_nick") or {})
        faction_to_team = m.get("factionToTeam") or {}
        teams = R.teams_in_window(idx, m["start"], m["end"], faction_to_team)
        dies, _ = R.dies_in_window(idx, m["start"], m["end"], steam, aliases)
        wounds = R.wounds_in_window(idx, m["start"], m["end"], steam, aliases)
        revives = R.revives_in_window(idx, m["start"], m["end"])
        disp = {R.canon_key(n, aliases): n for n in steam.values()}
        team_a, team_b = agg_players(dies, wounds, revives, teams, disp)

        # which list is team1?
        # agg puts team=="2" in b, else a. score1/score2 from discover.
        bb_side, opp_side = split_bb_opp(team_a, team_b, bb_keys, aliases)
        bb_is_a = bb_side is team_a
        # team_a ≈ team1 in agg (non-2). If bb is team_a, bb_is_team1 True unless swapped by score.
        bb_is_team1 = bb_is_a
        # refine: if more BB keys on team that matched score winner — trust nick score only

        bb_rows = attach_steam(bb_side, steam, aliases)
        opp_rows = attach_steam(opp_side, steam, aliases)
        # strip steam from public CW json? keep for clan ingest; remove from file later
        bb_rounds.append([{k: v for k, v in r.items() if k != "steamId"} for r in bb_rows])
        opp_rounds.append(opp_rows)  # keep steam for API
        bt, ot = tickets_for_side(m, bb_is_team1)
        # If nick split inverted relative to team numbers, tickets may be wrong —
        # recompute: if bb_side was team_b (team 2), swap.
        if not bb_is_a:
            bt, ot = int(m.get("score2") or 0), int(m.get("score1") or 0)
        ticket_pairs.append((bt, ot))
        layer_names.append(m["layer"])
        sk = str(m.get("serverKey") or m.get("server") or "")
        if "TR2" in sk.upper():
            server_label = "Blackberry | Training - Blackberries #2"
        elif "TR1" in sk.upper() or not sk:
            server_label = "Blackberry | Training - Blackberries #1"

        print(
            f"  R{i+1} {m['layer']} BB={len(bb_rows)} opp={len(opp_rows)} tickets {bt}:{ot}",
            flush=True,
        )

    if not bb_rounds:
        return False

    # pad r2 if only one round found yet — leave empty; wait for second
    while len(bb_rounds) < 2:
        bb_rounds.append([])
        opp_rounds.append([])
        ticket_pairs.append((0, 0))

    sum_bb = ticket_pairs[0][0] + ticket_pairs[1][0]
    sum_opp = ticket_pairs[0][1] + ticket_pairs[1][1]
    if sum_bb > sum_opp:
        status, meeting = "win", "2–0"
    elif sum_opp > sum_bb:
        status, meeting = "lose", "0–2"
    else:
        # rare equal — still not draw per canon; leave upcoming if incomplete
        if not rounds or len(candidates) < 2:
            status, meeting = "upcoming", "—"
        else:
            status, meeting = "win", "2–0"  # ask captain later; don't write draw
            print("WARN equal ticket sum — marked win pending captain", flush=True)

    # only finalize status if we have 2 rounds OR layer ended and slot clearly done
    finalize = len(candidates) >= 2 or (
        len(candidates) >= 1 and candidates[-1]["end"] < datetime.now(timezone.utc) - timedelta(minutes=5)
        and len(bb_rounds[0]) >= 8
    )
    # Prefer wait for 2 rounds for classic CW
    if len(candidates) < 2:
        print(f"  {mid}: only {len(candidates)} layer(s) — wait for R2", flush=True)
        # still write partial? skip until 2 rounds unless lookback old
        age_h = (datetime.now(timezone.utc) - t0).total_seconds() / 3600
        if age_h < 6:
            return False

    players_doc = {
        "matchId": mid,
        "opp": slot.get("opp"),
        "note": (
            f"Авто из логов TR · {server_label} · "
            f"сумма {sum_bb}:{sum_opp} · source=tr-cw-auto"
        ),
        "source": "tr-cw-auto",
        "server": server_label,
        "map": layer_names[0] if layer_names else slot_map,
        "r1": bb_rounds[0],
        "r2": bb_rounds[1],
        "oppR1": [{k: v for k, v in r.items() if k != "steamId"} for r in opp_rounds[0]],
        "oppR2": [{k: v for k, v in r.items() if k != "steamId"} for r in opp_rounds[1]],
    }
    CW_PLAYERS.mkdir(parents=True, exist_ok=True)
    (CW_PLAYERS / f"{mid}.json").write_text(
        json.dumps(players_doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    patch = {
        "playersUrl": f"data/players/{mid}.json",
        "r1": f"{ticket_pairs[0][0]}:{ticket_pairs[0][1]}",
        "r2": f"{ticket_pairs[1][0]}:{ticket_pairs[1][1]}",
        "note": (slot.get("note") or "") + " · авто TR обе команды",
    }
    if finalize and status in ("win", "lose"):
        patch["status"] = status
        patch["meeting"] = meeting
    update_calendar_row(slot, patch)

    opp_all = opp_rounds[0] + opp_rounds[1]
    # dedupe by nick
    seen: set[str] = set()
    uniq = []
    for p in opp_all:
        k = R.canon_key(p["nick"], aliases)
        if k in seen:
            continue
        seen.add(k)
        uniq.append(p)
    post_opponent_clan(str(slot.get("opp") or "OPP"), uniq, mid)

    auto.append(
        {
            "id": mid,
            "opp": slot.get("opp"),
            "map": players_doc["map"],
            "server": server_label,
            "start": t0.isoformat(),
            "rounds": len(candidates),
            "sum": f"{sum_bb}:{sum_opp}",
            "status": patch.get("status", slot.get("status")),
            "source": "tr-cw-auto",
        }
    )
    print(f"OK CW {mid} vs {slot.get('opp')} {sum_bb}:{sum_opp}", flush=True)
    return True


def main() -> int:
    aliases = load_aliases()
    bb_keys = load_bb_nick_keys(aliases)
    print(f"KV_PUBLIC={KV_PUBLIC} bb_keys={len(bb_keys)}", flush=True)

    logs: list[Path] = []
    for sk in ("TR1", "TR2"):
        found = sync_tr_logs(sk)
        # tag server on discover via log path parent name
        for p in found:
            # copy with server prefix already
            logs.append(p)
        print(f"{sk} logs: {len(found)}", flush=True)

    if not logs:
        print("no TR logs", flush=True)
        return 0

    # annotate discover with serverKey from filename/path
    discovered_raw = R.discover_matches(logs)
    discovered = []
    for m in discovered_raw:
        lp = str(m.get("logPath") or m.get("log") or "")
        sk = "TR1"
        if "TR2" in lp.upper() or "tr2" in lp.lower():
            sk = "TR2"
        m["serverKey"] = sk
        discovered.append(m)

    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    discovered = [
        m
        for m in discovered
        if (m["start"] if m["start"].tzinfo else m["start"].replace(tzinfo=timezone.utc))
        >= cutoff
    ]
    print(f"discovered layers (lookback): {len(discovered)}", flush=True)

    auto: list[dict] = []
    if AUTO_CW.is_file():
        try:
            auto = json.loads(AUTO_CW.read_text(encoding="utf-8"))
            if not isinstance(auto, list):
                auto = []
        except Exception:
            auto = []

    slots = load_cw_slots()
    print(f"CW slots on our servers: {len(slots)}", flush=True)
    added = 0
    for slot in slots:
        try:
            if process_slot(slot, discovered, bb_keys, aliases, auto):
                added += 1
        except Exception as e:
            print(f"slot {slot.get('id')} err: {type(e).__name__}: {e}", flush=True)

    AUTO_CW.parent.mkdir(parents=True, exist_ok=True)
    AUTO_CW.write_text(json.dumps(auto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if added:
        bump_cache_bust()
    print(f"done added={added}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
