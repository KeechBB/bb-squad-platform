#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared Squad log parsers for train + public RP ledgers."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

LINE_TS = re.compile(r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]")
PC_STEAM = re.compile(
    r"PC=(?P<nick>[^\s(]+)\s*\(Online IDs:\s*EOS:\s*(?P<eos>[0-9a-fA-F]+)\s+steam:\s*(?P<steam>7656\d+)",
    re.I,
)
# Nick immediately before (Online IDs: ...) — not the whole log line prefix.
NICK_STEAM = re.compile(
    r"(?:PC=|LogSquad:\s*)(?P<nick>[^\n(]+?)\s*\(Online IDs:\s*EOS:\s*(?P<eos>[0-9a-fA-F]+)\s+steam:\s*(?P<steam>7656\d+)\)",
    re.I,
)
DIE_RE = re.compile(
    r"Die\(\):\s*Player:(?P<victim>.+?)\s+KillingDamage=(?P<dmg>[-\d.]+)\s+from\s+\S+\s+"
    r"\(Online IDs:\s*EOS:\s*(?P<eos>[0-9a-fA-F]+)\s+steam:\s*(?P<steam>7656\d+)",
    re.I,
)
WOUND_RE = re.compile(
    r"Wound\(\):\s*Player:(?P<victim>.+?)\s+KillingDamage=(?P<dmg>[-\d.]+)\s+from\s+\S+\s+"
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
TRAVEL_RE = re.compile(r"SeamlessTravel to:\s*(?P<path>\S+)", re.I)
# Prefer LogGameMode (LogGameState duplicates the same transitions).
STATE_RE = re.compile(
    r"LogGameMode:.*Match State Changed from \w+ to (?P<state>InProgress|WaitingPostMatch|LeavingMap)\b",
    re.I,
)
MATCH_RESULT_RE = re.compile(
    r"LogSquadGameEvents:\s*Display:\s*Team\s+(?P<team>[12]),\s+"
    r"(?P<faction>.+?)\s+\(\s*(?P<side>.+?)\s*\)\s+has\s+"
    r"(?P<outcome>won|lost)\s+the\s+match\s+with\s+(?P<tickets>\d+)\s+Tickets\s+"
    r"on\s+layer\s+(?P<layer>.+?)\s+\(level\s+(?P<level>.+?)\)!",
    re.I,
)
CREATE_SQUAD_RE = re.compile(
    r"LogSquad:\s*(?P<nick>.+?)\s*\(Online IDs:\s*EOS:\s*[0-9a-fA-F]+\s+steam:\s*(?P<steam>7656\d+)\)\s+"
    r"has created Squad\s+\d+\s+\(Squad Name:\s*.+?\)\s+on\s+(?P<faction>.+)$",
    re.I,
)
DEPLOY_RE = re.compile(
    r"PC=(?P<nick>.+?)\s+Spawn=\S+\s+DeployRole=(?P<role>\S+)",
    re.I,
)
SEED_RE = re.compile(r"Seed|SEED|BP_GameStateSquad_Seed|Jensen", re.I)

START_RP = 1000.0
REVIVE_COEF = 0.6
STEP = 150
RADIANT3_MAX = 4500
MIN_MATCH_SEC = 8 * 60

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


def strip_tag(n: str) -> str:
    n = (n or "").strip()
    if "?" in n:
        n = n.split("?", 1)[0]
    n = TAG_RE.sub("", n).strip()
    # [BB], 〔 A 〕, 【x】, etc.
    n = re.sub(r"^[\[\(\{〔【「『][^\]\)\}〕】」』]{0,16}[\]\)\}〕】」』]\s*", "", n).strip()
    n = re.sub(r"^\[[^\]]+\]\s*", "", n).strip()
    # Clan prefix without brackets: "H1GH Nick" (ALLCAPS / digits). Keep "Gastone Gambara", "DarK Knight".
    parts = n.split()
    if len(parts) >= 2 and re.fullmatch(r"[A-Za-z0-9_\-]{2,10}", parts[0] or ""):
        first = parts[0]
        rest = " ".join(parts[1:])
        if len(rest) >= 3 and (first.isupper() or re.search(r"\d", first)):
            n = rest
    return n.strip()


def nick_key(n: str) -> str:
    return re.sub(r"\s+", "", strip_tag(n).lower())


def canon_key(n: str, aliases: dict[str, str]) -> str:
    k = nick_key(n)
    return aliases.get(k, k)


def resolve_player_key(
    raw: str,
    aliases: dict[str, str],
    known: set[str] | None = None,
    prefer: set[str] | None = None,
) -> str:
    """Map Die() victim 'CLAN Nick' / '〔 A 〕 Nick' → best key in known set."""
    parts = re.split(r"\s+", (raw or "").strip())
    cands: list[str] = []
    for piece in (
        raw,
        strip_tag(raw),
        parts[-1] if parts else "",
        " ".join(parts[1:]) if len(parts) >= 2 else "",
        " ".join(parts[-2:]) if len(parts) >= 2 else "",
    ):
        if not piece:
            continue
        cands.append(canon_key(piece, aliases))
    ordered: list[str] = []
    seen: set[str] = set()
    for c in cands:
        ck = aliases.get(c, c)
        if ck and ck not in seen:
            seen.add(ck)
            ordered.append(ck)
    if not ordered:
        return ""
    if not known:
        return ordered[0]
    hits = [c for c in ordered if c in known]
    if not hits:
        return ordered[0]
    if prefer:
        pref_hits = [c for c in hits if c in prefer]
        if pref_hits:
            # Real steam nicks: prefer longest full nick.
            pref_hits.sort(key=lambda x: (-len(x), x))
            return pref_hits[0]
    # Otherwise shortest (drop clan-prefixed composites like mdmav1nt).
    hits.sort(key=lambda x: (len(x), x))
    return hits[0]


def parse_ts(raw: str) -> datetime:
    raw = raw.rsplit(":", 1)[0] if re.search(r":\d{3}$", raw) else raw
    y, mo, d = raw[:10].split(".")
    h, mi, s = raw[11:].split(".")
    return datetime(int(y), int(mo), int(d), int(h), int(mi), int(s), tzinfo=timezone.utc)


def hunt_delta(pk: float, pv: float, pmax: float) -> float:
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


def role_prefix(role: str) -> str:
    role = (role or "").strip()
    if not role or role.lower() in ("none", "nullptr"):
        return ""
    return role.split("_", 1)[0].upper()


def layer_basename(path: str) -> str:
    name = Path(str(path).replace("\\", "/")).name
    return name.replace(".umap", "")


def is_seed_layer(layer: str, level: str = "") -> bool:
    return bool(SEED_RE.search(layer or "") or SEED_RE.search(level or ""))


def build_steam_map(log_paths: list[Path]) -> dict[str, str]:
    steam_to_nick: dict[str, str] = {}
    for path in log_paths:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                for m in PC_STEAM.finditer(line):
                    steam_to_nick[m.group("steam")] = strip_tag(m.group("nick"))
                if "Online IDs:" in line and "steam:" in line:
                    for m in NICK_STEAM.finditer(line):
                        steam_to_nick.setdefault(
                            m.group("steam"), strip_tag(m.group("nick"))
                        )
    return steam_to_nick


def parse_inactive_times(
    log_path: Path, t0: datetime, t1: datetime
) -> tuple[dict[str, list[datetime]], dict[str, list[datetime]]]:
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
    return by_nick, by_steam


def _has_inactive_soon(
    times: list[datetime], at: datetime, pad_sec: float = 8.0
) -> bool:
    lo = at
    hi = at + timedelta(seconds=pad_sec)
    for t in times:
        if t < lo:
            continue
        if t <= hi:
            return True
        return False
    return False


def index_log_combat(log_path: Path, aliases: dict[str, str]) -> dict:
    """Single pass: steam map, inactive, dies, revives, squad/deploy for team."""
    steam_to_nick: dict[str, str] = {}
    inactive_by_nick: dict[str, list[datetime]] = {}
    inactive_by_steam: dict[str, list[datetime]] = {}
    victim_steam: dict[str, str] = {}
    raw_dies: list[dict] = []
    raw_wounds: list[dict] = []
    revives: list[dict] = []
    squads: list[tuple[datetime, str, str]] = []  # at, nick_key, faction
    deploys: list[tuple[datetime, str, str]] = []  # at, nick_key, prefix

    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            tm = LINE_TS.match(line)
            if not tm:
                continue
            at = parse_ts(tm.group("ts"))

            if "Online IDs:" in line and "steam:" in line:
                for m in PC_STEAM.finditer(line):
                    nick = strip_tag(m.group("nick"))
                    if nick and "LogSquad" not in nick and "ChangeState" not in nick:
                        steam_to_nick[m.group("steam")] = nick
                        victim_steam[canon_key(nick, aliases)] = m.group("steam")
                for m in NICK_STEAM.finditer(line):
                    nick = strip_tag(m.group("nick"))
                    if nick and "LogSquad" not in nick and len(nick) < 64:
                        steam_to_nick[m.group("steam")] = nick
                        victim_steam[canon_key(nick, aliases)] = m.group("steam")

            if "NewState=Inactive" in line and "ChangeState():" in line:
                im = INACTIVE_RE.search(line)
                if im:
                    nick = strip_tag(im.group("nick"))
                    steam = im.group("steam")
                    inactive_by_nick.setdefault(nick_key(nick), []).append(at)
                    inactive_by_steam.setdefault(steam, []).append(at)

            if "Wound():" in line:
                wm = WOUND_RE.search(line)
                if wm:
                    try:
                        dmg = abs(float(wm.group("dmg") or 0))
                    except ValueError:
                        dmg = 0.0
                    raw_wounds.append(
                        {
                            "at": at,
                            "victim": strip_tag(wm.group("victim")),
                            "steam": wm.group("steam"),
                            "dmg": dmg,
                        }
                    )

            if "Die():" in line:
                dm = DIE_RE.search(line)
                if dm:
                    try:
                        dmg = abs(float(dm.group("dmg") or 0))
                    except ValueError:
                        dmg = 0.0
                    raw_dies.append(
                        {
                            "at": at,
                            "victim": strip_tag(dm.group("victim")),
                            "steam": dm.group("steam"),
                            "dmg": dmg,
                        }
                    )

            if "has revived" in line:
                rm = REVIVE_RE.search(line)
                if rm:
                    revives.append(
                        {
                            "at": at,
                            "at_msk": (at + timedelta(hours=3)).strftime("%H:%M:%S"),
                            "killer": strip_tag(rm.group("medic")),
                            "victim": strip_tag(rm.group("patient")),
                        }
                    )

            if "has created Squad" in line:
                cm = CREATE_SQUAD_RE.search(line)
                if cm:
                    squads.append(
                        (
                            at,
                            canon_key(cm.group("nick"), aliases),
                            (cm.group("faction") or "").strip(),
                        )
                    )

            if "DeployRole=" in line:
                dm = DEPLOY_RE.search(line)
                if dm:
                    pref = role_prefix(dm.group("role"))
                    if pref:
                        deploys.append(
                            (at, canon_key(dm.group("nick"), aliases), pref)
                        )

    for d in (inactive_by_nick, inactive_by_steam):
        for k in d:
            d[k].sort()

    return {
        "steam_to_nick": steam_to_nick,
        "inactive_by_nick": inactive_by_nick,
        "inactive_by_steam": inactive_by_steam,
        "victim_steam": victim_steam,
        "raw_dies": raw_dies,
        "raw_wounds": raw_wounds,
        "revives": revives,
        "squads": squads,
        "deploys": deploys,
    }


def _resolve_combat_row(
    rd: dict,
    *,
    steam_to_nick: dict[str, str],
    aliases: dict[str, str],
    known_keys: set[str],
    prefer_keys: set[str],
    victim_steam: dict[str, str],
    idx: dict,
) -> dict:
    victim_raw = rd["victim"]
    vk = resolve_player_key(victim_raw, aliases, known_keys, prefer_keys)
    victim = strip_tag(victim_raw)
    for snick in steam_to_nick.values():
        if canon_key(snick, aliases) == vk:
            victim = strip_tag(snick)
            break
    steam = rd["steam"]
    killer = steam_to_nick.get(steam) or idx["steam_to_nick"].get(
        steam, f"?{steam[-6:]}"
    )
    kk = canon_key(killer, aliases)
    at = rd["at"]
    return {
        "at": at,
        "at_iso": at.isoformat(),
        "at_msk": (at + timedelta(hours=3)).strftime("%H:%M:%S"),
        "killer": strip_tag(killer),
        "killerKey": kk,
        "victim": victim,
        "victimKey": vk,
        "steam": steam,
        "dmg": float(rd.get("dmg") or 0),
    }


def dies_in_window(
    idx: dict,
    t0: datetime,
    t1: datetime,
    steam_to_nick: dict[str, str],
    aliases: dict[str, str],
) -> tuple[list[dict], list[dict]]:
    """Return (give-up kills for RP, fallback noks = Die without Inactive).

    Real knockdowns come from wounds_in_window() (Wound). Die-without-Inactive
    is only a rare fallback when Wound was missing from the log.
    """
    out: list[dict] = []
    noks: list[dict] = []
    inactive_by_nick = idx["inactive_by_nick"]
    inactive_by_steam = idx["inactive_by_steam"]
    victim_steam = idx["victim_steam"]
    known_keys = set(inactive_by_nick) | set(victim_steam)
    prefer_keys: set[str] = set()
    for nick in list(steam_to_nick.values()) + list(idx.get("steam_to_nick", {}).values()):
        ck = canon_key(nick, aliases)
        known_keys.add(ck)
        prefer_keys.add(ck)

    for rd in idx["raw_dies"]:
        at = rd["at"]
        if not (t0 <= at < t1):
            continue
        row = _resolve_combat_row(
            rd,
            steam_to_nick=steam_to_nick,
            aliases=aliases,
            known_keys=known_keys,
            prefer_keys=prefer_keys,
            victim_steam=victim_steam,
            idx=idx,
        )
        vk = row["victimKey"]
        vsteam = victim_steam.get(vk, "")
        times = inactive_by_nick.get(vk) or []
        if vsteam and inactive_by_steam.get(vsteam):
            times = inactive_by_steam[vsteam]
        pub = {
            "kind": "die",
            "at": row["at_iso"],
            "at_dt": row["at"],
            "at_msk": row["at_msk"],
            "killer": row["killer"],
            "killerKey": row["killerKey"],
            "victim": row["victim"],
            "victimKey": row["victimKey"],
            "steam": row["steam"],
            "dmg": row["dmg"],
        }
        if not _has_inactive_soon(times, at):
            pub["kind"] = "nok"
            noks.append(pub)
            continue
        out.append(pub)
    return out, noks


def wounds_in_window(
    idx: dict,
    t0: datetime,
    t1: datetime,
    steam_to_nick: dict[str, str],
    aliases: dict[str, str],
) -> list[dict]:
    """Real knockdowns from Wound() — includes downs that later give up."""
    out: list[dict] = []
    victim_steam = idx["victim_steam"]
    known_keys = set(idx["inactive_by_nick"]) | set(victim_steam)
    prefer_keys: set[str] = set()
    for nick in list(steam_to_nick.values()) + list(idx.get("steam_to_nick", {}).values()):
        ck = canon_key(nick, aliases)
        known_keys.add(ck)
        prefer_keys.add(ck)

    for rd in idx.get("raw_wounds") or []:
        at = rd["at"]
        if not (t0 <= at < t1):
            continue
        row = _resolve_combat_row(
            rd,
            steam_to_nick=steam_to_nick,
            aliases=aliases,
            known_keys=known_keys,
            prefer_keys=prefer_keys,
            victim_steam=victim_steam,
            idx=idx,
        )
        out.append(
            {
                "kind": "nok",
                "at": row["at_iso"],
                "at_dt": row["at"],
                "at_msk": row["at_msk"],
                "killer": row["killer"],
                "killerKey": row["killerKey"],
                "victim": row["victim"],
                "victimKey": row["victimKey"],
                "steam": row["steam"],
                "dmg": row["dmg"],
                "source": "wound",
            }
        )
    return out


def revives_in_window(idx: dict, t0: datetime, t1: datetime) -> list[dict]:
    return [r for r in idx["revives"] if t0 <= r["at"] < t1]


def _faction_initials(faction: str) -> str:
    parts = [w for w in re.split(r"[\s\-]+", faction.strip()) if w]
    return "".join(w[0] for w in parts if w[0].isalpha()).upper()


def teams_in_window(
    idx: dict,
    t0: datetime,
    t1: datetime,
    faction_to_team: dict[str, str],
) -> dict[str, str]:
    """nick_key → '1'|'2' via create-squad faction + DeployRole prefix initials."""
    nick_team: dict[str, str] = {}
    nick_prefix: dict[str, str] = {}
    faction_norm = {
        re.sub(r"\s+", " ", k.strip().lower()): v for k, v in faction_to_team.items()
    }
    # USMC ← United States Marine Corps, ADF ← Australian Defence Force, …
    prefix_team: dict[str, str] = {}
    for faction, team in faction_to_team.items():
        initials = _faction_initials(faction)
        if initials:
            prefix_team[initials] = team
        # also last acronym-like token (e.g. USMC if ever present)
        for w in re.split(r"[\s\-]+", faction):
            if len(w) >= 2 and w.isupper():
                prefix_team[w.upper()] = team

    def faction_team(faction: str) -> str | None:
        f = re.sub(r"\s+", " ", (faction or "").strip().lower())
        if f in faction_norm:
            return faction_norm[f]
        for fk, tv in faction_norm.items():
            if fk in f or f in fk:
                return tv
        return None

    for at, kk, faction in idx["squads"]:
        if at < t0 - timedelta(minutes=5) or at >= t1:
            continue
        team = faction_team(faction)
        if team:
            nick_team[kk] = team

    for at, kk, pref in idx["deploys"]:
        if at < t0 - timedelta(minutes=5) or at >= t1:
            continue
        nick_prefix[kk] = pref
        # DeployRole is the strongest signal for combatants
        if pref in prefix_team:
            nick_team[kk] = prefix_team[pref]

    # fill remaining from last known prefix even if initials missed
    for kk, pref in nick_prefix.items():
        if kk not in nick_team and pref in prefix_team:
            nick_team[kk] = prefix_team[pref]

    return {k: v for k, v in nick_team.items() if v in ("1", "2")}


def parse_dies(
    log_path: Path,
    t0: datetime,
    t1: datetime,
    steam_to_nick: dict[str, str],
    aliases: dict[str, str],
) -> tuple[list[dict], int]:
    idx = index_log_combat(log_path, aliases)
    steam_to_nick.update(idx["steam_to_nick"])
    return dies_in_window(idx, t0, t1, steam_to_nick, aliases)


def parse_revives(log_path: Path, t0: datetime, t1: datetime) -> list[dict]:
    idx = index_log_combat(log_path, {})
    return revives_in_window(idx, t0, t1)


def parse_teams_from_log(
    log_path: Path,
    t0: datetime,
    t1: datetime,
    aliases: dict[str, str],
    faction_to_team: dict[str, str],
) -> dict[str, str]:
    idx = index_log_combat(log_path, aliases)
    return teams_in_window(idx, t0, t1, faction_to_team)

def discover_matches(log_paths: list[Path]) -> list[dict]:
    """Completed non-SEED matches: InProgress → WaitingPostMatch (+ winner)."""
    # (dt, kind, payload, path)
    events: list[tuple[datetime, str, dict, Path]] = []
    for path in log_paths:
        if not path.is_file():
            continue
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                tm = LINE_TS.match(line)
                if not tm:
                    continue
                at = parse_ts(tm.group("ts"))
                tr = TRAVEL_RE.search(line)
                if tr:
                    events.append(
                        (
                            at,
                            "travel",
                            {"layer": layer_basename(tr.group("path"))},
                            path,
                        )
                    )
                    continue
                st = STATE_RE.search(line)
                if st:
                    events.append(
                        (at, "state", {"state": st.group("state")}, path)
                    )
                    continue
                if "has won the match" in line or "has lost the match" in line:
                    mm = MATCH_RESULT_RE.search(line)
                    if mm:
                        events.append(
                            (
                                at,
                                "result",
                                {
                                    "team": mm.group("team"),
                                    "faction": (mm.group("side") or mm.group("faction") or "").strip(),
                                    "factionFull": (mm.group("faction") or "").strip(),
                                    "side": (mm.group("side") or "").strip(),
                                    "outcome": mm.group("outcome").lower(),
                                    "tickets": int(mm.group("tickets")),
                                    "layer": (mm.group("layer") or "").strip(),
                                    "level": (mm.group("level") or "").strip(),
                                },
                                path,
                            )
                        )

    # state before result so WaitingPostMatch is seen before won/lost at same ms
    kind_order = {"travel": 0, "state": 1, "result": 2}
    events.sort(key=lambda x: (x[0], kind_order.get(x[1], 9)))
    layer = ""
    t_start: datetime | None = None
    start_path: Path | None = None
    pending_end: tuple[datetime, Path] | None = None
    pending_results: list[dict] = []
    matches: list[dict] = []

    def flush_end() -> None:
        nonlocal t_start, start_path, pending_end, pending_results, layer
        if t_start is None or pending_end is None:
            return
        t_end, end_path = pending_end
        dur = (t_end - t_start).total_seconds()
        layer_name = layer
        level_name = ""
        winner_team = None
        faction_to_team: dict[str, str] = {}
        score: dict[str, int] = {}
        for r in pending_results:
            if r.get("layer"):
                layer_name = r["layer"]
            if r.get("level"):
                level_name = r["level"]
            side = (r.get("side") or "").strip()
            if side:
                faction_to_team[side] = r["team"]
            score[r["team"]] = r.get("tickets", 0)
            if r.get("outcome") == "won":
                winner_team = r["team"]
        pending_results = []
        pending_end = None
        start_dt = t_start
        t_start = None
        sp = start_path
        start_path = None
        if dur < MIN_MATCH_SEC:
            return
        if is_seed_layer(layer_name, level_name):
            return
        msk = start_dt + timedelta(hours=3)
        mid = msk.strftime("%Y%m%d-%H%M")
        map_slug = re.sub(
            r"[^a-z0-9]+", "-", (level_name or layer_name).lower()
        ).strip("-")
        match_id = f"{mid}-{map_slug}"[:80]
        log_path = sp or end_path
        matches.append(
            {
                "id": match_id,
                "map": layer_name or level_name or "unknown",
                "level": level_name,
                "date": msk.strftime("%Y-%m-%d"),
                "start": start_dt,
                "end": t_end,
                "log": log_path.name,
                "logPath": log_path,
                "winnerTeam": winner_team,
                "factionToTeam": faction_to_team,
                "score1": score.get("1"),
                "score2": score.get("2"),
            }
        )

    for at, kind, payload, path in events:
        if kind == "travel":
            if pending_end is not None:
                flush_end()
            layer = payload["layer"]
            continue
        if kind == "state":
            stt = payload["state"]
            if stt == "InProgress":
                if pending_end is not None:
                    flush_end()
                t_start = at
                start_path = path
                pending_results = []
                pending_end = None
            elif stt == "WaitingPostMatch" and t_start is not None:
                pending_end = (at, path)
            elif stt == "LeavingMap" and t_start is not None:
                if pending_end is None:
                    pending_end = (at, path)
                flush_end()
            continue
        if kind == "result":
            pending_results.append(payload)
            # Need both teams (won+lost) so faction→team map is complete for TK/win%.
            teams_seen = {r.get("team") for r in pending_results if r.get("team")}
            if (
                pending_end is not None
                and any(r.get("outcome") == "won" for r in pending_results)
                and teams_seen >= {"1", "2"}
            ):
                flush_end()
            continue

    if pending_end is not None:
        flush_end()

    seen: set[str] = set()
    out: list[dict] = []
    for m in sorted(matches, key=lambda x: x["start"]):
        # de-dupe identical windows across overlapping log copies
        key = f"{m['start'].strftime('%Y%m%d%H%M')}|{(m.get('level') or m['map']).lower()}"
        if m["id"] in seen or key in seen:
            continue
        seen.add(m["id"])
        seen.add(key)
        out.append(m)
    return out
