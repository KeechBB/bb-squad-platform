#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backfill DeployRole (standard kits) from TR1 logs → POST /api/ingest/squad-roles.

  python backfill_squad_roles.py
  python backfill_squad_roles.py --dry-run
  python backfill_squad_roles.py --from 2026-09-25

Env: scripts/.squad-collector.env
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from squad_log_collector import (
    DEPLOY_RE,
    LINE_TS_RE,
    STEAM_EOS_RE,
    clean_nick,
    kit_from_role,
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
    p.add_argument("--from", dest="from_ymd", default=None)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--backups", type=int, default=12)
    return p.parse_args()


def cutoff_utc(ymd: str) -> datetime:
    y, m, d = map(int, ymd.split("-"))
    return datetime(y, m, d, 0, 0, 0, tzinfo=timezone.utc)


def main() -> None:
    args = parse_args()
    cut = cutoff_utc(args.from_ymd) if args.from_ymd else None

    ingest_url = os.environ.get("SQUAD_ROLES_INGEST_URL", "").strip()
    if not ingest_url:
        base = os.environ.get(
            "SQUAD_INGEST_URL", "https://bb-squad.ru/api/ingest/squad-sessions"
        )
        ingest_url = base.replace(
            "/api/ingest/squad-sessions", "/api/ingest/squad-roles"
        )
        if ingest_url == base:
            ingest_url = "https://bb-squad.ru/api/ingest/squad-roles"
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
            f"grep -E 'DeployRole=|EOS:.*steam:|steam:.*EOS:' "
            f"{path} 2>/dev/null || true"
        )
        try:
            _, gout, _ = c.exec_command(grep_cmd, timeout=300)
            text = gout.read().decode("utf-8", "replace")
        except Exception as e:
            print(f"skip {path}: {e}", file=sys.stderr)
            continue
        n_roles = 0
        for line in text.splitlines():
            sm = STEAM_EOS_RE.search(line)
            if sm:
                eos = (sm.group("eos") or sm.group("eos2") or "").lower()
                steam = sm.group("steam") or sm.group("steam2") or ""
                if eos and steam:
                    eos_steam[eos] = steam
            if "DeployRole=" not in line:
                continue
            dm = DEPLOY_RE.search(line)
            tm = LINE_TS_RE.match(line)
            if not dm or not tm:
                continue
            role = (dm.group("role") or "").strip().rstrip(",;")
            if not kit_from_role(role):
                continue
            at_iso = parse_ts(tm.group("ts"))
            at_dt = datetime.fromisoformat(at_iso.replace("Z", "+00:00"))
            if cut and at_dt < cut:
                continue
            nick = clean_nick(dm.group("nick") or "")
            eos = ""
            steam = ""
            if sm:
                eos = (sm.group("eos") or sm.group("eos2") or "").lower()
                steam = sm.group("steam") or sm.group("steam2") or ""
            sm2 = STEAM_EOS_RE.search(line)
            if sm2:
                eos = (sm2.group("eos") or sm2.group("eos2") or "").lower() or eos
                steam = (sm2.group("steam") or sm2.group("steam2") or "") or steam
            if eos and steam:
                eos_steam[eos] = steam
            if not steam and eos:
                steam = eos_steam.get(eos, "")
            if not steam and not eos and not nick:
                continue
            events.append(
                {
                    "type": "role",
                    "steamId": steam or "",
                    "eosId": eos or None,
                    "nick": nick or None,
                    "role": role,
                    "at": at_iso,
                    "serverKey": "TR1",
                }
            )
            n_roles += 1
        print(f"{path.rsplit('/', 1)[-1]}: roles≈{n_roles}", flush=True)

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
