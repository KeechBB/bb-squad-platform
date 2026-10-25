#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Train «Техника» aggregates from vanilla Squad logs → vehicle-hit-stats.json

Per player:
  dmgToVeh   — урон по технике
  dmgFromVeh — урон из техники (пока мехвод/F2 на тяжёлой)
  noPen      — непробития (damage taken == 0 по технике)
  zonePct    — доли урона: turret/hull/engine/wheel/track
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import rp_log_parse as R  # noqa: E402

try:
    import train_rp_guard as TRG
except Exception:
    TRG = None  # type: ignore


def _kv_public() -> Path:
    env = (os.environ.get("BB_KV_PUBLIC") or "").strip()
    cands = []
    if env:
        cands.append(Path(env))
    cands += [
        Path("/var/www/bb-squad-platform/data/kv-cache"),
        Path("/var/www/blackberry-kv"),
        HERE.parents[1] / "KV" / "public",
    ]
    for c in cands:
        if (c / "data" / "training").is_dir():
            return c
    return cands[-1]


KV = _kv_public()
TRAIN = KV / "data" / "training"
OUT = TRAIN / "vehicle-hit-stats.json"
CACHE = Path(os.environ.get("TR1_LOG_CACHE", str(HERE / "_tmp_tr1_logs_cache")))

LINE_TS = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):(?P<ms>\d{3})\]"
)
PART_ATTEMPT = re.compile(
    r"TakeDamage\(\):\s*(?P<target>BP_[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?)\s+"
    r"\S+:\s*(?P<dmg>[\d.]+)\s+damage attempt",
    re.I,
)
DMG_TAKEN_FLEX = re.compile(
    r"TakeDamage\(\):\s*(?P<target>BP_[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?)\s*:"
    r"\s*(?P<dmg>[\d.]+)\s+damage taken by causer\s+(?P<causer>\S+)\s+"
    r"instigator\s+(?:\(Online Ids:\s*(?P<nick>[^)]+)\)|(?P<nick2>[^\s(]+))",
    re.I,
)
PLAYER_DMG = re.compile(
    r"(?:TraceAndMessageClient|TakeDamage)\(\):\s*(?P<victim>(?!BP_)[^:\n]+):\s*"
    r"(?P<dmg>[\d.]+)\s+damage taken by causer\s+\S+\s+instigator\s+"
    r"(?:\(Online Ids:\s*(?P<nick>[^)]+)\)|(?P<nick2>[^\s(]+))",
    re.I,
)
# Башня в ванили: SQVehicleSeat::TakeDamage на BP_*_Turret_* (не на корпус MATV_CROWS)
SEAT_DMG = re.compile(
    r"SQVehicleSeat::TakeDamage\[(?P<kind>\w+)\]\s+(?P<vid>BP_[A-Za-z0-9_]+)\s+"
    r"for\s+(?P<dmg>[\d.]+)\s+damage\s+\(type=(?P<typ>[^)]+)\)",
    re.I,
)
TAG_RE = re.compile(r"^\[(?:BB|BBCOP|BBC|BBr)\]\s*", re.I)
ZONES = ("turret", "hull", "engine", "wheel", "track")
TURRET_ACTOR_RE = re.compile(
    r"Turret|Arbalet_Turret|CROWS_Turret|M1151_Turret|Kord_Turret",
    re.I,
)


def strip_tag(n: str) -> str:
    return TAG_RE.sub("", (n or "").strip())


def parse_ts(line: str) -> datetime | None:
    m = LINE_TS.match(line)
    if not m:
        return None
    try:
        base = datetime.strptime(m.group("ts"), "%Y.%m.%d-%H.%M.%S")
        return base.replace(microsecond=int(m.group("ms")) * 1000, tzinfo=timezone.utc)
    except ValueError:
        return None


def root_vid(target: str) -> str:
    t = str(target or "")
    return t.split(".", 1)[0] if "." in t else t


def is_turret_actor(vid: str) -> bool:
    """BP_M1151_Turret_C / BP_CROWS_Turret_C — да; BP_MATV_CROWS_C (корпус) — нет."""
    t = str(vid or "")
    if not TURRET_ACTOR_RE.search(t):
        return False
    # целый armed light с CROWS в имени корпуса — не башня
    if re.search(r"MATV_CROWS|Tigr_RWS|LAV_RWS", t, re.I) and not re.search(
        r"Turret", t, re.I
    ):
        return False
    return True


def zone_of(target: str) -> str:
    t = str(target or "")
    if "." in t:
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
    if is_turret_actor(t):
        return "turret"
    return "hull"


def is_vehicle_target(target: str) -> bool:
    t = str(target or "")
    if not t.startswith("BP_"):
        return False
    if re.search(
        r"Hesco|Ladder|Fence|Wall|Sandbag|Emplacement|FOB|Radio|Hab\b|TestLadder",
        t,
        re.I,
    ):
        return False
    return True


def load_auto_matches() -> list[dict]:
    p = TRAIN / "_auto_matches.json"
    if not p.is_file():
        return []
    raw = json.loads(p.read_text(encoding="utf-8"))
    rows = raw if isinstance(raw, list) else list(raw.get("matches") or [])
    out = []
    for x in rows:
        if not isinstance(x, dict):
            continue
        mid = str(x.get("id") or "")
        if mid.endswith("-skip") or "cw-skip" in mid:
            continue
        out.append(x)
    return out


def resolve_log(m: dict) -> Path | None:
    log_name = str(m.get("log") or "")
    mid = str(m.get("id") or "")
    date = str(m.get("date") or "")
    if TRG is not None:
        hit = TRG.resolve_match_log(
            log_name,
            mid=mid,
            date_ymd=date,
            server=str(m.get("serverKey") or "") or None,
        )
        if hit and hit.is_file():
            return hit
        try:
            pin = TRG._pin_log_for_match(mid, date)  # noqa: SLF001
            if pin and pin.is_file():
                return pin
        except Exception:
            pass
    direct = CACHE / log_name
    if direct.is_file():
        return direct
    if mid and CACHE.is_dir():
        bare = re.sub(r"^\d{1,2}-", "", mid).lower()
        for p in CACHE.glob("*.log"):
            n = p.name.lower()
            if mid.lower() in n or (bare and bare in n and date[:10].replace("-", ".") in n):
                return p
    return None


def empty_acc(nick: str) -> dict:
    return {
        "_nick": nick,
        "dmgToVeh": 0.0,
        "dmgFromVeh": 0.0,
        "noPen": 0,
        "zones": {z: 0.0 for z in ZONES},
    }


def process_log(
    path: Path,
    t0: datetime | None,
    t1: datetime | None,
    acc: dict[str, dict],
) -> None:
    seats: dict[str, tuple[str, int, str]] = {}
    pending: list[tuple[datetime, str, str, float]] = []
    recent_hitters: list[tuple[datetime, str]] = []

    def key_of(nick: str) -> str:
        n = strip_tag(nick)
        return R.nick_key(n) if hasattr(R, "nick_key") else n.lower()

    def ensure(nick: str) -> str:
        k = key_of(nick)
        if k not in acc:
            acc[k] = empty_acc(strip_tag(nick))
        return k

    def in_armor_crew(k: str) -> bool:
        st = seats.get(k)
        if not st:
            return False
        asset, _seat, role = st
        return role in ("driver", "gunner") and R.is_train_armor_vehicle(asset)

    def note_hitter(at: datetime, nick: str) -> None:
        recent_hitters.append((at, nick))
        if len(recent_hitters) > 80:
            del recent_hitters[:40]

    def credit_zone(nick: str, zone: str, dmg: float) -> None:
        if dmg <= 0:
            return
        k = ensure(nick)
        acc[k]["zones"][zone] = float(acc[k]["zones"].get(zone) or 0) + dmg

    def nearest_hitter(at: datetime, window: float = 0.4) -> str | None:
        best = None
        best_dt = window + 1
        for hat, hnick in recent_hitters:
            dt = abs((at - hat).total_seconds())
            if dt <= window and dt < best_dt:
                best = hnick
                best_dt = dt
        return best

    def flush_parts(at: datetime, root: str, shooter: str, taken: float) -> None:
        """Привязать part-attempt / turret-seat к стрелку.

        engine/wheel/track — тот же root vid;
        turret — отдельный BP_*_Turret_* → матчим только по времени (±0.4с).
        """
        note_hitter(at, shooter)
        left = []
        for pat, proot, zone, pdmg in pending:
            dt = abs((at - pat).total_seconds())
            if dt > 0.4:
                if dt <= 0.8:
                    left.append((pat, proot, zone, pdmg))
                continue
            same = proot == root or zone == "turret"
            if not same:
                left.append((pat, proot, zone, pdmg))
                continue
            if taken > 0 or zone == "turret":
                use = pdmg if pdmg > 0 else taken
                credit_zone(shooter, zone, use)
        pending[:] = left

    def flush_turrets_by_time(at: datetime | None = None) -> None:
        """Осиротевшие turret-seat → ближайший hitter в окне."""
        left = []
        for pat, proot, zone, pdmg in pending:
            if zone != "turret":
                left.append((pat, proot, zone, pdmg))
                continue
            hit = nearest_hitter(pat, 0.5)
            if hit:
                credit_zone(hit, "turret", pdmg)
            elif at is None or abs((at - pat).total_seconds()) <= 1.0:
                left.append((pat, proot, zone, pdmg))
        pending[:] = left

    with path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            at = parse_ts(line)
            if at is None:
                continue
            if t0 and at < t0:
                continue
            if t1 and at >= t1:
                continue

            em = R.ENTERED_VEH_RE.search(line)
            if em:
                nick = strip_tag(em.group("nick"))
                asset = (em.group("asset") or "").strip()
                seat = int(em.group("seat") or 0)
                k = ensure(nick)
                role = R.vehicle_seat_role(asset, seat, em.group("pawn") or "")
                seats[k] = (asset, seat, role)
                continue
            xm = R.EXITED_VEH_RE.search(line)
            if xm:
                seats.pop(key_of(xm.group("nick")), None)
                continue

            # Башня: Seat TakeDamage на turret-pawn
            if "SQVehicleSeat::TakeDamage" in line:
                sm = SEAT_DMG.search(line)
                if sm:
                    typ = sm.group("typ") or ""
                    kind = sm.group("kind") or ""
                    vid = sm.group("vid") or ""
                    try:
                        dmg = float(sm.group("dmg") or 0)
                    except ValueError:
                        dmg = 0.0
                    if (
                        dmg > 0
                        and "Burning" not in typ
                        and kind != "GenericDamage"
                        and is_turret_actor(vid)
                    ):
                        # сразу пробуем привязать к недавнему стрелку
                        hit = nearest_hitter(at, 0.4)
                        if hit:
                            credit_zone(hit, "turret", dmg)
                        else:
                            pending.append((at, vid, "turret", dmg))
                            if len(pending) > 4000:
                                pending[:] = pending[-2000:]

            if "damage attempt" in line and "BP_" in line:
                pm = PART_ATTEMPT.search(line)
                if pm:
                    target = pm.group("target")
                    root = root_vid(target)
                    if is_vehicle_target(root):
                        try:
                            dmg = float(pm.group("dmg") or 0)
                        except ValueError:
                            dmg = 0.0
                        if dmg > 0:
                            pending.append((at, root, zone_of(target), dmg))
                            if len(pending) > 4000:
                                pending[:] = pending[-2000:]

            if "damage taken by causer" not in line:
                continue

            dm = R.VEH_DMG_RE.search(line)
            if dm:
                root = dm.group("vid")
                if is_vehicle_target(root):
                    try:
                        dmg = float(dm.group("dmg") or 0)
                    except ValueError:
                        dmg = 0.0
                    nick = strip_tag(dm.group("nick") or dm.group("nick2") or "")
                    if nick and nick.lower() not in ("nullptr", "invalid"):
                        k = ensure(nick)
                        if dmg <= 0:
                            acc[k]["noPen"] += 1
                        else:
                            acc[k]["dmgToVeh"] += dmg
                            had_parts = any(
                                abs((at - p[0]).total_seconds()) <= 0.35
                                and (p[1] == root or p[2] == "turret")
                                for p in pending
                            )
                            if not had_parts:
                                acc[k]["zones"]["hull"] += dmg
                        flush_parts(at, root, nick, dmg)
                continue

            flex = DMG_TAKEN_FLEX.search(line)
            if flex and "." in (flex.group("target") or ""):
                target = flex.group("target")
                root = root_vid(target)
                if is_vehicle_target(root):
                    try:
                        dmg = float(flex.group("dmg") or 0)
                    except ValueError:
                        dmg = 0.0
                    nick = strip_tag(flex.group("nick") or flex.group("nick2") or "")
                    if nick and nick.lower() not in ("nullptr", "invalid"):
                        k = ensure(nick)
                        if dmg <= 0:
                            acc[k]["noPen"] += 1
                        else:
                            acc[k]["dmgToVeh"] += dmg
                            z = zone_of(target)
                            acc[k]["zones"][z] += dmg
                        flush_parts(at, root, nick, dmg)
                continue

            pm = PLAYER_DMG.search(line)
            if pm:
                victim = strip_tag(pm.group("victim") or "")
                if victim.startswith("BP_"):
                    continue
                try:
                    dmg = float(pm.group("dmg") or 0)
                except ValueError:
                    dmg = 0.0
                    nick = strip_tag(pm.group("nick") or pm.group("nick2") or "")
                if dmg > 0 and nick:
                    k = ensure(nick)
                    if in_armor_crew(k):
                        acc[k]["dmgFromVeh"] += dmg

        # хвост: башни без пары damage-taken
        flush_turrets_by_time(None)


def main() -> int:
    matches = load_auto_matches()
    acc: dict[str, dict] = {}
    done = miss = 0
    for m in matches:
        lp = resolve_log(m)
        if not lp:
            miss += 1
            continue
        t0 = t1 = None
        try:
            if m.get("start"):
                t0 = datetime.fromisoformat(str(m["start"]).replace("Z", "+00:00"))
            if m.get("end"):
                t1 = datetime.fromisoformat(str(m["end"]).replace("Z", "+00:00"))
        except Exception:
            pass
        process_log(lp, t0, t1, acc)
        done += 1
        if done % 10 == 0:
            print(f"… {done} logs", flush=True)

    by_nick: dict[str, dict] = {}
    for _k, v in acc.items():
        nick = str(v.get("_nick") or _k)
        zones = v.get("zones") or {}
        zsum = sum(float(zones.get(z) or 0) for z in ZONES)
        zone_pct = {
            z: (round(100.0 * float(zones.get(z) or 0) / zsum, 1) if zsum > 0 else 0.0)
            for z in ZONES
        }
        row = {
            "nick": nick,
            "dmgToVeh": round(float(v.get("dmgToVeh") or 0), 1),
            "dmgFromVeh": round(float(v.get("dmgFromVeh") or 0), 1),
            "noPen": int(v.get("noPen") or 0),
            "zones": {z: round(float(zones.get(z) or 0), 1) for z in ZONES},
            "zonePct": zone_pct,
        }
        by_nick[nick.lower()] = row

    doc = {
        "version": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "matchesScanned": done,
        "matchesMissingLog": miss,
        "players": by_nick,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"
    OUT.write_text(text, encoding="utf-8")
    live = Path("/var/www/blackberry-kv/data/training/vehicle-hit-stats.json")
    if live.parent.is_dir() and live.resolve() != OUT.resolve():
        live.write_text(text, encoding="utf-8")
    print(f"Wrote {OUT} players={len(by_nick)} logs={done} miss={miss}")
    top = sorted(by_nick.values(), key=lambda r: -r["dmgToVeh"])[:8]
    for r in top:
        print(
            f"  to={r['dmgToVeh']:8.0f} from={r['dmgFromVeh']:8.0f} "
            f"noPen={r['noPen']:4d}  {r['nick']}  {r['zonePct']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
