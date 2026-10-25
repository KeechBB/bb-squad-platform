#!/usr/bin/env python3
"""One-shot: fill TRAIN RP for calendar matches with no real combat log.

Formula (Alex 2026-10-26): kill +25, nok +3, death -25. No revive/TK/vehicle.

Sources: month calendar + players/*.json. Skips ids already on ladder with
non-zero combat (giveUpKills/teamkills/revives > 0 or any |net| > 0.01).

Usage:
  python3 scripts/train_rp_backfill_lost_logs.py --dry-run
  python3 scripts/train_rp_backfill_lost_logs.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

KILL_RP = 25.0
NOK_RP = 3.0
DEATH_RP = -25.0
START_RP = 1000.0
MIN_RP = 1.0


def nick_key(n: str) -> str:
    return "".join(str(n or "").strip().lower().split())


def train_dir() -> Path:
    for raw in (
        os.environ.get("BB_KV_PUBLIC"),
        "/var/www/bb-squad-platform/data/kv-cache",
        "/var/www/blackberry-kv",
    ):
        if not raw:
            continue
        p = Path(raw) / "data" / "training"
        if (p / "rp-ladder.json").is_file() or list(p.glob("????-??.json")):
            return p
    raise SystemExit("no training dir")


def load_aliases(train: Path) -> dict[str, str]:
    for cand in (
        train.parent / "tiers.json",
        Path("/var/www/blackberry-kv/data/tiers.json"),
    ):
        if cand.is_file():
            try:
                return dict(json.loads(cand.read_text(encoding="utf-8")).get("aliases") or {})
            except Exception:
                pass
    return {}


def canon(n: str, aliases: dict[str, str]) -> str:
    k = nick_key(n)
    a = aliases.get(k) or aliases.get(n)
    return nick_key(a) if a else k


def rank_from_rp(rp: float) -> tuple[str, str]:
    # mirror trainRp.rpRankFromScore defaults (step 150, radiant3Max 4500-ish)
    try:
        import rp_log_parse as R  # noqa: WPS433

        if hasattr(R, "rank_label_from_rp"):
            return R.rank_label_from_rp(rp)  # type: ignore
    except Exception:
        pass
    step = 150
    names = [
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
    if rp >= 4500:
        return "PREDATOR", "predator"
    band = max(0, int((rp - START_RP) // step))
    ni = min(band // 3, len(names) - 1)
    roman = ["I", "II", "III"][min(band % 3, 2)]
    label, key = names[ni]
    return f"{label.upper()} {roman}", key


def calendar_matches(train: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for path in sorted(train.glob("????-??.json")):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        ym = path.stem
        for m in doc.get("matches") or []:
            mid = str(m.get("id") or "").strip()
            if not mid or mid.endswith("-skip"):
                continue
            if str(m.get("status") or "done") in ("upcoming", "cancel", "cancelled"):
                continue
            day = int(m.get("day") or 0)
            if not day:
                continue
            # skip SEC 26 junk
            if "SEC 26" in str(m.get("map") or "").upper():
                continue
            ta = m.get("ticketsA")
            tb = m.get("ticketsB")
            if ta is None and tb is None:
                continue
            try:
                if int(ta or 0) == 0 and int(tb or 0) == 0:
                    continue
            except Exception:
                continue
            date = f"{ym}-{day:02d}"
            time_msk = str(m.get("timeMsk") or "12:00")
            out.append(
                {
                    "id": mid,
                    "date": date,
                    "map": m.get("map") or "—",
                    "timeMsk": time_msk,
                    "playersUrl": m.get("playersUrl")
                    or f"data/training/players/{mid}.json",
                    "sort": f"{date}T{time_msk.zfill(5)}",
                }
            )
    out.sort(key=lambda x: x["sort"])
    return out


def load_players(train: Path, mid: str) -> list[dict[str, Any]]:
    p = train / "players" / f"{mid}.json"
    if not p.is_file():
        return []
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []
    rows = list(doc.get("players") or [])
    if not rows:
        rows = list(doc.get("teamA") or []) + list(doc.get("teamB") or [])
    return [r for r in rows if isinstance(r, dict) and r.get("nick")]


def formula_net(row: dict[str, Any]) -> float:
    kills = int(row.get("kills") or 0)
    deaths = int(row.get("deaths") or 0)
    nok = int(row.get("nok") or row.get("noks") or 0)
    return kills * KILL_RP + nok * NOK_RP + deaths * DEATH_RP


def ladder_scored_ids(ladder: dict) -> set[str]:
    """Ids that already have real (non-empty) RP combat."""
    out: set[str] = set()
    for m in ladder.get("matches") or []:
        mid = str(m.get("id") or "")
        if not mid:
            continue
        die = int(m.get("giveUpKills") or 0)
        tk = int(m.get("teamkills") or 0)
        rev = int(m.get("revives") or 0)
        nets = m.get("netByNick") or {}
        nonzero = sum(1 for v in nets.values() if abs(float(v or 0)) > 0.01)
        if die > 0 or tk > 0 or rev > 0 or nonzero > 0:
            out.add(mid)
    return out


def rebuild_ranks(players: dict[str, Any]) -> None:
    for pl in players.values():
        if not isinstance(pl, dict):
            continue
        rp = float(pl.get("rp") or START_RP)
        label, key = rank_from_rp(rp)
        pl["rankLabel"] = label
        pl["rankKey"] = key
        pl["predatorPlace"] = None
    # predator top by rp >= 4500
    preds = sorted(
        (p for p in players.values() if isinstance(p, dict) and float(p.get("rp") or 0) >= 4500),
        key=lambda p: -float(p.get("rp") or 0),
    )
    for i, p in enumerate(preds, 1):
        p["rankLabel"] = f"PREDATOR #{i}"
        p["rankKey"] = "predator"
        p["predatorPlace"] = i


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    train = train_dir()
    os.environ.setdefault("BB_KV_PUBLIC", str(train.parents[1]))
    aliases_raw = load_aliases(train)
    aliases = {nick_key(k): v for k, v in aliases_raw.items()}

    ladder_path = train / "rp-ladder.json"
    ledger_path = train / "rp-ledger.json"
    ladder = json.loads(ladder_path.read_text(encoding="utf-8"))
    ledger = (
        json.loads(ledger_path.read_text(encoding="utf-8"))
        if ledger_path.is_file()
        else json.loads(json.dumps(ladder))
    )

    scored = ladder_scored_ids(ladder)
    cal = calendar_matches(train)
    cal_by_id = {m["id"]: m for m in cal}
    targets = [m for m in cal if m["id"] not in scored]
    print(
        f"train={train} calendar={len(cal)} already_scored={len(scored)} "
        f"backfill_targets={len(targets)}",
        flush=True,
    )

    # Nets per match: keep real ladder combat; formula for lost-log gaps.
    match_nets: dict[str, dict[str, float]] = {}
    match_meta: dict[str, dict[str, Any]] = {}
    disp: dict[str, str] = {}

    for m in ladder.get("matches") or []:
        mid = str(m.get("id") or "")
        if mid not in scored:
            continue
        nets: dict[str, float] = {}
        for nick, v in (m.get("netByNick") or {}).items():
            ck = canon(str(nick), aliases)
            nets[ck] = nets.get(ck, 0.0) + float(v or 0)
            disp.setdefault(ck, str(nick))
        match_nets[mid] = nets
        meta = cal_by_id.get(mid) or {
            "id": mid,
            "date": m.get("date"),
            "map": m.get("map"),
            "sort": f"{m.get('date')}-12:00",
        }
        match_meta[mid] = {
            **meta,
            "source": "log",
            "giveUpKills": m.get("giveUpKills") or 0,
            "teamkills": m.get("teamkills") or 0,
            "revives": m.get("revives") or 0,
            "raw": m,
        }

    filled = 0
    for m in targets:
        mid = m["id"]
        rows = load_players(train, mid)
        if len(rows) < 4:
            print(f"skip {mid}: no players file / thin", flush=True)
            continue
        nets = {}
        for row in rows:
            nick = str(row.get("nick") or "").strip()
            if not nick:
                continue
            ck = canon(nick, aliases)
            nets[ck] = nets.get(ck, 0.0) + formula_net(row)
            disp.setdefault(ck, nick)
        if not nets:
            continue
        match_nets[mid] = nets
        match_meta[mid] = {
            **m,
            "source": "lost-log-formula",
            "giveUpKills": 0,
            "teamkills": 0,
            "revives": 0,
        }
        filled += 1
        print(f"+ formula {mid} players={len(nets)}", flush=True)

    # Full chrono replay from 1000 so gaps between real matches don't skew.
    ordered = sorted(
        match_nets.keys(),
        key=lambda mid: str(
            match_meta.get(mid, {}).get("sort")
            or f"{match_meta.get(mid, {}).get('date')}-{mid}"
        ),
    )
    rp: dict[str, float] = {ck: START_RP for ck in disp}
    hist: dict[str, list[dict[str, Any]]] = {ck: [] for ck in disp}
    match_rows: list[dict[str, Any]] = []

    for mid in ordered:
        nets = match_nets[mid]
        meta = match_meta[mid]
        for ck, net in nets.items():
            rp.setdefault(ck, START_RP)
            hist.setdefault(ck, [])
            disp.setdefault(ck, ck)
            after = max(MIN_RP, round(rp[ck] + net, 1))
            rp[ck] = after
            hist[ck] = [h for h in hist[ck] if str(h.get("id")) != mid]
            hist[ck].append(
                {
                    "id": mid,
                    "map": meta.get("map") or "—",
                    "date": meta.get("date"),
                    "net": round(net, 2),
                    **(
                        {"source": "lost-log-formula"}
                        if meta.get("source") == "lost-log-formula"
                        else {}
                    ),
                }
            )
        net_by_nick = {
            disp.get(ck, ck): round(v, 2)
            for ck, v in sorted(nets.items(), key=lambda x: -abs(x[1]))
        }
        row = {
            "id": mid,
            "map": meta.get("map") or "—",
            "date": meta.get("date"),
            "giveUpKills": meta.get("giveUpKills") or 0,
            "teamkills": meta.get("teamkills") or 0,
            "revives": meta.get("revives") or 0,
            "netByNick": net_by_nick,
        }
        if meta.get("source") == "lost-log-formula":
            row["source"] = "lost-log-formula"
            row["note"] = "kill+25 nok+3 death-25 (one-shot backfill)"
        elif isinstance(meta.get("raw"), dict):
            for k in ("giveUpKills", "teamkills", "revives"):
                if k in meta["raw"]:
                    row[k] = meta["raw"][k]
        match_rows.append(row)

    players_out: dict[str, Any] = {}
    for ck, nick in disp.items():
        players_out[ck] = {
            "nick": nick,
            "rp": max(MIN_RP, round(rp.get(ck, START_RP), 1)),
            "rankLabel": "IRON I",
            "rankKey": "iron",
            "predatorPlace": None,
            "matches": sorted(
                hist.get(ck) or [],
                key=lambda h: f"{h.get('date')}-{h.get('id')}",
            ),
        }
    rebuild_ranks(players_out)
    lb = [
        {
            "nick": pl.get("nick"),
            "rp": pl.get("rp"),
            "rankLabel": pl.get("rankLabel"),
            "rankKey": pl.get("rankKey"),
            "predatorPlace": pl.get("predatorPlace"),
        }
        for pl in players_out.values()
    ]
    lb.sort(key=lambda r: (-float(r.get("rp") or 0), str(r.get("nick") or "").lower()))

    print(
        f"filled_matches={filled} total_matches={len(match_rows)} players={len(players_out)} dry={args.dry_run}",
        flush=True,
    )
    if args.dry_run:
        return 0

    now = datetime.now(timezone.utc).isoformat()
    for doc, path in ((ladder, ladder_path), (ledger, ledger_path)):
        doc["players"] = players_out
        doc["matches"] = match_rows
        doc["leaderboard"] = lb
        doc["updatedAt"] = now
        doc["lostLogBackfill"] = {
            "at": now,
            "formula": {"kill": KILL_RP, "nok": NOK_RP, "death": DEATH_RP},
            "matches": filled,
        }
        path.write_text(
            json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {path} ({path.stat().st_size} bytes)", flush=True)

    try:
        import rp_ladder_db as RPDB

        RPDB.sync_from_path("TRAIN", ladder_path)
    except Exception as e:
        print(f"db sync skip: {e}", flush=True)

    # mirrors
    for dest in (
        Path("/var/www/blackberry-kv/data/training"),
        train,
    ):
        if dest == train or not dest.is_dir():
            continue
        try:
            (dest / "rp-ladder.json").write_text(
                ladder_path.read_text(encoding="utf-8"), encoding="utf-8"
            )
            (dest / "rp-ledger.json").write_text(
                ledger_path.read_text(encoding="utf-8"), encoding="utf-8"
            )
            print(f"mirrored → {dest}", flush=True)
        except Exception as e:
            print(f"mirror skip {dest}: {e}", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
