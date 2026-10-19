#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
After public / train RP ingest: verify integrity and optionally auto-rescore.

Usage:
  python rp_post_ingest_audit.py --kind public --last 3
  python rp_post_ingest_audit.py --kind public --ids id1,id2 --fix
  python rp_post_ingest_audit.py --kind train --from-blocks /tmp/train_blocks.json

Env:
  RP_AUDIT_FIX=1          — same as --fix
  RP_AUDIT_TELEGRAM=1     — send Telegram on failures (default on)
  RP_AUDIT_REPORT         — report path override
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import rp_integrity as RI  # noqa: E402


def _public_ledger_paths() -> list[Path]:
    roots = [
        Path(os.environ["PUBLIC_RP_OUT"]).parent
        if os.environ.get("PUBLIC_RP_OUT")
        else None,
        Path("/var/www/bb-squad-platform/data/public"),
        HERE.parent / "data" / "public",
    ]
    out = []
    for r in roots:
        if r is None:
            continue
        p = r / "rp-ledger.json"
        if p.is_file():
            out.append(p)
    return out


def _train_ledger_paths() -> list[Path]:
    env = (os.environ.get("BB_KV_PUBLIC") or os.environ.get("KV_LOCAL_DIR") or "").strip()
    cands = []
    if env:
        cands += [
            Path(env) / "data" / "training" / "rp-ledger.json",
            Path(env) / "public" / "data" / "training" / "rp-ledger.json",
        ]
    cands += [
        Path("/var/www/bb-squad-platform/data/kv-cache/data/training/rp-ledger.json"),
        Path("/var/www/blackberry-kv/data/training/rp-ledger.json"),
        HERE.parent / "data" / "kv-cache" / "data" / "training" / "rp-ledger.json",
    ]
    return [p for p in cands if p.is_file()]


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _report_path(kind: str) -> Path:
    override = (os.environ.get("RP_AUDIT_REPORT") or "").strip()
    if override:
        return Path(override)
    return HERE.parent / "data" / "cache" / f"rp-audit-{kind}-last.json"


def audit_ledger(
    kind: str,
    *,
    last: int | None,
    ids: set[str] | None,
    blocks: list[dict] | None = None,
) -> list[RI.MatchAudit]:
    if blocks is not None:
        only = ids
        return RI.audit_matches(blocks, only_ids=only)

    if kind == "public":
        paths = _public_ledger_paths()
        if not paths:
            print("no public rp-ledger.json", flush=True)
            return []
        doc = _load_json(paths[0])
        print(f"audit public ledger {paths[0]}", flush=True)
    else:
        paths = _train_ledger_paths()
        if not paths:
            print("no train rp-ledger.json", flush=True)
            return []
        doc = _load_json(paths[0])
        print(f"audit train ledger {paths[0]}", flush=True)

    matches = list(doc.get("matches") or [])
    players = doc.get("players") if isinstance(doc.get("players"), dict) else None

    if ids:
        only = ids
    elif last and last > 0:
        with_ev = [m for m in matches if m.get("events")]
        # public keeps events; train slim — fall back to last N anyway
        pool = with_ev or matches
        only = {str(m.get("id")) for m in pool[-last:]}
    else:
        with_ev = [m for m in matches if m.get("events")]
        only = {str(m.get("id")) for m in with_ev[-5:]} if with_ev else set()

    return RI.audit_matches(matches, players=players, only_ids=only or None)


def _telegram(kind: str, audits: list[RI.MatchAudit]) -> None:
    if (os.environ.get("RP_AUDIT_TELEGRAM") or "1").strip() in ("0", "false", "no"):
        return
    text = RI.format_telegram(kind, audits)
    if not text:
        return
    try:
        import train_rp_guard as TRG  # noqa: WPS433

        TRG.telegram_send(text)
    except Exception as e:
        print(f"telegram skip: {type(e).__name__}: {e}", flush=True)


def _fix_public(ids: list[str]) -> int:
    if not ids:
        return 0
    # Avoid infinite audit→rescore→audit loop.
    if (os.environ.get("RP_AUDIT_REPAIR_PASS") or "").strip() == "1":
        print("FIX skip: already in repair pass", flush=True)
        return 0
    script = HERE / "build_public_rp_ledger.py"
    cmd = [
        sys.executable,
        str(script),
        "--rescore-ids",
        ",".join(ids),
    ]
    env = {
        **os.environ,
        "RP_AUDIT_REPAIR_PASS": "1",
        "RP_AUDIT_FIX": "0",
    }
    print(f"FIX public rescore: {ids}", flush=True)
    return int(
        subprocess.run(cmd, cwd=str(HERE), env=env, check=False).returncode or 0
    )


def _fix_train_note(ids: list[str]) -> None:
    """Train builder has no --rescore-ids; queue note for next full/pending pass."""
    if not ids:
        return
    note = HERE.parent / "data" / "cache" / "rp-audit-train-fix-queue.json"
    note.parent.mkdir(parents=True, exist_ok=True)
    prev = []
    if note.is_file():
        try:
            prev = list((_load_json(note).get("ids") or []))
        except Exception:
            prev = []
    merged = list(dict.fromkeys([*prev, *ids]))
    note.write_text(
        json.dumps(
            {"ids": merged, "hint": "re-run build_train_rp_ledger / sync train"},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"FIX train queued → {note}: {merged}", flush=True)


def run_audit_on_blocks(
    kind: str,
    blocks: list[dict],
    *,
    fix: bool = False,
    players: dict | None = None,
) -> dict:
    """Called in-process from build_*_rp_ledger after scoring."""
    audits = RI.audit_matches(blocks, players=players)
    report = _report_path(kind)
    RI.write_report(report, kind=kind, audits=audits)
    summary = RI.summarize(audits)
    tcb = summary.get("ticket_class_bad") or 0
    print(
        f"RP audit [{kind}]: checked={summary['checked']} ok={summary['ok']} "
        f"bad={summary['bad']} ticketClass={tcb} ids={summary['badIds']}",
        flush=True,
    )
    if summary["bad"]:
        _telegram(kind, audits)
        if fix or (os.environ.get("RP_AUDIT_FIX") or "").strip() in ("1", "true", "yes"):
            if kind == "public":
                _fix_public(summary["badIds"])
            else:
                _fix_train_note(summary["badIds"])
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description="RP post-ingest integrity audit")
    ap.add_argument("--kind", choices=("public", "train"), required=True)
    ap.add_argument("--last", type=int, default=5, help="audit last N matches with events")
    ap.add_argument("--ids", default="", help="comma-separated match ids")
    ap.add_argument(
        "--from-blocks",
        default="",
        help="JSON file with list of match blocks (events+netByNick)",
    )
    ap.add_argument(
        "--fix",
        action="store_true",
        help="auto-rescore public bad ids / queue train fixes",
    )
    args = ap.parse_args()

    ids = {x.strip() for x in args.ids.split(",") if x.strip()} or None
    blocks = None
    if args.from_blocks:
        raw = _load_json(Path(args.from_blocks))
        blocks = raw if isinstance(raw, list) else raw.get("matches") or []

    audits = audit_ledger(
        args.kind, last=args.last, ids=ids, blocks=blocks
    )
    report = _report_path(args.kind)
    RI.write_report(report, kind=args.kind, audits=audits)
    summary = RI.summarize(audits)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    print(f"report → {report}", flush=True)

    if summary["bad"]:
        _telegram(args.kind, audits)
        if args.fix or (os.environ.get("RP_AUDIT_FIX") or "").strip() in (
            "1",
            "true",
            "yes",
        ):
            if args.kind == "public":
                rc = _fix_public(summary["badIds"])
                return rc if rc else 2
            _fix_train_note(summary["badIds"])
            return 2
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
