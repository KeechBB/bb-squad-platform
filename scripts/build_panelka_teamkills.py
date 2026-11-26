#!/usr/bin/env python3
"""Собрать тимкилы по Steam из логов TR/PB1 (с 2026-11-01) → disk cache.

Пишет: data/cache/panelka-teamkills/<steamId>.json
Админка читает мгновенно, без RCON.

Usage:
  python3 scripts/build_panelka_teamkills.py
  python3 scripts/build_panelka_teamkills.py --since 2026-11-01
  python3 scripts/build_panelka_teamkills.py --incremental
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOG_ROOT = Path("/var/www/bb-squad-logs")
CACHE_DIR = ROOT / "data" / "cache" / "panelka-teamkills"
STATE_PATH = CACHE_DIR / "_state.json"
MSK = timezone(timedelta(hours=3))

SERVERS = ("PB1", "TR1", "TR2", "TR3", "TR4", "TR5")

# PostLogin: controller asset → steam (killer id on Die)
POSTLOGIN_RE = re.compile(
    r"PostLogin:.*?BP_PlayerController_C_(?P<cid>\d+).*?steam:\s*(?P<steam>7656\d+)",
    re.I,
)
POSSESS_RE = re.compile(
    r"OnPossess\(\):\s*PC=(?P<nick>.+?)\s*\(Online IDs:.*?steam:\s*(?P<steam>7656\d+)\).*?"
    r"(?:Pawn=|Possessed\s+)(?P<pawn>BP_[A-Za-z0-9_]+)",
    re.I,
)
POSSESS_ALT = re.compile(
    r"steam:\s*(?P<steam>7656\d+)\).*?(?P<nick>[^\]]+?)\s+has possessed \((?P<pawn>BP_[^\)]+)\)",
    re.I,
)
# Die: victim nick + killer controller; Online IDs steam = victim
DIE_RE = re.compile(
    r"Die\(\):\s*Player:(?P<victim>.+?)\s+KillingDamage=[-\d.]+\s+from\s+(?P<causer>\S+)\s+"
    r"\(Online IDs:.*?steam:\s*(?P<vsteam>7656\d+)",
    re.I,
)
SQUAD_RE = re.compile(
    r"LogSquad:\s*(?P<nick>.+?)\s*\(Online IDs:\s*EOS:\s*[0-9a-fA-F]+\s+steam:\s*(?P<steam>7656\d+)\)\s+"
    r"has created Squad\s+\d+\s+\(Squad Name:.*?\)\s+on\s+(?P<faction>.+)$",
    re.I,
)
TEAM_MARK_RE = re.compile(
    r"Player\s+(?P<nick>.+?)\s*\(Team:\s*(?P<team>[12]);\s*ID:\s*EOS:[^)]*steam:\s*(?P<steam>7656\d+)\)",
    re.I,
)
STAMP_RE = re.compile(r"\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})")
STRIP_TAG = re.compile(r"^[\[【〔][^\]】〕]*[\]】〕]\s*")


def pad2(n: int) -> str:
    return f"{n:02d}"


def msk_stamp(line: str) -> tuple[str, str, str]:
    """→ (ymd YYYY-MM-DD, clock HH:MM:SS MSK, display DD.MM.YYYY)."""
    m = STAMP_RE.search(line)
    if not m:
        return "", "", ""
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    h, mi, s = int(m.group(4)), int(m.group(5)), int(m.group(6))
    # log UTC → MSK +3
    h = (h + 3) % 24
    ymd = f"{y:04d}-{pad2(mo)}-{pad2(d)}"
    # crude day rollover when +3 crosses midnight — stamp date stays UTC day;
    # for UI clock is enough; ymd filter uses UTC day ≈ ok for Nov window
    clock = f"{pad2(h)}:{pad2(mi)}:{pad2(s)}"
    disp = f"{pad2(d)}.{pad2(mo)}.{y:04d}"
    return ymd, clock, disp


def clean_nick(n: str) -> str:
    s = (n or "").strip()
    s = STRIP_TAG.sub("", s).strip()
    return s[:48]


def iter_log_files(server: str, since: str) -> list[Path]:
    out: list[Path] = []
    base = LOG_ROOT / server
    if not base.is_dir():
        return out
    live = base / "_live" / "SquadGame.log"
    if live.is_file():
        out.append(live)
    # monthly backups: 2026-11/SquadGame-backup-...
    since_dt = datetime.strptime(since, "%Y-%m-%d")
    for month_dir in sorted(base.glob("????-??")):
        try:
            y, m = month_dir.name.split("-")
            month_start = datetime(int(y), int(m), 1)
        except Exception:
            continue
        if month_start.year < since_dt.year or (
            month_start.year == since_dt.year and month_start.month < since_dt.month
        ):
            # still include if month overlaps (e.g. Oct backups ending Nov 1)
            if not (month_start.year == since_dt.year and month_start.month == since_dt.month - 1):
                if month_start < since_dt.replace(day=1):
                    continue
        for p in sorted(month_dir.glob("*.log")):
            out.append(p)
    # dedupe by resolve
    seen = set()
    uniq = []
    for p in out:
        try:
            r = str(p.resolve())
        except Exception:
            r = str(p)
        if r in seen:
            continue
        seen.add(r)
        uniq.append(p)
    return uniq


def parse_file(
    path: Path,
    server: str,
    since: str,
    by_steam: dict[str, list[dict]],
) -> int:
    """Parse one log; append TK rows. Returns count added."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        print(f"  skip {path}: {e}", file=sys.stderr)
        return 0

    # BP_PlayerController_C_<id> → steam
    ctrl_owner: dict[str, str] = {}
    pawn_owner: dict[str, str] = {}
    steam_faction: dict[str, str] = {}
    steam_team: dict[str, str] = {}
    steam_nick: dict[str, str] = {}
    added = 0

    for line in text.splitlines():
        ymd, clock, disp = msk_stamp(line)
        if ymd and ymd < since:
            continue

        pl = POSTLOGIN_RE.search(line)
        if pl:
            ctrl_owner[f"BP_PlayerController_C_{pl.group('cid')}"] = pl.group("steam")

        for rx in (POSSESS_RE, POSSESS_ALT):
            pm = rx.search(line)
            if not pm:
                continue
            pawn = pm.group("pawn").split()[0].rstrip(",;")
            steam = pm.group("steam")
            pawn_owner[pawn] = steam
            nick = clean_nick(pm.group("nick"))
            if nick:
                steam_nick[steam] = nick
            mfac = re.search(r"BP_Soldier_([A-Za-z0-9]+)_", pawn)
            if mfac:
                steam_faction[steam] = mfac.group(1).upper()

        sm = SQUAD_RE.search(line)
        if sm:
            steam = sm.group("steam")
            steam_faction[steam] = (sm.group("faction") or "").strip()
            nick = clean_nick(sm.group("nick"))
            if nick:
                steam_nick[steam] = nick

        tm = TEAM_MARK_RE.search(line)
        if tm:
            steam = tm.group("steam")
            steam_team[steam] = tm.group("team")
            nick = clean_nick(tm.group("nick"))
            if nick:
                steam_nick[steam] = nick

        dm = DIE_RE.search(line)
        if not dm:
            continue
        causer = dm.group("causer").rstrip(",;")
        killer_steam = ctrl_owner.get(causer) or pawn_owner.get(causer)
        if not killer_steam:
            # BP_PlayerController_C_123 → match by id suffix
            mcid = re.search(r"BP_PlayerController_C_(\d+)", causer)
            if mcid:
                killer_steam = ctrl_owner.get(f"BP_PlayerController_C_{mcid.group(1)}")
        if not killer_steam:
            base = causer.rsplit("_", 1)[0] if "_" in causer else causer
            for pawn, owner in pawn_owner.items():
                if pawn.startswith(base) or causer.startswith(pawn.rsplit("_", 1)[0]):
                    killer_steam = owner
                    break
        if not killer_steam:
            continue
        victim_steam = dm.group("vsteam")
        if victim_steam == killer_steam:
            continue

        same = False
        kt = steam_team.get(killer_steam)
        vt = steam_team.get(victim_steam)
        if kt and vt:
            same = kt == vt
        else:
            kf = steam_faction.get(killer_steam)
            vf = steam_faction.get(victim_steam)
            if kf and vf:
                same = kf == vf
            else:
                continue

        if not same:
            continue

        victim_name = clean_nick(dm.group("victim")) or steam_nick.get(
            victim_steam, victim_steam
        )
        if not ymd:
            ymd, clock, disp = msk_stamp(line)
        row = {
            "date": disp or ymd,
            "ymd": ymd,
            "clock": clock,
            "victim": victim_name,
            "victimSteamId": victim_steam,
            "server": server,
        }
        by_steam[killer_steam].append(row)
        added += 1

    return added


def load_state() -> dict:
    if STATE_PATH.is_file():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"files": {}, "since": None, "updatedAt": None}


def save_state(state: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def write_caches(
    by_steam: dict[str, list[dict]], since: str, *, merge: bool
) -> int:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    if not merge:
        for p in CACHE_DIR.glob("7656*.json"):
            try:
                p.unlink()
            except Exception:
                pass
    written = 0
    for steam, rows in by_steam.items():
        seen = set()
        uniq = []
        for r in sorted(
            rows,
            key=lambda x: (x.get("ymd") or "", x.get("clock") or ""),
            reverse=True,
        ):
            key = f"{r.get('ymd')}|{r.get('clock')}|{r.get('victimSteamId')}|{r.get('server')}"
            if key in seen:
                continue
            seen.add(key)
            uniq.append(r)
        path = CACHE_DIR / f"{steam}.json"
        if merge and path.is_file():
            try:
                old = json.loads(path.read_text(encoding="utf-8"))
                for r in old.get("rows") or []:
                    key = f"{r.get('ymd')}|{r.get('clock')}|{r.get('victimSteamId')}|{r.get('server')}"
                    if key in seen:
                        continue
                    if (r.get("ymd") or "") < since:
                        continue
                    seen.add(key)
                    uniq.append(r)
                uniq.sort(
                    key=lambda x: (x.get("ymd") or "", x.get("clock") or ""),
                    reverse=True,
                )
            except Exception:
                pass
        doc = {
            "steamId": steam,
            "updatedAt": now,
            "since": since,
            "count": len(uniq),
            "rows": uniq,
        }
        path.write_text(json.dumps(doc, ensure_ascii=False) + "\n", encoding="utf-8")
        written += 1

    players = list(CACHE_DIR.glob("7656*.json"))
    total_rows = 0
    for p in players:
        try:
            total_rows += len(
                json.loads(p.read_text(encoding="utf-8")).get("rows") or []
            )
        except Exception:
            pass
    index = {
        "updatedAt": now,
        "since": since,
        "players": len(players),
        "totalRows": total_rows,
    }
    (CACHE_DIR / "_index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-11-01")
    ap.add_argument(
        "--incremental",
        action="store_true",
        help="только файлы новее state (live + новые backups)",
    )
    ap.add_argument("--server", action="append", default=[])
    args = ap.parse_args()
    since = args.since
    servers = tuple(args.server) if args.server else SERVERS
    state = load_state()
    by_steam: dict[str, list[dict]] = defaultdict(list)
    t0 = time.time()
    files_n = 0
    added = 0

    for server in servers:
        files = iter_log_files(server, since)
        for path in files:
            try:
                st = path.stat()
                sig = f"{st.st_mtime_ns}:{st.st_size}"
            except Exception:
                st = None
                sig = ""
            key = f"{server}:{path}"
            if args.incremental and state.get("files", {}).get(key) == sig:
                continue
            size_kb = (st.st_size // 1024) if st else 0
            print(f"parse {server} {path.name} ({size_kb}KB)")
            n = parse_file(path, server, since, by_steam)
            added += n
            files_n += 1
            if sig:
                state.setdefault("files", {})[key] = sig

    written = write_caches(by_steam, since, merge=bool(args.incremental))
    state["since"] = since
    state["updatedAt"] = datetime.now(timezone.utc).isoformat()
    save_state(state)
    print(
        f"done files={files_n} newTk={added} playersWritten={written} "
        f"sec={time.time() - t0:.1f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
