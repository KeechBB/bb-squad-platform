#!/usr/bin/env python3
"""Keep Squad RCON open on the game host and append player chat lines.

Answers !admins / admins with a private AdminWarn on the SAME RCON socket
(Squad often allows only one RCON client per server port).
"""
from __future__ import annotations

import json
import re
import socket
import struct
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

CHAT_SCRIPT_VERSION = "2026-11-21-admins-v4"

KEYS = ("TR1", "TR2", "TR3", "TR4", "TR5", "PB1")
HOST = {"PB1": "TPUB1"}
OUT = Path("/home/squad/bb-panelka-chat.jsonl")
CHAT_RE = re.compile(
    r"\[(ChatAll|ChatTeam|ChatSquad|ChatAdmin)\] \[Online IDs:([^\]]*)\] (.+?) : (.*)"
)
STEAM_RE = re.compile(r"steam:\s*(7656\d+)", re.I)
LABELS = {
    "ChatAll": "всем",
    "ChatTeam": "команда",
    "ChatSquad": "сквад",
    "ChatAdmin": "админам",
}
MSK = timezone(timedelta(hours=3))
LOCK = threading.Lock()
ADMINS_COOLDOWN_SEC = 30
_last_admins: dict[str, float] = {}
_last_admins_lock = threading.Lock()
_seen_chat: dict[str, float] = {}
_seen_lock = threading.Lock()

ADMINS_REPLY_PARTS = (
    "Увидел нарушение? Зафиксируй откат! Создай тикет на сайте bb-squad.ru.",
    "Сервер работает в автоматическом режиме. Мы сразу разберёмся в ситуации.",
)
ADMINS_LOG = Path("/tmp/bb_panelka_admins.log")


def _host(key: str) -> str:
    return HOST.get(key, key)


def load_cfg(key: str) -> tuple[int, str]:
    text = Path(f"/home/squad/servers/{_host(key)}/SquadGame/ServerConfig/Rcon.cfg").read_text(
        encoding="utf-8", errors="replace"
    )
    port = 21114
    password = ""
    for line in text.splitlines():
        line = line.strip()
        port_m = re.match(r"Port\s*=\s*(\d+)", line, re.I)
        if port_m:
            port = int(port_m.group(1))
        pass_m = re.match(r"Password\s*=\s*(.+)", line, re.I)
        if pass_m:
            password = pass_m.group(1).strip().strip('"').strip("'")
    return port, password


def encode(packet_type: int, marker: int, count: int, body: str) -> bytes:
    raw = body.encode("utf-8")
    size = len(raw) + 10
    buf = bytearray(4 + size)
    struct.pack_into("<I", buf, 0, size)
    buf[4] = marker
    struct.pack_into("<H", buf, 6, count & 0xFFFF)
    struct.pack_into("<I", buf, 8, packet_type)
    buf[12 : 12 + len(raw)] = raw
    return bytes(buf)


def append(row: dict) -> None:
    line = json.dumps(row, ensure_ascii=False)
    with LOCK:
        with OUT.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        if OUT.stat().st_size > 1_500_000:
            kept = OUT.read_text(encoding="utf-8", errors="replace").splitlines()[-200:]
            OUT.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")


def _admins_log(line: str) -> None:
    try:
        stamp = datetime.now(MSK).strftime("%Y-%m-%d %H:%M:%S")
        with ADMINS_LOG.open("a", encoding="utf-8") as handle:
            handle.write(f"{stamp} {line}\n")
        if ADMINS_LOG.stat().st_size > 400_000:
            kept = ADMINS_LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-200:]
            ADMINS_LOG.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")
    except Exception:
        pass


def is_admins_command(text: str) -> bool:
    low = (text or "").strip().lower()
    if not low:
        return False
    # !admins / admins / !admin / admin
    return low in ("!admins", "admins", "!admin", "admin") or low.startswith(
        ("!admins ", "admins ", "!admin ", "admin ")
    )


def send_cmd(sock: socket.socket, counter: list[int], cmd: str) -> None:
    """Execute RCON command on the already-authenticated Squad socket."""
    counter[0] = (counter[0] + 1) & 0xFFFF
    # type 2 = exec command (same family as auth response)
    sock.sendall(encode(2, 1, counter[0], cmd))


def reply_admins_on_socket(
    key: str,
    sock: socket.socket,
    counter: list[int],
    steam_id: str,
    name: str,
) -> None:
    if not steam_id:
        _admins_log(f"{key} skip no-steam name={name!r}")
        return
    now = time.time()
    with _last_admins_lock:
        prev = _last_admins.get(steam_id, 0.0)
        if now - prev < ADMINS_COOLDOWN_SEC:
            _admins_log(f"{key} cooldown steam={steam_id} name={name!r}")
            return
        _last_admins[steam_id] = now
    try:
        for part in ADMINS_REPLY_PARTS:
            cmd = f"AdminWarn {steam_id} {part}"
            send_cmd(sock, counter, cmd)
            _admins_log(f"{key} warn-socket steam={steam_id} name={name!r} part={part[:48]!r}")
            time.sleep(0.2)
    except Exception as exc:
        _admins_log(
            f"{key} ERROR-socket steam={steam_id} name={name!r} err={type(exc).__name__}:{exc}"
        )
        with _last_admins_lock:
            _last_admins.pop(steam_id, None)
        raise


def handle_chat(
    key: str,
    sock: socket.socket,
    counter: list[int],
    body: str,
) -> None:
    match = CHAT_RE.search(body.strip())
    if not match:
        return
    ids_blob = match.group(2) or ""
    steam_m = STEAM_RE.search(ids_blob)
    steam_id = steam_m.group(1) if steam_m else ""
    name = match.group(3).strip()[:48]
    text = match.group(4).strip()[:240]

    # RCON иногда дублирует один и тот же пакет десятки раз
    dedupe_key = f"{key}|{steam_id}|{text.lower()}"
    now = time.time()
    with _seen_lock:
        prev = _seen_chat.get(dedupe_key, 0.0)
        if now - prev < 1.5:
            return
        _seen_chat[dedupe_key] = now
        if len(_seen_chat) > 4000:
            cutoff = now - 60
            for old in [k for k, ts in _seen_chat.items() if ts < cutoff]:
                _seen_chat.pop(old, None)

    append(
        {
            "key": key,
            "date": datetime.now(MSK).strftime("%Y-%m-%d"),
            "clock": datetime.now(MSK).strftime("%H:%M:%S"),
            "channel": LABELS.get(match.group(1), "чат"),
            "name": name,
            "steamId": steam_id,
            "text": text,
        }
    )
    if is_admins_command(text):
        try:
            reply_admins_on_socket(key, sock, counter, steam_id, name)
        except Exception:
            # сокет мог оборваться — listen() переподключится
            raise


def listen(key: str) -> None:
    port, password = load_cfg(key)
    while True:
        sock = None
        try:
            sock = socket.create_connection(("127.0.0.1", port), timeout=8)
            sock.settimeout(30)
            buf = bytearray()
            counter = [1]

            def pull() -> tuple[int, str] | None:
                while True:
                    if len(buf) >= 4:
                        size = struct.unpack_from("<i", buf, 0)[0]
                        if size < 10 or size > 65536:
                            raise RuntimeError("bad packet")
                        if (
                            size == 10
                            and len(buf) >= 21
                            and buf[12:19] == b"\x00\x00\x00\x01\x00\x00\x00"
                        ):
                            del buf[:21]
                            continue
                        if len(buf) >= 4 + size:
                            data = bytes(buf[4 : 4 + size])
                            del buf[: 4 + size]
                            packet_type = struct.unpack_from("<I", data, 4)[0]
                            body = data[8:-2].decode("utf-8", "replace")
                            return packet_type, body
                    chunk = sock.recv(4096)
                    if not chunk:
                        raise RuntimeError("closed")
                    buf.extend(chunk)

            sock.sendall(encode(3, 2, counter[0], password))
            while True:
                packet = pull()
                if packet and packet[0] == 2:
                    break
            while True:
                try:
                    packet = pull()
                except socket.timeout:
                    continue
                if packet and packet[0] == 1:
                    handle_chat(key, sock, counter, packet[1])
        except Exception as exc:
            _admins_log(f"{key} listen-reconnect {type(exc).__name__}:{exc}")
            time.sleep(2)
        finally:
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass


def main() -> None:
    for key in KEYS:
        threading.Thread(target=listen, args=(key,), daemon=True).start()
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
