#!/usr/bin/env python3
"""LAT (Легкая Труба) ladder 1..10. Rolling 14 calendar days MSK.

Same calibration as rifle/medic: main role from kit-tiers, 5 days in window,
best=10 / worst=1, player level = sum of metric levels / metric count.

Rules locked with Alex:
- roster = #1 role «Легкая Труба» only (profile «Роли»)
- stats while LAT kit + light projectile (no tandem/HAT)
- vehicle dmg/hits = movable tech only (no ammo crates)
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

try:
    import train_rp_guard as TRG
except Exception:
    TRG = None  # type: ignore

WINDOW_DAYS = 14
MSK = timezone(timedelta(hours=3))
NEED_DAYS = 5
CONFIRM = 8.0
KNOCK_GAP = 4.0
MIN_LAT_SEC = 60

OUT_PATHS = [
    Path("/var/www/bb-squad-platform/data/kv-cache/data/lat-ladder.json"),
    Path("/var/www/blackberry-kv/data/lat-ladder.json"),
    Path("/var/www/blackberry-kv/public/data/lat-ladder.json"),
]

LINE_TS = re.compile(
    r"^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]"
)
SPAWN = re.compile(
    r"RestartPlayer\(\):.*?PC=(?P<nick>\S+).*?DeployRole=(?P<role>\S+)", re.I
)
POSS = re.compile(
    r"OnPossess\(\):\s*PC=(?P<nick>\S+)\s*\(Online IDs:\s*EOS:\s*(?P<eos>[0-9a-fA-F]{32})\s*steam:\s*(?P<steam>7656\d+)",
    re.I,
)
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
CAUSED = re.compile(r"caused by\s+(?P<caused>\S+)", re.I)
INACTIVE = re.compile(
    r"ChangeState\(\):\s*PC=(?P<nick>.+?)\s+\(Online IDs:.*?steam:\s*(?P<steam>7656\d+)\).*?"
    r"OldState=Playing\s+NewState=Inactive",
    re.I,
)
REVIVE = re.compile(
    r"has revived\s+(?P<patient>.+?)\s*\(Online IDs:",
    re.I,
)
HIT = re.compile(
    r"BBHitZone:\s*AttackerEOS=<?(?P<eos>[0-9a-fA-F]{32})",
    re.I,
)
BONE = re.compile(r"Bone=<?(?P<bone>[^>\s]+)>?", re.I)
ZONE = re.compile(r"Zone=<?(?P<zone>[^>\s]+)>?", re.I)
DMG_TAKEN = re.compile(
    r"(?:TakeDamage|TraceAndMessageClient)\(\):\s*(?P<target>\S+):\s*(?P<dmg>[\d.]+)\s+"
    r"damage taken by causer\s+(?P<causer>\S+)\s+instigator\s+"
    r"(?:\(Online Ids:\s*(?P<nick>[^)]+)\)|(?P<nick2>[^\s(]+))",
    re.I,
)
DMG_ATTEMPT = re.compile(
    r"TakeDamage\(\):\s*(?P<target>BP_[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?)\s+"
    r"\S+:\s*(?P<dmg>[\d.]+)\s+damage attempt",
    re.I,
)
LAT_ROLE = re.compile(r"(?:^|_)LAT(?:_|$)|LightAntiTank", re.I)
HAT_ROLE = re.compile(r"(?:^|_)HAT(?:_|$)|HeavyAntiTank|Tandem", re.I)

# Strict LAT only. No tandem / HAT / vehicle AT / RPG-28/29.
# Heat/Frag for RPG7+SMAW+AT4+M72+LAW+light disposable; soldier LAT kit pawns.
LAT_CAUSER = re.compile(
    r"BP_(?:"
    r"RPG7_(?:Heat|Frag)_Proj|"
    r"RPG18_|RPG22_|RPG26_|"  # disposable light — NOT RPG28/29/32 tandem family
    r"M72_(?!Tandem)|AT4_(?!Tandem)|"
    r"SMAW_(?:Heat|HE|Frag)_Proj|"  # SMAW heat/HE only, not tandem
    r"LAW_(?!Tandem)|"
    r"Pzf3_(?:Heat|HEAT|Frag)|"  # not tandem
    r"Panzerfaust|"
    r"NLAW_|"
    r"RGW90_(?!Tandem)|"
    r"PF98_(?:Heat|HEAT|Frag)|"
    r"Soldier_[A-Za-z0-9]+_LAT_"
    r")",
    re.I,
)
NOT_LAT_CAUSER = re.compile(
    r"Tandem|RPG28|RPG29|RPG30|RPG32|RPG7_Tandem|"
    r"SMAW_Tandem|M3MAAWS|MAAWS|FFV751|CarlG|CarlGustav|"
    r"Soldier_[A-Za-z0-9]+_HAT_|Kornet|SPG9|Metis|TOW|Javelin|Sraw|Spike",
    re.I,
)

VITAL_BONES = {"head", "neck", "chest", "spine", "stomach", "abdomen", "pelvis"}


def nick_key(raw: str) -> str:
    s = re.sub(r"\[[^\]]*\]", " ", raw or "")
    return re.sub(r"[^0-9a-zA-Z]", "", s).lower()


def strip_tag(n: str) -> str:
    return re.sub(r"^\[(?:BB|BBCOP|BBC|BBr)\]\s*", "", (n or "").strip(), flags=re.I)


def parse_ts(line: str) -> datetime | None:
    m = LINE_TS.match(line)
    if not m:
        return None
    try:
        return datetime(
            int(m.group(1)),
            int(m.group(2)),
            int(m.group(3)),
            int(m.group(4)),
            int(m.group(5)),
            int(m.group(6)),
            int(m.group(7)) * 1000,
            tzinfo=timezone.utc,
        )
    except ValueError:
        return None


def msk_day(ts: datetime) -> str:
    return (ts.astimezone(MSK)).date().isoformat()


def is_lat_causer(name: str) -> bool:
    """True only for light-tube projectiles / LAT soldier pawns. Hard-deny tandem/HAT."""
    if not name:
        return False
    if NOT_LAT_CAUSER.search(name):
        return False
    if re.search(r"Tandem", name, re.I):
        return False
    return bool(LAT_CAUSER.search(name))


def zone_of(target: str) -> str | None:
    t = str(target or "")
    if "." not in t:
        return None
    comp = t.split(".", 1)[1].upper()
    if "ENGINE" in comp:
        return "engine"
    if "TRACK" in comp or "TREAD" in comp:
        return "track"
    if "WHEEL" in comp:
        return "wheel"
    if "TURRET" in comp or "GUN" in comp:
        return "turret"
    return "hull"


# Не «техника»: ящики/статик — в урон и попадания по технике не входят.
NOT_MOBILE_VEH = re.compile(
    r"Ammo(crate|bag|box)|Ammocrate|Supply(Crate|Bag)?|Cache|"
    r"Hesco|Ladder|Fence|Wall|Sandbag|Emplacement|FOB|Radio|Hab\b|"
    r"Projectile|Soldier|Mine|Razor|Wire|Barrier|Bunker|Trench|"
    r"Rally|Spawn|Deployable",
    re.I,
)


def is_vehicle_target(target: str) -> bool:
    """True only for movable vehicles (tech that drives/flies) — not ammo crates."""
    t = str(target or "")
    root = t.split(".", 1)[0]
    if not root.startswith("BP_"):
        return False
    if NOT_MOBILE_VEH.search(root):
        return False
    return True


def bone_bucket(zone: str, bone: str) -> str:
    z = (zone or "").lower()
    b = (bone or "").lower()
    for token in (z, b):
        if any(x in token for x in ("head", "neck")):
            return "head"
        if any(x in token for x in ("chest", "spine", "clavicle")):
            return "chest"
        if any(x in token for x in ("stomach", "abdomen", "pelvis", "hip")):
            return "stomach"
    return "other"


def rolling_window():
    now = datetime.now(timezone.utc).astimezone(MSK)
    end = datetime(now.year, now.month, now.day, tzinfo=MSK) + timedelta(days=1)
    start = end - timedelta(days=WINDOW_DAYS)
    last = end - timedelta(days=1)
    label = f"{start.strftime('%d.%m')}–{last.strftime('%d.%m.%Y')}"
    return (
        start.astimezone(timezone.utc),
        end.astimezone(timezone.utc),
        label,
        start.date().isoformat(),
        last.date().isoformat(),
    )


def _ymd_from_match(m: dict, file_hint: str = "") -> str:
    raw = str(m.get("date") or "").strip()
    if re.match(r"\d{4}-\d{2}-\d{2}", raw):
        return raw[:10]
    day = m.get("day")
    if isinstance(day, int) or (isinstance(day, str) and str(day).isdigit()):
        ym = ""
        if re.match(r"\d{4}-\d{2}", file_hint):
            ym = file_hint[:7]
        elif m.get("startUtc"):
            ym = str(m.get("startUtc"))[:7]
        if ym:
            return f"{ym}-{int(day):02d}"
    if m.get("startUtc"):
        try:
            return (
                datetime.fromisoformat(str(m["startUtc"]).replace("Z", "+00:00"))
                .astimezone(MSK)
                .date()
                .isoformat()
            )
        except Exception:
            pass
    return ""


def load_matches(since: datetime, until: datetime) -> list[dict]:
    train = Path("/var/www/bb-squad-platform/data/kv-cache/data/training")
    # Prefer calendar months (windows), merge log names from _auto_matches.
    auto_logs: dict[str, str] = {}
    auto_p = train / "_auto_matches.json"
    if auto_p.is_file():
        raw = json.loads(auto_p.read_text(encoding="utf-8"))
        items = raw if isinstance(raw, list) else list(raw.get("matches") or [])
        for x in items:
            if isinstance(x, dict) and x.get("id") and x.get("log"):
                auto_logs[str(x["id"])] = str(x["log"])

    rows = []
    for name in ("2026-10.json", "2026-11.json"):
        p = train / name
        if not p.is_file():
            continue
        raw = json.loads(p.read_text(encoding="utf-8"))
        items = raw if isinstance(raw, list) else list(raw.get("matches") or [])
        for x in items:
            if not isinstance(x, dict):
                continue
            mid = str(x.get("id") or "")
            if not mid or mid.endswith("-skip") or "cw-skip" in mid:
                continue
            ymd = _ymd_from_match(x, name)
            if not ymd:
                continue
            try:
                d0 = datetime.fromisoformat(ymd).replace(tzinfo=MSK)
            except ValueError:
                continue
            if d0 + timedelta(days=1) < since.astimezone(MSK) or d0 > until.astimezone(MSK):
                continue
            row = dict(x)
            row["date"] = ymd
            if not row.get("log") and mid in auto_logs:
                row["log"] = auto_logs[mid]
            if not row.get("serverKey") and isinstance(row.get("server"), str):
                sk = re.search(r"\b(TR[1-5])\b", str(row.get("server")), re.I)
                if sk:
                    row["serverKey"] = sk.group(1).upper()
            rows.append(row)
    seen = set()
    out = []
    for x in rows:
        mid = str(x.get("id"))
        if mid in seen:
            continue
        seen.add(mid)
        out.append(x)
    return out


def _parse_duration_min(raw) -> float:
    if raw is None:
        return 45.0
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    if re.match(r"^\d+(\.\d+)?$", s):
        return float(s)
    if ":" in s:
        parts = [int(x) for x in s.split(":")]
        if len(parts) == 2:
            return parts[0] + parts[1] / 60.0
        if len(parts) == 3:
            return parts[0] * 60 + parts[1] + parts[2] / 60.0
    return 45.0


def match_window(m: dict) -> tuple[datetime, datetime] | None:
    if m.get("startUtc") and m.get("endUtc"):
        try:
            start = datetime.fromisoformat(str(m["startUtc"]).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(m["endUtc"]).replace("Z", "+00:00"))
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            return start - timedelta(seconds=60), end + timedelta(seconds=120)
        except Exception:
            pass
    day = str(m.get("date") or _ymd_from_match(m) or "")[:10]
    tm = str(m.get("timeMsk") or m.get("startMsk") or "00:00")
    dur_min = _parse_duration_min(m.get("durationMin") or m.get("duration"))
    try:
        hh, mm = [int(x) for x in tm.split(":")[:2]]
        start = datetime(
            int(day[0:4]), int(day[5:7]), int(day[8:10]), hh, mm, tzinfo=MSK
        ).astimezone(timezone.utc)
        end = start + timedelta(minutes=max(8.0, dur_min) + 2)
        start = start - timedelta(seconds=60)
        return start, end
    except Exception:
        return None


def resolve_log(m: dict) -> Path | None:
    log_name = str(m.get("log") or "")
    mid = str(m.get("id") or "")
    date = str(m.get("date") or _ymd_from_match(m) or "")
    server = str(m.get("serverKey") or "") or None
    if not server and isinstance(m.get("server"), str):
        sk = re.search(r"\b(TR[1-5])\b", str(m.get("server")), re.I)
        if sk:
            server = sk.group(1).upper()
    if not log_name and server and date and mid:
        # TR1-2026.10.31-31-fclsumari.log
        log_name = f"{server}-{date.replace('-', '.')}-{mid}.log"
    if TRG is not None:
        hit = TRG.resolve_match_log(log_name, mid=mid, date_ymd=date, server=server)
        if hit and hit.is_file() and hit.stat().st_size > 1000:
            return hit
        try:
            pin = TRG._pin_log_for_match(mid, date)  # noqa: SLF001
            if pin and pin.is_file() and pin.stat().st_size > 1000:
                return pin
        except Exception:
            pass
    # brute pins / cache
    cands = []
    if log_name:
        cands.append(
            Path("/var/www/bb-squad-platform/scripts/_tmp_squad_logs")
            / (server or "TR1")
            / "pins"
            / log_name
        )
        cands.append(
            Path("/var/www/bb-squad-platform/scripts/_tmp_tr1_logs_cache") / log_name
        )
    if mid:
        for root in (
            Path("/var/www/bb-squad-platform/scripts/_tmp_squad_logs"),
            Path("/var/www/bb-squad-platform/scripts/_tmp_tr1_logs_cache"),
        ):
            if not root.exists():
                continue
            cands.extend(root.rglob(f"*{mid}*.log"))
    for p in cands:
        try:
            if p.is_file() and p.stat().st_size > 1000:
                return p
        except Exception:
            continue
    return None


MAP_RE = re.compile(r"/Game/Maps/([^/\s?]+)", re.I)
STATE_RE = re.compile(
    r"Match State Changed from \w+ to (?P<state>InProgress|WaitingPostMatch|LeavingMap)"
)
FLEET_SERVERS = ("TR1", "TR2", "TR3", "TR4", "TR5")
LOG_ROOT = Path("/var/www/bb-squad-logs")


def fleet_logs(since: datetime, until: datetime) -> list[tuple[str, Path]]:
    months = set()
    cur = since
    while cur < until:
        months.add(cur.strftime("%Y-%m"))
        months.add((cur.astimezone(MSK)).strftime("%Y-%m"))
        cur += timedelta(days=1)
    out: list[tuple[str, Path]] = []
    for srv in FLEET_SERVERS:
        live = LOG_ROOT / srv / "_live" / "SquadGame.log"
        if live.is_file():
            out.append((srv, live))
        for name in sorted(months):
            month = LOG_ROOT / srv / name
            if month.is_dir():
                out.extend((srv, p) for p in sorted(month.glob("SquadGame-backup-*.log")))
    return out


def cw_log_rounds(since: datetime, until: datetime) -> list[dict]:
    """Clan-war rounds the training ingest marked cw-skip, played on TR1–TR5."""
    auto_p = Path(
        "/var/www/bb-squad-platform/data/kv-cache/data/training/_auto_matches.json"
    )
    if not auto_p.is_file():
        print("cw auto missing", auto_p)
        return []
    raw = json.loads(auto_p.read_text(encoding="utf-8"))
    items = raw if isinstance(raw, list) else list(raw.get("matches") or [])
    pending = []
    for x in items:
        if not isinstance(x, dict) or "cw-skip" not in str(x.get("id") or ""):
            continue
        try:
            start = datetime.fromisoformat(str(x.get("start")).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(x.get("end")).replace("Z", "+00:00"))
        except Exception:
            continue
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        if end < since or start >= until:
            continue
        if (end - start).total_seconds() < 8 * 60:
            continue
        pending.append(
            {
                "id": str(x.get("id")),
                "map": str(x.get("map") or ""),
                "start": start,
                "end": end,
                "srv": "",
                "path": "",
            }
        )
    if not pending:
        return []

    def place_token(name: str) -> str:
        s = re.sub(r"[^a-z0-9]", "", (name or "").lower())
        for noise in (
            "hotdrop",
            "specialforlavius",
            "gameplaylayers",
            "fcl",
            "csl",
            "sec",
            "raas",
            "paas",
            "aas",
            "invasion",
            "skirmish",
            "v1",
            "v2",
            "v3",
        ):
            s = s.replace(noise, "")
        return s

    for row in pending:
        row["token"] = place_token(row["map"])

    for srv, path in fleet_logs(since, until):
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if "has won the match" not in line and "has lost the match" not in line:
                    continue
                ts = parse_ts(line)
                if ts is None:
                    continue
                low = re.sub(r"[^a-z0-9]", "", line.lower())
                for row in pending:
                    if row["path"] or len(row["token"]) < 4:
                        continue
                    if row["token"] not in low:
                        continue
                    if not (
                        row["start"] - timedelta(minutes=3)
                        <= ts
                        <= row["end"] + timedelta(minutes=10)
                    ):
                        continue
                    delta = abs((ts - row["end"]).total_seconds())
                    if delta <= 120:
                        row["srv"] = srv
                        row["path"] = str(path)
                        row["_best"] = None
                        continue
                    best = row.get("_best")
                    if best is None or delta < best[0]:
                        row["_best"] = (delta, srv, str(path))

    for row in pending:
        if row.get("path") or not row.get("_best"):
            continue
        _delta, srv, path = row["_best"]
        row["srv"] = srv
        row["path"] = path
    for row in pending:
        row.pop("_best", None)

    assigned = [r for r in pending if r["path"]]
    missed = [r["id"] for r in pending if not r["path"]]
    if missed:
        print("cw log not found", len(missed), ",".join(missed[:8]))
    assigned.sort(key=lambda r: (r["path"], r["start"]))
    merged: list[dict] = []
    for row in assigned:
        if (
            merged
            and merged[-1]["logPath"] == row["path"]
            and row["start"] <= merged[-1]["_end"] + timedelta(minutes=2)
        ):
            if row["end"] > merged[-1]["_end"]:
                merged[-1]["_end"] = row["end"]
                merged[-1]["endUtc"] = row["end"].isoformat()
            continue
        merged.append(
            {
                "id": row["id"],
                "serverKey": row["srv"],
                "logPath": row["path"],
                "startUtc": row["start"].isoformat(),
                "endUtc": row["end"].isoformat(),
                "map": row["map"],
                "cw": True,
                "_end": row["end"],
            }
        )
    for row in merged:
        row.pop("_end", None)
    return merged


def load_lat_roster() -> list[tuple[str, float]]:
    """Only players whose #1 profile role (kit-tiers / «Роли») is Легкая Труба."""
    out: list[tuple[str, float]] = []
    try:
        req = urllib.request.Request(
            "https://bb-squad.ru/api/public/kit-tiers",
            headers={"User-Agent": "bb-lat-preview"},
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        for p in ((data.get("ranking") or {}).get("players")) or []:
            levels = p.get("levels") or []
            top = levels[0] if levels else None
            kit = (top or {}).get("kit") if top else None
            nick = str(p.get("nick") or "").strip()
            if nick and kit == "Легкая Труба":
                pct = float((top or {}).get("pct") or 0)
                out.append((nick, pct))
    except Exception as exc:
        print("roster api", exc)
    return out


def blank(nick: str) -> dict:
    return {
        "nick": nick,
        "games": 0,
        "game_days": set(),
        "lat_sec": 0.0,
        "lat_days": set(),
        "eff_sec": 0.0,
        "eff_days": set(),
        "life_sec": [],
        "life_days": set(),
        "enemy_knocks": 0,
        "enemy_kills": 0,
        "tube_kills": 0,
        "taken_knocks": 0,
        "own_deaths": 0,
        "hits": Counter(),
        "hit_days": set(),
        "veh_dmg": 0.0,
        "veh_dmg_days": set(),
        "veh_hits": 0,
        "veh_hit_days": set(),
        "day_span": defaultdict(list),
    }


def process_match(path: Path, t0: datetime, t1: datetime, track: dict[str, dict], discover: bool):
    steam_to: dict[str, str] = {}
    eos_to: dict[str, str] = {}
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()

    # first pass possess for id maps
    for line in lines:
        ts = parse_ts(line)
        if ts is None or ts < t0 - timedelta(minutes=30) or ts > t1 + timedelta(minutes=10):
            continue
        pm = POSS.search(line)
        if pm:
            nick = strip_tag(pm.group("nick"))
            steam_to[pm.group("steam")] = nick_key(nick)
            eos_to[pm.group("eos").lower()] = nick_key(nick)
            if discover and nick_key(nick) not in track:
                track[nick_key(nick)] = blank(nick)

    st = {
        k: {
            "open": None,
            "lat": False,
            "lat_match": False,
            "down": False,
        }
        for k in list(track)
    }
    inactive: dict[str, list[datetime]] = defaultdict(list)
    knock_dedupe = set()
    taken_dedupe = set()
    played = set()
    pending_attempts: list[tuple[datetime, str, str]] = []  # ts, root_vid, zone

    def close_open(p: str, end: datetime, by_knock: bool):
        s = st.get(p)
        if not s or s["open"] is None or s["down"]:
            return
        if not s["lat"]:
            s["open"] = None
            return
        dur = (end - s["open"]).total_seconds()
        if dur < 0 or dur > 3 * 3600:
            s["open"] = None
            return
        acc = track[p]
        acc["eff_sec"] += dur
        acc["lat_sec"] += dur
        acc["eff_days"].add(msk_day(s["open"]))
        acc["lat_days"].add(msk_day(s["open"]))
        if by_knock and dur >= 1:
            acc["life_sec"].append(dur)
            acc["life_days"].add(msk_day(s["open"]))
        s["open"] = None

    def on_lat(key: str) -> bool:
        s = st.get(key) or {}
        return bool(s.get("lat") or s.get("lat_match"))

    for line in lines:
        ts = parse_ts(line)
        if ts is None or ts < t0 or ts >= t1:
            continue

        sm = SPAWN.search(line)
        if sm:
            nick = strip_tag(sm.group("nick"))
            key = nick_key(nick)
            role = sm.group("role")
            if discover and LAT_ROLE.search(role) and key not in track:
                track[key] = blank(nick)
                st[key] = {
                    "open": None,
                    "lat": False,
                    "lat_match": False,
                    "down": False,
                }
            if key not in st:
                continue
            close_open(key, ts, False)
            is_lat = bool(LAT_ROLE.search(role)) and not HAT_ROLE.search(role)
            st[key]["open"] = ts if is_lat else None
            st[key]["lat"] = is_lat
            if is_lat:
                st[key]["lat_match"] = True
            st[key]["down"] = False
            if is_lat:
                played.add(key)
                track[key]["day_span"][msk_day(ts)].append(ts)
            continue

        im = INACTIVE.search(line)
        if im:
            inactive[nick_key(strip_tag(im.group("nick")))].append(ts)
            continue

        if "has revived" in line:
            rm = REVIVE.search(line)
            if rm:
                # patient poorly named — try nick_key from patient blob
                pass
            continue

        am = DMG_ATTEMPT.search(line)
        if am and is_vehicle_target(am.group("target")):
            z = zone_of(am.group("target"))
            if z:
                root = am.group("target").split(".", 1)[0]
                pending_attempts.append((ts, root, z))
                if len(pending_attempts) > 40:
                    pending_attempts = pending_attempts[-40:]
            continue

        dm = DMG_TAKEN.search(line)
        if dm:
            target = dm.group("target")
            dmg = float(dm.group("dmg"))
            causer = dm.group("causer")
            nick = strip_tag(dm.group("nick") or dm.group("nick2") or "")
            key = nick_key(nick)
            # Vehicle LAT dmg only while currently on LAT kit + light projectile.
            if (
                key in track
                and key in st
                and st[key].get("lat")
                and is_lat_causer(causer)
                and is_vehicle_target(target)
                and dmg > 0
            ):
                track[key]["veh_dmg"] += dmg
                track[key]["veh_dmg_days"].add(msk_day(ts))
                track[key]["veh_hits"] += 1
                track[key]["veh_hit_days"].add(msk_day(ts))
                st[key]["lat_match"] = True
                played.add(key)
            continue

        if "BBHitZone:" in line:
            hm = HIT.search(line)
            if hm:
                key = eos_to.get(hm.group("eos").lower())
                if key in track and on_lat(key):
                    zm = ZONE.search(line)
                    bm = BONE.search(line)
                    bucket = bone_bucket(
                        zm.group("zone") if zm else "",
                        bm.group("bone") if bm else "",
                    )
                    track[key]["hits"][bucket] += 1
                    track[key]["hit_days"].add(msk_day(ts))
            continue

        wm = WOUND.search(line)
        if wm:
            victim = nick_key(strip_tag(wm.group("victim")))
            att = steam_to.get(wm.group("steam"))
            cm = CAUSED.search(line)
            caused = cm.group("caused") if cm else ""
            if att and att in st and on_lat(att) and att != victim:
                bucket = int(ts.timestamp()) // int(KNOCK_GAP)
                dk = (att, victim, bucket)
                if dk not in knock_dedupe:
                    knock_dedupe.add(dk)
                    track[att]["enemy_knocks"] += 1
            if victim in st and on_lat(victim):
                bucket = int(ts.timestamp()) // int(KNOCK_GAP)
                if (victim, bucket) not in taken_dedupe:
                    taken_dedupe.add((victim, bucket))
                    track[victim]["taken_knocks"] += 1
                if st[victim]["open"] is not None and not st[victim]["down"]:
                    close_open(victim, ts, True)
                st[victim]["down"] = True
            continue

        dm2 = DIE.search(line)
        if dm2:
            victim = nick_key(strip_tag(dm2.group("victim")))
            att = steam_to.get(dm2.group("steam"))
            cm = CAUSED.search(line)
            caused = cm.group("caused") if cm else ""
            # Preview: Die already means dead; inactive-confirm often misses nick variants.
            if att and att in st and on_lat(att) and att != victim:
                track[att]["enemy_kills"] += 1
                # Tube infantry kills: LAT kit NOW + light projectile only (no tandem).
                if st[att].get("lat") and is_lat_causer(caused):
                    track[att]["tube_kills"] += 1
            if victim in st and on_lat(victim):
                if st[victim]["open"] is not None and not st[victim]["down"]:
                    close_open(victim, ts, False)
                st[victim]["down"] = True
                track[victim]["own_deaths"] += 1
            continue

    end = t1
    for p in list(st):
        if st[p]["lat_match"] or st[p]["lat"]:
            played.add(p)
    for p in played:
        if st[p]["open"] is not None and not st[p]["down"]:
            close_open(p, end, False)
        track[p]["games"] += 1
        track[p]["game_days"].add(msk_day(t0))


def level_of(v: float, worst: float, best: float, higher: bool) -> float:
    if best == worst:
        return 10.0
    if higher:
        return 1.0 + 9.0 * (v - worst) / (best - worst)
    return 1.0 + 9.0 * (worst - v) / (worst - best)


METRICS = [
    ("life", "Жизнь до нока, мин", True),
    ("kpm", "Ноки врагам в минуту", True),
    ("vital", "Голова+грудь+живот, %", True),
    ("kpg", "Убийства за игру", True),
    ("taken", "Ноки по нему за игру", False),
    ("dpg", "Смерти за игру", False),
    ("kd", "KD", True),
    ("week", "Тренировок в неделю", True),
    ("lat_min", "Минуты на LAT", True),
    ("veh_dpg", "Урон LAT по технике в ср. за игру", True),
    ("veh_hpg", "Попаданий по технике / игру", True),
    ("tube_kpg", "Убийства с трубы пехоты / игру", True),
]


def main() -> int:
    since, until, label, day_from, day_to = rolling_window()
    print("window", label, since.isoformat(), "→", until.isoformat())
    roster = load_lat_roster()
    roster_pct = {nick_key(n): pct for n, pct in roster}
    print(
        "lat roster (main role Легкая Труба)",
        len(roster),
        [f"{n} {p:.0f}%" for n, p in roster[:20]],
    )
    track: dict[str, dict] = {nick_key(n): blank(n) for n, _pct in roster}

    matches = load_matches(since, until)
    train_starts = []
    for m in matches:
        win = match_window(m)
        if not win:
            continue
        train_starts.append((str(m.get("serverKey") or ""), win[0]))
    cw_rounds = []
    for rnd in cw_log_rounds(since, until):
        win = match_window(rnd)
        if not win:
            continue
        sk = str(rnd.get("serverKey") or "")
        if sk and any(
            tsk == sk and abs((t0 - win[0]).total_seconds()) < 5 * 60
            for tsk, t0 in train_starts
        ):
            continue
        cw_rounds.append(rnd)
        print(
            "include cw",
            rnd.get("serverKey"),
            rnd.get("id"),
            str(rnd.get("map") or "")[:36],
        )
    matches.extend(cw_rounds)
    print("calendar matches in window", len(matches) - len(cw_rounds), "cw", len(cw_rounds))
    scanned = 0
    missing = 0
    for m in matches:
        win = match_window(m)
        if not win:
            continue
        t0, t1 = win
        if t1 < since or t0 > until:
            continue
        pinned = Path(str(m.get("logPath") or ""))
        path = pinned if pinned.is_file() else resolve_log(m)
        if not path:
            missing += 1
            continue
        try:
            # discover=False: no SL/medic who sometimes pick LAT (Chidori etc.)
            process_match(path, t0, t1, track, discover=False)
            scanned += 1
            print("ok", m.get("id"), path.name[:40], "players", len(track))
        except Exception as exc:
            print("fail", m.get("id"), exc)

    print("scanned", scanned, "missing_log", missing, "tracked", len(track))

    rows = []
    for key, s in track.items():
        if key not in roster_pct:
            continue
        if s["lat_sec"] < MIN_LAT_SEC and s["games"] == 0:
            continue
        lives = s["life_sec"]
        eff = s["eff_sec"]
        hits = s["hits"]
        hit_n = sum(hits.values())
        vital_n = hits.get("head", 0) + hits.get("chest", 0) + hits.get("stomach", 0)
        games = max(1, s["games"]) if s["games"] else 0
        raw = {
            "life": (
                round(sum(lives) / len(lives) / 60, 2) if lives else None,
                len(s["life_days"]),
            ),
            "kpm": (
                round(s["enemy_knocks"] / (eff / 60), 3) if eff >= 60 else None,
                len(s["eff_days"]),
            ),
            "vital": (
                round(100 * vital_n / hit_n, 1) if hit_n >= 5 else None,
                len(s["hit_days"]),
            ),
            "kpg": (
                round(s["enemy_kills"] / s["games"], 2) if s["games"] else None,
                len(s["game_days"]),
            ),
            "taken": (
                round(s["taken_knocks"] / s["games"], 2) if s["games"] else None,
                len(s["game_days"]),
            ),
            "dpg": (
                round(s["own_deaths"] / s["games"], 2) if s["games"] else None,
                len(s["game_days"]),
            ),
            "kd": (
                round(s["enemy_kills"] / s["own_deaths"], 2)
                if s["own_deaths"]
                else (float(s["enemy_kills"]) if s["enemy_kills"] else None),
                len(s["game_days"]),
            ),
            "week": (
                round(len(s["game_days"]) / (WINDOW_DAYS / 7), 2)
                if s["game_days"]
                else None,
                len(s["game_days"]),
            ),
            "lat_min": (round(s["lat_sec"] / 60, 1), len(s["lat_days"])),
            "veh_dpg": (
                round(s["veh_dmg"] / s["games"], 1) if s["games"] else None,
                len(s["veh_dmg_days"]) if s["veh_dmg"] else 0,
            ),
            "veh_hpg": (
                round(s["veh_hits"] / s["games"], 2) if s["games"] else None,
                len(s["veh_hit_days"])
                if s["veh_hits"]
                else (len(s["game_days"]) if s["games"] else 0),
            ),
            "tube_kpg": (
                round(s["tube_kills"] / s["games"], 2) if s["games"] else None,
                len(s["game_days"]) if s["tube_kills"] or s["games"] else 0,
            ),
        }
        row = {
            "nick": s["nick"],
            "games": s["games"],
            "days": len(s["game_days"]),
            "lat_min_total": round(s["lat_sec"] / 60, 1),
            "mainRolePct": round(roster_pct.get(key, 0), 1),
            "raw": {
                k: {
                    "v": v,
                    "days": d,
                    "ok": v is not None and d >= NEED_DAYS,
                }
                for k, (v, d) in raw.items()
            },
        }
        # tube/veh: 0 is real if enough game-days
        for k in ("veh_hpg", "tube_kpg", "veh_dpg"):
            cell = row["raw"][k]
            if cell["v"] is not None and row["days"] >= NEED_DAYS:
                cell["ok"] = True
                cell["days"] = max(cell["days"], row["days"])
        rows.append(row)

    anchors = {}
    for key, _title, higher in METRICS:
        vals = [r["raw"][key]["v"] for r in rows if r["raw"][key]["ok"]]
        if not vals:
            anchors[key] = {
                "best": None,
                "worst": None,
                "n": 0,
                "higher": higher,
                "bestNicks": [],
                "worstNicks": [],
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
            "bestNicks": [
                r["nick"]
                for r in rows
                if r["raw"][key]["ok"] and r["raw"][key]["v"] == best
            ],
            "worstNicks": [
                r["nick"]
                for r in rows
                if r["raw"][key]["ok"] and r["raw"][key]["v"] == worst
            ],
        }
        for r in rows:
            cell = r["raw"][key]
            if not cell["ok"]:
                cell["lvl"] = None
            else:
                cell["lvl"] = round(
                    level_of(float(cell["v"]), worst, best, higher), 1
                )

    for r in rows:
        parts = [
            r["raw"][k]["lvl"] * (0.5 if k in ("week", "lat_min") else 1.0)
            for k, _t, _h in METRICS
            if r["raw"][k].get("lvl") is not None
        ]
        r["scored"] = len(parts)
        r["level"] = round(sum(parts) / len(METRICS), 2) if parts else None

    rows.sort(
        key=lambda r: (
            r["level"] is None,
            -(r["level"] or 0),
            -r["lat_min_total"],
            -r["games"],
            r["nick"].lower(),
        )
    )

    out = {
        "generatedAt": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "window": label,
        "from": day_from,
        "to": day_to,
        "needDays": NEED_DAYS,
        "metricCount": len(METRICS),
        "title": "Легкая Труба · уровень 1–10",
        "foot": (
            "В лестнице только игроки с главной ролью «Легкая Труба» в карточке Роли (14 дней). "
            "Метрики считаются пока на ките LAT и лёгком снаряде (без tandem/HAT). "
            "Урон и попадания по технике — только то, что ездит или летает (аммоящики не считаются). "
            "Клановые войны на TR1–TR5 входят в то же окно. "
            "Окно — 14 дней. Нет 5 дней по показателю — калибровка. "
            "Тренировки в неделю и минуты на LAT в общий уровень входят наполовину: 10 в столбце даёт 5. "
            "Убийство — гивап, нок — сбитие."
        ),
        "metrics": [{"key": k, "title": t, "higher": h, "weight": 0.5 if k in ("week", "lat_min") else 1} for k, t, h in METRICS],
        "anchors": anchors,
        "players": rows,
        "liveMatches": scanned,
        "missingLog": missing,
        "roster": len(rows),
    }
    payload = json.dumps(out, ensure_ascii=False)
    Path("/tmp/lat_ladder.json").write_text(payload, encoding="utf-8")
    for dest in OUT_PATHS:
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(payload, encoding="utf-8")
            print("wrote", dest)
        except OSError as exc:
            print("skip", dest, exc)
    print("players", len(rows), "scanned", scanned, "missing_log", missing)
    for i, r in enumerate(rows[:20], 1):
        print(
            f"{i:2d}. {r['level']}  g={r['games']} d={r['days']} lat={r['lat_min_total']}  {r['nick']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
