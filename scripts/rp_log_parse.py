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
MIN_RP = 1.0  # ниже 1 опуститься нельзя (канон капитана 05.10.2026)
REVIVE_COEF = 0.6  # legacy (pre cutover)
STEP = 150
# Ceiling before Predator: Iron…Radiant (30) + Eclipse I–III (3) = 33×150 → 4950.
# JSON field still named radiant3Max (legacy) — means «max RP before Predator».
RADIANT3_MAX = 4950
ECLIPSE3_MAX = RADIANT3_MAX
NAMED_RANK_LEVELS = 33  # 11 ranks × 3 romans
MIN_MATCH_SEC = 8 * 60

# New unified RP formula (TR1 = PB1) — only matches on/after this date (YYYY-MM-DD).
RP_FORMULA_CUTOVER = "2026-10-05"
COEF_ENEMY_NOK = 0.1
COEF_ENEMY_KILL = 1.0
COEF_REVIVE = 0.7
COEF_REVIVE_OWN_NOK = 0.2
COEF_TK_NOK = 0.5
COEF_TK_KILL_EXTRA = 0.6
COEF_OWN_DEATH = 1.1
COEF_BEING_NOKKED = 0.1

# Soft-cap on RP *gains* from Immortal+ (losses always ×1).
# Canon night: from 17.10.2026 01:00 MSK (match id YYYYMMDD-HHMM…).
RP_GAIN_SOFT_CUTOVER = "2026-10-17"
# Immortal 0.9 → Master 0.8 → Radiant I/II 0.7 → Radiant III 0.6 → Eclipse 0.55 → Predator 0.5
GAIN_COEF_IMMORTAL = 0.9
GAIN_COEF_MASTER = 0.8
GAIN_COEF_RADIANT = 0.7
GAIN_COEF_RADIANT3 = 0.6
GAIN_COEF_ECLIPSE = 0.55
GAIN_COEF_PREDATOR = 0.5

# Vehicle RP (canon 17.10.2026) — tickets×12.5; F2 100% / driver 70%; finisher-only kill.
# Same night cutover as soft-cap (01:00 MSK).
# Light tier: logi = 5 (=62.5 RP); unarmed transport = 2 (=25 RP).
# Rate cut 17.10 night: was ×25 → ×12.5 (half) — less farm.
RP_VEHICLE_CUTOVER = RP_GAIN_SOFT_CUTOVER
# Match-id / wall-clock gate: 2026-10-17 01:00:00 Europe/Moscow
MSK = timezone(timedelta(hours=3))
RP_NIGHT_CUTOVER_MSK = datetime(2026, 10, 17, 1, 0, 0, tzinfo=MSK)
_MATCH_ID_START_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})")
VEHICLE_RP_PER_TICKET = 12.5
VEHICLE_DRIVER_SHARE = 0.7
_VEH_TANK_RE = re.compile(
    r"(T72|T62|T80|T90|M1A|LEOPARD|M60|CHALLENGER|MERKAVA|T14|ZTZ|TYPE99|TYPE96)",
    re.I,
)
_VEH_IFV_RE = re.compile(
    r"(BTR|BMP|BFV|FV510|AAVP|WARRIOR|ZBD|ZBL|BMD|MTL|PIRANHA|STRYKER|"
    r"LAV25|BOXER|ZTD|BRDM)",
    re.I,
)
# Mobile hub — confirm Asset Name with captain if a new BP appears.
_VEH_HUB_RE = re.compile(
    r"WPMC.*(HUB|MCT|HQ|RADIO.?BIKE|MOBILE|COMMAND)",
    re.I,
)
_VEH_LOGI_RE = re.compile(r"LOGI", re.I)
# Softskin / troop movers without a dedicated gunner weapon — 2 tickets (=50 RP).
_VEH_TRANSPORT_RE = re.compile(
    r"(TRANSPORT|UTIL|URAL|KAMAZ|M939|CTM131|GAZ66|GAZ_66|"
    r"MINSK|BIKE|MOTORCYCLE|QUAD|BICYCLE|BOAT|RHIB|ZODIAC|"
    r"CH146|RAVEN|UH60|UH_60|MI8|MI_8|LOACH|SAFEZONE)",
    re.I,
)
# Armed light (stay 5 tickets = 125) — has shooter / weapon in Asset Name.
_VEH_ARMED_LIGHT_RE = re.compile(
    r"(TOW|KORNET|M134|ZU23|QJZ|NSV|KORD|DSHK|SPG9|SPG_9|"
    r"CAS|CROWS|RWS|ARMED|OPEN.?TOP|MINIGUN|ROCKET|M2HB|PKT|KPVT|"
    r"OBLITERATE|DSHKM|HMG|GMG)",
    re.I,
)
_VEH_SKIP_RE = re.compile(
    r"(EMPLACED|DEPLOYABLE|TRIPOD|SANDBAG|FOB|HAB|RALLY|MINE|RAZOR)",
    re.I,
)
ENTERED_VEH_RE = re.compile(
    r"OnPossess\(\):\s*PC=(?P<nick>.+?)\s*\(Online IDs:.*?steam:\s*(?P<steam>7656\d+)\).*?"
    r"Entered Vehicle\s+Pawn=(?P<pawn>\S+)\s+\(Asset Name\s*=\s*(?P<asset>[^)]+)\)\s+"
    r"FullPath=(?P<fullpath>.+?)\s+Seat Number=(?P<seat>\d+)",
    re.I,
)
EXITED_VEH_RE = re.compile(
    r"OnUnPossess\(\):\s*PC=(?P<nick>.+?)\s*\(Online IDs:.*?steam:\s*(?P<steam>7656\d+)\).*?"
    r"Exited Vehicle\s+Pawn=\S+\s+\(Asset Name\s*=\s*(?P<asset>[^)]+)\)\s+"
    r"FullPath=(?P<fullpath>.+?)\s+Seat Number=(?P<seat>\d+)",
    re.I,
)
VEH_DMG_RE = re.compile(
    r"(?P<vid>BP_[A-Za-z0-9_]+_C_\d+):\s*(?P<dmg>[\d.]+)\s+damage taken by causer\s+"
    r"(?P<causer>\S+)\s+instigator\s+(?:\(Online Ids:\s*(?P<nick>[^)]+)\)|"
    r"(?P<nick2>[^\s(]+))\s+"
    r"(?:EOS:\s*[0-9a-fA-F]+\s+steam:\s*(?P<steam>7656\d+)\s+)?"
    r"(?:INVALID\s+)?"
    r"health remaining\s+(?P<health>[-\d.]+)",
    re.I,
)
# Squad writes the killing blow on an occupied hull as "DriverNick: 1400 … health remaining -800"
# instead of "BP_AAVP…:". Same HP pool as the previous BP_ line (600 − 1400 = −800).
VEH_OCC_DMG_RE = re.compile(
    r"TraceAndMessageClient\(\):\s*(?P<who>.+?):\s*(?P<dmg>[\d.]+)\s+damage taken by causer\s+"
    r"(?P<causer>\S+)\s+instigator\s+\(Online Ids:\s*(?P<nick>[^)]+)\)\s+"
    r"EOS:\s*[0-9a-fA-F]+\s+steam:\s*(?P<steam>7656\d+)\s+"
    r"(?:INVALID\s+)?health remaining\s+(?P<health>[-\d.]+)",
    re.I,
)
VEH_BURN_RE = re.compile(
    r"SQVehicleSeat::TakeDamage\[GenericDamage\]\s+(?P<vid>BP_[A-Za-z0-9_]+_C_\d+)\s+"
    r"for\s+[\d.]+\s+damage\s+\(type=SQBurningDamage\)",
    re.I,
)

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
    ("Eclipse", "eclipse"),
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
    """N — base points for a full kill from rating gap (≈1–50)."""
    pk = min(max(float(pk), 1.0), pmax)
    pv = min(max(float(pv), 1.0), pmax)
    if pmax <= 1:
        return 25.5
    return 1 + 49 * (pv - pk + pmax - 1) / (2 * (pmax - 1))


def use_new_rp_formula(match_date: str) -> bool:
    return str(match_date or "")[:10] >= RP_FORMULA_CUTOVER


def match_at_or_after_night_cutover(
    match_id: str = "",
    match_date: str = "",
    at: datetime | None = None,
) -> bool:
    """True if match/event is on/after 2026-10-17 01:00 MSK (vehicle + soft-cap night)."""
    if at is not None:
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        return at.astimezone(MSK) >= RP_NIGHT_CUTOVER_MSK
    mid = str(match_id or "").strip()
    m = _MATCH_ID_START_RE.match(mid)
    if m:
        y, mo, d, hh, mm = (int(x) for x in m.groups())
        return datetime(y, mo, d, hh, mm, tzinfo=MSK) >= RP_NIGHT_CUTOVER_MSK
    day = str(match_date or "")[:10]
    if not day:
        return False
    if day > RP_GAIN_SOFT_CUTOVER:
        return True
    if day < RP_GAIN_SOFT_CUTOVER:
        return False
    # Same calendar day but no HHMM in id — treat as pre-cutover (safe).
    return False


def use_rp_gain_softcap(match_date: str = "", match_id: str = "") -> bool:
    """Diminishing gains from Immortal+ — from 17.10.2026 01:00 MSK."""
    return match_at_or_after_night_cutover(match_id=match_id, match_date=match_date)


def use_rp_vehicle(match_date: str = "", match_id: str = "") -> bool:
    """Vehicle kill/loss RP — from 17.10.2026 01:00 MSK."""
    return match_at_or_after_night_cutover(match_id=match_id, match_date=match_date)


def _is_unarmed_transport(asset: str) -> bool:
    """
    Non-combat mover without a dedicated gunner (transport / bare util / softskin).
    Logi is handled separately (stays 5 tickets). Armed light stays 5.
    """
    a = str(asset or "")
    if not a or _VEH_LOGI_RE.search(a):
        return False
    if _VEH_ARMED_LIGHT_RE.search(a):
        return False
    if re.search(r"TRANSPORT", a, re.I):
        return True
    if _VEH_TRANSPORT_RE.search(a):
        # Loach CAS already caught by armed; plain Loach = transport heli
        if re.search(r"LOACH", a, re.I) and re.search(r"CAS", a, re.I):
            return False
        return True
    return False


def vehicle_tickets(asset: str) -> int:
    """Ticket cost by Asset Name (not from match ticket log)."""
    a = str(asset or "")
    if _VEH_HUB_RE.search(a):
        return 20
    if _VEH_TANK_RE.search(a):
        return 15
    if _VEH_IFV_RE.search(a):
        return 10
    # Light tier: logi / armed light = 5 (=62.5 RP); unarmed transport = 2 (=25 RP)
    if _VEH_LOGI_RE.search(a):
        return 5
    if _is_unarmed_transport(a):
        return 2
    return 5


def vehicle_base_rp(asset: str) -> float:
    return float(vehicle_tickets(asset) * VEHICLE_RP_PER_TICKET)


def vehicle_short_name(asset: str) -> str:
    """BP_T72S_GFI_C → T72S · BP_Kamaz_5350_Desert_C → Kamaz 5350."""
    a = re.sub(r"^BP_", "", str(asset or ""), flags=re.I)
    a = re.sub(r"_C$", "", a, flags=re.I)
    a = re.sub(
        r"_(Desert|Woodland|WoodLand|Black|Green|Urban|Snow|Forest)$",
        "",
        a,
        flags=re.I,
    )
    a = re.sub(
        r"_(GFI|RUS|USA|USMC|PLA|CAF|BAF|ADF|MEA|INS|IMF|WPMC|TLF|VDV|GB|IRAN)$",
        "",
        a,
        flags=re.I,
    )
    a = a.replace("_", " ").strip()
    return a or "техника"


def vehicle_class_ru(asset: str) -> str:
    a = str(asset or "")
    t = vehicle_tickets(a)
    if t >= 20:
        return "хаб WPMC"
    if t >= 15:
        return "танк"
    if t >= 10:
        return "БТР/БМП"
    if t <= 2:
        return "транспорт"
    if _VEH_LOGI_RE.search(a):
        return "logi"
    return "техника"


def vehicle_label_ru(asset: str) -> str:
    """Human label for detail UI: «танк T72S», «БТР/БМП BTR82A»."""
    short = vehicle_short_name(asset)
    cls = vehicle_class_ru(asset)
    if cls == "хаб WPMC":
        return f"{cls} {short}".strip() if short and short.lower() != "техника" else cls
    return f"{cls} {short}".strip()


def vehicle_seat_role(asset: str, seat: int, pawn: str = "") -> str:
    """
    Who can lose RP on vehicle destroy:
      driver — seat 0 (всегда, в т.ч. грузовик/вертолёт)
      gunner — F2 / башня (танк·БТР·БМП·AAVP·хаб); НЕ пассажир seat 1 на logi
      passenger — десант / кузов / любые seat≥2 — **никогда** не теряют RP за технику
    """
    seat_i = int(seat or 0)
    if seat_i == 0:
        return "driver"
    if seat_i >= 2:
        return "passenger"
    # seat 1
    pawn_u = (pawn or "").upper()
    if any(
        x in pawn_u
        for x in ("PASSENGER", "CARGO", "REAR", "BENCH", "TROOP")
    ):
        return "passenger"
    tickets = vehicle_tickets(asset)
    # Logi / transport / лёгкая техника (≤5 тик.): только водитель — seat 1 = пассажир.
    if tickets <= 5:
        return "passenger"
    if any(
        x in pawn_u
        for x in ("TURRET", "GUNNER", "RWS", "CROWS", "CANNON", "OPEN_TOP")
    ):
        return "gunner"
    # Танк / IFV / AAVP / хаб — seat 1 по умолчанию наводчик.
    return "gunner"


def _veh_instance(text: str) -> str:
    m = re.search(r"(BP_[A-Za-z0-9_]+_C_\d+)", text or "")
    return m.group(1) if m else ""


def _skip_vehicle_asset(asset: str, pawn: str = "") -> bool:
    return bool(_VEH_SKIP_RE.search(f"{asset} {pawn}"))


def _veh_id_num(vid: str) -> int | None:
    try:
        return int(str(vid).rsplit("_", 1)[-1])
    except (TypeError, ValueError):
        return None


# Turret / periscope / seat pawn sits a few ids from its hull.
# A neighbour vehicle in the same spawn wave is further out (~34+).
_HULL_LINK_DIST = 32
_COMPONENT_RE = re.compile(
    r"TURRET|PERISCOPE|SCOPE|PASSENGER|GUNNER|RWS|CROWS",
    re.I,
)


def _is_component_pawn(instance: str) -> bool:
    return bool(_COMPONENT_RE.search(instance or ""))


def _asset_same_vehicle(a: str, b: str) -> bool:
    """Hull and its turret pawn are one vehicle.

    BP_ZBL08_Turret_HJ73C_Naval_C and BP_ZBL08_HJ73C_Naval_C share a hull.
    Different families (BTR vs ZBL) do not.
    """
    if not a or not b or a == b:
        return True
    def _norm(x: str) -> str:
        return re.sub(r"_TURRET", "", x.upper())
    return _norm(a) == _norm(b)


def rp_gain_coef(current_rp: float) -> float:
    """
    Multiplier for positive RP only (kills/noks/revives/vehicle_kill…).
    Losses (death, TK, vehicle_loss…) always stay at 1.0.
    Rank is taken from RP *before* the gain.
    """
    info = rp_rank(float(current_rp))
    if info.get("predator") or info.get("rankKey") == "predator":
        return GAIN_COEF_PREDATOR
    key = str(info.get("rankKey") or "")
    if key == "eclipse":
        return GAIN_COEF_ECLIPSE
    if key == "radiant":
        if str(info.get("roman") or "") == "III":
            return GAIN_COEF_RADIANT3
        return GAIN_COEF_RADIANT
    if key == "master":
        return GAIN_COEF_MASTER
    if key == "immortal":
        return GAIN_COEF_IMMORTAL
    return 1.0


# Same timestamp: leave the old seat before taking the new one, then apply damage.
_KIND_RANK = {
    "v_exit": 0,
    "v_burn": 1,
    "v_dmg": 2,
    "v_dmg_named": 3,
    "v_enter": 4,
    "wound": 5,
    "die": 6,
    "revive": 7,
}


def _event_sort_key(e: dict) -> tuple:
    kind = e.get("kind", "")
    rank = _KIND_RANK.get(kind, 5)
    dt = e.get("at_dt")
    if dt is not None:
        return (0, dt.isoformat(), rank, kind)
    return (1, e.get("at_msk", ""), rank, kind)


def score_match_rp(
    *,
    dies: list[dict],
    wounds: list[dict],
    revives: list[dict],
    teams: dict[str, str],
    rp: dict[str, float],
    disp: dict[str, str],
    aliases: dict[str, str] | None = None,
    new_formula: bool,
    pwr_weights: dict[str, float] | None = None,
    match_date: str | None = None,
    match_id: str | None = None,
    vehicle_ops: list[dict] | None = None,
) -> tuple[list[dict], dict[str, float], int, int, int, int]:
    """
    Apply Die/Wound/Revive (+ vehicle kill/loss after cutover) to running RP.

    new_formula=False: legacy (Wound=0 RP; Die ±N; TK both −N; revive +N*0.6).
      Weight = pwr_weights[k] if given else current RP.
    new_formula=True: canon 05.10.2026 (N×coefs). Weight = current RP always.
    From 17.10.2026 01:00 MSK: soft-cap on gains; vehicle tickets×12.5.

    Returns: events, net, die_n, tk_n, rev_n, nok_rp_n
    """
    aliases = aliases or {}
    mid = str(match_id or "")
    mdate = str(match_date or "")
    soft_gain = use_rp_gain_softcap(mdate, mid)
    do_vehicle = use_rp_vehicle(mdate, mid) and bool(vehicle_ops)
    events: list[dict] = []
    net: dict[str, float] = {}
    die_n = tk_n = rev_n = nok_rp_n = 0
    # canon key → timestamp when their vehicle exploded.
    # Infantry nok and give-up are still scored on top of the vehicle RP.
    exploded_at: dict[str, datetime] = {}
    # victimKey -> killerKey of last enemy/TK wound (for revive own-nok)
    last_wound_by: dict[str, str] = {}
    # Vehicle crew state (hull id → seats / last responsible / finisher)
    hulls: dict[str, dict] = {}
    player_hull: dict[str, str] = {}  # nickKey → hull id
    # Exit can be logged in the same second as the killing blow, a few ms earlier.
    recent_exit: dict[str, tuple[str, int, datetime]] = {}
    player_seat: dict[str, int] = {}
    pawn_to_hull: dict[str, str] = {}

    def ensure(key: str, nick: str) -> str:
        ck = aliases.get(key, key)
        if ck not in disp:
            disp[ck] = nick
        rp.setdefault(ck, START_RP)
        return ck

    def n_base(actor: str, other: str) -> tuple[float, float, float]:
        pmax = max(rp.values()) if rp else START_RP
        pmax = max(pmax, START_RP)
        if pwr_weights is not None and not new_formula:
            pk = float(pwr_weights.get(actor, 250.0))
            pv = float(pwr_weights.get(other, 250.0))
            pmax_w = max(list(pwr_weights.values()) + [START_RP]) if pwr_weights else START_RP
            return hunt_delta(pk, pv, pmax_w), pk, pv
        pk = rp.get(actor, START_RP)
        pv = rp.get(other, START_RP)
        return hunt_delta(pk, pv, pmax), pk, pv

    def apply_delta(key: str, signed: float) -> float:
        """Apply signed delta; soft-cap positive gains. Returns actual applied."""
        cur = rp.get(key, START_RP)
        if soft_gain and signed > 0:
            signed = round(signed * rp_gain_coef(cur), 2)
        nxt = cur + signed
        if nxt < MIN_RP:
            signed = MIN_RP - cur
            nxt = MIN_RP
        rp[key] = nxt
        net[key] = round(net.get(key, 0.0) + signed, 2)
        return signed

    def same_team(a: str, b: str) -> bool:
        return a in teams and b in teams and teams[a] == teams[b]

    def _ensure_hull(hid: str, asset: str) -> dict:
        h = hulls.get(hid)
        if h is None:
            h = {
                "asset": asset,
                "seats": {},  # seat -> nickKey (all occupants tracked)
                "seat_roles": {},  # seat -> driver|gunner|passenger
                "last_crew": {},  # only liable: 0=driver, 1=gunner
                "burn_crew": None,
                "burning": False,
                "dead": False,
                "last_hit": None,  # {killerKey, killer, causer, at_msk}
                "finisher": None,
            }
            hulls[hid] = h
        elif asset and not h.get("asset"):
            h["asset"] = asset
        h.setdefault("seat_roles", {})
        return h

    def _resolve_hull_id(asset: str, instance: str, seat: int) -> str:
        if not instance:
            return ""
        if seat == 0:
            pawn_to_hull[instance] = instance
            return instance
        if instance in pawn_to_hull:
            return pawn_to_hull[instance]
        inst_n = _veh_id_num(instance)
        best, best_d = "", 10**18
        component = _is_component_pawn(instance)
        limit = _HULL_LINK_DIST if component else 500
        for hid, meta in hulls.items():
            if meta.get("dead") or meta.get("absorbed"):
                continue
            # A turret must not latch onto a periscope of the vehicle next to it.
            if _is_component_pawn(hid):
                continue
            meta_asset = str(meta.get("asset") or "")
            if asset and meta_asset and not _asset_same_vehicle(asset, meta_asset):
                continue
            hid_n = _veh_id_num(hid)
            if inst_n is None or hid_n is None:
                continue
            d = abs(hid_n - inst_n)
            if d < best_d and d < limit:
                best_d = d
                best = hid
        if best:
            pawn_to_hull[instance] = best
            return best
        # No hull yet — treat pawn as provisional hull until seat-0 links.
        pawn_to_hull[instance] = instance
        return instance

    def _nearest_body(comp_id: str, asset: str, *, include_dead: bool = True) -> str:
        n_id = _veh_id_num(comp_id)
        if n_id is None:
            return ""
        best, best_d = "", 10**9
        for cand, meta in hulls.items():
            if cand == comp_id or _is_component_pawn(cand) or meta.get("absorbed"):
                continue
            if not include_dead and meta.get("dead"):
                continue
            meta_asset = str(meta.get("asset") or "")
            if asset and meta_asset and not _asset_same_vehicle(asset, meta_asset):
                continue
            cn = _veh_id_num(cand)
            if cn is None:
                continue
            dist = abs(cn - n_id)
            if dist < best_d and dist < _HULL_LINK_DIST and vehicle_tickets(meta_asset or asset) > 5:
                best, best_d = cand, dist
        return best

    def _absorb_nearby_turrets(hid: str, asset: str) -> None:
        """Pull a turret/periscope that was logged before its hull onto that hull."""
        parent = hulls.get(hid)
        n_id = _veh_id_num(hid)
        if not parent or n_id is None or _is_component_pawn(hid):
            return
        for cand, meta in list(hulls.items()):
            if cand == hid or meta.get("dead") or meta.get("absorbed"):
                continue
            if not _is_component_pawn(cand):
                continue
            if not _asset_same_vehicle(asset, str(meta.get("asset") or "")):
                continue
            cn = _veh_id_num(cand)
            if cn is None or abs(cn - n_id) >= _HULL_LINK_DIST:
                continue
            if _nearest_body(cand, asset) not in ("", hid):
                continue
            for seat, pk in list((meta.get("seats") or {}).items()):
                role = (meta.get("seat_roles") or {}).get(seat) or vehicle_seat_role(
                    asset, int(seat), cand
                )
                parent.setdefault("seats", {})[int(seat)] = pk
                parent.setdefault("seat_roles", {})[int(seat)] = role
                player_hull[pk] = hid
                player_seat[pk] = int(seat)
                if role == "driver":
                    parent.setdefault("last_crew", {})[0] = pk
                elif role == "gunner":
                    parent.setdefault("last_crew", {})[1] = pk
            meta["dead"] = True
            meta["absorbed"] = True
            pawn_to_hull[cand] = hid

    def _snapshot_crew(h: dict) -> dict[int, str]:
        """Только водитель + F2. Пассажиры/десант (seat≥2 и seat1 на logi) — вне штрафа."""
        seats = h.get("seats") or {}
        roles = h.get("seat_roles") or {}
        snap: dict[int, str] = {}
        for seat, key in seats.items():
            role = roles.get(seat) or vehicle_seat_role(
                str(h.get("asset") or ""), int(seat), ""
            )
            if role == "driver":
                snap[0] = key
            elif role == "gunner":
                snap[1] = key
        # Same-second exit clears the seat, then the killing blow reseats only
        # the driver whose name is on the HP line. The gunner is still liable.
        for seat, key in (h.get("last_crew") or {}).items():
            if key:
                snap.setdefault(int(seat), key)
        return snap

    def _credit_driver_share(
        gunner_key: str, applied_gain: float, at_msk: str, reason: str
    ) -> None:
        """§5: мехвод +70% от +RP наводчика F2, пока оба в одном экипаже."""
        if applied_gain <= 0:
            return
        hid = player_hull.get(gunner_key)
        if not hid:
            return
        h = hulls.get(hid) or {}
        roles = h.get("seat_roles") or {}
        g_seat = player_seat.get(gunner_key)
        if g_seat is None or roles.get(g_seat) != "gunner":
            return
        # Driver = whoever currently holds driver role on this hull
        driver = None
        for seat, key in (h.get("seats") or {}).items():
            if roles.get(seat) == "driver":
                driver = key
                break
        if not driver:
            driver = (h.get("last_crew") or {}).get(0)
        if not driver or driver == gunner_key:
            return
        driver = ensure(driver, disp.get(driver, driver))
        share = round(abs(applied_gain) * VEHICLE_DRIVER_SHARE, 2)
        if share <= 0:
            return
        gcoef = rp_gain_coef(rp.get(driver, START_RP)) if soft_gain else 1.0
        applied = apply_delta(driver, +share)
        asset = h.get("asset") or ""
        vlab = vehicle_label_ru(asset) if asset else "техника"
        gun_nick = disp.get(gunner_key, gunner_key)
        reason_ru = {"nok": "нок", "die": "килл", "vehicle_kill": "технику"}.get(
            reason, reason
        )
        events.append(
            {
                "kind": "driver_share",
                "time": at_msk,
                "killer": disp[driver],
                "victim": gun_nick,
                "delta": round(abs(applied), 2),
                "gainCoef": gcoef,
                "vehicle": asset,
                "tickets": vehicle_tickets(asset) if asset else None,
                "reason": reason,
                "label": f"мехвод 70% · {reason_ru} F2 ({gun_nick}) · {vlab}",
                "formula": "v2",
            }
        )

    def _destroy_vehicle(hid: str, at_msk: str, dmg_row: dict | None = None) -> None:
        h = hulls.get(hid)
        if not h or h.get("dead") or h.get("absorbed"):
            return
        # Turret and periscope are not a second vehicle. Score the hull, once.
        if _is_component_pawn(hid):
            body = _nearest_body(hid, str(h.get("asset") or ""))
            if body and body != hid:
                bh = hulls.get(body)
                if not bh or bh.get("dead"):
                    return
                hid = body
                h = bh
        h["dead"] = True
        boom_at = (dmg_row or {}).get("at_dt")
        if boom_at is not None:
            liable = set((h.get("seats") or {}).values())
            liable.update((h.get("burn_crew") or {}).values())
            liable.update((h.get("last_crew") or {}).values())
            for pk in liable:
                if pk:
                    exploded_at[pk] = boom_at
        asset = h.get("asset") or ""
        if dmg_row and not asset:
            # Infer asset from vid prefix: BP_T62_C_123 → BP_T62_C
            vid = dmg_row.get("vid") or hid
            asset = re.sub(r"_\d+$", "", vid)
            h["asset"] = asset
        base = vehicle_base_rp(asset)
        tickets = vehicle_tickets(asset)
        vlab = vehicle_label_ru(asset)
        crew = h.get("burn_crew") or _snapshot_crew(h)
        # Canon: только F2 (gunner) + мехвод. Пассажиры грузовика/вертолёта — 0 штрафа.
        f2 = crew.get(1)
        driver = crew.get(0)
        # Losses — always ×1 (no soft-cap). Never seats≥2 / transport passengers.
        if f2:
            f2 = ensure(f2, disp.get(f2, f2))
            apply_delta(f2, -base)
            events.append(
                {
                    "kind": "vehicle_loss",
                    "time": at_msk,
                    "killer": asset or hid,
                    "victim": disp[f2],
                    "delta": round(base, 2),
                    "tickets": tickets,
                    "vehicle": asset,
                    "seat": 1,
                    "label": f"потеря {vlab} (F2, {tickets} тик.)",
                    "formula": "v2",
                }
            )
        if driver and driver != f2:
            driver = ensure(driver, disp.get(driver, driver))
            dpen = round(base * VEHICLE_DRIVER_SHARE, 2)
            apply_delta(driver, -dpen)
            events.append(
                {
                    "kind": "vehicle_loss_driver",
                    "time": at_msk,
                    "killer": asset or hid,
                    "victim": disp[driver],
                    "delta": dpen,
                    "tickets": tickets,
                    "vehicle": asset,
                    "seat": 0,
                    "label": f"потеря {vlab} (мехвод 70%, {tickets} тик.)",
                    "formula": "v2",
                }
            )
        # Finisher kill credit
        fin = h.get("finisher") or h.get("last_hit")
        if dmg_row and not dmg_row.get("burning") and dmg_row.get("killerKey"):
            fin = {
                "killerKey": dmg_row["killerKey"],
                "killer": dmg_row.get("killer") or "",
                "causer": dmg_row.get("causer") or "",
            }
        kk = (fin or {}).get("killerKey") or ""
        if not kk or str(kk).startswith("?"):
            return
        # Friendly fire / own crew: no +RP
        crew_keys = {c for c in (f2, driver) if c}
        if kk in crew_keys:
            return
        if any(same_team(kk, c) for c in crew_keys):
            return
        kk = ensure(kk, (fin or {}).get("killer") or kk)
        gcoef = rp_gain_coef(rp.get(kk, START_RP)) if soft_gain else 1.0
        applied = apply_delta(kk, +base)
        events.append(
            {
                "kind": "vehicle_kill",
                "time": at_msk,
                "killer": disp[kk],
                "victim": asset or hid,
                "delta": round(abs(applied), 2),
                "tickets": tickets,
                "vehicle": asset,
                "weapon": (fin or {}).get("causer") or "",
                "gainCoef": gcoef,
                "label": f"уничтожил {vlab} ({tickets} тик.)",
                "formula": "v2",
            }
        )
        _credit_driver_share(kk, applied, at_msk, "vehicle_kill")

    def _handle_vehicle_op(d: dict) -> None:
        kind = d["kind"]
        at_msk = d.get("at_msk") or ""
        if kind == "v_enter":
            key = d.get("nickKey") or ""
            if not key or key.startswith("?"):
                return
            key = ensure(key, d.get("nick") or key)
            seat = int(d.get("seat") or 0)
            asset = d.get("asset") or ""
            inst = d.get("instance") or ""
            hid = _resolve_hull_id(asset, inst, seat)
            if not hid:
                return
            h = _ensure_hull(hid, asset)
            if h.get("dead"):
                return
            # Leave previous seat
            old = player_hull.get(key)
            if old and old in hulls:
                seats = hulls[old]["seats"]
                roles_old = hulls[old].setdefault("seat_roles", {})
                for s, pk in list(seats.items()):
                    if pk == key:
                        del seats[s]
                        roles_old.pop(s, None)
            role = vehicle_seat_role(asset, seat, d.get("pawn") or d.get("instance") or "")
            h["seats"][seat] = key
            h.setdefault("seat_roles", {})[seat] = role
            player_hull[key] = hid
            player_seat[key] = seat
            # last_crew — только ответственные (не десант)
            if role == "driver":
                h["last_crew"][0] = key
            elif role == "gunner":
                h["last_crew"][1] = key
            if not _is_component_pawn(hid):
                _absorb_nearby_turrets(hid, asset or str(h.get("asset") or ""))
            return

        if kind == "v_exit":
            key = d.get("nickKey") or ""
            if not key:
                return
            key = aliases.get(key, key)
            seat = int(d.get("seat") or 0)
            hid = player_hull.get(key)
            if not hid:
                # Try resolve via fullpath instance
                inst = _veh_instance(d.get("fullpath") or "") or d.get("instance") or ""
                hid = pawn_to_hull.get(inst) or inst
            if hid and hid in hulls:
                h = hulls[hid]
                seats = h["seats"]
                roles = h.setdefault("seat_roles", {})

                def _freeze_liable(s: int, pk: str) -> None:
                    role = roles.get(s) or vehicle_seat_role(
                        str(h.get("asset") or ""), s, ""
                    )
                    if role == "driver":
                        h["last_crew"][0] = pk
                    elif role == "gunner":
                        h["last_crew"][1] = pk

                if seats.get(seat) == key:
                    _freeze_liable(seat, key)
                    del seats[seat]
                    roles.pop(seat, None)
                else:
                    for s, pk in list(seats.items()):
                        if pk == key:
                            _freeze_liable(s, pk)
                            del seats[s]
                            roles.pop(s, None)
            if hid:
                recent_exit[key] = (hid, int(seat or 0), d.get("at_dt"))
            player_hull.pop(key, None)
            player_seat.pop(key, None)
            return

        if kind == "v_burn":
            vid = d.get("vid") or ""
            hid = pawn_to_hull.get(vid) or vid
            if hid not in hulls:
                # Damage may arrive before any Enter in window — still track.
                _ensure_hull(hid, re.sub(r"_\d+$", "", vid))
            h = hulls[hid]
            if h.get("dead"):
                return
            if not h.get("burning"):
                h["burning"] = True
                h["burn_crew"] = _snapshot_crew(h)
                if h.get("last_hit"):
                    h["finisher"] = dict(h["last_hit"])
            return

        if kind == "v_dmg":
            vid = d.get("vid") or ""
            hid = pawn_to_hull.get(vid) or vid
            if hid not in hulls:
                _ensure_hull(hid, re.sub(r"_\d+$", "", vid))
                pawn_to_hull[vid] = hid
            h = hulls[hid]
            if h.get("dead"):
                return
            burning = bool(d.get("burning"))
            kk = d.get("killerKey") or ""
            if kk and not str(kk).startswith("?") and not burning:
                hit = {
                    "killerKey": aliases.get(kk, kk),
                    "killer": d.get("killer") or "",
                    "causer": d.get("causer") or "",
                    "at_msk": at_msk,
                }
                h["last_hit"] = hit
                if not h.get("burning"):
                    h["finisher"] = hit
            if burning and not h.get("burning"):
                h["burning"] = True
                h["burn_crew"] = _snapshot_crew(h)
                if h.get("last_hit"):
                    h["finisher"] = dict(h["last_hit"])
            try:
                health = float(d.get("health"))
            except (TypeError, ValueError):
                health = 1.0
            h["health"] = health
            if health <= 0:
                _destroy_vehicle(hid, at_msk, d)
            return

        if kind == "v_dmg_named":
            # Occupied hull: log names the driver, HP continues the BP_ pool.
            key = d.get("whoKey") or ""
            if not key or str(key).startswith("?"):
                return
            key = aliases.get(key, key)
            hid = player_hull.get(key) or ""
            ghost: tuple | None = None
            if not hid:
                rec = recent_exit.get(key)
                at_dt = d.get("at_dt")
                if rec and at_dt is not None and rec[2] is not None:
                    rhid, rseat, rat = rec
                    if 0 <= (at_dt - rat).total_seconds() <= 2:
                        h0 = hulls.get(rhid)
                        if h0 and not h0.get("dead"):
                            role = vehicle_seat_role(
                                str(h0.get("asset") or ""), rseat, ""
                            )
                            h0.setdefault("seats", {})[rseat] = key
                            h0.setdefault("seat_roles", {})[rseat] = role
                            if role == "driver":
                                h0["last_crew"][0] = key
                            elif role == "gunner":
                                h0["last_crew"][1] = key
                            hid = rhid
                            ghost = (h0, rseat)
            h = hulls.get(hid) if hid else None

            def _drop_ghost() -> None:
                if not ghost:
                    return
                gh, gs = ghost
                if gh.get("seats", {}).get(gs) == key:
                    gh["seats"].pop(gs, None)
                    gh.get("seat_roles", {}).pop(gs, None)

            if not h or h.get("dead"):
                return
            try:
                health = float(d.get("health"))
                dmg = float(d.get("dmg") or 0)
            except (TypeError, ValueError):
                _drop_ghost()
                return
            # who ∈ hull ⇒ TraceAndMessageClient HP *is* the vehicle pool.
            # Continuity can break on unparsed INVALID/self ticks — still trust
            # absolute health from the log (re-seed) instead of dropping the kill.
            last = h.get("health")
            if last is not None and abs((float(last) - dmg) - health) > 2.0:
                # re-seed; do not return
                pass
            dmg_as_hull = {
                **d,
                "kind": "v_dmg",
                "vid": hid,
                "health": health,
                "burning": False,
            }
            _handle_vehicle_op(dmg_as_hull)
            _drop_ghost()
            return

    if not new_formula:
        # --- legacy path (matches before cutover) ---
        for d in dies:
            kk, vk = d.get("killerKey"), d.get("victimKey")
            if not kk or not vk or kk == vk or str(kk).startswith("?"):
                continue
            kk = ensure(kk, d.get("killer") or kk)
            vk = ensure(vk, d.get("victim") or vk)
            n, pk, pv = n_base(kk, vk)
            delta = round(n, 2)
            if same_team(kk, vk):
                apply_delta(kk, -delta)
                apply_delta(vk, -delta)
                events.append(
                    {
                        "kind": "tk",
                        "time": d.get("at_msk"),
                        "killer": disp[kk],
                        "victim": disp[vk],
                        "killerPwr": round(pk, 1),
                        "victimPwr": round(pv, 1),
                        "delta": delta,
                        "teamkill": True,
                        "formula": "legacy",
                    }
                )
                tk_n += 1
            else:
                apply_delta(kk, +delta)
                apply_delta(vk, -delta)
                events.append(
                    {
                        "kind": "die",
                        "time": d.get("at_msk"),
                        "killer": disp[kk],
                        "victim": disp[vk],
                        "killerPwr": round(pk, 1),
                        "victimPwr": round(pv, 1),
                        "delta": delta,
                        "teamkill": False,
                        "formula": "legacy",
                    }
                )
                die_n += 1
        for d in revives:
            kk = canon_key(d.get("killer") or "", aliases)
            vk = canon_key(d.get("victim") or "", aliases)
            if not kk or not vk or kk == vk or kk.startswith("?"):
                continue
            kk = ensure(kk, d.get("killer") or kk)
            vk = ensure(vk, d.get("victim") or vk)
            n, pk, pv = n_base(kk, vk)
            delta = round(n * REVIVE_COEF, 2)
            apply_delta(kk, +delta)
            net.setdefault(vk, 0.0)
            events.append(
                {
                    "kind": "revive",
                    "time": d.get("at_msk"),
                    "killer": disp[kk],
                    "victim": disp[vk],
                    "killerPwr": round(pk, 1),
                    "victimPwr": round(pv, 1),
                    "delta": delta,
                    "formula": "legacy",
                }
            )
            rev_n += 1
        for d in wounds:
            events.append(
                {
                    "kind": "nok",
                    "time": d.get("at_msk"),
                    "killer": d.get("killer"),
                    "victim": d.get("victim"),
                    "delta": 0,
                    "teamkill": same_team(
                        aliases.get(d.get("killerKey") or "", d.get("killerKey") or ""),
                        aliases.get(d.get("victimKey") or "", d.get("victimKey") or ""),
                    ),
                    "formula": "legacy",
                }
            )
        events.sort(key=lambda e: e.get("time") or "")
        return events, net, die_n, tk_n, rev_n, 0

    # --- new formula (cutover+) — chronological ---
    # Нок или смерть сами по себе технику не списывают: корпус умер, только
    # если ХП дошло до нуля. Если дошло — в счёт идёт и техника, и пехотная
    # жизнь экипажа (нок + give up). Горение без нуля и смерть мехвода снаружи
    # живого корпуса технику не списывают.
    timeline: list[dict] = []
    for d in wounds:
        timeline.append({**d, "kind": "wound"})
    for d in dies:
        timeline.append({**d, "kind": "die"})
    for d in revives:
        at_dt = d.get("at_dt") or d.get("at")
        at_msk = d.get("at_msk")
        if not at_msk and at_dt is not None:
            try:
                at_msk = (at_dt + timedelta(hours=3)).strftime("%H:%M:%S")
            except Exception:
                at_msk = ""
        timeline.append(
            {
                "kind": "revive",
                "killer": d.get("killer"),
                "victim": d.get("victim"),
                "killerKey": canon_key(d.get("killer") or "", aliases),
                "victimKey": canon_key(d.get("victim") or "", aliases),
                "at_msk": at_msk,
                "at_dt": at_dt,
            }
        )
    if do_vehicle:
        for d in vehicle_ops or []:
            timeline.append(d)
    timeline.sort(key=_event_sort_key)

    for d in timeline:
        kind = d["kind"]
        if kind in ("v_enter", "v_exit", "v_burn", "v_dmg", "v_dmg_named"):
            if do_vehicle:
                _handle_vehicle_op(d)
            continue

        kk, vk = d.get("killerKey"), d.get("victimKey")
        if not kk or not vk or kk == vk or str(kk).startswith("?"):
            continue
        kk = ensure(kk, d.get("killer") or kk)
        vk = ensure(vk, d.get("victim") or vk)
        n, pk, pv = n_base(kk, vk)
        tk = same_team(kk, vk)

        if kind == "wound":
            last_wound_by[vk] = kk
            if tk:
                delta_k = round(n * COEF_TK_NOK, 2)
                apply_delta(kk, -delta_k)
                events.append(
                    {
                        "kind": "nok",
                        "time": d.get("at_msk"),
                        "killer": disp[kk],
                        "victim": disp[vk],
                        "killerRp": round(pk, 1),
                        "victimRp": round(pv, 1),
                        "delta": delta_k,
                        "teamkill": True,
                        "formula": "v2",
                    }
                )
            else:
                delta_k = round(n * COEF_ENEMY_NOK, 2)
                delta_v = round(n * COEF_BEING_NOKKED, 2)
                gcoef = rp_gain_coef(pk) if soft_gain else 1.0
                applied_k = apply_delta(kk, +delta_k)
                apply_delta(vk, -delta_v)
                events.append(
                    {
                        "kind": "nok",
                        "time": d.get("at_msk"),
                        "killer": disp[kk],
                        "victim": disp[vk],
                        "killerRp": round(pk, 1),
                        "victimRp": round(pv, 1),
                        "delta": round(abs(applied_k), 2),
                        "victimDelta": delta_v,
                        "teamkill": False,
                        "formula": "v2",
                        "gainCoef": gcoef,
                    }
                )
                if do_vehicle:
                    _credit_driver_share(kk, applied_k, d.get("at_msk") or "", "nok")
            nok_rp_n += 1

        elif kind == "die":
            if tk:
                delta_k = round(n * COEF_TK_KILL_EXTRA, 2)
                delta_v = round(n * COEF_OWN_DEATH, 2)
                apply_delta(kk, -delta_k)
                apply_delta(vk, -delta_v)
                events.append(
                    {
                        "kind": "tk",
                        "time": d.get("at_msk"),
                        "killer": disp[kk],
                        "victim": disp[vk],
                        "killerRp": round(pk, 1),
                        "victimRp": round(pv, 1),
                        "delta": delta_k,
                        "victimDelta": delta_v,
                        "teamkill": True,
                        "formula": "v2",
                    }
                )
                tk_n += 1
            else:
                delta_k = round(n * COEF_ENEMY_KILL, 2)
                delta_v = round(n * COEF_OWN_DEATH, 2)
                gcoef = rp_gain_coef(pk) if soft_gain else 1.0
                applied_k = apply_delta(kk, +delta_k)
                apply_delta(vk, -delta_v)
                events.append(
                    {
                        "kind": "die",
                        "time": d.get("at_msk"),
                        "killer": disp[kk],
                        "victim": disp[vk],
                        "killerRp": round(pk, 1),
                        "victimRp": round(pv, 1),
                        "delta": round(abs(applied_k), 2),
                        "victimDelta": delta_v,
                        "teamkill": False,
                        "formula": "v2",
                        "gainCoef": gcoef,
                    }
                )
                if do_vehicle:
                    _credit_driver_share(kk, applied_k, d.get("at_msk") or "", "die")
                die_n += 1

        elif kind == "revive":
            own_nok = last_wound_by.get(vk) == kk
            coef = COEF_REVIVE_OWN_NOK if own_nok else COEF_REVIVE
            delta = round(n * coef, 2)
            gcoef = rp_gain_coef(pk) if soft_gain else 1.0
            applied = apply_delta(kk, +delta)
            net.setdefault(vk, 0.0)
            events.append(
                {
                    "kind": "revive",
                    "time": d.get("at_msk"),
                    "killer": disp[kk],
                    "victim": disp[vk],
                    "killerRp": round(pk, 1),
                    "victimRp": round(pv, 1),
                    "delta": round(abs(applied), 2),
                    "ownNokRevive": own_nok,
                    "formula": "v2",
                    "gainCoef": gcoef,
                }
            )
            rev_n += 1

    events.sort(key=lambda e: e.get("time") or "")
    return events, net, die_n, tk_n, rev_n, nok_rp_n


def rp_rank(rp: float) -> dict:
    rp_i = int(round(rp))
    if rp_i > RADIANT3_MAX:
        return {
            "label": "PREDATOR",
            "rankKey": "predator",
            "roman": "",
            "level": NAMED_RANK_LEVELS,
            "predator": True,
        }
    idx = 0 if rp_i < 1 else min(NAMED_RANK_LEVELS - 1, (rp_i - 1) // STEP)
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
    """Single pass: steam map, inactive, dies, revives, squad/deploy, vehicles."""
    steam_to_nick: dict[str, str] = {}
    inactive_by_nick: dict[str, list[datetime]] = {}
    inactive_by_steam: dict[str, list[datetime]] = {}
    victim_steam: dict[str, str] = {}
    raw_dies: list[dict] = []
    raw_wounds: list[dict] = []
    revives: list[dict] = []
    squads: list[tuple[datetime, str, str]] = []  # at, nick_key, faction
    deploys: list[tuple[datetime, str, str]] = []  # at, nick_key, prefix
    raw_vehicle_ops: list[dict] = []

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

            if "Entered Vehicle" in line:
                em = ENTERED_VEH_RE.search(line)
                if em:
                    asset = (em.group("asset") or "").strip()
                    pawn = em.group("pawn") or ""
                    if not _skip_vehicle_asset(asset, pawn):
                        raw_vehicle_ops.append(
                            {
                                "op": "enter",
                                "at": at,
                                "nick": strip_tag(em.group("nick")),
                                "steam": em.group("steam"),
                                "pawn": pawn,
                                "asset": asset,
                                "fullpath": em.group("fullpath") or "",
                                "seat": int(em.group("seat") or 0),
                            }
                        )

            if "Exited Vehicle" in line:
                xm = EXITED_VEH_RE.search(line)
                if xm:
                    asset = (xm.group("asset") or "").strip()
                    if not _skip_vehicle_asset(asset):
                        raw_vehicle_ops.append(
                            {
                                "op": "exit",
                                "at": at,
                                "nick": strip_tag(xm.group("nick")),
                                "steam": xm.group("steam"),
                                "asset": asset,
                                "fullpath": xm.group("fullpath") or "",
                                "seat": int(xm.group("seat") or 0),
                            }
                        )

            if "SQBurningDamage" in line:
                bm = VEH_BURN_RE.search(line)
                if bm:
                    raw_vehicle_ops.append(
                        {
                            "op": "burn",
                            "at": at,
                            "vid": bm.group("vid"),
                        }
                    )

            if "damage taken by causer" in line and "health remaining" in line:
                # Vehicle actor, or the same HP pool written under the driver's nick.
                if not re.search(r"BP_[A-Za-z0-9_]+_C_\d+:", line):
                    om = VEH_OCC_DMG_RE.search(line)
                    if om and not str(om.group("who") or "").startswith("BP_"):
                        try:
                            raw_vehicle_ops.append(
                                {
                                    "op": "dmg_named",
                                    "at": at,
                                    "who": strip_tag(om.group("who") or ""),
                                    "dmg": float(om.group("dmg") or 0),
                                    "causer": om.group("causer") or "",
                                    "nick": strip_tag(om.group("nick") or ""),
                                    "steam": om.group("steam") or "",
                                    "health": float(om.group("health")),
                                }
                            )
                        except ValueError:
                            pass
                elif re.search(r"BP_[A-Za-z0-9_]+_C_\d+:", line):
                    dm = VEH_DMG_RE.search(line)
                    if dm:
                        nick = (dm.group("nick") or dm.group("nick2") or "").strip()
                        causer = dm.group("causer") or ""
                        vid = dm.group("vid")
                        nick_l = nick.lower()
                        # Burn ticks: causer is the vehicle itself; or explicit SQBurningDamage.
                        burning = causer == vid or "SQBurningDamage" in line
                        try:
                            health = float(dm.group("health"))
                            dmg = float(dm.group("dmg") or 0)
                        except ValueError:
                            continue
                        raw_vehicle_ops.append(
                            {
                                "op": "dmg",
                                "at": at,
                                "vid": vid,
                                "dmg": dmg,
                                "causer": causer,
                                "nick": (
                                    ""
                                    if nick_l in ("", "nullptr", "invalid")
                                    else strip_tag(nick)
                                ),
                                "steam": dm.group("steam") or "",
                                "health": health,
                                "burning": burning,
                            }
                        )

    for d in (inactive_by_nick, inactive_by_steam):
        for k in d:
            d[k].sort()

    raw_vehicle_ops.sort(key=lambda r: r["at"])

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
        "raw_vehicle_ops": raw_vehicle_ops,
    }


def vehicle_ops_in_window(
    idx: dict,
    t0: datetime,
    t1: datetime,
    steam_to_nick: dict[str, str],
    aliases: dict[str, str],
) -> list[dict]:
    """Resolve vehicle enter/exit/dmg/burn ops inside [t0, t1) for score_match_rp."""
    out: list[dict] = []
    for raw in idx.get("raw_vehicle_ops") or []:
        at = raw["at"]
        if not (t0 <= at < t1):
            continue
        op = raw["op"]
        at_msk = (at + timedelta(hours=3)).strftime("%H:%M:%S")
        if op in ("enter", "exit"):
            nick = raw.get("nick") or ""
            steam = raw.get("steam") or ""
            if steam and steam in steam_to_nick:
                nick = steam_to_nick[steam]
            elif steam and steam in idx.get("steam_to_nick", {}):
                nick = idx["steam_to_nick"][steam]
            pawn = raw.get("pawn") or ""
            fullpath = raw.get("fullpath") or ""
            inst = _veh_instance(pawn) or _veh_instance(fullpath)
            out.append(
                {
                    "kind": f"v_{op}",
                    "at_dt": at,
                    "at_msk": at_msk,
                    "nick": strip_tag(nick),
                    "nickKey": canon_key(nick, aliases),
                    "steam": steam,
                    "asset": raw.get("asset") or "",
                    "pawn": pawn,
                    "fullpath": fullpath,
                    "instance": inst,
                    "seat": int(raw.get("seat") or 0),
                }
            )
        elif op == "burn":
            out.append(
                {
                    "kind": "v_burn",
                    "at_dt": at,
                    "at_msk": at_msk,
                    "vid": raw.get("vid") or "",
                }
            )
        elif op == "dmg":
            nick = raw.get("nick") or ""
            steam = raw.get("steam") or ""
            if steam and steam in steam_to_nick:
                nick = steam_to_nick[steam]
            elif steam and steam in idx.get("steam_to_nick", {}):
                nick = idx["steam_to_nick"][steam]
            out.append(
                {
                    "kind": "v_dmg",
                    "at_dt": at,
                    "at_msk": at_msk,
                    "vid": raw.get("vid") or "",
                    "dmg": float(raw.get("dmg") or 0),
                    "causer": raw.get("causer") or "",
                    "killer": strip_tag(nick) if nick else "",
                    "killerKey": canon_key(nick, aliases) if nick else "",
                    "steam": steam,
                    "health": float(raw.get("health") or 0),
                    "burning": bool(raw.get("burning")),
                }
            )
        elif op == "dmg_named":
            who = raw.get("who") or ""
            nick = raw.get("nick") or ""
            steam = raw.get("steam") or ""
            if steam and steam in steam_to_nick:
                nick = steam_to_nick[steam]
            elif steam and steam in idx.get("steam_to_nick", {}):
                nick = idx["steam_to_nick"][steam]
            out.append(
                {
                    "kind": "v_dmg_named",
                    "at_dt": at,
                    "at_msk": at_msk,
                    "who": strip_tag(who),
                    "whoKey": canon_key(who, aliases) if who else "",
                    "dmg": float(raw.get("dmg") or 0),
                    "causer": raw.get("causer") or "",
                    "killer": strip_tag(nick) if nick else "",
                    "killerKey": canon_key(nick, aliases) if nick else "",
                    "steam": steam,
                    "health": float(raw.get("health") or 0),
                    "burning": False,
                }
            )
    out.sort(key=_event_sort_key)
    return out


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


_FACTION_INITIAL_SKIP = frozenset(
    {"of", "the", "and", "de", "la", "le", "les", "van", "der"}
)


def _faction_initials(faction: str) -> str:
    """Initials for DeployRole prefixes: 'Ground Forces of Iran' → GFI (skip of/the/…)."""
    parts = [w for w in re.split(r"[\s\-]+", faction.strip()) if w]
    letters: list[str] = []
    for w in parts:
        if w.lower() in _FACTION_INITIAL_SKIP:
            continue
        if w[0].isalpha():
            letters.append(w[0])
    return "".join(letters).upper()


# DeployRole pawn prefixes that initials() miss (PNMC≠PLANMC, RAF≠VDV, …)
_FACTION_ROLE_PREFIXES: dict[str, tuple[str, ...]] = {
    "pla navy marine corps": ("PLANMC", "PLA"),
    "people's liberation army": ("PLA",),
    "russian airborne forces": ("VDV",),
    "russian ground forces": ("RGF",),
    "united states marine corps": ("USMC",),
    "united states army": ("USA", "US"),
    "canadian armed forces": ("CAF",),
    "western private military contractors": ("WPMC",),
    "british army": ("BA", "GB"),
    "australian defence force": ("ADF",),
    "middle eastern alliance": ("MEA",),
    "insurgent forces": ("INS",),
    "irregular militia forces": ("IMF",),
    "ukraine": ("AFU",),
    # GFI from DeployRole; initials without skip used to yield GFOI
    "ground forces of iran": ("GFI",),
    "iranian": ("GFI",),
}


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
        fk = re.sub(r"\s+", " ", faction.strip().lower())
        for pref in _FACTION_ROLE_PREFIXES.get(fk, ()):
            prefix_team[pref] = team
        for known, prefs in _FACTION_ROLE_PREFIXES.items():
            if known in fk or fk in known:
                for pref in prefs:
                    prefix_team[pref] = team

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
        winner_name = ""
        faction_by_team: dict[str, str] = {}
        faction_to_team: dict[str, str] = {}
        score: dict[str, int] = {}
        for r in pending_results:
            if r.get("layer"):
                layer_name = r["layer"]
            if r.get("level"):
                level_name = r["level"]
            side = (r.get("side") or "").strip()
            faction_full = (r.get("factionFull") or r.get("faction") or "").strip()
            team = str(r.get("team") or "")
            if side:
                faction_to_team[side] = team
            if faction_full and team:
                faction_by_team[team] = faction_full
            score[team] = r.get("tickets", 0)
            if r.get("outcome") == "won":
                winner_team = team
                winner_name = faction_full or side
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
                "winnerName": winner_name,
                "faction1": faction_by_team.get("1") or "",
                "faction2": faction_by_team.get("2") or "",
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
