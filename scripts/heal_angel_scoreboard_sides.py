#!/usr/bin/env python3
"""Развести двух angel на табло по Steam + клан-тегу.

Саня [BB] и ALPHA 〔 A 〕 — один игровой ник, разные теги и стороны.
Скрин/OCR оставляют одну строку «angel» → чиним teamA/teamB из лога.

Usage:
  python3 scripts/heal_angel_scoreboard_sides.py --id 25-cslmutaha-2
  python3 scripts/heal_angel_scoreboard_sides.py --since 2026-11-25
  python3 scripts/heal_angel_scoreboard_sides.py --since 2026-11-25 --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import train_combat_card as tcc  # noqa: E402
import rp_log_parse as R  # noqa: E402

MSK = timezone(timedelta(hours=3))

ANGELS = {
    "76561198941350361": {
        "label": "BB-Sanya",
        "display": "[BB] angel",
        "clanTag": "BB",
        "siteNick": "angel",
    },
    "76561198730638062": {
        "label": "ALPHA-8062",
        "display": "〔 A 〕 angel",
        "clanTag": "A",
        "siteNick": "angel ·8062",
    },
    "76561198421145708": {
        "label": "Alan",
        "display": "✝︎Angel✝︎🪽",
        "clanTag": "",
        "siteNick": "✝︎Angel✝︎🪽",
    },
}


def is_plain_angel_nick(nick: str) -> bool:
    s = R.nick_key(nick)
    if s == "angel":
        return True
    # уже размеченные heal'ом
    compact = "".join(ch for ch in s if ch.isalnum())
    return compact == "angel"


def combat_stats(match_id: str, steam: str) -> dict | None:
    p = ROOT / "data" / "kv-cache" / "data" / "training" / "combat" / f"{match_id}.json"
    if not p.is_file():
        # try rebuild
        try:
            tcc.build(match_id)
        except Exception as e:
            print(f"  combat rebuild fail {match_id}: {e}", file=sys.stderr)
            return None
    if not p.is_file():
        return None
    doc = json.loads(p.read_text(encoding="utf-8"))
    card = (doc.get("players") or {}).get(f"angel#{steam}")
    if not card:
        return None
    kills = list(card.get("kills") or [])
    deaths = list(card.get("deaths") or [])
    noks = list(card.get("noks") or [])
    rev = list(card.get("revives") or [])
    veh = list(card.get("vehicles") or [])
    dmg = 0
    for e in kills + noks:
        dmg += int(e.get("dmg") or 0)
    return {
        "kills": len(kills),
        "deaths": len(deaths),
        "nok": len(noks),
        "res": len(rev),
        "vehicleKills": len(veh)
        or sum(1 for e in kills if e.get("kind") == "vehicle_kill"),
        "dmg": dmg,
    }


def angel_team_map(match_id: str) -> dict[str, str]:
    """steamId → '1'|'2' (teamA/teamB)."""
    found = tcc.find_slice(match_id)
    row = tcc.month_row(match_id) or {}
    if not found:
        return {}
    folder, meta = found
    layer = tcc.ensure_layer(folder, {**meta, **row})
    t0 = datetime.fromisoformat(str(meta["start"]))
    t1 = datetime.fromisoformat(str(meta["end"]))
    if t0.tzinfo is None:
        t0 = t0.replace(tzinfo=timezone.utc)
    if t1.tzinfo is None:
        t1 = t1.replace(tzinfo=timezone.utc)
    idx = R.index_log_combat(layer, {})
    discovered = R.discover_matches([layer])
    faction_to_team: dict[str, str] = {}
    for m in discovered:
        ms, me = m.get("start"), m.get("end")
        if ms and me and ms <= t1 and me >= t0:
            faction_to_team = m.get("factionToTeam") or {}
            break
    teams = R.teams_in_window(idx, t0, t1, faction_to_team)
    out: dict[str, str] = {}
    for k, side in teams.items():
        if k.startswith("angel#") and side in ("1", "2"):
            out[k.split("#", 1)[1]] = side
    return out


def players_paths(match_id: str) -> list[Path]:
    rel = Path("data") / "training" / "players" / f"{match_id}.json"
    roots = [
        ROOT / "data" / "kv-cache",
        ROOT / "data" / "kv-cache" / "blackberry-kv",
        ROOT / "data" / "kv-cache" / "public" / "public",
        ROOT / "data" / "kv-cache" / "blackberry-kv" / "public",
    ]
    out: list[Path] = []
    for r in roots:
        p = r / rel
        if p.is_file():
            out.append(p)
    # canonical first
    primary = ROOT / "data" / "kv-cache" / rel
    if primary.is_file() and primary not in out:
        out.insert(0, primary)
    # dedupe
    seen = set()
    uniq = []
    for p in out:
        rp = str(p.resolve())
        if rp in seen:
            continue
        seen.add(rp)
        uniq.append(p)
    return uniq


def make_row(
    steam: str,
    side_name: str,
    won: bool,
    stats: dict,
    fallback: dict | None,
) -> dict:
    meta = ANGELS[steam]
    base = {
        "nick": meta["display"],
        "res": int(stats.get("res") or 0),
        "nok": int(stats.get("nok") or 0),
        "kills": int(stats.get("kills") or 0),
        "deaths": int(stats.get("deaths") or 0),
        "dmg": int(stats.get("dmg") or 0),
        "vehicleKills": int(stats.get("vehicleKills") or 0),
        "team": side_name,
        "won": won,
        "steamId": steam,
        "clanTag": meta["clanTag"],
        "siteNick": meta["siteNick"],
        "angelSteamSplit": True,
    }
    # dmg с OCR табло, если combat без урона
    if base["dmg"] <= 0 and fallback:
        base["dmg"] = int(fallback.get("dmg") or 0)
        if base["vehicleKills"] <= 0:
            base["vehicleKills"] = int(fallback.get("vehicleKills") or 0)
    return base


def heal_doc(match_id: str, doc: dict, team_by_steam: dict[str, str]) -> tuple[dict, list[str]]:
    notes: list[str] = []
    if not team_by_steam:
        return doc, ["no steam team map"]

    side_a = (doc.get("sideA") or {}).get("name") or "A"
    side_b = (doc.get("sideB") or {}).get("name") or "B"
    winner = str(doc.get("winner") or "").strip()

    def won_for(side_name: str) -> bool:
        if not winner:
            # tickets
            ta = (doc.get("sideA") or {}).get("tickets")
            tb = (doc.get("sideB") or {}).get("tickets")
            try:
                ta_i, tb_i = int(ta), int(tb)
            except (TypeError, ValueError):
                return False
            if side_name == side_a:
                return ta_i > tb_i
            return tb_i > ta_i
        return R.nick_key(side_name) == R.nick_key(winner) or side_name == winner

    # старые angel-строки (plain или уже heal) — снимем, цифры OCR сохраним как fallback по стороне
    fallback_by_side: dict[str, dict] = {}
    new_a: list[dict] = []
    new_b: list[dict] = []
    removed = 0
    for side_key, bucket, side_name in (
        ("1", new_a, side_a),
        ("2", new_b, side_b),
    ):
        src = doc.get("teamA" if side_key == "1" else "teamB") or []
        for row in src:
            nick = str((row or {}).get("nick") or "")
            steam = str((row or {}).get("steamId") or "").strip()
            if is_plain_angel_nick(nick) or steam in ANGELS:
                fallback_by_side[side_key] = dict(row)
                removed += 1
                continue
            bucket.append(row)

    inserted = []
    for steam, side in team_by_steam.items():
        if steam not in ANGELS:
            continue
        if side not in ("1", "2"):
            continue
        stats = combat_stats(match_id, steam) or {}
        side_name = side_a if side == "1" else side_b
        row = make_row(
            steam,
            side_name,
            won_for(side_name),
            stats,
            fallback_by_side.get(side),
        )
        (new_a if side == "1" else new_b).append(row)
        inserted.append(f"{ANGELS[steam]['label']}→{'A' if side=='1' else 'B'}({side_name})")

    if not inserted:
        return doc, ["no angel rows to insert"]

    out = deepcopy(doc)
    out["teamA"] = new_a
    out["teamB"] = new_b
    out["angelSteamSplit"] = True
    out["angelSteamSplitNote"] = (
        f"healed {removed} plain angel → " + ", ".join(inserted)
    )
    # flat players list if present
    if isinstance(out.get("players"), list):
        out["players"] = list(new_a) + list(new_b)
    notes.append(out["angelSteamSplitNote"])
    return out, notes


def month_match_ids(since: str | None) -> list[str]:
    ids: list[str] = []
    train = ROOT / "data" / "kv-cache" / "data" / "training"
    for p in sorted(train.glob("????-??.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        year_s, mon_s = p.stem.split("-")
        year, month = int(year_s), int(mon_s)
        for m in data.get("matches") or []:
            mid = str(m.get("id") or "").strip()
            if not mid:
                continue
            day = int(m.get("day") or 0)
            ymd = f"{year:04d}-{month:02d}-{day:02d}"
            if since and ymd < since:
                continue
            # only if players file has angel
            pp = train / "players" / f"{mid}.json"
            if not pp.is_file():
                continue
            try:
                doc = json.loads(pp.read_text(encoding="utf-8"))
            except Exception:
                continue
            rows = list(doc.get("teamA") or []) + list(doc.get("teamB") or [])
            if any(is_plain_angel_nick(str(r.get("nick") or "")) for r in rows):
                ids.append(mid)
            elif any(
                str(r.get("steamId") or "") in ANGELS for r in rows
            ):
                ids.append(mid)
    return ids


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", action="append", default=[])
    ap.add_argument("--since", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    ids = list(args.id) or month_match_ids(args.since)
    if not ids:
        print("no matches")
        return 0
    changed = 0
    for mid in ids:
        print(f"== {mid}")
        try:
            team_map = angel_team_map(mid)
        except Exception as e:
            print(f"  team map fail: {e}")
            continue
        print(f"  teams { {ANGELS.get(s,{}).get('label',s): t for s,t in team_map.items()} }")
        paths = players_paths(mid)
        if not paths:
            print("  no players.json")
            continue
        primary = paths[0]
        doc = json.loads(primary.read_text(encoding="utf-8"))
        new_doc, notes = heal_doc(mid, doc, team_map)
        for n in notes:
            print(f"  {n}")
        if new_doc is doc or notes == ["no angel rows to insert"]:
            continue
        # skip write if identical content for angel rows
        if (
            json.dumps(doc.get("teamA"), sort_keys=True, ensure_ascii=False)
            == json.dumps(new_doc.get("teamA"), sort_keys=True, ensure_ascii=False)
            and json.dumps(doc.get("teamB"), sort_keys=True, ensure_ascii=False)
            == json.dumps(new_doc.get("teamB"), sort_keys=True, ensure_ascii=False)
        ):
            print("  already healed")
            continue
        changed += 1
        if args.dry_run:
            print("  dry-run skip write")
            continue
        text = json.dumps(new_doc, ensure_ascii=False, indent=2) + "\n"
        for p in paths:
            p.write_text(text, encoding="utf-8")
            print(f"  wrote {p}")
    print(f"done changed={changed}/{len(ids)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
