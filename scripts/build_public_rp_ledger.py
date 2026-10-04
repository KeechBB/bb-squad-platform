#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build public (PB1/TPUB1) RP ledger from logs.

- Auto-discover non-SEED matches (InProgress → WaitingPostMatch)
- Weight = current public RP (not PWR)
- Die/TK/Revive rules same as training
- Writes platform/data/public/rp-ledger.json (+ KV mirror if present)

Usage:
  python build_public_rp_ledger.py
  python build_public_rp_ledger.py --local-only   # only cache / PUBLIC_RP_LOG_DIR
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import rp_log_parse as R

HERE = Path(__file__).resolve().parent
PLATFORM = HERE.parent
CACHE = HERE / "_tmp_tpub1_logs_cache"
OUT_PRIMARY = PLATFORM / "data" / "public" / "rp-ledger.json"
OUT_KV = PLATFORM.parent / "KV" / "public" / "data" / "public" / "rp-ledger.json"
OUT_LADDER_PRIMARY = PLATFORM / "data" / "public" / "rp-ladder.json"
OUT_LADDER_KV = (
    PLATFORM.parent / "KV" / "public" / "data" / "public" / "rp-ladder.json"
)
HISTORY_CACHE = PLATFORM / "data" / "public" / "match-history.json"
TIERS = PLATFORM.parent / "KV" / "public" / "data" / "tiers.json"
# Rating starts from this date (MSK calendar day). Older log matches are ignored.
PUBLIC_RP_EPOCH = (os.environ.get("PUBLIC_RP_EPOCH") or "2026-10-03").strip()
# Keep rebuilds tractable on large daily logs (rolling window).
MATCH_LOOKBACK_DAYS = int(os.environ.get("PUBLIC_RP_LOOKBACK_DAYS") or "14")


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip("'").strip('"')
        if k and k not in os.environ:
            os.environ[k] = v


def load_alias_keys() -> dict[str, str]:
    out: dict[str, str] = {}
    if not TIERS.is_file():
        return out
    t = json.loads(TIERS.read_text(encoding="utf-8"))
    for raw, canon in (t.get("aliases") or {}).items():
        ak, ck = R.nick_key(str(raw)), R.nick_key(str(canon))
        if ak and ck:
            out[ak] = ck
            out.setdefault(ck, ck)
    return out


def sync_logs_via_ssh(cache: Path) -> list[Path]:
    """Download TPUB1 current log + recent backups into cache."""
    try:
        import paramiko
    except ImportError as e:
        local = sorted(cache.glob("*.log"))
        if local:
            print(
                f"paramiko missing ({e}) — using local cache ({len(local)} logs)",
                flush=True,
            )
            return local
        raise SystemExit(
            "paramiko required for SSH sync (or put TPUB1 logs in "
            f"{cache}). Prefer: .venv-collector/bin/python scripts/build_public_rp_ledger.py"
        ) from e

    host = os.environ.get("SQUAD_SSH_HOST")
    user = os.environ.get("SQUAD_SSH_USER")
    password = os.environ.get("SQUAD_SSH_PASSWORD")
    if not host or not user or not password:
        print("SSH env missing — using local cache only", flush=True)
        return sorted(cache.glob("*.log"))

    port = int(os.environ.get("SQUAD_SSH_PORT") or "2022")
    root = (os.environ.get("SQUAD_LOG_ROOT") or "/home/squad/servers").rstrip("/")
    remote_dir = f"{root}/TPUB1/SquadGame/Saved/Logs"
    cache.mkdir(parents=True, exist_ok=True)

    last_err: Exception | None = None
    for attempt in range(4):
        transport = None
        try:
            transport = paramiko.Transport((host, port))
            transport.banner_timeout = 120
            transport.connect(username=user, password=password)
            sftp = paramiko.SFTPClient.from_transport(transport)
            assert sftp is not None
            names = []
            try:
                names = sftp.listdir(remote_dir)
            except Exception as e:
                print(f"listdir fail: {e}", flush=True)
            backups = sorted(
                [n for n in names if n.startswith("SquadGame-backup-") and n.endswith(".log")],
                reverse=True,
            )[:5]
            to_get = ["SquadGame.log"] + backups
            for name in to_get:
                rpath = f"{remote_dir}/{name}"
                lpath = cache / name
                try:
                    st = sftp.stat(rpath)
                    if lpath.is_file() and lpath.stat().st_size == st.st_size:
                        continue
                    print(f"sftp ← {name} ({st.st_size})", flush=True)
                    sftp.get(rpath, str(lpath))
                except Exception as e:
                    print(f"skip {name}: {e}", flush=True)
            sftp.close()
            transport.close()
            break
        except Exception as e:
            last_err = e
            print(f"ssh sync fail {attempt+1}: {type(e).__name__}: {e}", flush=True)
            try:
                if transport:
                    transport.close()
            except Exception:
                pass
            time.sleep(2 + attempt)
    else:
        print(f"ssh sync gave up: {last_err}", flush=True)

    return sorted(cache.glob("*.log"))


def _pick_tpub1_logs(paths: list[Path], limit: int = 10) -> list[Path]:
    """Prefer SquadGame.log / backups / rotated SquadGame_N.log / local tails."""
    named = [
        p
        for p in paths
        if p.name == "SquadGame.log"
        or p.name.startswith("SquadGame-backup-")
        or (p.name.startswith("SquadGame_") and p.name.endswith(".log") and "CRC" not in p.name)
        or p.name.startswith("_tmp_tpub1")
        or "tpub1" in p.name.lower()
    ]
    if not named:
        named = [p for p in paths if "CRC" not in p.name]
    named.sort(key=lambda p: p.stat().st_mtime if p.is_file() else 0, reverse=True)
    return named[:limit]


def resolve_log_paths(local_only: bool) -> list[Path]:
    env_dir = os.environ.get("PUBLIC_RP_LOG_DIR", "").strip()
    if env_dir:
        d = Path(env_dir)
        paths = _pick_tpub1_logs(sorted(d.glob("*.log")), limit=20)
        if paths:
            return paths
    if local_only:
        live = HERE / "_tmp_tpub1_tail_live.log"
        # Prefer live snapshot for fast local/dev; fall back to cache backups.
        if live.is_file() and not os.environ.get("PUBLIC_RP_USE_CACHE"):
            return [live]
        paths = _pick_tpub1_logs(sorted(CACHE.glob("*.log")), limit=16)
        if live.is_file():
            paths = [live] + [p for p in paths if p.resolve() != live.resolve()]
        return paths[:16]
    return _pick_tpub1_logs(sync_logs_via_ssh(CACHE), limit=10)


def write_empty(note: str) -> None:
    payload = {
        "version": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "startRp": R.START_RP,
        "step": R.STEP,
        "radiant3Max": R.RADIANT3_MAX,
        "pMax": R.START_RP,
        "weight": "current_public_rp",
        "excludeSeed": True,
        "matches": [],
        "players": {},
        "leaderboard": [],
        "note": note,
    }
    for out in (OUT_PRIMARY, OUT_KV):
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"wrote empty → {out}")


def get_log_index(
    log_path: Path,
    aliases: dict[str, str],
    cache: dict[str, dict],
) -> dict | None:
    key = str(log_path.resolve()) if log_path.is_file() else ""
    if not key:
        alt = CACHE / log_path.name
        if alt.is_file():
            log_path = alt
            key = str(alt.resolve())
        else:
            return None
    if key not in cache:
        print(f"index {log_path.name}…", flush=True)
        cache[key] = R.index_log_combat(log_path, aliases)
    return cache[key]


def _psycopg_dsn(db: str) -> str:
    """Strip Prisma-only query params (e.g. ?schema=public) for psycopg2/psycopg."""
    if not db:
        return db
    if "://" not in db:
        return db
    # Keep libpq-safe params; drop schema= which Prisma injects.
    if "?" not in db:
        return db
    base, _, qs = db.partition("?")
    kept: list[str] = []
    for part in qs.split("&"):
        if not part or part.lower().startswith("schema="):
            continue
        kept.append(part)
    return f"{base}?{'&'.join(kept)}" if kept else base


def load_history_matches() -> list[dict]:
    """PublicMatch history — Neon/VPS DATABASE_URL or data/public/match-history.json."""
    rows: list[dict] = []
    db = (os.environ.get("DATABASE_URL") or "").strip().strip("'").strip('"')
    if db:
        connect = None
        try:
            import psycopg2

            connect = psycopg2.connect
        except ImportError:
            try:
                import psycopg

                connect = psycopg.connect
            except ImportError:
                print(
                    "history DB skip: ModuleNotFoundError: no psycopg2/psycopg "
                    "(pip install psycopg2-binary into collector venv)",
                    flush=True,
                )
        if connect is not None:
            try:
                conn = connect(_psycopg_dsn(db))
                cur = conn.cursor()
                cur.execute(
                    """
                    select "endedAt", "mapName", "layerName", score1, score2,
                           "winnerTeam", "winnerName", "serverKey"
                    from "PublicMatch"
                    where "serverKey" in ('TPUB1','PB1','PUB')
                    order by "endedAt" asc
                    """
                )
                for ended, map_name, layer, s1, s2, wt, wn, sk in cur.fetchall():
                    rows.append(
                        {
                            "endedAt": ended
                            if isinstance(ended, datetime)
                            else datetime.fromisoformat(str(ended)),
                            "mapName": map_name or "",
                            "layerName": layer or "",
                            "score1": int(s1 or 0),
                            "score2": int(s2 or 0),
                            "winnerTeam": str(wt) if wt is not None else None,
                            "winnerName": wn or "",
                            "serverKey": sk or "TPUB1",
                        }
                    )
                conn.close()
                if rows:
                    print(f"history from DB: {len(rows)}", flush=True)
                    try:
                        HISTORY_CACHE.parent.mkdir(parents=True, exist_ok=True)
                        HISTORY_CACHE.write_text(
                            json.dumps(
                                {
                                    "updatedAt": datetime.now(
                                        timezone.utc
                                    ).isoformat(),
                                    "matches": [
                                        {
                                            "endedAt": (
                                                r["endedAt"].isoformat()
                                                if getattr(r["endedAt"], "tzinfo", None)
                                                else r["endedAt"].isoformat() + "Z"
                                            ),
                                            "mapName": r["mapName"],
                                            "layerName": r["layerName"],
                                            "score1": r["score1"],
                                            "score2": r["score2"],
                                            "winnerTeam": int(r["winnerTeam"])
                                            if r["winnerTeam"]
                                            else None,
                                            "winnerName": r["winnerName"],
                                            "serverKey": r["serverKey"],
                                        }
                                        for r in rows
                                    ],
                                },
                                ensure_ascii=False,
                                indent=2,
                                default=str,
                            )
                            + "\n",
                            encoding="utf-8",
                        )
                    except Exception as e:
                        print(f"history cache write skip: {e}", flush=True)
                    return rows
            except Exception as e:
                print(f"history DB skip: {type(e).__name__}: {e}", flush=True)

    if HISTORY_CACHE.is_file():
        try:
            raw = json.loads(HISTORY_CACHE.read_text(encoding="utf-8"))
            items = (
                raw.get("matches")
                if isinstance(raw, dict)
                else raw
                if isinstance(raw, list)
                else []
            ) or []
            for h in items:
                ended = h.get("endedAt") or h.get("ended_at")
                if not ended:
                    continue
                if isinstance(ended, str):
                    ended_dt = datetime.fromisoformat(ended.replace("Z", "+00:00"))
                else:
                    continue
                if ended_dt.tzinfo is None:
                    ended_dt = ended_dt.replace(tzinfo=timezone.utc)
                rows.append(
                    {
                        "endedAt": ended_dt.astimezone(timezone.utc).replace(tzinfo=None),
                        "mapName": h.get("mapName") or h.get("map") or "",
                        "layerName": h.get("layerName") or h.get("layer") or "",
                        "score1": int(h.get("score1") or 0),
                        "score2": int(h.get("score2") or 0),
                        "winnerTeam": str(h["winnerTeam"])
                        if h.get("winnerTeam") is not None
                        else None,
                        "winnerName": h.get("winnerName") or "",
                        "serverKey": h.get("serverKey") or "TPUB1",
                    }
                )
            if rows:
                print(f"history from {HISTORY_CACHE.name}: {len(rows)}", flush=True)
        except Exception as e:
            print(f"history JSON skip: {e}", flush=True)
    return rows


def _map_blob(m: dict) -> str:
    return " ".join(
        str(x or "").lower()
        for x in (m.get("map"), m.get("level"), m.get("layerName"), m.get("mapName"))
    )


def match_in_history(m: dict, history: list[dict]) -> dict | None:
    """Link a log-discovered match to a PublicMatch history row."""
    if not history:
        return None
    end = m["end"]
    if end.tzinfo is not None:
        end = end.astimezone(timezone.utc).replace(tzinfo=None)
    blob = _map_blob(m)
    best = None
    best_dt = 10**9
    for h in history:
        hend = h["endedAt"]
        if hend.tzinfo is not None:
            hend = hend.astimezone(timezone.utc).replace(tzinfo=None)
        dt = abs((end - hend).total_seconds())
        if dt > 20 * 60:
            continue
        hmap = (h.get("mapName") or "").lower()
        hlayer = (h.get("layerName") or "").lower()
        if hmap and hmap not in blob and not any(
            tok and tok in blob for tok in hmap.replace("-", " ").split()
        ):
            # layer still ok
            if hlayer and hlayer.lower() not in blob and not any(
                t and t in blob for t in re.split(r"[\s_]+", hlayer) if len(t) > 3
            ):
                continue
        if h.get("score1") is not None and m.get("score1") is not None:
            if int(h["score1"]) != int(m["score1"]) or int(h["score2"]) != int(
                m.get("score2") or 0
            ):
                continue
        if dt < best_dt:
            best_dt = dt
            best = h
    return best


def filter_matches_to_history(matches: list[dict], history: list[dict]) -> list[dict]:
    """Only matches that exist in site history AND on/after PUBLIC_RP_EPOCH."""
    epoch = PUBLIC_RP_EPOCH
    if not history:
        print(
            "WARNING: no PublicMatch history — refusing to score log-only matches",
            flush=True,
        )
        return []
    out: list[dict] = []
    for m in matches:
        if m.get("date") and m["date"] < epoch:
            continue
        hit = match_in_history(m, history)
        if not hit:
            print(
                f"skip (not in history): {m['id']} {m.get('map')} "
                f"scores={m.get('score1')}:{m.get('score2')}",
                flush=True,
            )
            continue
        m = dict(m)
        m["historyEndedAt"] = hit["endedAt"].isoformat()
        m["historyWinner"] = hit.get("winnerName")
        out.append(m)
    return out


def process_match(
    m: dict,
    steam_to_nick: dict[str, str],
    aliases: dict[str, str],
    rp: dict[str, float],
    disp: dict[str, str],
    log_index_cache: dict[str, dict],
) -> dict | None:
    log_path: Path = m["logPath"]
    idx = get_log_index(log_path, aliases, log_index_cache)
    if idx is None:
        print(f"  missing log {m['log']}", flush=True)
        return None

    steam_to_nick.update(idx["steam_to_nick"])
    t0, t1 = m["start"], m["end"]
    faction_to_team = m.get("factionToTeam") or {}
    teams = R.teams_in_window(idx, t0, t1, faction_to_team)
    dies, die_noks = R.dies_in_window(idx, t0, t1, steam_to_nick, aliases)
    wound_noks = R.wounds_in_window(idx, t0, t1, steam_to_nick, aliases)
    # Prefer real Wound() downs; keep Die-without-Inactive only if no Wound nearby.
    noks: list[dict] = list(wound_noks)
    for d in die_noks:
        # Skip fallback Die-nok if a Wound for same pair exists within ±2 min
        dt = d.get("at_dt")
        skip = False
        if dt is not None:
            for w in wound_noks:
                wdt = w.get("at_dt")
                if wdt is None:
                    continue
                if (
                    w["killerKey"] == d["killerKey"]
                    and w["victimKey"] == d["victimKey"]
                    and abs((wdt - dt).total_seconds()) <= 120
                ):
                    skip = True
                    break
        if not skip:
            noks.append(d)
    revives = R.revives_in_window(idx, t0, t1)

    events: list[dict] = []
    net: dict[str, float] = {}
    dmg_by: dict[str, float] = {}
    combatants: set[str] = set()
    die_n = tk_n = rev_n = 0

    def ensure(key: str, nick: str) -> None:
        ck = aliases.get(key, key)
        if ck not in disp:
            disp[ck] = nick
        rp.setdefault(ck, R.START_RP)
        combatants.add(ck)

    def wound_covers_kill(kk: str, vk: str, kill_at) -> bool:
        """True if a Wound from same killer→victim precedes give-up (dmg already on nok)."""
        if kill_at is None:
            return False
        for w in wound_noks:
            if w["killerKey"] != kk or w["victimKey"] != vk:
                continue
            wdt = w.get("at_dt")
            if wdt is None:
                continue
            dt = (kill_at - wdt).total_seconds()
            if 0 <= dt <= 90:
                return True
        return False

    for d in dies:
        kk, vk = d["killerKey"], d["victimKey"]
        if not kk or not vk or kk == vk or kk.startswith("?"):
            continue
        ensure(kk, d["killer"])
        ensure(vk, d["victim"])
        dmg = float(d.get("dmg") or 0)
        pmax = max(rp.values()) if rp else R.START_RP
        pmax = max(pmax, R.START_RP)
        pk = rp.get(kk, R.START_RP)
        pv = rp.get(vk, R.START_RP)
        delta = round(R.hunt_delta(pk, pv, pmax), 2)
        same_team = kk in teams and vk in teams and teams[kk] == teams[vk]
        if same_team:
            # TK: RP penalty only. Never add TK KillingDamage to combat score.
            rp[kk] = rp.get(kk, R.START_RP) - delta
            rp[vk] = rp.get(vk, R.START_RP) - delta
            net[kk] = round(net.get(kk, 0.0) - delta, 2)
            net[vk] = round(net.get(vk, 0.0) - delta, 2)
            events.append(
                {
                    "kind": "tk",
                    "time": d["at_msk"],
                    "killer": disp[kk],
                    "victim": disp[vk],
                    "killerPwr": round(pk, 1),
                    "victimPwr": round(pv, 1),
                    "delta": delta,
                    "dmg": dmg,
                    "teamkill": True,
                }
            )
            tk_n += 1
        else:
            # Combat dmg: Die only if no prior Wound (else Wound already counted).
            if not wound_covers_kill(kk, vk, d.get("at_dt")):
                dmg_by[kk] = round(dmg_by.get(kk, 0.0) + dmg)
            rp[kk] = rp.get(kk, R.START_RP) + delta
            rp[vk] = rp.get(vk, R.START_RP) - delta
            net[kk] = round(net.get(kk, 0.0) + delta, 2)
            net[vk] = round(net.get(vk, 0.0) - delta, 2)
            events.append(
                {
                    "kind": "die",
                    "time": d["at_msk"],
                    "killer": disp[kk],
                    "victim": disp[vk],
                    "killerPwr": round(pk, 1),
                    "victimPwr": round(pv, 1),
                    "delta": delta,
                    "dmg": dmg,
                    "teamkill": False,
                }
            )
            die_n += 1

    for d in noks:
        kk, vk = d["killerKey"], d["victimKey"]
        if not kk or not vk or kk == vk or kk.startswith("?"):
            continue
        ensure(kk, d["killer"])
        ensure(vk, d["victim"])
        net.setdefault(kk, 0.0)
        net.setdefault(vk, 0.0)
        dmg = float(d.get("dmg") or 0)
        same_team = kk in teams and vk in teams and teams[kk] == teams[vk]
        # Combat score: enemy downs (Wound / soft Die). TK never counts.
        if not same_team:
            dmg_by[kk] = round(dmg_by.get(kk, 0.0) + dmg)
        events.append(
            {
                "kind": "nok",
                "time": d["at_msk"],
                "killer": disp.get(kk, d["killer"]),
                "victim": disp.get(vk, d["victim"]),
                "delta": 0,
                "dmg": dmg,
                "teamkill": same_team,
            }
        )

    for d in revives:
        kk = R.canon_key(d["killer"], aliases)
        vk = R.canon_key(d["victim"], aliases)
        if not kk or not vk or kk == vk or kk.startswith("?"):
            continue
        ensure(kk, d["killer"])
        ensure(vk, d["victim"])
        pmax = max(rp.values()) if rp else R.START_RP
        pmax = max(pmax, R.START_RP)
        pk = rp.get(kk, R.START_RP)
        pv = rp.get(vk, R.START_RP)
        delta = round(R.hunt_delta(pk, pv, pmax) * R.REVIVE_COEF, 2)
        rp[kk] = rp.get(kk, R.START_RP) + delta
        net[kk] = round(net.get(kk, 0.0) + delta, 2)
        net.setdefault(vk, 0.0)
        events.append(
            {
                "kind": "revive",
                "time": d["at_msk"],
                "killer": disp[kk],
                "victim": disp[vk],
                "killerPwr": round(pk, 1),
                "victimPwr": round(pv, 1),
                "delta": delta,
            }
        )
        rev_n += 1

    events.sort(key=lambda e: e["time"])
    winner = m.get("winnerTeam")

    for k in combatants:
        rp.setdefault(k, R.START_RP)
        net.setdefault(k, 0.0)

    nok_n = sum(1 for e in events if e.get("kind") == "nok")
    print(
        f"{m['id']}: {die_n} Die, {tk_n} TK, {rev_n} rev, nok={nok_n}, "
        f"teams={len(teams)}, players={len(combatants)}",
        flush=True,
    )

    return {
        "id": m["id"],
        "map": m["map"],
        "date": m["date"],
        "giveUpKills": die_n,
        "teamkills": tk_n,
        "revives": rev_n,
        "nok": nok_n,
        "winnerTeam": winner,
        "score1": m.get("score1"),
        "score2": m.get("score2"),
        "events": events,
        "netByNick": {
            disp.get(k, k): v for k, v in sorted(net.items(), key=lambda x: -abs(x[1]))
        },
        "netByKey": net,
        "dmgByKey": dmg_by,
        "teamsByKey": teams,
        "combatants": combatants,
    }


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser()
    ap.add_argument("--local-only", action="store_true")
    args = ap.parse_args()

    load_dotenv(HERE / ".squad-collector.env")
    load_dotenv(PLATFORM / ".env")

    aliases = load_alias_keys()
    log_paths = resolve_log_paths(local_only=args.local_only)
    if not log_paths:
        write_empty("No TPUB1 logs found")
        return

    print(f"logs: {len(log_paths)} {[p.name for p in log_paths]}", flush=True)
    matches = R.discover_matches(log_paths)
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        days=MATCH_LOOKBACK_DAYS
    )
    matches = [m for m in matches if m["start"].replace(tzinfo=None) >= cutoff]
    print(
        f"discovered matches (last {MATCH_LOOKBACK_DAYS}d): {len(matches)}",
        flush=True,
    )

    history = load_history_matches()
    matches = filter_matches_to_history(matches, history)
    print(
        f"after history+epoch({PUBLIC_RP_EPOCH}): {len(matches)} "
        f"{[m['id'] for m in matches]}",
        flush=True,
    )
    if not matches:
        write_empty(
            "No history-linked public matches since "
            f"{PUBLIC_RP_EPOCH} in available logs"
        )
        return

    steam_to_nick: dict[str, str] = {}
    # steam map filled from combat indexes as we process logs

    rp: dict[str, float] = {}
    disp: dict[str, str] = {}
    match_blocks: list[dict] = []
    log_index_cache: dict[str, dict] = {}

    for m in matches:
        block = process_match(
            m, steam_to_nick, aliases, rp, disp, log_index_cache
        )
        if block:
            match_blocks.append(block)

    if not match_blocks:
        write_empty("Matches found but no combat parsed")
        return

    ranked = sorted(rp.items(), key=lambda x: -x[1])
    predator_place: dict[str, int] = {}
    place = 0
    for k, val in ranked:
        info = R.rp_rank(val)
        if info["predator"]:
            place += 1
            predator_place[k] = place

    players_out: dict = {}
    for k, val in ranked:
        info = R.rp_rank(val)
        match_hist = []
        for mb in match_blocks:
            combat_keys = mb.get("combatants") or set(mb["netByKey"])
            if k not in combat_keys:
                continue
            team = (mb.get("teamsByKey") or {}).get(k)
            won = None
            if team and mb.get("winnerTeam"):
                won = team == str(mb["winnerTeam"])
            kills = [
                e
                for e in mb["events"]
                if e.get("kind") == "die"
                and R.canon_key(e["killer"], aliases) == k
            ]
            deaths = [
                e
                for e in mb["events"]
                if e.get("kind") in ("die", "tk")
                and R.canon_key(e["victim"], aliases) == k
            ]
            # Ноки = Wound() downs (incl. those that later give up). Not a copy of kills.
            noks = [
                e
                for e in mb["events"]
                if e.get("kind") == "nok"
                and R.canon_key(e["killer"], aliases) == k
            ]
            revives = [
                e
                for e in mb["events"]
                if e.get("kind") == "revive"
                and R.canon_key(e["killer"], aliases) == k
            ]
            match_hist.append(
                {
                    "id": mb["id"],
                    "map": mb["map"],
                    "date": mb["date"],
                    "net": mb["netByKey"].get(k, 0.0),
                    "won": won,
                    "dmg": round((mb.get("dmgByKey") or {}).get(k, 0.0)),
                    "kills": kills,
                    "deaths": deaths,
                    "noks": noks,
                    "teamkills": [
                        e
                        for e in mb["events"]
                        if e.get("kind") == "tk"
                        and R.canon_key(e["killer"], aliases) == k
                    ],
                    "revives": revives,
                }
            )
        players_out[k] = {
            "nick": disp.get(k, k),
            "rp": round(val, 1),
            "rankLabel": info["label"],
            "rankKey": info["rankKey"],
            "roman": info["roman"],
            "predator": info["predator"],
            "predatorPlace": predator_place.get(k),
            "matches": match_hist,
        }

    public_matches = []
    for mb in match_blocks:
        public_matches.append(
            {
                kk: vv
                for kk, vv in mb.items()
                if kk
                not in ("netByKey", "teamsByKey", "dmgByKey", "combatants")
            }
        )

    pmax = max(rp.values()) if rp else R.START_RP
    ledger = {
        "version": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "startRp": R.START_RP,
        "step": R.STEP,
        "radiant3Max": R.RADIANT3_MAX,
        "weight": "current_public_rp",
        "excludeSeed": True,
        "historyOnly": True,
        "epoch": PUBLIC_RP_EPOCH,
        "formula": (
            "delta=1+49*(Pv-Pk+Pmax-1)/(2*(Pmax-1)); "
            "Pk/Pv=current public RP; final Die(+Inactive): enemy zero-sum; "
            "TK both -delta; Revive medic +delta*0.6; Wound/nok=0 RP; "
            "combat dmg=KillingDamage enemy Wound(+Die if no prior Wound); "
            "nok=Wound downs; kill=Die+Inactive give-up; TK dmg excluded; "
            "only PublicMatch history since epoch"
        ),
        "reviveCoef": R.REVIVE_COEF,
        "pMax": round(pmax, 1),
        "matches": public_matches,
        "players": players_out,
        "leaderboard": [
            {
                "nick": players_out[k]["nick"],
                "rp": players_out[k]["rp"],
                "rankLabel": players_out[k]["rankLabel"],
                "rankKey": players_out[k]["rankKey"],
                "predatorPlace": players_out[k]["predatorPlace"],
            }
            for k, _ in ranked
        ],
    }

    text = json.dumps(ledger, ensure_ascii=False, indent=2) + "\n"
    for out in (OUT_PRIMARY, OUT_KV):
        try:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text, encoding="utf-8")
            print(f"Wrote {out} ({len(ledger['leaderboard'])} players, {len(public_matches)} matches)")
        except Exception as e:
            print(f"skip write {out}: {e}", flush=True)

    # Slim ladder for Next hot path (~1MB vs ~30MB full ledger).
    slim_players: dict[str, dict] = {}
    for k, p in players_out.items():
        slim_ms = []
        for m in p.get("matches") or []:
            slim_ms.append(
                {
                    "id": m.get("id"),
                    "kills": len(m.get("kills") or []),
                    "deaths": len(m.get("deaths") or []),
                    "noks": len(m.get("noks") or []),
                    "revives": len(m.get("revives") or []),
                    "dmg": int(round(float(m.get("dmg") or 0))),
                    "won": m.get("won"),
                }
            )
        slim_players[k] = {
            "nick": p.get("nick"),
            "rp": p.get("rp"),
            "rankLabel": p.get("rankLabel"),
            "rankKey": p.get("rankKey"),
            "predatorPlace": p.get("predatorPlace"),
            "matches": slim_ms,
        }
    slim = {
        "version": ledger["version"],
        "updatedAt": ledger["updatedAt"],
        "startRp": ledger["startRp"],
        "step": ledger["step"],
        "radiant3Max": ledger["radiant3Max"],
        "weight": ledger["weight"],
        "excludeSeed": True,
        "historyOnly": True,
        "epoch": ledger["epoch"],
        "formula": ledger["formula"],
        "pMax": ledger["pMax"],
        "slim": True,
        "matches": [
            {"id": m.get("id"), "date": m.get("date"), "map": m.get("map")}
            for m in public_matches
        ],
        "players": slim_players,
        "leaderboard": ledger["leaderboard"],
    }
    slim_text = json.dumps(slim, ensure_ascii=False, separators=(",", ":")) + "\n"
    for out in (OUT_LADDER_PRIMARY, OUT_LADDER_KV):
        try:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(slim_text, encoding="utf-8")
            print(f"Wrote slim {out} ({out.stat().st_size} bytes)")
        except Exception as e:
            print(f"skip write {out}: {e}", flush=True)

    print("TOP 10:")
    for i, row in enumerate(ledger["leaderboard"][:10], 1):
        print(f"  {i}. {row['nick']:20} RP {row['rp']:7.1f}  {row['rankLabel']}")


if __name__ == "__main__":
    main()
