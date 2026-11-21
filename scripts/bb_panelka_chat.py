#!/usr/bin/env python3
"""Keep Squad RCON open on the game host and append player chat lines.

Also answers !admins with a private AdminWarn.
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

CHAT_SCRIPT_VERSION = "2026-11-21-admins-v1"

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
ADMINS_COOLDOWN_SEC = 45
_last_admins: dict[str, float] = {}
_last_admins_lock = threading.Lock()

ADMINS_REPLY = (
    "Увидел нарушение? Зафиксируй откат! Создай тикет на сайте bb-squad.ru. "
    "Сервер работает в автоматическом режиме. Мы сразу разберёмся в ситуации."
)


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


def source_rcon(key: str, cmd: str, timeout: float = 6.0) -> str:
    """Short-lived Source-style RCON (same as panelka) for AdminWarn."""
    port, password = load_cfg(key)
    sock = socket.create_connection(("127.0.0.1", port), timeout=timeout)
    sock.settimeout(timeout)

    def send(req_id: int, req_type: int, body: str) -> None:
        payload = struct.pack("<ii", req_id, req_type) + body.encode("utf-8") + b"\x00\x00"
        sock.sendall(struct.pack("<i", len(payload)) + payload)

    def recvall(n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                raise RuntimeError("rcon closed")
            buf += chunk
        return buf

    def recv() -> tuple[int, int, str]:
        size = struct.unpack("<i", recvall(4))[0]
        if size < 10 or size > 4_000_000:
            raise RuntimeError("bad packet")
        data = recvall(size)
        req_id, req_type = struct.unpack("<ii", data[:8])
        return req_id, req_type, data[8:-2].decode("utf-8", "replace")

    try:
        send(1, 3, password)
        while True:
            req_id, req_type, _ = recv()
            if req_type == 2:
                if req_id == -1:
                    raise RuntimeError("rcon auth failed")
                break
        send(2, 2, cmd)
        parts: list[str] = []
        sock.settimeout(1.5)
        try:
            while True:
                req_id, req_type, body = recv()
                if req_id == 2 and req_type == 0:
                    parts.append(body)
                    sock.settimeout(0.2)
                    if len(parts) > 40:
                        break
                elif req_id == -1:
                    raise RuntimeError("rcon rejected")
        except (socket.timeout, TimeoutError, RuntimeError):
            pass
        return "".join(parts)
    finally:
        try:
            sock.close()
        except Exception:
            pass


def maybe_reply_admins(key: str, steam_id: str, text: str) -> None:
    low = (text or "").strip().lower()
    if low != "!admins" and not low.startswith("!admins "):
        return
    if not steam_id:
        return
    now = time.time()
    with _last_admins_lock:
        prev = _last_admins.get(steam_id, 0.0)
        if now - prev < ADMINS_COOLDOWN_SEC:
            return
        _last_admins[steam_id] = now
    try:
        source_rcon(key, f"AdminWarn {steam_id} {ADMINS_REPLY}")
    except Exception:
        with _last_admins_lock:
            _last_admins.pop(steam_id, None)


def record(key: str, body: str) -> None:
    match = CHAT_RE.search(body.strip())
    if not match:
        return
    ids_blob = match.group(2) or ""
    steam_m = STEAM_RE.search(ids_blob)
    steam_id = steam_m.group(1) if steam_m else ""
    name = match.group(3).strip()[:48]
    text = match.group(4).strip()[:240]
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
    if steam_id:
        threading.Thread(
            target=maybe_reply_admins,
            args=(key, steam_id, text),
            daemon=True,
        ).start()


def listen(key: str) -> None:
    port, password = load_cfg(key)
    while True:
        sock = None
        try:
            sock = socket.create_connection(("127.0.0.1", port), timeout=8)
            sock.settimeout(30)
            buf = bytearray()

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

            sock.sendall(encode(3, 2, 1, password))
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
                    record(key, packet[1])
        except Exception:
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
