#!/usr/bin/env python3
"""Импорт TRAIN/CW из legacy kv-cache JSON → CanonMatch / CanonMatchPlayer.

Не удаляет и не переписывает JSON. Идемпотентный upsert по matchKey.

Usage:
  python3 scripts/import_canon_from_kv_cache.py --root /path/to/KV/public/data --dry-run
  python3 scripts/import_canon_from_kv_cache.py --root ... --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Optional: load .env next to platform/
ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
if ENV.exists():
    for line in ENV.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        os.environ.setdefault(k, v)


def slug_map(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "", (name or "").lower())
    return s[:32] or "map"


def server_key_from_label(label: str | None) -> str:
    if not label:
        return "unk"
    u = label.upper()
    for key in ("TR1", "TR2", "TR3", "PB1", "PB2", "PB3"):
        if key in u or f"({key})" in u:
            return key.lower()
    if "TRAINING" in u or "ТРЕН" in u:
        return "tr"
    return "srv"


def parse_time_hm(t: str | None) -> str | None:
    if not t:
        return None
    m = re.match(r"^(\d{1,2}):(\d{2})", str(t).strip())
    if not m:
        return None
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def match_key(year: int, month: int, day: int, server: str | None, map_name: str, time_msk: str | None) -> str:
    hm = (time_msk or "0000").replace(":", "")
    if len(hm) < 4:
        hm = hm.zfill(4)
    date = f"{year:04d}-{month:02d}-{day:02d}"
    return f"{date}_{server_key_from_label(server)}_{slug_map(map_name)}_{hm[:4]}"


def load_month(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("matches"), list):
        return data["matches"]
    return []


def int_or_none(v: Any) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def float_or_none(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def resolve_players_path(root: Path, row: dict[str, Any], legacy_id: str, kind: str) -> Path:
    """Prefer playersUrl from row; else conventional path."""
    url = str(row.get("playersUrl") or "").replace("\\", "/").strip()
    if url.startswith("data/"):
        # data/… relative to public/ — our root is public/data
        rel = url[len("data/") :]
        cand = root / rel
        if cand.exists():
            return cand
    if kind == "TRAIN":
        return root / "training" / "players" / f"{legacy_id}.json"
    return root / "players" / f"{legacy_id}.json"


def train_rows(root: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    train_dir = root / "training"
    if not train_dir.is_dir():
        return out
    for month_path in sorted(train_dir.glob("????-??.json")):
        ym = month_path.stem  # 2026-10
        try:
            year, month = map(int, ym.split("-"))
        except ValueError:
            continue
        for row in load_month(month_path):
            legacy_id = str(row.get("id") or "").strip()
            if not legacy_id:
                continue
            day = int(row.get("day") or 0) or 1
            time_msk = parse_time_hm(row.get("time") or row.get("timeMsk"))
            srv = row.get("server")
            mk = match_key(year, month, day, srv, str(row.get("map") or "map"), time_msk)
            players_path = resolve_players_path(root, row, legacy_id, "TRAIN")
            players_raw: dict[str, Any] = {}
            if players_path.exists():
                try:
                    players_raw = json.loads(players_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    players_raw = {}
            # Prefer serverKey from players file when month row has long label
            srv_key_src = players_raw.get("serverKey") or players_raw.get("server") or srv
            pl_rows: list[dict[str, Any]] = []
            for side_key, side in (("teamA", "A"), ("teamB", "B")):
                for p in players_raw.get(side_key) or []:
                    if not isinstance(p, dict):
                        continue
                    nick = str(p.get("nick") or "").strip()
                    if not nick:
                        continue
                    pl_rows.append(
                        {
                            "side": side,
                            "round": 0,
                            "nick": nick,
                            "kills": int(p.get("kills") or 0),
                            "deaths": int(p.get("deaths") or 0),
                            "nok": int(p.get("nok") or 0),
                            "res": int(p.get("res") or 0),
                            "dmg": float_or_none(p.get("dmg")),
                            "vehicleKills": int_or_none(p.get("vehicleKills")),
                            "won": p.get("won") if isinstance(p.get("won"), bool) else None,
                            "rawJson": p,
                        }
                    )
            out.append(
                {
                    "matchKey": mk,
                    "kind": "TRAIN",
                    "source": "IMPORT_JSON",
                    "legacyId": legacy_id,
                    "year": year,
                    "month": month,
                    "day": day,
                    "timeMsk": time_msk,
                    "serverKey": server_key_from_label(str(srv_key_src) if srv_key_src else None),
                    "serverLabel": srv or players_raw.get("server"),
                    "mapName": str(row.get("map") or players_raw.get("map") or "unknown"),
                    "mode": row.get("mode") or players_raw.get("mode"),
                    "size": row.get("size"),
                    "durationSec": int_or_none(row.get("durationSec")),
                    "factionA": row.get("factionA") or (players_raw.get("sideA") or {}).get("name"),
                    "ticketsA": int_or_none(row.get("ticketsA") or (players_raw.get("sideA") or {}).get("tickets")),
                    "factionB": row.get("factionB") or (players_raw.get("sideB") or {}).get("name"),
                    "ticketsB": int_or_none(row.get("ticketsB") or (players_raw.get("sideB") or {}).get("tickets")),
                    "winner": row.get("winner") or players_raw.get("winner"),
                    "note": row.get("note") or players_raw.get("note"),
                    "legacyPlayersPath": str(players_path.relative_to(root)) if players_path.exists() else None,
                    "rawJson": row,
                    "players": pl_rows,
                }
            )
    return out


def cw_rows(root: Path) -> list[dict[str, Any]]:
    """CW months live at data/YYYY-MM.json (same folder as root)."""
    out: list[dict[str, Any]] = []
    for month_path in sorted(root.glob("????-??.json")):
        # skip non-month dumps
        if month_path.name.startswith("_"):
            continue
        ym = month_path.stem
        try:
            year, month = map(int, ym.split("-"))
        except ValueError:
            continue
        for row in load_month(month_path):
            legacy_id = str(row.get("id") or "").strip()
            if not legacy_id:
                continue
            day = int(row.get("day") or 0) or 1
            time_msk = parse_time_hm(row.get("time") or row.get("timeMsk"))
            mk = match_key(
                year,
                month,
                day,
                row.get("server"),
                str(row.get("map") or row.get("mapName") or "map"),
                time_msk,
            )
            # Same calendar slot / map often shared — always suffix legacyId for CW
            mk = f"{mk}_{legacy_id}"
            players_path = resolve_players_path(root, row, legacy_id, "CW")
            players_raw: dict[str, Any] = {}
            if players_path.exists():
                try:
                    players_raw = json.loads(players_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError:
                    players_raw = {}
            pl_rows: list[dict[str, Any]] = []
            for round_key, rnd in (("r1", 1), ("r2", 2)):
                for p in players_raw.get(round_key) or []:
                    if not isinstance(p, dict):
                        continue
                    nick = str(p.get("nick") or "").strip()
                    if not nick:
                        continue
                    pl_rows.append(
                        {
                            "side": "BB",
                            "round": rnd,
                            "nick": nick,
                            "kills": int(p.get("kills") or 0),
                            "deaths": int(p.get("deaths") or 0),
                            "nok": int(p.get("nok") or 0),
                            "res": int(p.get("res") or 0),
                            "dmg": float_or_none(p.get("dmg")),
                            "vehicleKills": int_or_none(p.get("vehicleKills")),
                            "rawJson": p,
                        }
                    )
            out.append(
                {
                    "matchKey": mk,
                    "kind": "CW",
                    "source": "IMPORT_JSON",
                    "legacyId": legacy_id,
                    "year": year,
                    "month": month,
                    "day": day,
                    "timeMsk": time_msk,
                    "serverKey": server_key_from_label(row.get("server")),
                    "serverLabel": row.get("server"),
                    "mapName": str(row.get("map") or row.get("mapName") or "unknown"),
                    "size": row.get("size"),
                    "opp": row.get("opp"),
                    "stack": row.get("stack"),
                    "rules": row.get("rules"),
                    "meeting": row.get("meeting"),
                    "r1": row.get("r1") if isinstance(row.get("r1"), str) else None,
                    "r2": row.get("r2") if isinstance(row.get("r2"), str) else None,
                    "status": row.get("status"),
                    "note": row.get("note"),
                    "ticketsA": int_or_none(row.get("ticketsOurs") or row.get("ticketsA")),
                    "ticketsB": int_or_none(row.get("ticketsTheirs") or row.get("ticketsB")),
                    "winner": row.get("winner"),
                    "legacyPlayersPath": str(players_path.relative_to(root)) if players_path.exists() else None,
                    "rawJson": row,
                    "players": pl_rows,
                }
            )
    return out


def summarize(rows: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "matches": len(rows),
        "players": sum(len(r.get("players") or []) for r in rows),
        "train": sum(1 for r in rows if r["kind"] == "TRAIN"),
        "cw": sum(1 for r in rows if r["kind"] == "CW"),
        "with_players": sum(1 for r in rows if r.get("players")),
    }


def apply_prisma(rows: list[dict[str, Any]]) -> None:
    """Use Prisma via Node one-shot to avoid Python client drift."""
    payload_path = ROOT / "scripts" / ".canon_import_payload.json"
    payload_path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    js = ROOT / "scripts" / "import_canon_apply.mjs"
    if not js.exists():
        raise SystemExit(f"missing {js}")
    code = os.system(f'node "{js}" "{payload_path}"')
    if code != 0:
        raise SystemExit(f"import_canon_apply.mjs failed: {code}")
    try:
        payload_path.unlink()
    except OSError:
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="KV public/data or kv-cache data root")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--kind", choices=["all", "train", "cw"], default="all")
    args = ap.parse_args()
    root = Path(args.root)
    if not root.is_dir():
        raise SystemExit(f"root not found: {root}")

    rows: list[dict[str, Any]] = []
    if args.kind in ("all", "train"):
        rows.extend(train_rows(root))
    if args.kind in ("all", "cw"):
        rows.extend(cw_rows(root))

    # Deduplicate matchKey (keep first)
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for r in rows:
        if r["matchKey"] in seen:
            r["matchKey"] = f"{r['matchKey']}_{r['legacyId']}"
        if r["matchKey"] in seen:
            print(f"WARN skip dup key {r['matchKey']}", file=sys.stderr)
            continue
        seen.add(r["matchKey"])
        unique.append(r)

    stats = summarize(unique)
    print(json.dumps({"ok": True, "stats": stats, "at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False, indent=2))
    if args.dry_run or not args.apply:
        if not args.apply:
            print("dry-run only (pass --apply to write DB)", file=sys.stderr)
        return
    apply_prisma(unique)
    print("applied", stats)


if __name__ == "__main__":
    main()
