#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backfill SquadServerSession for one registered player from TR1/TPUB1 logs.

Use when a newbie played on the server BEFORE registering on bb-squad.ru —
live ingest skipped those joins (no User row yet).

  python backfill_player_sessions.py --steam 76561199802004249 --nick KingOfLobs
  python backfill_player_sessions.py --steam 7656… --from 2026-09-15

Env: scripts/.squad-collector.env (SSH + SQUAD_INGEST_*)
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from squad_log_collector import (
    LOGIN_RE,
    REMOVE_RE,
    STEAM_EOS_RE,
    clean_nick,
    load_dotenv_file,
    parse_ts,
)

HERE = Path(__file__).resolve().parent
load_dotenv_file(HERE / ".squad-collector.env")
load_dotenv_file(HERE.parent / ".env")

import paramiko  # noqa: E402

ROOT = os.environ.get("SQUAD_LOG_ROOT", "/home/squad/servers").rstrip("/")
SERVERS = ["TR1", "TR2", "TPUB1"]
JOIN_DEDUP_SEC = 15

POSTLOGIN_RE = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\d+\].*PostLogin:.*"
    r"(?:EOS:\s*(?P<eos>[0-9a-fA-F]{32}).*steam:\s*(?P<steam>7656\d{13})"
    r"|steam:\s*(?P<steam2>7656\d{13}).*EOS:\s*(?P<eos2>[0-9a-fA-F]{32}))",
    re.IGNORECASE,
)
ADDED_RE = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\d+\].*"
    r"Player\s+(?P<name>.+?)\s+has been added to Team",
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--steam", required=True, help="Steam64 7656…")
    p.add_argument("--nick", default=None, help="Fallback nickAtJoin")
    p.add_argument(
        "--eos",
        default=None,
        help="EOS id if known (optional; learned from logs)",
    )
    p.add_argument(
        "--from",
        dest="from_ymd",
        default="2026-09-15",
        help="UTC cutoff date YYYY-MM-DD (default attendance canon 2026-09-15)",
    )
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


def cutoff_utc(ymd: str) -> datetime:
    y, m, d = map(int, ymd.split("-"))
    # 15.09.2026 MSK start = 14.09 21:00 UTC — keep simple: midnight UTC of day
    return datetime(y, m, d, 0, 0, 0, tzinfo=timezone.utc)


def main() -> None:
    args = parse_args()
    steam = args.steam.strip()
    if not re.fullmatch(r"7656\d{13}", steam):
        raise SystemExit(f"bad steam: {steam}")
    nick_fallback = (args.nick or "").strip() or None
    eos_hint = (args.eos or "").strip().lower() or None
    cut = cutoff_utc(args.from_ymd)

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

    eos_steam: dict[str, str] = {}
    if eos_hint:
        eos_steam[eos_hint] = steam
    all_events: list[dict] = []

    try:
        for srv in SERVERS:
            log_dir = f"{ROOT}/{srv}/SquadGame/Saved/Logs"
            # Prefer steam + optional nick/eos in grep to keep payload small
            nick_pat = re.escape(nick_fallback) if nick_fallback else ""
            pats = [steam]
            if eos_hint:
                pats.append(eos_hint)
            if nick_pat:
                pats.append(nick_pat)
            alt = "|".join(pats)
            cmd = (
                f"grep -h -E '{alt}' {log_dir}/SquadGame*.log 2>/dev/null "
                f"| grep -E 'PostLogin:|Login request:|RemovePlayer|has been added to Team' "
                f"|| true"
            )
            print(f"grep {srv}…", flush=True)
            _, out, _ = c.exec_command(cmd, timeout=600)
            lines = out.read().decode("utf-8", "replace").splitlines()
            print(f"  {srv}: {len(lines)} lines", flush=True)

            pending_login: dict[str, dict] = {}
            last_added_nick: str | None = None

            for line in lines:
                m = STEAM_EOS_RE.search(line)
                if m:
                    eos = (m.group("eos") or m.group("eos2") or "").lower()
                    st = m.group("steam") or m.group("steam2") or ""
                    if eos and st == steam:
                        eos_steam[eos] = steam

                am = ADDED_RE.search(line)
                if am:
                    last_added_nick = clean_nick(am.group("name"))

                pm = POSTLOGIN_RE.search(line)
                if pm:
                    eos = (pm.group("eos") or pm.group("eos2") or "").lower()
                    st = pm.group("steam") or pm.group("steam2") or ""
                    if st != steam:
                        continue
                    at_s = parse_ts(pm.group("ts"))
                    at = datetime.fromisoformat(at_s.replace("Z", "+00:00"))
                    if at < cut:
                        continue
                    if eos:
                        eos_steam[eos] = steam
                    nick = last_added_nick or nick_fallback
                    all_events.append(
                        {
                            "type": "join",
                            "steamId": steam,
                            "eosId": eos or eos_hint,
                            "nick": nick,
                            "at": at_s,
                            "serverKey": srv,
                            "_src": "postlogin",
                        }
                    )
                    continue

                lm = LOGIN_RE.search(line)
                if lm:
                    eos = lm.group("eos").lower()
                    nick = clean_nick(lm.group("name"))
                    at_s = parse_ts(lm.group("ts"))
                    at = datetime.fromisoformat(at_s.replace("Z", "+00:00"))
                    if at < cut:
                        continue
                    st = eos_steam.get(eos)
                    if st == steam or (eos_hint and eos == eos_hint):
                        all_events.append(
                            {
                                "type": "join",
                                "steamId": steam,
                                "eosId": eos,
                                "nick": nick or nick_fallback,
                                "at": at_s,
                                "serverKey": srv,
                                "_src": "login",
                            }
                        )
                    else:
                        pending_login[eos] = {
                            "nick": nick,
                            "at": at_s,
                            "serverKey": srv,
                        }
                    continue

                # resolve pending login if steam mapping appears later in same line batch
                if m and (m.group("steam") or m.group("steam2")) == steam:
                    eos = (m.group("eos") or m.group("eos2") or "").lower()
                    if eos in pending_login:
                        pj = pending_login.pop(eos)
                        at = datetime.fromisoformat(
                            pj["at"].replace("Z", "+00:00")
                        )
                        if at >= cut:
                            all_events.append(
                                {
                                    "type": "join",
                                    "steamId": steam,
                                    "eosId": eos,
                                    "nick": pj.get("nick") or nick_fallback,
                                    "at": pj["at"],
                                    "serverKey": pj.get("serverKey", srv),
                                    "_src": "login",
                                }
                            )

                rm = REMOVE_RE.search(line)
                if rm:
                    eos = rm.group("eos").lower()
                    if eos_steam.get(eos) != steam and eos != eos_hint:
                        continue
                    at_s = parse_ts(rm.group("ts"))
                    at = datetime.fromisoformat(at_s.replace("Z", "+00:00"))
                    if at < cut:
                        continue
                    all_events.append(
                        {
                            "type": "leave",
                            "steamId": steam,
                            "eosId": eos,
                            "at": at_s,
                            "serverKey": srv,
                        }
                    )
    finally:
        c.close()

    if not eos_steam and eos_hint:
        eos_steam[eos_hint] = steam

    # Dedupe joins within 15s
    all_events.sort(
        key=lambda e: (
            datetime.fromisoformat(e["at"].replace("Z", "+00:00")).timestamp(),
            0 if e["type"] == "join" and e.get("_src") == "login" else 1,
            0 if e["type"] == "join" else 1,
        )
    )
    deduped: list[dict] = []
    last_join: dict[tuple[str, str], datetime] = {}
    for ev in all_events:
        at = datetime.fromisoformat(ev["at"].replace("Z", "+00:00"))
        key = (ev["steamId"], ev["serverKey"])
        if ev["type"] == "join":
            prev = last_join.get(key)
            if prev is not None and (at - prev).total_seconds() <= JOIN_DEDUP_SEC:
                continue
            last_join[key] = at
        clean = {k: v for k, v in ev.items() if not k.startswith("_")}
        if not clean.get("eosId"):
            clean.pop("eosId", None)
        deduped.append(clean)

    joins = sum(1 for e in deduped if e["type"] == "join")
    leaves = sum(1 for e in deduped if e["type"] == "leave")
    print(f"\nevents={len(deduped)} joins={joins} leaves={leaves}")
    print(f"eos_map={eos_steam}")
    for ev in deduped:
        print(
            f"  {ev['type']:5} {ev['at']} {ev['serverKey']} nick={ev.get('nick')}"
        )

    if args.dry_run:
        print("\nDRY-RUN — not posting")
        return

    if not deduped:
        print("nothing to ingest")
        return

    url = os.environ.get(
        "SQUAD_INGEST_URL", "https://bb-squad.ru/api/ingest/squad-sessions"
    )
    secret = os.environ["SQUAD_INGEST_SECRET"]
    # chunk to be safe
    chunk = 200
    for i in range(0, len(deduped), chunk):
        batch = deduped[i : i + chunk]
        res = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            },
            json={"events": batch},
            timeout=180,
        )
        print(f"INGEST [{i}:{i+len(batch)}] {res.status_code} {res.text[:400]}")
        if res.status_code >= 400:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
