#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Хвост SquadGame.log → POST join/leave на bb-squad.ru.

Env (не коммитить секреты):
  SQUAD_SSH_HOST=194.93.2.107
  SQUAD_SSH_PORT=2022
  SQUAD_SSH_USER=squad
  SQUAD_SSH_PASSWORD=...
  # Один лог (legacy):
  SQUAD_LOG_PATH=/home/squad/servers/TPUB1/SquadGame/Saved/Logs/SquadGame.log
  SQUAD_SERVER_KEY=TPUB1
  # Или несколько серверов (тренировка TR1 + паб):
  SQUAD_SERVERS=TR1,TPUB1
  SQUAD_LOG_ROOT=/home/squad/servers
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

# Name may be followed by ?PASSWORD=… on passworded training servers.
LOGIN_RE = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\d+\]"
    r".*LogNet: Login request: \?Name=(?P<name>[^?\s]+)"
    r"(?:\?[^\s]*)?"
    r" userId: RedpointEOS:(?P<eos>[0-9a-fA-F]{32})",
)
REMOVE_RE = re.compile(
    r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}):\d+\]"
    r".*RemovePlayer\(UserId: (?P<eos>[0-9a-fA-F]{32})\)",
)
# Steam64 = 17 digits (7656 + 13). Shorter capture truncated IDs and broke ingest.
STEAM_EOS_RE = re.compile(
    r"EOS:\s*(?P<eos>[0-9a-fA-F]{32}).*?steam:\s*(?P<steam>7656\d{13})"
    r"|steam:\s*(?P<steam2>7656\d{13}).*?EOS:\s*(?P<eos2>[0-9a-fA-F]{32})",
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


def clean_nick(raw: str) -> str:
    nick = (raw or "").strip()
    if "?" in nick:
        nick = nick.split("?", 1)[0]
    return nick.strip()


def resolve_log_targets() -> list[tuple[str, str]]:
    """Return list of (serverKey, logPath)."""
    servers = os.environ.get("SQUAD_SERVERS", "").strip()
    root = os.environ.get("SQUAD_LOG_ROOT", "/home/squad/servers").rstrip("/")
    if servers:
        out: list[tuple[str, str]] = []
        for key in servers.split(","):
            key = key.strip()
            if not key:
                continue
            path = f"{root}/{key}/SquadGame/Saved/Logs/SquadGame.log"
            out.append((key, path))
        if out:
            return out
    path = os.environ.get(
        "SQUAD_LOG_PATH",
        f"{root}/TPUB1/SquadGame/Saved/Logs/SquadGame.log",
    )
    key = os.environ.get("SQUAD_SERVER_KEY", "TPUB1")
    return [(key, path)]


class Collector:
    def __init__(self) -> None:
        self.host = env("SQUAD_SSH_HOST")
        self.port = int(os.environ.get("SQUAD_SSH_PORT", "2022"))
        self.user = env("SQUAD_SSH_USER")
        self.password = env("SQUAD_SSH_PASSWORD")
        self.targets = resolve_log_targets()
        self.ingest_url = env("SQUAD_INGEST_URL")
        self.ingest_secret = env("SQUAD_INGEST_SECRET")
        self.state_path = Path(
            os.environ.get("SQUAD_STATE_PATH", "squad_collector_state.json")
        )
        self.poll_sec = float(os.environ.get("SQUAD_POLL_SEC", "5"))
        self.eos_steam: dict[str, str] = {}
        # eos -> {nick, at, serverKey}
        self.pending_joins: dict[str, dict[str, Any]] = {}
        # serverKey -> {offset, inode}
        self.log_state: dict[str, dict[str, Any]] = {
            key: {"offset": 0, "inode": None} for key, _ in self.targets
        }
        self._load_state()

    def _load_state(self) -> None:
        if not self.state_path.exists():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            raw_map = {
                str(k).lower(): str(v) for k, v in (data.get("eos_steam") or {}).items()
            }
            self.eos_steam = {
                k: v for k, v in raw_map.items() if re.fullmatch(r"7656\d{13}", v)
            }
            self.pending_joins = data.get("pending_joins") or {}
            logs = data.get("logs")
            if isinstance(logs, dict):
                for key, meta in logs.items():
                    if key in self.log_state and isinstance(meta, dict):
                        self.log_state[key] = {
                            "offset": int(meta.get("offset", 0)),
                            "inode": meta.get("inode"),
                        }
            elif len(self.targets) == 1:
                # legacy single-log state
                key = self.targets[0][0]
                self.log_state[key] = {
                    "offset": int(data.get("offset", 0)),
                    "inode": data.get("inode"),
                }
            if len(self.eos_steam) != len(raw_map):
                print(
                    f"state: dropped {len(raw_map) - len(self.eos_steam)} truncated steam ids",
                    file=sys.stderr,
                )
        except Exception as e:
            print("state load fail", e, file=sys.stderr)

    def _valid_steam(self, steam: str) -> str | None:
        steam = (steam or "").strip()
        return steam if re.fullmatch(r"7656\d{13}", steam) else None

    def _save_state(self) -> None:
        payload = {
            "logs": self.log_state,
            "eos_steam": self.eos_steam,
            "pending_joins": self.pending_joins,
        }
        # keep legacy fields for the first target (compat)
        if self.targets:
            key = self.targets[0][0]
            payload["offset"] = self.log_state[key]["offset"]
            payload["inode"] = self.log_state[key]["inode"]
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

    def _stat(self, client: paramiko.SSHClient, log_path: str) -> tuple[int, str]:
        cmd = f'stat -c "%s %i" {log_path}'
        _, out, _ = client.exec_command(cmd, timeout=30)
        text = out.read().decode("utf-8", "replace").strip()
        size_s, ino_s = text.split()
        return int(size_s), ino_s

    def _read_chunk(
        self, client: paramiko.SSHClient, log_path: str, start: int, size: int
    ) -> bytes:
        length = max(0, size - start)
        if length == 0:
            return b""
        length = min(length, 8 * 1024 * 1024)
        cmd = (
            f"dd if={log_path} bs=1 skip={start} count={length} "
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
            json={"events": events},
            timeout=30,
        )
        if r.status_code >= 300:
            print("ingest fail", r.status_code, r.text[:300], file=sys.stderr)
        else:
            print("ingest", r.json())

    def _remember_map(self, eos: str, steam: str) -> list[dict[str, Any]]:
        eos = eos.lower()
        steam_ok = self._valid_steam(steam)
        if not steam_ok:
            return []
        steam = steam_ok
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
                    "serverKey": pj.get("serverKey") or self.targets[0][0],
                }
            )
        elif prev != steam:
            pass
        return events

    def _handle_line(self, line: str, server_key: str) -> list[dict[str, Any]]:
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
            nick = clean_nick(lm.group("name"))
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
                        "serverKey": server_key,
                    }
                )
            else:
                self.pending_joins[eos] = {
                    "nick": nick,
                    "at": at,
                    "serverKey": server_key,
                }
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
                        "serverKey": server_key,
                    }
                )
        return events

    def _poll_one(
        self, client: paramiko.SSHClient, server_key: str, log_path: str
    ) -> list[dict[str, Any]]:
        st = self.log_state[server_key]
        size, inode = self._stat(client, log_path)
        if st.get("inode") and inode != st["inode"]:
            print(f"log rotated {server_key}, reset offset")
            st["offset"] = 0
        st["inode"] = inode
        if size < int(st["offset"]):
            st["offset"] = 0

        offset = int(st["offset"])
        if (
            offset == 0
            and size > 256 * 1024
            and os.environ.get("SQUAD_BACKFILL") != "1"
            and not self.eos_steam
            and not self.pending_joins
        ):
            print(f"bootstrap {server_key}: seek end size={size}")
            st["offset"] = size
            return []

        raw = self._read_chunk(client, log_path, offset, size)
        if not raw:
            return []
        text = raw.decode("utf-8", "replace")
        if not text.endswith("\n"):
            cut = text.rfind("\n")
            if cut < 0:
                return []
            consumed = len(raw[: cut + 1])
            text = text[: cut + 1]
        else:
            consumed = len(raw)

        batch: list[dict[str, Any]] = []
        for line in text.splitlines():
            batch.extend(self._handle_line(line, server_key))
        st["offset"] = offset + consumed
        return batch

    def poll_once(self) -> None:
        client = self._ssh()
        try:
            batch: list[dict[str, Any]] = []
            for server_key, log_path in self.targets:
                try:
                    batch.extend(self._poll_one(client, server_key, log_path))
                except Exception as e:
                    print(
                        f"poll {server_key} error",
                        type(e).__name__,
                        e,
                        file=sys.stderr,
                    )
            self._post(batch)
            self._save_state()
        finally:
            client.close()

    def run(self) -> None:
        print(
            "collector start",
            self.host,
            ", ".join(f"{k}={p}" for k, p in self.targets),
        )
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
