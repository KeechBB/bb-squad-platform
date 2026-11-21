#!/usr/bin/env python3
"""Keep Squad RCON open on the game host and append player chat lines.

Answers !admins / admins with a private AdminWarn.

Squad RCON port allows one client: for Warn we briefly pause the chat
listener on that server, send Source-RCON AdminWarn, then resume.
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

CHAT_SCRIPT_VERSION = "2026-11-21-admins-v5"

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

# per-server: request pause / confirm paused / resume
_pause_req: dict[str, threading.Event] = {k: threading.Event() for k in KEYS}
_paused_ack: dict[str, threading.Event] = {k: threading.Event() for k in KEYS}
_sock_breaker: dict[str, socket.socket | None] = {k: None for k in KEYS}
_sock_lock = threading.Lock()

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
    return low in ("!admins", "admins", "!admin", "admin") or low.startswith(
        ("!admins ", "admins ", "!admin ", "admin ")
    )


def source_rcon(key: str, cmd: str, timeout: float = 6.0, attempts: int = 4) -> str:
    port, password = load_cfg(key)
    last_err: Exception | None = None
    for attempt in range(max(1, attempts)):
        sock = None
        try:
            sock = socket.create_connection(("127.0.0.1", port), timeout=timeout)
            sock.settimeout(timeout)

            def send(req_id: int, req_type: int, body: str) -> None:
                payload = (
                    struct.pack("<ii", req_id, req_type) + body.encode("utf-8") + b"\x00\x00"
                )
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
        except Exception as exc:
            last_err = exc
            time.sleep(0.4 * (attempt + 1))
        finally:
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass
    raise RuntimeError(str(last_err) if last_err else "rcon failed")


def with_rcon_pause(key: str, fn) -> None:
    """Pause chat listener on this server, run fn(), resume."""
    req = _pause_req[key]
    ack = _paused_ack[key]
    ack.clear()
    req.set()
    # force-break blocking recv
    with _sock_lock:
        sock = _sock_breaker.get(key)
    if sock is not None:
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        try:
            sock.close()
        except Exception:
            pass
    if not ack.wait(timeout=4.0):
        _admins_log(f"{key} pause-timeout")
    try:
        fn()
    finally:
        req.clear()
        ack.clear()


def maybe_reply_admins(key: str, steam_id: str, name: str, text: str) -> None:
    if not is_admins_command(text):
        return
    if not steam_id:
        _admins_log(f"{key} skip no-steam name={name!r} text={text!r}")
        return
    now = time.time()
    with _last_admins_lock:
        prev = _last_admins.get(steam_id, 0.0)
        if now - prev < ADMINS_COOLDOWN_SEC:
            _admins_log(f"{key} cooldown steam={steam_id} name={name!r}")
            return
        _last_admins[steam_id] = now

    def _send() -> None:
        for part in ADMINS_REPLY_PARTS:
            reply = source_rcon(key, f"AdminWarn {steam_id} {part}")
            _admins_log(
                f"{key} warn steam={steam_id} name={name!r} reply={reply[:160]!r}"
            )
            if "warned player" not in reply.lower():
                alt = part.replace(" ", "_")
                reply2 = source_rcon(key, f"AdminWarn {steam_id} {alt}")
                _admins_log(f"{key} warn-fallback steam={steam_id} reply={reply2[:160]!r}")
            time.sleep(0.2)

    try:
        with_rcon_pause(key, _send)
    except Exception as exc:
        _admins_log(
            f"{key} ERROR steam={steam_id} name={name!r} err={type(exc).__name__}:{exc}"
        )
        with _last_admins_lock:
            _last_admins.pop(steam_id, None)


def handle_chat(key: str, body: str) -> None:
    match = CHAT_RE.search(body.strip())
    if not match:
        return
    ids_blob = match.group(2) or ""
    steam_m = STEAM_RE.search(ids_blob)
    steam_id = steam_m.group(1) if steam_m else ""
    name = match.group(3).strip()[:48]
    text = match.group(4).strip()[:240]

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
        threading.Thread(
            target=maybe_reply_admins,
            args=(key, steam_id, name, text),
            daemon=True,
        ).start()


def listen(key: str) -> None:
    port, password = load_cfg(key)
    while True:
        # wait if pause requested before connecting
        while _pause_req[key].is_set():
            _paused_ack[key].set()
            time.sleep(0.15)

        sock = None
        try:
            sock = socket.create_connection(("127.0.0.1", port), timeout=8)
            sock.settimeout(30)
            with _sock_lock:
                _sock_breaker[key] = sock
            buf = bytearray()

            def pull() -> tuple[int, str] | None:
                while True:
                    if _pause_req[key].is_set():
                        raise RuntimeError("pause")
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
                    if _pause_req[key].is_set():
                        raise RuntimeError("pause")
                    continue
                if packet and packet[0] == 1:
                    handle_chat(key, packet[1])
        except Exception as exc:
            if "pause" in str(exc).lower() or _pause_req[key].is_set():
                _paused_ack[key].set()
                while _pause_req[key].is_set():
                    time.sleep(0.1)
            else:
                _admins_log(f"{key} listen-reconnect {type(exc).__name__}:{exc}")
                time.sleep(1.2)
        finally:
            with _sock_lock:
                if _sock_breaker.get(key) is sock:
                    _sock_breaker[key] = None
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
