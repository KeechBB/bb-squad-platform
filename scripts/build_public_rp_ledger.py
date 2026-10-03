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
TIERS = PLATFORM.parent / "KV" / "public" / "data" / "tiers.json"
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
        raise SystemExit(f"paramiko required for SSH sync: {e}") from e

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
    """Prefer SquadGame.log + newest backups; skip unrelated caches."""
    named = [
        p
        for p in paths
        if p.name == "SquadGame.log"
        or p.name.startswith("SquadGame-backup-")
        or p.name.startswith("_tmp_tpub1")
        or "tpub1" in p.name.lower()
    ]
    if not named:
        named = list(paths)
    # newest first by mtime, keep limited set
    named.sort(key=lambda p: p.stat().st_mtime if p.is_file() else 0, reverse=True)
    return named[:limit]


def resolve_log_paths(local_only: bool) -> list[Path]:
    env_dir = os.environ.get("PUBLIC_RP_LOG_DIR", "").strip()
    if env_dir:
        d = Path(env_dir)
        paths = _pick_tpub1_logs(sorted(d.glob("*.log")))
        if paths:
            return paths
    if local_only:
        live = HERE / "_tmp_tpub1_tail_live.log"
        # Prefer live snapshot for fast local/dev; fall back to cache backups.
        if live.is_file() and not os.environ.get("PUBLIC_RP_USE_CACHE"):
            return [live]
        paths = _pick_tpub1_logs(sorted(CACHE.glob("*.log")), limit=5)
        if live.is_file():
            paths = [live] + [p for p in paths if p.resolve() != live.resolve()]
        return paths[:5]
    return _pick_tpub1_logs(sync_logs_via_ssh(CACHE), limit=6)


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
    dies, nok_n = R.dies_in_window(idx, t0, t1, steam_to_nick, aliases)
    revives = R.revives_in_window(idx, t0, t1)

    events: list[dict] = []
    net: dict[str, float] = {}
    die_n = tk_n = rev_n = 0

    def ensure(key: str, nick: str) -> None:
        ck = aliases.get(key, key)
        if ck not in disp:
            disp[ck] = nick
        rp.setdefault(ck, R.START_RP)

    for d in dies:
        kk, vk = d["killerKey"], d["victimKey"]
        if not kk or not vk or kk == vk or kk.startswith("?"):
            continue
        ensure(kk, d["killer"])
        ensure(vk, d["victim"])
        pmax = max(rp.values()) if rp else R.START_RP
        pmax = max(pmax, R.START_RP)
        pk = rp.get(kk, R.START_RP)
        pv = rp.get(vk, R.START_RP)
        delta = round(R.hunt_delta(pk, pv, pmax), 2)
        same_team = kk in teams and vk in teams and teams[kk] == teams[vk]
        if same_team:
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
                    "teamkill": True,
                }
            )
            tk_n += 1
        else:
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
                    "teamkill": False,
                }
            )
            die_n += 1

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

    # ensure all combatants in net
    for k in list(net):
        rp.setdefault(k, R.START_RP)

    print(
        f"{m['id']}: {die_n} Die, {tk_n} TK, {rev_n} rev, nok≈{nok_n}, "
        f"teams={len(teams)}, players={len(net)}",
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
        "events": events,
        "netByNick": {
            disp.get(k, k): v for k, v in sorted(net.items(), key=lambda x: -abs(x[1]))
        },
        "netByKey": net,
        "teamsByKey": teams,
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
    cutoff = datetime.now(timezone.utc) - timedelta(days=MATCH_LOOKBACK_DAYS)
    matches = [m for m in matches if m["start"] >= cutoff]
    print(
        f"discovered matches (last {MATCH_LOOKBACK_DAYS}d): {len(matches)}",
        flush=True,
    )
    if not matches:
        write_empty("No completed non-SEED matches in available logs")
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
            if k not in mb["netByKey"]:
                continue
            team = (mb.get("teamsByKey") or {}).get(k)
            won = None
            if team and mb.get("winnerTeam"):
                won = team == str(mb["winnerTeam"])
            match_hist.append(
                {
                    "id": mb["id"],
                    "map": mb["map"],
                    "date": mb["date"],
                    "net": mb["netByKey"][k],
                    "won": won,
                    "kills": [
                        e
                        for e in mb["events"]
                        if e.get("kind") == "die"
                        and R.canon_key(e["killer"], aliases) == k
                    ],
                    "deaths": [
                        e
                        for e in mb["events"]
                        if e.get("kind") in ("die", "tk")
                        and R.canon_key(e["victim"], aliases) == k
                    ],
                    "teamkills": [
                        e
                        for e in mb["events"]
                        if e.get("kind") == "tk"
                        and R.canon_key(e["killer"], aliases) == k
                    ],
                    "revives": [
                        e
                        for e in mb["events"]
                        if e.get("kind") == "revive"
                        and R.canon_key(e["killer"], aliases) == k
                    ],
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
            {kk: vv for kk, vv in mb.items() if kk not in ("netByKey", "teamsByKey")}
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
        "formula": (
            "delta=1+49*(Pv-Pk+Pmax-1)/(2*(Pmax-1)); "
            "Pk/Pv=current public RP; final Die(+Inactive): enemy zero-sum; "
            "TK both -delta; Revive medic +delta*0.6; Wound/nok=0 RP"
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

    print("TOP 10:")
    for i, row in enumerate(ledger["leaderboard"][:10], 1):
        print(f"  {i}. {row['nick']:20} RP {row['rp']:7.1f}  {row['rankLabel']}")


if __name__ == "__main__":
    main()
