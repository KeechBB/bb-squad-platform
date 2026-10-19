#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ticket-class audit after public / train RP scoring (PB1, TR1–TR7).

Compares stored event.tickets for vehicle_* / driver_share against
rp_log_parse.vehicle_tickets(Asset Name). Catches unknown tanks (e.g. BP_2A6
stored as default 5 instead of 15) without waiting for a player report.

Usage:
  python rp_ticket_class_audit.py --kind public --last 20
  python rp_ticket_class_audit.py --kind public --day 2026-10-19
  python rp_ticket_class_audit.py --kind public --all --fix
  python rp_ticket_class_audit.py --kind train --last 10

Exit 0 = clean, 2 = mismatches found (or fix attempted).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import rp_integrity as RI  # noqa: E402
import rp_log_parse as R  # noqa: E402
import rp_post_ingest_audit as AUD  # noqa: E402

KINDS = RI.TICKET_CLASS_KINDS


def _event_asset(e: dict) -> str:
    return RI._event_vehicle_asset(e)


def scan_match(m: dict) -> dict[str, Any]:
    mid = str(m.get("id") or "")
    day = str(m.get("day") or m.get("date") or "")[:10]
    issues: list[dict] = []
    ok_n = 0
    for e in m.get("events") or []:
        kind = str(e.get("kind") or "")
        if kind not in KINDS:
            continue
        asset = _event_asset(e)
        if not asset:
            continue
        stored = e.get("tickets")
        if stored is None:
            continue
        try:
            stored_i = int(stored)
        except (TypeError, ValueError):
            continue
        exp_i = int(R.vehicle_tickets(asset))
        if stored_i == exp_i:
            ok_n += 1
            continue
        issues.append(
            {
                "t": e.get("time"),
                "kind": kind,
                "asset": asset,
                "stored": stored_i,
                "expected": exp_i,
                "label": e.get("label"),
                "who": e.get("victim") or e.get("killer"),
                "delta": e.get("delta"),
            }
        )
    return {
        "id": mid,
        "day": day,
        "map": m.get("map") or m.get("mapName"),
        "okEvents": ok_n,
        "badEvents": len(issues),
        "issues": issues[:20],
        "ok": len(issues) == 0,
    }


def _filter_matches(
    matches: list[dict],
    *,
    last: int | None,
    ids: set[str] | None,
    day: str | None,
    all_matches: bool,
) -> list[dict]:
    pool = [m for m in matches if m.get("events")]
    if ids:
        return [m for m in pool if str(m.get("id") or "") in ids]
    if day:
        d = day.strip()[:10]
        return [
            m
            for m in pool
            if str(m.get("day") or m.get("date") or "")[:10] == d
            or str(m.get("id") or "").startswith(d.replace("-", ""))
        ]
    if all_matches:
        return pool
    n = last if last and last > 0 else 10
    return pool[-n:]


def run(
    kind: str,
    *,
    last: int | None = 10,
    ids: set[str] | None = None,
    day: str | None = None,
    all_matches: bool = False,
    fix: bool = False,
) -> dict[str, Any]:
    if kind == "public":
        paths = AUD._public_ledger_paths()
    else:
        paths = AUD._train_ledger_paths()
    if not paths:
        raise SystemExit(f"no {kind} rp-ledger.json")
    ledger_path = paths[0]
    doc = AUD._load_json(ledger_path)
    matches = list(doc.get("matches") or [])
    selected = _filter_matches(
        matches, last=last, ids=ids, day=day, all_matches=all_matches
    )

    rows = [scan_match(m) for m in selected]
    bad_rows = [r for r in rows if not r["ok"]]
    asset_hits: Counter[str] = Counter()
    pair_hits: Counter[str] = Counter()
    for r in bad_rows:
        for iss in r["issues"]:
            asset_hits[str(iss["asset"])] += 1
            pair_hits[f"{iss['asset']}:{iss['stored']}→{iss['expected']}"] += 1

    summary = {
        "kind": kind,
        "ledger": str(ledger_path),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "checked": len(rows),
        "ok": len(rows) - len(bad_rows),
        "bad": len(bad_rows),
        "badIds": [r["id"] for r in bad_rows],
        "badEvents": sum(r["badEvents"] for r in bad_rows),
        "topAssets": asset_hits.most_common(12),
        "topPairs": pair_hits.most_common(12),
        "matches": rows if (day or ids or all_matches or (last or 0) <= 30) else bad_rows,
    }

    report = HERE.parent / "data" / "cache" / f"rp-ticket-class-{kind}-last.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"ticket-class [{kind}]: checked={summary['checked']} ok={summary['ok']} "
        f"bad={summary['bad']} events={summary['badEvents']}",
        flush=True,
    )
    if bad_rows:
        for r in bad_rows[:8]:
            sample = r["issues"][0] if r["issues"] else {}
            print(
                f"  • {r['id']}: {r['badEvents']} evt "
                f"{sample.get('asset')} {sample.get('stored')}→{sample.get('expected')}",
                flush=True,
            )
        if len(bad_rows) > 8:
            print(f"  … ещё {len(bad_rows) - 8}", flush=True)
    print(f"report → {report}", flush=True)

    _telegram_ticket_report(kind, summary, bad_rows)

    if bad_rows and fix:
        if kind == "public":
            rc = AUD._fix_public(summary["badIds"])
            summary["fixRc"] = rc
        else:
            AUD._fix_train_note(summary["badIds"])
            summary["fixRc"] = 0

    return summary


def _telegram_ticket_report(kind: str, summary: dict, bad_rows: list[dict]) -> None:
    if (os.environ.get("RP_AUDIT_TELEGRAM") or "1").strip() in ("0", "false", "no"):
        return
    if bad_rows:
        title = f"Ticket-class ({kind}) — рассинхрон"
        level = "warn"
        lines = [
            f"проверено: {summary['checked']} · bad: {summary['bad']} · evt: {summary['badEvents']}",
        ]
        for r in bad_rows[:6]:
            sample = (r.get("issues") or [{}])[0]
            lines.append(
                f"• {r['id']}: {sample.get('asset')} "
                f"{sample.get('stored')}→{sample.get('expected')}"
            )
        if summary.get("topPairs"):
            lines.append("топ: " + ", ".join(f"{a}×{n}" for a, n in summary["topPairs"][:4]))
    else:
        title = f"Ticket-class ({kind}) — успешно"
        level = "ok"
        lines = [
            f"проверено: {summary['checked']} матчей · ошибок класса тикетов: 0",
        ]
    try:
        import bb_alerts as AL  # noqa: WPS433

        AL.send(
            kind="rp-ticket",
            title=title,
            level=level,
            lines=lines,
            force=True,
            cooldown=0,
        )
    except Exception as e:
        print(f"ticket telegram skip: {e}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="RP vehicle ticket-class audit")
    ap.add_argument("--kind", choices=("public", "train"), required=True)
    ap.add_argument("--last", type=int, default=10)
    ap.add_argument("--ids", default="", help="comma-separated match ids")
    ap.add_argument("--day", default="", help="YYYY-MM-DD (match day / id prefix)")
    ap.add_argument("--all", action="store_true", help="scan every match with events")
    ap.add_argument(
        "--fix",
        action="store_true",
        help="rescore public bad ids / queue train fixes",
    )
    args = ap.parse_args()
    ids = {x.strip() for x in args.ids.split(",") if x.strip()} or None
    summary = run(
        args.kind,
        last=args.last,
        ids=ids,
        day=(args.day or "").strip() or None,
        all_matches=bool(args.all),
        fix=bool(args.fix),
    )
    return 2 if summary["bad"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
