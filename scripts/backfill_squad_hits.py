#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backfill BBHitZone hits from TR1 logs → POST /api/ingest/squad-hits.

Use after enabling hit ingest (or after a collector outage) to fill profiles
from the current SquadGame.log + recent backups.

  python backfill_squad_hits.py
  python backfill_squad_hits.py --dry-run
  python backfill_squad_hits.py --from 2026-09-25

Env: scripts/.squad-collector.env (SSH + SQUAD_INGEST_SECRET)
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from squad_log_collector import (
    HIT_RE,
    LINE_TS_RE,
    STEAM_EOS_RE,
    load_dotenv_file,
    parse_ts,
)

HERE = Path(__file__).resolve().parent
load_dotenv_file(HERE / ".squad-collector.env")
load_dotenv_file(HERE.parent / ".env")

import paramiko  # noqa: E402

ROOT = os.environ.get("SQUAD_LOG_ROOT", "/home/squad/servers").rstrip("/")
SERVER = "TR1"
LOG_DIR = f"{ROOT}/{SERVER}/SquadGame/Saved/Logs"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--from",
        dest="from_ymd",
        default=None,
        help="UTC cutoff date YYYY-MM-DD (optional)",
    )
    p.add_argument("--dry-run", action="store_true")
    p.add_argument(
        "--backups",
        type=int,
        default=6,
        help="How many recent SquadGame-backup-*.log to include (default 6)",
    )
    return p.parse_args()


def cutoff_utc(ymd: str) -> datetime:
    y, m, d = map(int, ymd.split("-"))
    return datetime(y, m, d, 0, 0, 0, tzinfo=timezone.utc)


def main() -> None:
    args = parse_args()
    cut = cutoff_utc(args.from_ymd) if args.from_ymd else None

    ingest_url = os.environ.get("SQUAD_HITS_INGEST_URL", "").strip()
    if not ingest_url:
        base = os.environ.get(
            "SQUAD_INGEST_URL", "https://bb-squad.ru/api/ingest/squad-sessions"
        )
        ingest_url = base.replace(
            "/api/ingest/squad-sessions", "/api/ingest/squad-hits"
        )
        if ingest_url == base:
            ingest_url = "https://bb-squad.ru/api/ingest/squad-hits"
    secret = os.environ.get("SQUAD_INGEST_SECRET", "").strip()
    if not secret:
        raise SystemExit("missing SQUAD_INGEST_SECRET")

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        os.environ["SQUAD_SSH_HOST"],
        port=int(os.environ.get("SQUAD_SSH_PORT", "2022")),
        username=os.environ["SQUAD_SSH_USER"],
        password=os.environ["SQUAD_SSH_PASSWORD"],
        timeout=60,
        banner_timeout=120,
        allow_agent=False,
        look_for_keys=False,
    )

    files_cmd = (
        f"ls -1t {LOG_DIR}/SquadGame-backup-*.log 2>/dev/null "
        f"| head -{max(0, args.backups)} ; "
        f"echo {LOG_DIR}/SquadGame.log"
    )
    _, out, _ = c.exec_command(files_cmd, timeout=30)
    paths = [
        p.strip()
        for p in out.read().decode("utf-8", "replace").splitlines()
        if p.strip()
    ]
    # Unique, keep order (backups first, live last so steam map fills early)
    seen: set[str] = set()
    ordered: list[str] = []
    for p in paths:
        if p not in seen:
            seen.add(p)
            ordered.append(p)

    eos_steam: dict[str, str] = {}
    events: list[dict] = []

    for path in ordered:
        grep_cmd = (
            f"grep -E 'BBHitZone:|EOS:.*steam:|steam:.*EOS:' "
            f"{path} 2>/dev/null || true"
        )
        try:
            _, gout, _ = c.exec_command(grep_cmd, timeout=300)
            text = gout.read().decode("utf-8", "replace")
        except Exception as e:
            print(f"skip {path}: {e}", file=sys.stderr)
            continue
        n_hits = 0
        for line in text.splitlines():
            sm = STEAM_EOS_RE.search(line)
            if sm:
                eos = (sm.group("eos") or sm.group("eos2") or "").lower()
                steam = sm.group("steam") or sm.group("steam2") or ""
                if eos and steam:
                    eos_steam[eos] = steam
            if "BBHitZone:" not in line:
                continue
            hm = HIT_RE.search(line)
            tm = LINE_TS_RE.match(line)
            if not hm or not tm:
                continue
            at_iso = parse_ts(tm.group("ts"))
            at_dt = datetime.fromisoformat(at_iso.replace("Z", "+00:00"))
            if cut and at_dt < cut:
                continue
            aeos_raw = (hm.group("aeos") or "").strip()
            asteam_raw = (hm.group("asteam") or "").strip()
            veos_raw = (hm.group("veos") or "").strip()
            bone = (hm.group("bone") or "").strip()
            if not bone or bone.lower() == "none":
                continue
            aeos = (
                aeos_raw.lower()
                if aeos_raw and aeos_raw.lower() != "none"
                else ""
            )
            asteam = (
                asteam_raw
                if asteam_raw
                and asteam_raw.lower() != "none"
                and asteam_raw.startswith("7656")
                else ""
            )
            if not asteam and aeos:
                asteam = eos_steam.get(aeos, "")
            if aeos and asteam:
                eos_steam[aeos] = asteam
            veos = (
                veos_raw.lower()
                if veos_raw and veos_raw.lower() != "none"
                else ""
            )
            if not aeos and not asteam:
                continue
            events.append(
                {
                    "type": "hit",
                    "steamId": asteam or "",
                    "eosId": aeos or None,
                    "victimEos": veos or None,
                    "zone": (hm.group("zone") or "Limb").strip(),
                    "bone": bone,
                    "damage": (hm.group("damage") or "").strip() or None,
                    "weapon": (hm.group("weapon") or "").strip() or None,
                    "at": at_iso,
                    "serverKey": "TR1",
                }
            )
            n_hits += 1
        print(f"{path.rsplit('/', 1)[-1]}: hits≈{n_hits}", flush=True)

    c.close()
    print(f"total events: {len(events)} (eos_map={len(eos_steam)})", flush=True)

    if args.dry_run:
        print("dry-run — not posting")
        return

    headers = {
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/json",
    }
    chunk = 500
    accepted = 0
    skipped = 0
    for i in range(0, len(events), chunk):
        part = events[i : i + chunk]
        r = requests.post(
            ingest_url,
            headers=headers,
            json={"events": part},
            timeout=120,
        )
        if r.status_code >= 300:
            print(f"POST fail {r.status_code}: {r.text[:400]}", file=sys.stderr)
            raise SystemExit(1)
        data = r.json()
        accepted += int(data.get("accepted") or 0)
        skipped += int(data.get("skipped") or 0)
        print(f"chunk {i // chunk + 1}: {data}", flush=True)

    print(f"done accepted={accepted} skipped={skipped}")


if __name__ == "__main__":
    main()
