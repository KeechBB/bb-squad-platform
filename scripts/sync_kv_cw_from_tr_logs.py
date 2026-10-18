#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto-digitize CW matches hosted on any TR (TR1, TR2, TR3…) → KV players.
Clan cards are NOT auto-created — clans register themselves on the site.

Canon: .cursor/rules/kv-tr-both-teams-auto.mdc
- calendar `server` is NOT a filter (ANY, OMEN, a clan name — still try our logs)
- match a closed layer by time + map (+ clan tags when present), duration ≥ 10 min
- both sides, including clan vs clan with no BB; RP not applied
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
# Canon «≥10 мин»; 9.5 ловит округление/обрезку (напр. FAL R2 9.9 мин).
MIN_LAYER_SEC = int(9.5 * 60)
TIME_SLACK_MIN = int(os.environ.get("CW_TR_TIME_SLACK_MIN", "45"))

OUR_SERVER_RE = re.compile(
    r"\bTR\s*\d+\b|Blackberry\s*\|?\s*Training|Blackberry\s+Training|"
    r"Blackberries\s*#|\bBB\b|FCL\s*ARENA\s*#?\s*2\b",
    re.I,
)

# Public browser name of our TR2 box (same logs /home/.../TR2).
TR2_PUBLIC_ALIASES = (
    "TR2",
    "FCL ARENA #2",
    "FCL ARENA 2",
    "FCLARENA#2",
    "BLACKBERRIES #2",
    "BLACKBERRIES#2",
)


def _server_is_ours(server: str, note: str = "") -> bool:
    # Only the calendar `server` field — never scan `note` (notes often say
    # "OMEN vs BB" and `\bBB\b` would false-positive foreign hosts).
    _ = note  # kept for call-site compat
    s = (server or "").strip()
    if not s:
        return False
    if OUR_SERVER_RE.search(s):
        return True
    su = s.upper()
    return su in {"BB", "TR1", "TR2", "BB TRAINING", "BLACKBERRY"} or su in {
        a.upper() for a in TR2_PUBLIC_ALIASES
    }


def slot_allows_tr_auto(slot: dict) -> bool:
    """Every calendar slot is a candidate. The `server` field is not a filter.

    A booking may say OMEN, ANY, or another clan's box and still be played
    on TR1/TR2/TR3. Time + map (+ tags) decide. Cancelled rows never reach here.
    """
    _ = slot
    return True


def calendar_server_key(server: str) -> str | None:
    """Map a calendar label to a TR folder. Hint only — never a reason to skip."""
    s = re.sub(r"\s+", " ", (server or "").strip().upper())
    if not s:
        return None
    m = re.search(r"\bTR\s*(\d+)\b", s)
    if m:
        return f"TR{m.group(1)}"
    m = re.search(r"BLACKBERRIES\s*#\s*(\d+)", s)
    if m:
        return f"TR{m.group(1)}"
    if s in {a.upper() for a in TR2_PUBLIC_ALIASES} or re.search(
        r"FCL\s*ARENA\s*#?\s*2\b", s
    ):
        return "TR2"
    return None


def tr_number(label: str) -> str | None:
    m = re.search(r"TR\s*(\d+)", (label or "").upper())
    return m.group(1) if m else None


def server_label_for(sk: str) -> str:
    try:
        import bb_alerts as AL  # noqa: WPS433

        label = AL.train_server_label(sk)
        if label:
            return label
    except Exception:
        pass
    n = tr_number(sk)
    if n:
        return f"TR{n}"
    return "Blackberry | Training"


def server_key_from_log(path: str) -> str:
    m = re.search(r"TR\d+", (path or "").upper())
    return m.group(0) if m else "TR1"


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
                    print(f"{server_key} sftp <- {name} ({st.st_size})", flush=True)
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


# IPA / small-cap lookalikes (ɪʜ → ih) — Steam clan tags often use phonetics.
_NICK_LOOKALIKES = str.maketrans(
    {
        "\u026a": "i",  # ɪ
        "\u029c": "h",  # ʜ
        "\u0280": "r",  # ʀ
        "\u029f": "l",  # ʟ
        "\u1d00": "a",  # ᴀ
        "\u0299": "b",  # ʙ
        "\u1d04": "c",  # ᴄ
        "\u1d05": "d",  # ᴅ
        "\u1d07": "e",  # ᴇ
        "\u0262": "g",  # ɢ
        "\u1d0a": "j",  # ᴊ
        "\u1d0b": "k",  # ᴋ
        "\u1d0d": "m",  # ᴍ
        "\u0274": "n",  # ɴ
        "\u1d0f": "o",  # ᴏ
        "\u1d18": "p",  # ᴘ
        "\u1d1b": "t",  # ᴛ
        "\u1d1c": "u",  # ᴜ
        "\u1d20": "v",  # ᴠ
        "\u1d21": "w",  # ᴡ
        "\u028f": "y",  # ʏ
        "\u1d22": "z",  # ᴢ
    }
)


def fold_nick_lookalikes(nick: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", nick or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.translate(_NICK_LOOKALIKES)


def nick_leading_tag_token(nick: str) -> str:
    folded = fold_nick_lookalikes(nick).strip()
    first = folded.split()[0] if folded.split() else ""
    return re.sub(r"[^A-Za-z0-9]", "", first).upper()


def looks_bb_nick(nick: str) -> bool:
    u = fold_nick_lookalikes(nick or "").upper()
    return bool(re.search(r"(?:^|[\[\|\s])BB(?:[\]\|\s]|$)", u) or u.startswith("[BB]"))


def looks_opp_tag(nick: str, opp: str) -> bool:
    """True if nick carries opponent clan tag (do not count as BB)."""
    n = nick or ""
    folded = fold_nick_lookalikes(n)
    u = folded.upper()
    tag = re.sub(r"[^A-Z0-9]", "", fold_nick_lookalikes(opp or "").upper())
    if not tag:
        return False
    lead = nick_leading_tag_token(n)
    if lead.startswith(tag) or lead == tag:
        return True
    if tag in re.sub(r"[^A-Z0-9]", "", u):
        return True
    # common wrappers: ↯DCAI↯ 『DCAI』 [DCAI]
    if re.search(rf"[↯『\[\|\s]{re.escape(tag)}[↯』\]\|\s]", u):
        return True
    # DCAI sometimes as DCI)(AG …
    if tag == "DCAI" and ("DCI)(AG" in u):
        return True
    return False


def looks_foreign_clan_tag(nick: str) -> bool:
    """Any decorative / phonetic clan tag that is not BB (RA/DCAI/ɪʜ… leaked onto BB side)."""
    n = nick or ""
    if not n or looks_bb_nick(n):
        return False
    lead = nick_leading_tag_token(n)
    # IH / iHHHHHH gLow — phonetic prefix without brackets
    if re.match(r"^IH+$", lead):
        return True
    folded = fold_nick_lookalikes(n)
    if re.search(
        r"[✠✥❖↯『\[\u2726]\s*(?!BB\b)[A-Za-zА-Яа-я0-9]{2,8}\s*[✠✥❖↯』\]\u2726]",
        folded,
        re.I,
    ):
        return True
    u = folded.upper()
    if "RA" in u and re.search(r"[✠✥❖\u2726]", n):
        return True
    return False


def load_cw_slots() -> list[dict]:
    """CW rows to try against every TR log.

    The calendar server label is ignored. Clan vs clan (no BB) is included.
    """
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
            st = str(m.get("status") or "")
            # upcoming always; also re-check recent win/lose if players missing opp
            if st not in ("upcoming", "win", "lose"):
                continue
            if not slot_allows_tr_auto(m):
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


def _normalize_map_stem(stem: str) -> str:
    """Collapse known Squad layer typos / spelling variants."""
    s = (stem or "").lower()
    # SEC pack sometimes ships AlBasras instead of AlBasrah
    s = s.replace("albasras", "albasrah")
    # bare AlBasra / Al Basra (not already AlBasrah)
    s = re.sub(r"albasra(?!h)", "albasrah", s)
    return s


def map_fuzzy_match(slot_map: str, layer: str) -> bool:
    a = _normalize_map_stem(_map_stem(slot_map))
    b = _normalize_map_stem(_map_stem(layer))
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
    opp: str = "",
) -> tuple[list[dict], list[dict], bool]:
    """Return (bb_rows, opp_rows, bb_is_team_a).

    bb_is_team_a is decided BEFORE filtering tagged opp out of the BB list —
    otherwise a rebuilt `keep` list breaks `is team_a` and flips tickets.
    """

    def score(rows: list[dict]) -> int:
        s = 0
        for r in rows:
            nick = str(r.get("nick") or "")
            if looks_opp_tag(nick, opp):
                s -= 2
                continue
            k = R.canon_key(nick, aliases)
            if k in bb_keys or looks_bb_nick(nick):
                s += 1
        return s

    sa, sb = score(team_a), score(team_b)
    bb_is_team_a = sa >= sb
    if bb_is_team_a:
        bb_side, opp_side = team_a, team_b
    else:
        bb_side, opp_side = team_b, team_a
    # hard filter: tagged opp / any foreign clan tag never stay on BB list
    keep, dump = [], []
    for r in bb_side:
        nick = str(r.get("nick") or "")
        if (opp and looks_opp_tag(nick, opp)) or looks_foreign_clan_tag(nick):
            dump.append(r)
        else:
            keep.append(r)
    if dump:
        bb_side = keep
        opp_side = list(opp_side) + dump
    return bb_side, opp_side, bb_is_team_a


def split_match_sides(
    slot: dict,
    team_a: list[dict],
    team_b: list[dict],
    bb_keys: set[str],
    aliases: dict[str, str],
) -> tuple[list[dict], list[dict], bool]:
    """Orient rounds as (our_side, their_side, our_side_is_team1).

    BB stack: our side is the BB-tagged team.
    Clan vs clan (no BB): our side is the calendar `clan`, theirs is `opp`.
    """
    stack = str(slot.get("stack") or "").strip()
    clan = str(slot.get("clan") or "").strip()
    opp = str(slot.get("opp") or "").strip()
    bb_stack = stack in {"Main", "Junior", "BB"} or not clan

    def bb_count(rows: list[dict]) -> int:
        n = 0
        for r in rows:
            nick = str(r.get("nick") or "")
            if looks_bb_nick(nick) or R.canon_key(nick, aliases) in bb_keys:
                n += 1
        return n

    if bb_stack and max(bb_count(team_a), bb_count(team_b)) >= 3:
        return split_bb_opp(team_a, team_b, bb_keys, aliases, opp=opp)

    home = clan
    if home and opp and home.upper() not in {"BB", "BLACKBERRY"}:

        def tag_n(rows: list[dict], tag: str) -> int:
            return sum(
                1 for r in rows if looks_opp_tag(str(r.get("nick") or ""), tag)
            )

        score_a = tag_n(team_a, home) - tag_n(team_a, opp)
        score_b = tag_n(team_b, home) - tag_n(team_b, opp)
        if score_a >= score_b:
            return team_a, team_b, True
        return team_b, team_a, False
    return split_bb_opp(team_a, team_b, bb_keys, aliases, opp=opp)


def vehicle_kill_counts(
    *,
    dies: list[dict],
    wounds: list[dict],
    revives: list[dict],
    teams: dict[str, str],
    disp: dict[str, str],
    aliases: dict[str, str],
    vehicle_ops: list[dict],
    match_date: str,
    match_id: str,
) -> dict[str, int]:
    """Finisher vehicle destroys per canon key — only after 17.10.2026 01:00 MSK."""
    if not vehicle_ops or not R.use_rp_vehicle(match_date, match_id):
        return {}
    rp = {k: float(R.START_RP) for k in set(list(teams) + list(disp))}
    events, *_ = R.score_match_rp(
        dies=dies,
        wounds=wounds,
        revives=revives,
        teams=teams,
        rp=rp,
        disp=dict(disp),
        aliases=aliases,
        new_formula=True,
        match_date=match_date,
        match_id=match_id,
        vehicle_ops=vehicle_ops,
    )
    counts: dict[str, int] = {}
    for e in events:
        if e.get("kind") != "vehicle_kill":
            continue
        kk = R.canon_key(str(e.get("killer") or ""), aliases)
        if not kk:
            continue
        counts[kk] = counts.get(kk, 0) + 1
    return counts


def attach_steam(
    rows: list[dict],
    steam_to_nick: dict[str, str],
    aliases: dict[str, str],
    vk_by_key: dict[str, int] | None = None,
) -> list[dict]:
    nick_to_steam: dict[str, str] = {}
    for steam, nick in steam_to_nick.items():
        nick_to_steam[R.canon_key(nick, aliases)] = steam
    vk_by_key = vk_by_key or {}
    out = []
    for r in rows:
        ck = R.canon_key(r["nick"], aliases)
        nr = {
            "nick": r["nick"],
            "res": int(r.get("res") or 0),
            "nok": int(r.get("nok") or 0),
            "kills": int(r.get("kills") or 0),
            "deaths": int(r.get("deaths") or 0),
            "dmg": int(r.get("dmg") or 0),
            "vehicleKills": int(vk_by_key.get(ck) or r.get("vehicleKills") or 0),
        }
        steam = nick_to_steam.get(ck)
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
    """Disabled 08.10.2026 — clans create their own cards on the site."""
    print(
        f"skip opponent-clan card for {opp} ({len(players)} players, {match_id}) — self-serve only",
        flush=True,
    )


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
            if v is None:
                if k in m:
                    del m[k]
                    changed = True
                continue
            if m.get(k) != v:
                m[k] = v
                changed = True
        break
    if changed:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"calendar {mid} <- {patch}", flush=True)


def process_slot(
    slot: dict,
    discovered: list[dict],
    bb_keys: set[str],
    aliases: dict[str, str],
    auto: list[dict],
) -> bool:
    mid = str(slot.get("id") or "")
    # Manual / foreign-server block (e.g. OMEN screens-only).
    if any(a.get("id") == mid and a.get("skip") for a in auto):
        return False
    if not slot_allows_tr_auto(slot):
        return False
    # Re-run while incomplete (R2 still open). Only skip fully finalized auto rows.
    prior = next((a for a in auto if a.get("id") == mid and not a.get("skip")), None)
    if prior and prior.get("rounds", 0) >= 2 and prior.get("status") in ("win", "lose"):
        return False

    # Не затирать уже залитый R2, если в логах раунд больше не находится
    # (ротация SquadGame.log → парсер видит только R1 → снова «R2 идёт»).
    players_path = CW_PLAYERS / f"{mid}.json"
    prior_doc: dict | None = None
    if players_path.exists():
        try:
            prior_doc = json.loads(players_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            prior_doc = None
    prior_r2_n = len((prior_doc or {}).get("r2") or [])
    prior_opp_r2_n = len((prior_doc or {}).get("oppR2") or [])
    if prior_r2_n > 0 and slot.get("status") in ("win", "lose") and slot.get("r2"):
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

    # Calendar `server` does not choose the log. Any TR at this time+map counts.

    # Drop early warmup layers (often start before slot). Keep layers at/after t0−10m.
    on_time = [c for c in candidates if c["start"] >= t0 - timedelta(minutes=10)]
    if on_time:
        candidates = on_time

    # Prefer layers with parsed tickets (skip empty InProgress→PostMatch without Display winner).
    scored = [
        c
        for c in candidates
        if c.get("score1") is not None and c.get("score2") is not None
    ]
    if scored:
        candidates = scored

    # take up to 2 closed rounds
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

        start_msk = m["start"].astimezone(R.MSK)
        match_date = start_msk.strftime("%Y-%m-%d")
        match_id = start_msk.strftime("%Y%m%d-%H%M") + "-cw"
        vehicle_ops = R.vehicle_ops_in_window(
            idx, m["start"], m["end"], steam, aliases
        )
        vk_by_key = vehicle_kill_counts(
            dies=dies,
            wounds=wounds,
            revives=revives,
            teams=teams,
            disp=disp,
            aliases=aliases,
            vehicle_ops=vehicle_ops,
            match_date=match_date,
            match_id=match_id,
        )

        # agg: team_a ≈ team1, team_b ≈ team2
        bb_side, opp_side, bb_is_team_a = split_match_sides(
            slot, team_a, team_b, bb_keys, aliases
        )

        bb_rows = attach_steam(bb_side, steam, aliases, vk_by_key)
        opp_rows = attach_steam(opp_side, steam, aliases, vk_by_key)
        # strip steam from public CW json? keep for clan ingest; remove from file later
        bb_rounds.append([{k: v for k, v in r.items() if k != "steamId"} for r in bb_rows])
        opp_rounds.append(opp_rows)  # keep steam for API
        if bb_is_team_a:
            bt, ot = int(m.get("score1") or 0), int(m.get("score2") or 0)
        else:
            bt, ot = int(m.get("score2") or 0), int(m.get("score1") or 0)
        ticket_pairs.append((bt, ot))
        layer_names.append(m["layer"])
        sk = str(m.get("serverKey") or "")
        if sk:
            server_label = server_label_for(sk)

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

    closed_rounds = sum(1 for rows in bb_rounds if rows)
    # Если парсер потерял R2, а на диске он уже был — не даунгрейдим.
    if closed_rounds < 2 and prior_r2_n > 0:
        print(
            f"  {mid}: skip write — logs show {closed_rounds} round(s), "
            f"but players file already has R2 ({prior_r2_n}+{prior_opp_r2_n})",
            flush=True,
        )
        return False
    sum_bb = ticket_pairs[0][0] + (ticket_pairs[1][0] if closed_rounds >= 2 else 0)
    sum_opp = ticket_pairs[0][1] + (ticket_pairs[1][1] if closed_rounds >= 2 else 0)
    # Finalize meeting only when both rounds are closed layers.
    finalize = closed_rounds >= 2
    if finalize:
        if sum_bb > sum_opp:
            status, meeting = "win", "2–0"
        elif sum_opp > sum_bb:
            status, meeting = "lose", "0–2"
        else:
            status, meeting = "win", "2–0"  # ask captain later; never draw
            print("WARN equal ticket sum — marked win pending captain", flush=True)
    else:
        status, meeting = "upcoming", "—"
        print(f"  {mid}: {closed_rounds} closed round(s) — write partial, wait for R2", flush=True)

    note_sum = (
        f"сумма {sum_bb}:{sum_opp}"
        if finalize
        else f"R1 {ticket_pairs[0][0]}:{ticket_pairs[0][1]} · R2 идёт"
    )
    players_doc = {
        "matchId": mid,
        "opp": slot.get("opp"),
        "note": (
            f"Авто из логов TR · {server_label} · "
            f"{note_sum} · source=tr-cw-auto"
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
        "note": (slot.get("note") or "") + " · авто TR обе команды",
        "status": status,
    }
    stack = str(slot.get("stack") or "Main")
    rules = str(slot.get("rules") or "")
    map_label = layer_names[0] if layer_names else slot_map
    played_on = tr_number(server_label) or tr_number(
        str((rounds[0] if rounds else {}).get("serverKey") or "")
    )
    srv = f"TR{played_on}" if played_on else "TR"
    head = f"{stack} · {rules} · {map_label} · {srv}".replace(" ·  · ", " · ")
    if closed_rounds >= 2:
        patch["r2"] = f"{ticket_pairs[1][0]}:{ticket_pairs[1][1]}"
        patch["meeting"] = meeting
        patch["note"] = (
            f"{head} · сумма {sum_bb}:{sum_opp} "
            f"({ticket_pairs[0][0]}:{ticket_pairs[0][1]} · {ticket_pairs[1][0]}:{ticket_pairs[1][1]}) · "
            f"авто обе команды"
        )
    else:
        patch["note"] = (
            f"{head} · R1 {ticket_pairs[0][0]}:{ticket_pairs[0][1]} · "
            f"R2 идёт · авто обе команды"
        )
        # clear stale finalize fields if re-writing partial
        patch["r2"] = None
        patch["meeting"] = None
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

    entry = {
        "id": mid,
        "opp": slot.get("opp"),
        "map": players_doc["map"],
        "server": server_label,
        "start": t0.isoformat(),
        "rounds": closed_rounds,
        "sum": f"{sum_bb}:{sum_opp}" if finalize else f"R1 {ticket_pairs[0][0]}:{ticket_pairs[0][1]}",
        "status": patch.get("status", slot.get("status")),
        "source": "tr-cw-auto",
    }
    # replace prior partial row for this match id
    auto[:] = [a for a in auto if a.get("id") != mid] + [entry]
    print(f"OK CW {mid} vs {slot.get('opp')} {entry['sum']}", flush=True)
    return entry


def main() -> int:
    aliases = load_aliases()
    bb_keys = load_bb_nick_keys(aliases)
    print(f"KV_PUBLIC={KV_PUBLIC} bb_keys={len(bb_keys)}", flush=True)

    import bb_log_fleet as FLEET  # noqa: WPS433

    _load_collector_env()
    train = FLEET.train_servers() or ["TR1", "TR2", "TR3"]
    logs = FLEET.sync_servers_parallel(train, kind="train")
    print(f"TR fleet {train} logs: {len(logs)}", flush=True)

    if not logs:
        print("no TR logs", flush=True)
        return 0

    discovered_raw = R.discover_matches(logs)
    discovered = []
    for m in discovered_raw:
        lp = str(m.get("logPath") or m.get("log") or "")
        m["serverKey"] = server_key_from_log(lp)
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
    print(f"CW slots (server field ignored): {len(slots)}", flush=True)
    added = 0
    written: list[dict] = []
    for slot in slots:
        try:
            report = process_slot(slot, discovered, bb_keys, aliases, auto)
            if report:
                added += 1
                if isinstance(report, dict):
                    written.append(report)
        except Exception as e:
            print(f"slot {slot.get('id')} err: {type(e).__name__}: {e}", flush=True)

    AUTO_CW.parent.mkdir(parents=True, exist_ok=True)
    AUTO_CW.write_text(json.dumps(auto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if added:
        bump_cache_bust()
        publish_cw_live_mirrors(auto)
        try:
            import bb_alerts as AL  # noqa: WPS433

            lines = [f"залито слотов: {added}"]
            for row in written:
                opp = row.get("opp") or "?"
                game = row.get("map") or "?"
                where = row.get("server") or "TR"
                score = row.get("sum") or ""
                rounds = row.get("rounds")
                bit = f"{where} · vs {opp} · {game}"
                if score:
                    bit += f" · {score}"
                if rounds:
                    bit += f" · раундов {rounds}"
                lines.append(bit)
            AL.send(
                kind="выгрузка",
                title="КВ: залиты раунды",
                level="ok",
                lines=lines,
                force=True,
            )
        except Exception as e:
            print(f"alert cw skip: {e}", flush=True)
    print(f"done added={added}", flush=True)
    return 0


def publish_cw_live_mirrors(auto: list[dict] | None = None) -> None:
    """Copy CW calendar + player files into platform kv-cache for immediate site."""
    import shutil

    mirrors: list[Path] = []
    for raw in (
        os.environ.get("KV_LOCAL_DIR", "").strip(),
        "/var/www/bb-squad-platform/data/kv-cache",
        str(HERE.parents[0] / "data" / "kv-cache"),
    ):
        if not raw:
            continue
        p = Path(raw)
        try:
            if p.resolve() == KV_PUBLIC.resolve():
                continue
        except Exception:
            pass
        if (p / "data").is_dir() or p.is_dir():
            mirrors.append(p)
    if not mirrors:
        return

    rels = [
        "data/cache-bust.json",
        "data/_auto_cw_matches.json",
        "app.js",
    ]
    # current-month calendars
    for path in (KV_PUBLIC / "data").glob("20??-??.json"):
        if "training" in path.name:
            continue
        rels.append(f"data/{path.name}")
    # player files from auto ledger + any recent id we know
    ids: set[str] = set()
    for row in auto or []:
        mid = str(row.get("id") or "").strip()
        if mid:
            ids.add(mid)
    try:
        for path in (KV_PUBLIC / "data").glob("20??-??.json"):
            if "training" in str(path):
                continue
            doc = json.loads(path.read_text(encoding="utf-8"))
            for m in doc.get("matches") or []:
                if m.get("playersUrl"):
                    mid = str(m.get("id") or "")
                    if mid:
                        ids.add(mid)
    except Exception:
        pass
    for mid in ids:
        rels.append(f"data/players/{mid}.json")

    for dest_root in mirrors:
        for rel in rels:
            src = KV_PUBLIC / rel
            if not src.is_file():
                continue
            dst = dest_root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
        print(f"mirrored CW data → {dest_root}", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
