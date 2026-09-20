#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Хвост SquadGame.log → POST join/leave на bb-squad.ru.

Env (не коммитить секреты):
  SQUAD_SSH_HOST=194.93.2.107
  SQUAD_SSH_PORT=2022
  SQUAD_SSH_USER=squad
  SQUAD_SSH_PASSWORD=...
  SQUAD_LOG_PATH=/home/squad/servers/TPUB1/SquadGame/Saved/Logs/SquadGame.log
  SQUAD_SERVER_KEY=TPUB1
  SQUAD_INGEST_URL=https://bb-squad.ru/api/ingest/squad-sessions
  SQUAD_INGEST_SECRET=...
  SQUAD_STATE_PATH=./squad_collector_state.json
  SQUAD_POLL_SEC=5

Зависимости: pip install paramiko requests
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import paramiko
import requests

LOGIN_RE = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\d+\]"
    r".*LogNet: Login request: \?Name=(?P<name>.+?) "
    r"userId: RedpointEOS:(?P<eos>[0-9a-fA-F]{32})",
)
REMOVE_RE = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\d+\]"
    r".*RemovePlayer\(UserId: (?P<eos>[0-9a-fA-F]{32})\)",
)
STEAM_EOS_RE = re.compile(
    r"EOS:\s*(?P<eos>[0-9a-fA-F]{32}).*?steam:\s*(?P<steam>7656\d{12})"
    r"|steam:\s*(?P<steam2>7656\d{12}).*?EOS:\s*(?P<eos2>[0-9a-fA-F]{32})",
    re.IGNORECASE,
)


def load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = val


def env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None or v == "":
        raise SystemExit(f"missing env {name}")
    return v


def parse_ts(ts: str) -> str:
    # 2026.09.20-13.51.23 → assume UTC (Squad dedicated logs)
    dt = datetime.strptime(ts, "%Y.%m.%d-%H.%M.%S").replace(tzinfo=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


class Collector:
    def __init__(self) -> None:
        self.host = env("SQUAD_SSH_HOST")
        self.port = int(os.environ.get("SQUAD_SSH_PORT", "2022"))
        self.user = env("SQUAD_SSH_USER")
        self.password = env("SQUAD_SSH_PASSWORD")
        self.log_path = env(
            "SQUAD_LOG_PATH",
            "/home/squad/servers/TPUB1/SquadGame/Saved/Logs/SquadGame.log",
        )
        self.server_key = os.environ.get("SQUAD_SERVER_KEY", "TPUB1")
        self.ingest_url = env("SQUAD_INGEST_URL")
        self.ingest_secret = env("SQUAD_INGEST_SECRET")
        self.state_path = Path(
            os.environ.get("SQUAD_STATE_PATH", "squad_collector_state.json")
        )
        self.poll_sec = float(os.environ.get("SQUAD_POLL_SEC", "5"))
        self.eos_steam: dict[str, str] = {}
        self.pending_joins: dict[str, dict[str, Any]] = {}
        self.offset = 0
        self.inode: str | None = None
        self._load_state()

    def _load_state(self) -> None:
        if not self.state_path.exists():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            self.offset = int(data.get("offset", 0))
            self.inode = data.get("inode")
            self.eos_steam = {
                str(k).lower(): str(v) for k, v in (data.get("eos_steam") or {}).items()
            }
            self.pending_joins = data.get("pending_joins") or {}
        except Exception as e:
            print("state load fail", e, file=sys.stderr)

    def _save_state(self) -> None:
        payload = {
            "offset": self.offset,
            "inode": self.inode,
            "eos_steam": self.eos_steam,
            "pending_joins": self.pending_joins,
        }
        self.state_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _ssh(self) -> paramiko.SSHClient:
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        c.connect(
            self.host,
            port=self.port,
            username=self.user,
            password=self.password,
            timeout=45,
            banner_timeout=90,
            allow_agent=False,
            look_for_keys=False,
        )
        return c

    def _stat(self, client: paramiko.SSHClient) -> tuple[int, str]:
        cmd = f'stat -c "%s %i" {self.log_path}'
        _, out, _ = client.exec_command(cmd, timeout=30)
        text = out.read().decode("utf-8", "replace").strip()
        size_s, ino_s = text.split()
        return int(size_s), ino_s

    def _read_chunk(self, client: paramiko.SSHClient, start: int, size: int) -> bytes:
        # dd skip bytes
        length = max(0, size - start)
        if length == 0:
            return b""
        # cap chunk to 8MB per poll
        length = min(length, 8 * 1024 * 1024)
        cmd = (
            f"dd if={self.log_path} bs=1 skip={start} count={length} "
            f"2>/dev/null"
        )
        _, out, _ = client.exec_command(cmd, timeout=120)
        return out.read()

    def _post(self, events: list[dict[str, Any]]) -> None:
        if not events:
            return
        r = requests.post(
            self.ingest_url,
            headers={
                "Authorization": f"Bearer {self.ingest_secret}",
                "Content-Type": "application/json",
            },
            json={"serverKey": self.server_key, "events": events},
            timeout=30,
        )
        if r.status_code >= 300:
            print("ingest fail", r.status_code, r.text[:300], file=sys.stderr)
        else:
            print("ingest", r.json())

    def _remember_map(self, eos: str, steam: str) -> list[dict[str, Any]]:
        eos = eos.lower()
        events: list[dict[str, Any]] = []
        prev = self.eos_steam.get(eos)
        self.eos_steam[eos] = steam
        if eos in self.pending_joins:
            pj = self.pending_joins.pop(eos)
            events.append(
                {
                    "type": "join",
                    "steamId": steam,
                    "eosId": eos,
                    "nick": pj.get("nick"),
                    "at": pj["at"],
                    "serverKey": self.server_key,
                }
            )
        elif prev != steam:
            # map updated; nothing else
            pass
        return events

    def _handle_line(self, line: str) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        m = STEAM_EOS_RE.search(line)
        if m:
            eos = (m.group("eos") or m.group("eos2") or "").lower()
            steam = m.group("steam") or m.group("steam2") or ""
            if eos and steam:
                events.extend(self._remember_map(eos, steam))

        lm = LOGIN_RE.search(line)
        if lm:
            eos = lm.group("eos").lower()
            nick = lm.group("name").strip()
            at = parse_ts(lm.group("ts"))
            steam = self.eos_steam.get(eos)
            if steam:
                events.append(
                    {
                        "type": "join",
                        "steamId": steam,
                        "eosId": eos,
                        "nick": nick,
                        "at": at,
                        "serverKey": self.server_key,
                    }
                )
            else:
                self.pending_joins[eos] = {"nick": nick, "at": at}
            return events

        rm = REMOVE_RE.search(line)
        if rm:
            eos = rm.group("eos").lower()
            at = parse_ts(rm.group("ts"))
            self.pending_joins.pop(eos, None)
            steam = self.eos_steam.get(eos)
            if steam:
                events.append(
                    {
                        "type": "leave",
                        "steamId": steam,
                        "eosId": eos,
                        "at": at,
                        "serverKey": self.server_key,
                    }
                )
        return events

    def poll_once(self) -> None:
        client = self._ssh()
        try:
            size, inode = self._stat(client)
            if self.inode and inode != self.inode:
                print("log rotated, reset offset")
                self.offset = 0
            self.inode = inode
            if size < self.offset:
                self.offset = 0
            # Первый старт: не гонять весь архив (55MB+), только live.
            # Для истории: SQUAD_BACKFILL=1
            if (
                self.offset == 0
                and size > 256 * 1024
                and os.environ.get("SQUAD_BACKFILL") != "1"
                and not self.eos_steam
                and not self.pending_joins
            ):
                print(f"bootstrap: seek end size={size}")
                self.offset = size
                self._save_state()
                return

            raw = self._read_chunk(client, self.offset, size)
            if not raw:
                return
            # incomplete last line → keep remainder
            text = raw.decode("utf-8", "replace")
            if not text.endswith("\n"):
                cut = text.rfind("\n")
                if cut < 0:
                    return
                consumed = len(raw[: cut + 1])
                text = text[: cut + 1]
            else:
                consumed = len(raw)

            batch: list[dict[str, Any]] = []
            for line in text.splitlines():
                batch.extend(self._handle_line(line))
            self.offset += consumed
            self._post(batch)
            self._save_state()
        finally:
            client.close()

    def run(self) -> None:
        print("collector start", self.host, self.log_path)
        while True:
            try:
                self.poll_once()
            except Exception as e:
                print("poll error", type(e).__name__, e, file=sys.stderr)
            time.sleep(self.poll_sec)


if __name__ == "__main__":
    here = Path(__file__).resolve().parent
    load_dotenv_file(here / ".squad-collector.env")
    Collector().run()
