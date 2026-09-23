#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Закрыть открытые сессии (leftAt IS NULL), у которых в логах есть RemovePlayer
после joinedAt. TR1 + TPUB1, live + backup.

  python scripts/reconcile_open_leaves.py
  python scripts/reconcile_open_leaves.py --dry-run
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import paramiko
import psycopg2

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

REMOVE_RE = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\d+\]"
    r".*RemovePlayer\(UserId:\s*(?P<eos>[0-9a-fA-F]{32})\)",
)


def load_env() -> None:
    for p in (HERE / ".squad-collector.env", ROOT / ".env"):
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip("'").strip('"')
            if k and k not in os.environ:
                os.environ[k] = v


def parse_ts(ts: str) -> datetime:
    return datetime.strptime(ts, "%Y.%m.%d-%H.%M.%S").replace(tzinfo=timezone.utc)


def ssh_client() -> paramiko.SSHClient:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        os.environ["SQUAD_SSH_HOST"],
        port=int(os.environ.get("SQUAD_SSH_PORT", "2022")),
        username=os.environ["SQUAD_SSH_USER"],
        password=os.environ["SQUAD_SSH_PASSWORD"],
        timeout=45,
        banner_timeout=90,
        allow_agent=False,
        look_for_keys=False,
    )
    return c


def list_log_files(client: paramiko.SSHClient, server_key: str) -> list[str]:
    root = os.environ.get("SQUAD_LOG_ROOT", "/home/squad/servers").rstrip("/")
    log_dir = f"{root}/{server_key}/SquadGame/Saved/Logs"
    cmd = (
        f"ls -1t {log_dir}/SquadGame.log {log_dir}/SquadGame-backup-*.log "
        f"2>/dev/null | head -8 || true"
    )
    _, out, _ = client.exec_command(cmd, timeout=60)
    return [
        ln.strip()
        for ln in out.read().decode("utf-8", "replace").splitlines()
        if ln.strip()
    ]


def gather_removes(
    client: paramiko.SSHClient, paths: list[str]
) -> dict[str, list[datetime]]:
    """eos -> sorted list of RemovePlayer timestamps."""
    by_eos: dict[str, list[datetime]] = {}
    for path in paths:
        cmd = f"grep -E 'RemovePlayer\\(UserId:' {path} 2>/dev/null || true"
        try:
            _, out, _ = client.exec_command(cmd, timeout=300)
            text = out.read().decode("utf-8", "replace")
        except Exception as e:
            print(f"  skip {path}: {type(e).__name__} {e}", file=sys.stderr)
            continue
        n = 0
        for line in text.splitlines():
            m = REMOVE_RE.search(line)
            if not m:
                continue
            eos = m.group("eos").lower()
            at = parse_ts(m.group("ts"))
            by_eos.setdefault(eos, []).append(at)
            n += 1
        print(f"  {path.rsplit('/', 1)[-1]}: RemovePlayer lines~{n}")
    for eos, times in by_eos.items():
        times.sort()
    return by_eos


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    load_env()

    db = os.environ["DATABASE_URL"].strip().strip('"').strip("'")
    conn = psycopg2.connect(db)
    cur = conn.cursor()

    cur.execute(
        """
        SELECT s.id, s."steamId", s."eosId", s."serverKey", s."joinedAt",
               s."nickAtJoin", u.nick
        FROM "SquadServerSession" s
        LEFT JOIN "User" u ON u.id = s."userId"
        WHERE s."leftAt" IS NULL
        ORDER BY s."joinedAt"
        """
    )
    opens = cur.fetchall()
    print(f"open sessions: {len(opens)}")
    if not opens:
        return

    # steam -> eos from map table
    cur.execute('SELECT "eosId", "steamId" FROM "SquadEosSteamMap"')
    steam_to_eos: dict[str, str] = {}
    eos_to_steam: dict[str, str] = {}
    for eos, steam in cur.fetchall():
        e = (eos or "").lower()
        s = (steam or "").strip()
        if e and s:
            steam_to_eos[s] = e
            eos_to_steam[e] = s

    servers = sorted({row[3] for row in opens})
    client = ssh_client()
    removes_by_server: dict[str, dict[str, list[datetime]]] = {}
    try:
        for sk in servers:
            print(f"scan logs {sk}…")
            paths = list_log_files(client, sk)
            removes_by_server[sk] = gather_removes(client, paths)
    finally:
        client.close()

    closed = 0
    still_open = 0
    for sid, steam, eos, server_key, joined, nick_at, nick in opens:
        eos_l = (eos or steam_to_eos.get(steam) or "").lower()
        label = nick or nick_at or steam
        if not eos_l:
            print(f"NO EOS  {label} {server_key} joined={joined}")
            still_open += 1
            continue
        times = removes_by_server.get(server_key, {}).get(eos_l, [])
        # first RemovePlayer strictly after join (+2s slack for clock)
        leave_at = None
        join_aware = joined if joined.tzinfo else joined.replace(tzinfo=timezone.utc)
        for t in times:
            if t.timestamp() >= join_aware.timestamp() + 2:
                leave_at = t
                break
        if not leave_at:
            age_h = (datetime.now(timezone.utc) - join_aware).total_seconds() / 3600
            print(f"STILL ON/NO LEAVE  {label} {server_key} age={age_h:.1f}h")
            still_open += 1
            continue
        print(f"CLOSE  {label} {server_key} {join_aware.isoformat()} → {leave_at.isoformat()}")
        if not args.dry_run:
            cur.execute(
                """
                UPDATE "SquadServerSession"
                SET "leftAt" = %s, "updatedAt" = NOW(),
                    "eosId" = COALESCE("eosId", %s)
                WHERE id = %s AND "leftAt" IS NULL
                """,
                (leave_at, eos_l, sid),
            )
            closed += 1

    if not args.dry_run:
        conn.commit()
    conn.close()
    print(f"done closed={closed} still_open={still_open} dry_run={args.dry_run}")


if __name__ == "__main__":
    main()
