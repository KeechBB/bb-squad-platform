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
    r".*RemovePlayer\(UserId:\s*(?P<eos>[0-9a-fA-F]{32})\)",
)
# Steam64 = 17 digits (7656 + 13). Shorter capture truncated IDs and broke ingest.
STEAM_EOS_RE = re.compile(
    r"EOS:\s*(?P<eos>[0-9a-fA-F]{32}).*?steam:\s*(?P<steam>7656\d{13})"
    r"|steam:\s*(?P<steam2>7656\d{13}).*?EOS:\s*(?P<eos2>[0-9a-fA-F]{32})",
    re.IGNORECASE,
)


def _safe_print(*args, **kwargs):
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        text = " ".join(str(a) for a in args)
        print(text.encode("ascii", "backslashreplace").decode("ascii"), **kwargs)


def load_dotenv_file(path: Path, *, override: bool = False) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        if not key:
            continue
        if override or key not in os.environ:
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
        self.poll_sec = float(os.environ.get("SQUAD_POLL_SEC", "3"))
        self.eos_steam: dict[str, str] = {}
        # eos -> {nick, at, serverKey}
        self.pending_joins: dict[str, dict[str, Any]] = {}
        # leave до появления steam-карты
        self.pending_leaves: dict[str, dict[str, Any]] = {}
        # serverKey -> {offset, inode}
        self.log_state: dict[str, dict[str, Any]] = {
            key: {"offset": 0, "inode": None} for key, _ in self.targets
        }
        # Какие backup уже дочитали (имя файла)
        self.processed_backups: set[str] = set()
        self._pending_backup_catchup: set[str] = set()
        self._load_state()
        # При старте один раз проверим свежие backup (после простоя / отпуска)
        for key, _ in self.targets:
            self._pending_backup_catchup.add(key)

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
            self.pending_leaves = data.get("pending_leaves") or {}
            raw_backs = data.get("processed_backups") or []
            if isinstance(raw_backs, list):
                self.processed_backups = {str(x) for x in raw_backs}
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
                _safe_print(
                    f"state: dropped {len(raw_map) - len(self.eos_steam)} truncated steam ids",
                    file=sys.stderr,
                )
        except Exception as e:
            _safe_print("state load fail", e, file=sys.stderr)

    def _valid_steam(self, steam: str) -> str | None:
        steam = (steam or "").strip()
        return steam if re.fullmatch(r"7656\d{13}", steam) else None

    def _save_state(self) -> None:
        payload = {
            "logs": self.log_state,
            "eos_steam": self.eos_steam,
            "pending_joins": self.pending_joins,
            "pending_leaves": self.pending_leaves,
            "processed_backups": sorted(self.processed_backups)[-80:],
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
            _safe_print("ingest fail", r.status_code, r.text[:300], file=sys.stderr)
        else:
            _safe_print("ingest", r.json())

    def _remember_map(self, eos: str, steam: str) -> list[dict[str, Any]]:
        eos = eos.lower()
        steam_ok = self._valid_steam(steam)
        if not steam_ok:
            return []
        steam = steam_ok
        events: list[dict[str, Any]] = []
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
        if eos in self.pending_leaves:
            pl = self.pending_leaves.pop(eos)
            events.append(
                {
                    "type": "leave",
                    "steamId": steam,
                    "eosId": eos,
                    "at": pl["at"],
                    "serverKey": pl.get("serverKey") or self.targets[0][0],
                }
            )
        return events

    def _emit_leave(
        self, eos: str, at: str, server_key: str
    ) -> list[dict[str, Any]]:
        self.pending_joins.pop(eos, None)
        # дедуп UnregisterPlayer + RemovePlayer в одну секунду
        prev = self.pending_leaves.get(eos)
        if prev and prev.get("at") == at and prev.get("serverKey") == server_key:
            return []
        steam = self.eos_steam.get(eos)
        if steam:
            self.pending_leaves.pop(eos, None)
            return [
                {
                    "type": "leave",
                    "steamId": steam,
                    "eosId": eos,
                    "at": at,
                    "serverKey": server_key,
                }
            ]
        self.pending_leaves[eos] = {"at": at, "serverKey": server_key}
        _safe_print(
            f"leave without steam map → eos-only {eos[:8]}… @ {server_key}",
            flush=True,
        )
        return [
            {
                "type": "leave",
                "steamId": "",
                "eosId": eos,
                "at": at,
                "serverKey": server_key,
            }
        ]

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
            events.extend(self._emit_leave(eos, at, server_key))
        return events

    def _poll_one(
        self, client: paramiko.SSHClient, server_key: str, log_path: str
    ) -> list[dict[str, Any]]:
        st = self.log_state[server_key]
        size, inode = self._stat(client, log_path)
        if st.get("inode") and inode != st["inode"]:
            _safe_print(f"log rotated {server_key}, queue offset + catchup backup")
            # Дочитать свежий backup, иначе leave за вечер теряются
            self._pending_backup_catchup.add(server_key)
            st["offset"] = 0
        st["inode"] = inode
        if size < int(st["offset"]):
            st["offset"] = 0
            self._pending_backup_catchup.add(server_key)

        offset = int(st["offset"])
        if (
            offset == 0
            and size > 256 * 1024
            and os.environ.get("SQUAD_BACKFILL") != "1"
            and not self.eos_steam
            and not self.pending_joins
        ):
            _safe_print(f"bootstrap {server_key}: seek end size={size}")
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

    def _catchup_backups(
        self, client: paramiko.SSHClient, server_key: str, log_path: str
    ) -> list[dict[str, Any]]:
        """Дочитать свежие SquadGame-backup-*.log (после ротации / простоя)."""
        if server_key not in self._pending_backup_catchup:
            return []
        self._pending_backup_catchup.discard(server_key)
        log_dir = log_path.rsplit("/", 1)[0]
        # последние ~4 backup + не помеченные processed
        cmd = (
            f"ls -1t {log_dir}/SquadGame-backup-*.log 2>/dev/null | head -6 || true"
        )
        try:
            _, out, _ = client.exec_command(cmd, timeout=30)
            files = [
                f.strip()
                for f in out.read().decode("utf-8", "replace").splitlines()
                if f.strip()
            ]
        except Exception as e:
            _safe_print(f"backup list {server_key}", type(e).__name__, e, file=sys.stderr)
            return []

        batch: list[dict[str, Any]] = []
        for path in files:
            name = path.rsplit("/", 1)[-1]
            if name in self.processed_backups:
                continue
            # Только Login / Remove / steam↔EOS — не весь 20MB
            grep_cmd = (
                f"grep -E 'Login request:|RemovePlayer\\(UserId:|EOS:.*steam:|steam:.*EOS:' "
                f"{path} 2>/dev/null || true"
            )
            try:
                _, gout, _ = client.exec_command(grep_cmd, timeout=180)
                text = gout.read().decode("utf-8", "replace")
            except Exception as e:
                _safe_print(
                    f"backup read {name}", type(e).__name__, e, file=sys.stderr
                )
                continue
            n = 0
            for line in text.splitlines():
                ev = self._handle_line(line, server_key)
                if ev:
                    batch.extend(ev)
                    n += 1
            self.processed_backups.add(name)
            _safe_print(f"backup catchup {server_key} {name} events≈{n}", flush=True)
        return batch

    def poll_once(self) -> None:
        last_err: Exception | None = None
        client = None
        for attempt in range(1, 4):
            try:
                client = self._ssh()
                last_err = None
                break
            except Exception as e:
                last_err = e
                _safe_print(f"ssh connect retry {attempt}/3", type(e).__name__, e, file=sys.stderr)
                time.sleep(min(5 * attempt, 15))
        if client is None:
            _safe_print("poll error", type(last_err).__name__, last_err, file=sys.stderr)
            # всё равно трогаем state mtime, чтобы watchdog не бесился
            try:
                self._save_state()
            except Exception:
                pass
            return
        try:
            batch: list[dict[str, Any]] = []
            for server_key, log_path in self.targets:
                try:
                    batch.extend(self._catchup_backups(client, server_key, log_path))
                    batch.extend(self._poll_one(client, server_key, log_path))
                except Exception as e:
                    _safe_print(
                        f"poll {server_key} error",
                        type(e).__name__,
                        e,
                        file=sys.stderr,
                    )
            self._post(batch)
            self._save_state()
        finally:
            try:
                client.close()
            except Exception:
                pass

    def run(self) -> None:
        _safe_print(
            "collector start",
            self.host,
            ", ".join(f"{k}={p}" for k, p in self.targets),
        )
        ticks = 0
        # Раз в час снова дочитать свежие backup (пропуск leave в live / рестарт).
        rebackup_every = max(1, int(3600 / max(self.poll_sec, 1)))
        stale_tick_every = max(1, int(60 / max(self.poll_sec, 1)))
        while True:
            try:
                ticks += 1
                if ticks % rebackup_every == 0:
                    for key, _ in self.targets:
                        self._pending_backup_catchup.add(key)
                    # разрешить перечитать 2 самых свежих backup
                    for name in sorted(self.processed_backups, reverse=True)[:2]:
                        self.processed_backups.discard(name)
                    _safe_print("hourly backup re-catchup armed", flush=True)
                self.poll_once()
                # Пустой POST → на сайте stale-close висяков >18ч
                if ticks % stale_tick_every == 0:
                    try:
                        requests.post(
                            self.ingest_url,
                            headers={
                                "Authorization": f"Bearer {self.ingest_secret}",
                                "Content-Type": "application/json",
                            },
                            json={"events": []},
                            timeout=20,
                        )
                    except Exception as e:
                        _safe_print(
                            "stale-tick fail",
                            type(e).__name__,
                            e,
                            file=sys.stderr,
                        )
            except Exception as e:
                _safe_print("poll error", type(e).__name__, e, file=sys.stderr)
            time.sleep(self.poll_sec)


if __name__ == "__main__":
    here = Path(__file__).resolve().parent
    load_dotenv_file(here / ".squad-collector.env", override=True)
    Collector().run()
