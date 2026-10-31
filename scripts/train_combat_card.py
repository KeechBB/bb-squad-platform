#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minute-by-minute training combat card from the server log.

Who, when, and with what. No RP is written and no ladder file is touched.
Cache: data/kv-cache/data/training/combat/<match id>.json
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import rp_log_parse as R  # noqa: E402

LOG_ROOT = Path("/var/www/bb-squad-logs")
TRAIN = Path("/var/www/bb-squad-platform/data/kv-cache/data/training")
CACHE = TRAIN / "combat"
MSK = timezone(timedelta(hours=3))

DROP = {
    "killerRp",
    "victimRp",
    "killerPwr",
    "victimPwr",
    "gainCoef",
    "formula",
    "steam",
    "killerKey",
    "victimKey",
    "at_dt",
    "at",
    "at_iso",
    "track",
    "victimTrack",
    "crewRole",
}


def slim(e: dict) -> dict:
    out = {}
    for k, v in e.items():
        if k in DROP or v is None or isinstance(v, datetime):
            continue
        out[k] = v
    if out.get("weapon"):
        out["weapon"] = R.short_causer(str(out["weapon"]))
    out["delta"] = 0
    out.pop("victimDelta", None)
    return out


def _verify_dirs_for_match(match_id: str) -> list[Path]:
    """Narrow folders first — full-tree rglob is too slow under the API timeout."""
    out: list[Path] = []
    row = month_row(match_id)
    if row and row.get("_month") and row.get("day") is not None:
        y, m = str(row["_month"]).split("-")[:2]
        day = int(row["day"])
        day_dir = LOG_ROOT / "matches" / y / f"{int(m):02d}" / f"{day:02d}"
        if day_dir.is_dir():
            out.append(day_dir)
    # id like 30-sec26… → scan recent months' day folders
    if match_id[:2].isdigit() and len(match_id) > 2 and match_id[2] == "-":
        day = int(match_id[:2])
        root = LOG_ROOT / "matches"
        if root.is_dir():
            years = sorted(
                (p for p in root.iterdir() if p.is_dir() and p.name.isdigit()),
                reverse=True,
            )[:2]
            for yp in years:
                months = sorted(
                    (p for p in yp.iterdir() if p.is_dir() and p.name.isdigit()),
                    reverse=True,
                )[:3]
                for mp in months:
                    day_dir = mp / f"{day:02d}"
                    if day_dir.is_dir() and day_dir not in out:
                        out.append(day_dir)
    return out


def find_slice(match_id: str) -> tuple[Path, dict] | None:
    def scan(dir_path: Path, *, deep: bool) -> tuple[Path, dict] | None:
        if not dir_path.is_dir():
            return None
        verifies = dir_path.rglob("verify.json") if deep else dir_path.glob("*/verify.json")
        for verify in verifies:
            try:
                doc = json.loads(verify.read_text(encoding="utf-8"))
            except Exception:
                continue
            if str(doc.get("legacyId") or "") != match_id:
                continue
            meta_path = verify.parent / "meta.json"
            if not meta_path.is_file():
                continue
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            return verify.parent, meta
        return None

    for day_dir in _verify_dirs_for_match(match_id):
        hit = scan(day_dir, deep=False)
        if hit:
            return hit
    # Last resort (old layouts) — still bounded to matches/, not whole disk
    root = LOG_ROOT / "matches"
    return scan(root, deep=True) if root.is_dir() else None


def month_row(match_id: str) -> dict | None:
    for path in sorted(TRAIN.glob("????-??.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for m in data.get("matches") or []:
            if str(m.get("id") or "") == match_id:
                row = dict(m)
                row["_month"] = path.stem
                return row
    return None


def parse_when(row: dict) -> tuple[datetime, datetime]:
    month = str(row.get("_month") or "")
    year_s, mon_s = month.split("-")
    day = int(row.get("day") or 1)
    hm = str(row.get("timeMsk") or "00:00")
    hh, mm = [int(x) for x in hm.split(":")[:2]]
    start = datetime(int(year_s), int(mon_s), day, hh, mm, tzinfo=MSK).astimezone(timezone.utc)
    dur = str(row.get("duration") or "0:00")
    parts = dur.split(":")
    sec = int(parts[0]) * 60 + int(parts[1] if len(parts) > 1 else 0)
    if sec < 60:
        sec = 50 * 60
    return start, start + timedelta(seconds=sec)


def _parse_meta_window(meta: dict) -> tuple[datetime, datetime]:
    t0 = datetime.fromisoformat(str(meta["start"]))
    t1 = datetime.fromisoformat(str(meta["end"]))
    if t0.tzinfo is None:
        t0 = t0.replace(tzinfo=timezone.utc)
    if t1.tzinfo is None:
        t1 = t1.replace(tzinfo=timezone.utc)
    return t0 - timedelta(minutes=3), t1 + timedelta(minutes=1)


def _slice_window(log: Path, dest: Path, t0: datetime, t1: datetime) -> int:
    n = 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".log.tmp")
    with log.open("r", encoding="utf-8", errors="replace") as inf, tmp.open(
        "w", encoding="utf-8"
    ) as out:
        for line in inf:
            if len(line) < 22 or line[0] != "[":
                continue
            raw = line[1:20]
            try:
                ts = R.parse_ts(raw)
            except Exception:
                continue
            if ts < t0:
                continue
            if ts > t1:
                if n > 50:
                    break
                continue
            out.write(line)
            n += 1
    if n:
        tmp.replace(dest)
    else:
        tmp.unlink(missing_ok=True)
    return n


def _server_key(meta: dict, folder: Path) -> str:
    srv = str(meta.get("server") or "").strip().upper()
    if srv in ("TR1", "TR2", "PB1", "CW1"):
        return srv
    ref_path = folder / "source.ref"
    if ref_path.is_file():
        ref = ref_path.read_text(encoding="utf-8").strip().replace("\\", "/")
        head = ref.split("/", 1)[0].upper()
        if head in ("TR1", "TR2", "PB1", "CW1"):
            return head
    return "TR1"


def _candidate_logs(folder: Path, meta: dict, t0: datetime, t1: datetime) -> list[Path]:
    """Live → source.ref → monthly backups that can cover the match window."""
    out: list[Path] = []
    seen: set[str] = set()

    def add(p: Path) -> None:
        try:
            key = str(p.resolve())
        except Exception:
            key = str(p)
        if key in seen or not p.is_file():
            return
        seen.add(key)
        out.append(p)

    server = _server_key(meta, folder)
    add(LOG_ROOT / server / "_live" / "SquadGame.log")
    ref_path = folder / "source.ref"
    if ref_path.is_file():
        ref = ref_path.read_text(encoding="utf-8").strip()
        if ref:
            add(LOG_ROOT / ref)
    # Backups named SquadGame-backup-YYYY.MM.DD-HH.MM.SS.log (UTC rotate time).
    month = t0.astimezone(timezone.utc).strftime("%Y-%m")
    backup_dir = LOG_ROOT / server / month
    if backup_dir.is_dir():
        # Prefer backups whose rotate stamp is after match start.
        ranked: list[tuple[datetime, Path]] = []
        for path in backup_dir.glob("SquadGame-backup-*.log"):
            stem = path.stem  # SquadGame-backup-2026.10.28-21.39.35
            stamp = stem.split("SquadGame-backup-")[-1]
            try:
                rot = datetime.strptime(stamp, "%Y.%m.%d-%H.%M.%S").replace(
                    tzinfo=timezone.utc
                )
            except Exception:
                continue
            if rot < t0 - timedelta(hours=6):
                continue
            ranked.append((rot, path))
        ranked.sort(key=lambda x: x[0])
        for _, path in ranked:
            add(path)
    return out


def ensure_layer(folder: Path, meta: dict) -> Path:
    dest = folder / "layer.log"
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    t0, t1 = _parse_meta_window(meta)
    last_err = "window empty"
    for log in _candidate_logs(folder, meta, t0, t1):
        n = _slice_window(log, dest, t0, t1)
        if n:
            # Remember which archive worked so next rebuild is instant.
            try:
                rel = str(log.relative_to(LOG_ROOT)).replace("\\", "/")
                (folder / "source.ref").write_text(rel + "\n", encoding="utf-8")
            except Exception:
                pass
            print(f"sliced {n} lines from {log.name}", file=sys.stderr)
            return dest
        last_err = f"window empty in {log.name}"
    raise SystemExit(last_err)


def bucket(events: list[dict], aliases: dict[str, str]) -> dict[str, dict]:
    by: dict[str, dict] = {}

    def card(key: str, nick: str) -> dict:
        row = by.get(key)
        if row is None:
            row = {
                "nick": nick,
                "kills": [],
                "deaths": [],
                "teamkills": [],
                "revives": [],
                "noks": [],
                "gotNoks": [],
                "vehicles": [],
            }
            by[key] = row
        return row

    for e in events:
        kind = str(e.get("kind") or "")
        kk = R.canon_key(str(e.get("killer") or ""), aliases)
        vk = R.canon_key(str(e.get("victim") or ""), aliases)
        slim_e = slim(e)
        if kind in ("die", "vehicle_kill", "driver_share") or (
            kind == "tk" and kk
        ):
            if kind == "driver_share" and e.get("reason") == "nok":
                if kk:
                    card(kk, str(e.get("killer") or kk))["noks"].append(slim_e)
            elif kk and kind != "tk":
                card(kk, str(e.get("killer") or kk))["kills"].append(slim_e)
            elif kk and kind == "tk":
                card(kk, str(e.get("killer") or kk))["teamkills"].append(slim_e)
        if kind in ("die", "tk") and vk:
            card(vk, str(e.get("victim") or vk))["deaths"].append(slim_e)
        if kind in ("vehicle_loss", "vehicle_loss_driver") and vk:
            card(vk, str(e.get("victim") or vk))["deaths"].append(slim_e)
        if kind == "nok" and kk:
            card(kk, str(e.get("killer") or kk))["noks"].append(slim_e)
        if kind == "nok" and vk:
            card(vk, str(e.get("victim") or vk))["gotNoks"].append(slim_e)
        if kind == "revive" and kk:
            card(kk, str(e.get("killer") or kk))["revives"].append(slim_e)
        if kind in ("vehicle_kill", "vehicle_loss", "vehicle_loss_driver"):
            who = kk if kind == "vehicle_kill" else vk
            nick = str(e.get("killer") if kind == "vehicle_kill" else e.get("victim") or who)
            if who:
                card(who, nick)["vehicles"].append(slim_e)
    return by


def build(match_id: str) -> dict:
    found = find_slice(match_id)
    row = month_row(match_id) or {}
    if found:
        folder, meta = found
        layer = ensure_layer(folder, meta)
        t0 = datetime.fromisoformat(str(meta["start"]))
        t1 = datetime.fromisoformat(str(meta["end"]))
        if t0.tzinfo is None:
            t0 = t0.replace(tzinfo=timezone.utc)
        if t1.tzinfo is None:
            t1 = t1.replace(tzinfo=timezone.utc)
        map_name = str(meta.get("map") or row.get("map") or "")
        date = (t0.astimezone(MSK)).strftime("%Y-%m-%d")
        time_s = (t0.astimezone(MSK)).strftime("%H:%M")
    else:
        if not row:
            raise SystemExit(f"unknown match {match_id}")
        t0, t1 = parse_when(row)
        log = LOG_ROOT / "TR1" / "_live" / "SquadGame.log"
        folder = CACHE / "_layers" / match_id
        meta = {
            "matchKey": match_id,
            "start": t0.isoformat(),
            "end": t1.isoformat(),
            "map": row.get("map") or "",
        }
        (folder / "source.ref").parent.mkdir(parents=True, exist_ok=True)
        (folder / "source.ref").write_text(
            "TR1/_live/SquadGame.log\n", encoding="utf-8"
        )
        if not log.is_file():
            raise SystemExit("no live log")
        layer = ensure_layer(folder, meta)
        map_name = str(row.get("map") or "")
        date = t0.astimezone(MSK).strftime("%Y-%m-%d")
        time_s = str(row.get("timeMsk") or t0.astimezone(MSK).strftime("%H:%M"))

    aliases: dict[str, str] = {}
    idx = R.index_log_combat(layer, aliases)
    discovered = R.discover_matches([layer])
    faction_to_team: dict[str, str] = {}
    for m in discovered:
        ms = m.get("start")
        me = m.get("end")
        if ms and me and ms <= t1 and me >= t0:
            faction_to_team = m.get("factionToTeam") or {}
            break
    steam_to_nick = dict(idx.get("steam_to_nick") or {})
    dies, die_noks = R.dies_in_window(idx, t0, t1, steam_to_nick, aliases)
    wound_noks = R.wounds_in_window(idx, t0, t1, steam_to_nick, aliases)
    noks = list(wound_noks)
    for d in die_noks:
        dt = d.get("at_dt")
        skip = False
        if dt is not None:
            for w in wound_noks:
                wdt = w.get("at_dt")
                if wdt is None:
                    continue
                if (
                    w.get("killerKey") == d.get("killerKey")
                    and w.get("victimKey") == d.get("victimKey")
                    and abs((wdt - dt).total_seconds()) <= 120
                ):
                    skip = True
                    break
        if not skip:
            noks.append(d)
    revives = R.revives_in_window(idx, t0, t1)
    vehicle_ops = R.vehicle_ops_in_window(idx, t0, t1, steam_to_nick, aliases)
    team_timeline = R.team_timeline_in_window(idx, t0, t1, faction_to_team)
    teams = R.teams_in_window(idx, t0, t1, faction_to_team)
    if not teams:
        pj = TRAIN / "players" / f"{match_id}.json"
        if pj.is_file():
            docp = json.loads(pj.read_text(encoding="utf-8"))
            for side, rows in (("1", docp.get("teamA") or []), ("2", docp.get("teamB") or [])):
                for prow in rows:
                    nickp = str((prow or {}).get("nick") or "").strip()
                    if nickp:
                        teams[R.canon_key(nickp, aliases)] = side
    rp: dict[str, float] = {}
    disp: dict[str, str] = {}
    events, _net, die_n, tk_n, rev_n, nok_n = R.score_match_rp(
        dies=dies,
        wounds=noks,
        revives=revives,
        teams=teams,
        rp=rp,
        disp=disp,
        aliases=aliases,
        new_formula=True,
        match_date=date,
        match_id=match_id,
        vehicle_ops=vehicle_ops,
        cutover_at=t0,
        team_timeline=team_timeline,
    )
    players = bucket(events, aliases)
    out_players = {}
    for key, card in players.items():
        nick = str(card.pop("nick") or key)
        body = {
            "id": match_id,
            "map": map_name,
            "date": date,
            "time": time_s,
            "net": 0,
            **card,
        }
        out_players[R.nick_key(nick)] = body
        out_players[key] = body
    doc = {
        "id": match_id,
        "map": map_name,
        "date": date,
        "time": time_s,
        "counts": {
            "players": len(players),
            "dies": die_n,
            "teamkills": tk_n,
            "revives": rev_n,
            "noks": nok_n,
        },
        "players": out_players,
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{match_id}.json"
    path.write_text(json.dumps(doc, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"card {match_id} players={len(players)} dies={die_n} noks={nok_n} revives={rev_n}",
        file=sys.stderr,
    )
    return doc


def main() -> None:
    match_id = ""
    nick = ""
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--id" and i + 1 < len(args):
            match_id = args[i + 1]
            i += 2
            continue
        if args[i] == "--nick" and i + 1 < len(args):
            nick = args[i + 1]
            i += 2
            continue
        i += 1
    if not match_id or not all(c.isalnum() or c in "-_" for c in match_id):
        raise SystemExit("need --id")
    path = CACHE / f"{match_id}.json"
    doc = None
    if path.is_file() and "--rebuild" not in args:
        doc = json.loads(path.read_text(encoding="utf-8"))
    else:
        doc = build(match_id)
    if not nick:
        counts = doc.get("counts") or {}
        print(json.dumps({"ok": True, "id": match_id, "counts": counts}, ensure_ascii=False))
        return
    key = R.nick_key(nick)
    player = (doc.get("players") or {}).get(key)
    if player is None:
        print(json.dumps({"ok": True, "match": None}, ensure_ascii=False))
        return
    print(json.dumps({"ok": True, "match": player}, ensure_ascii=False))


if __name__ == "__main__":
    main()
