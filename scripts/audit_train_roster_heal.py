#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hourly / nightly: calendar month rows must have real players/{id}.json.

Plan: month ↔ players gap → heal from pinned log → Telegram if still broken.

Usage:
  python3 audit_train_roster_heal.py            # audit + heal + mirrors
  python3 audit_train_roster_heal.py --check    # report only (exit 2 on gaps)
  python3 audit_train_roster_heal.py --quiet
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# Prefer live VPS cache when present (collector + /tm).
for cand in (
    os.environ.get("BB_KV_PUBLIC", "").strip(),
    "/var/www/bb-squad-platform/data/kv-cache",
    str(HERE.parent / "data" / "kv-cache"),
):
    if cand and (Path(cand) / "data" / "training").is_dir():
        os.environ.setdefault("BB_KV_PUBLIC", cand)
        os.environ.setdefault("KV_LOCAL_DIR", cand)
        break


def _load_env() -> None:
    for env_path in (
        HERE / ".squad-collector.env",
        HERE.parent / ".env",
    ):
        if not env_path.is_file():
            continue
        for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def audit_gaps(train: Path) -> list[dict]:
    import sync_train_from_tr1_logs as S  # noqa: WPS433

    gaps: list[dict] = []
    for month_path in sorted(train.glob("????-??.json")):
        try:
            data = json.loads(month_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for row in data.get("matches") or []:
            if not isinstance(row, dict):
                continue
            mid = str(row.get("id") or "").strip()
            if not mid or mid.endswith("-skip"):
                continue
            status = str(row.get("status") or "done").lower()
            if status in ("cancel", "move", "upcoming", "no-stats"):
                continue
            if S._players_file_ok(mid):
                continue
            gaps.append(
                {
                    "id": mid,
                    "month": month_path.stem,
                    "map": row.get("map") or "",
                    "day": row.get("day"),
                    "status": status,
                    "playersUrl": row.get("playersUrl") or "",
                }
            )
    return gaps


def main() -> int:
    _load_env()
    quiet = "--quiet" in sys.argv
    check_only = "--check" in sys.argv

    import sync_train_from_tr1_logs as S  # noqa: WPS433

    train = S.TRAIN
    if not train.is_dir():
        print(f"FAIL no training dir: {train}", flush=True)
        return 1

    before = audit_gaps(train)
    if not quiet:
        print(
            json.dumps(
                {
                    "train": str(train),
                    "gapsBefore": len(before),
                    "ids": [g["id"] for g in before[:40]],
                },
                ensure_ascii=False,
            ),
            flush=True,
        )

    if check_only:
        return 2 if before else 0

    healed = 0
    if before:
        aliases = S.load_aliases()
        healed = S.heal_missing_player_rosters(aliases)
        if healed:
            S.bump_cache_bust()
            S.publish_live_mirrors()

    after = audit_gaps(train)
    if not quiet:
        print(
            json.dumps(
                {
                    "healed": healed,
                    "gapsAfter": len(after),
                    "stillBroken": [g["id"] for g in after[:40]],
                },
                ensure_ascii=False,
            ),
            flush=True,
        )

    # Alert only on remaining holes (heal already alerts per-id on fail/ok).
    if after:
        try:
            import bb_alerts as AL  # noqa: WPS433

            ids = ", ".join(g["id"] for g in after[:12])
            AL.send(
                kind="выгрузка",
                title="Аудит: тренировки без статы",
                level="warn",
                server="TR1",
                lines=[
                    f"дыр после heal: {len(after)}",
                    f"id: {ids}",
                    "проверь pinned-логи / auto_matches",
                ],
                force=True,
                cooldown=1800,
            )
        except Exception as e:
            print(f"alert skip: {e}", flush=True)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
