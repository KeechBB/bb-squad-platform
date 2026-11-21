#!/usr/bin/env python3
"""BlackBerry panelka agent on the game host.

Owns Squad RCON (one client per port) with a priority queue:
  P0 = moderation commands (kick/ban/warn/…)
  P1 = roster ListPlayers/ListSquads
  P2 = background (unused)

Also listens for chat and answers !admins.

HTTP API on 127.0.0.1:18765 only — never binds public interfaces.
Does NOT restart/stop the game server process.
"""
from __future__ import annotations

import json
import os
import queue
import re
import socket
import struct
import threading
import time
import traceback
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

AGENT_VERSION = "2026-11-21-agent-v1"
LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 18765
KEYS = ("TR1", "TR2", "TR3", "TR4", "TR5", "PB1")
HOST = {"PB1": "TPUB1"}
CHAT_OUT = Path("/home/squad/bb-panelka-chat.jsonl")
ADMINS_LOG = Path("/tmp/bb_panelka_admins.log")
METRICS_PATH = Path("/tmp/bb_panelka_agent_metrics.json")
PID_PATH = Path("/tmp/bb_panelka_agent.pid")

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

# Forbidden in agent unless explicitly allowlisted — safety for game server
BLOCKED_CMDS = re.compile(
    r"^\s*(AdminRestartMatch|AdminEndMatch|AdminDestroy|Quit|Exit)\b",
    re.I,
)

ADMINS_REPLY_PARTS = (
    "Увидел нарушение? Зафиксируй откат! Создай тикет на сайте bb-squad.ru.",
    "Сервер работает в автоматическом режиме. Мы сразу разберёмся в ситуации.",
)

P0 = 0
P1 = 1
P2 = 2

_chat_lock = threading.Lock()
_seen_chat: dict[str, float] = {}
_last_admins: dict[str, float] = {}
_admins_lock = threading.Lock()

_metrics_lock = threading.Lock()
_metrics: dict[str, Any] = {
    "version": AGENT_VERSION,
    "startedAt": "",
    "rconOk": 0,
    "rconFail": 0,
    "rosterOk": 0,
    "rosterFail": 0,
    "cmdOk": 0,
    "cmdFail": 0,
    "lastRosterMs": {},
    "lastCmdMs": {},
    "queueWaitMs": {},
}


def _host(key: str) -> str:
    return HOST.get(key, key)


def _admins_log(line: str) -> None:
    try:
        stamp = datetime.now(MSK).strftime("%Y-%m-%d %H:%M:%S")
        with ADMINS_LOG.open("a", encoding="utf-8") as handle:
            handle.write(f"{stamp} {line}\n")
    except Exception:
        pass


def _metric(event: str, **kwargs: Any) -> None:
    with _metrics_lock:
        if event == "rcon_ok":
            _metrics["rconOk"] += 1
        elif event == "rcon_fail":
            _metrics["rconFail"] += 1
        elif event == "roster_ok":
            _metrics["rosterOk"] += 1
            key = str(kwargs.get("key") or "")
            _metrics["lastRosterMs"][key] = int(kwargs.get("ms") or 0)
        elif event == "roster_fail":
            _metrics["rosterFail"] += 1
        elif event == "cmd_ok":
            _metrics["cmdOk"] += 1
            key = str(kwargs.get("key") or "")
            _metrics["lastCmdMs"][key] = int(kwargs.get("ms") or 0)
        elif event == "cmd_fail":
            _metrics["cmdFail"] += 1
        wait = kwargs.get("wait_ms")
        if wait is not None:
            key = str(kwargs.get("key") or "")
            _metrics["queueWaitMs"][key] = int(wait)
        try:
            METRICS_PATH.write_text(json.dumps(_metrics, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass


def load_cfg(key: str) -> tuple[int, str]:
    text = Path(f"/home/squad/servers/{_host(key)}/SquadGame/ServerConfig/Rcon.cfg").read_text(
        encoding="utf-8", errors="replace"
    )
    port = 21114
    password = ""
    for line in text.splitlines():
        line = line.strip()
        m = re.match(r"Port\s*=\s*(\d+)", line, re.I)
        if m:
            port = int(m.group(1))
        m = re.match(r"Password\s*=\s*(.+)", line, re.I)
        if m:
            password = m.group(1).strip().strip('"').strip("'")
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


def source_rcon(key: str, cmd: str, timeout: float = 6.0) -> str:
    if BLOCKED_CMDS.search(cmd or ""):
        raise RuntimeError("команда запрещена агентом")
    port, password = load_cfg(key)
    sock = socket.create_connection(("127.0.0.1", port), timeout=timeout)
    sock.settimeout(timeout)
    try:

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

        send(1, 3, password)
        while True:
            req_id, req_type, _ = recv()
            if req_type == 2:
                if req_id == -1:
                    raise RuntimeError("rcon auth failed")
                break
        send(2, 2, cmd)
        parts: list[str] = []
        sock.settimeout(2.0)
        try:
            while True:
                req_id, req_type, body = recv()
                if req_id == 2 and req_type == 0:
                    parts.append(body)
                    sock.settimeout(0.15)
                    if len(parts) > 200:
                        break
                elif req_id == -1:
                    raise RuntimeError("rcon rejected")
        except (socket.timeout, TimeoutError, RuntimeError):
            if not parts:
                raise
        return "".join(parts)
    finally:
        try:
            sock.close()
        except Exception:
            pass


class KeyWorker:
    """Per-server RCON owner: chat listen + priority command queue."""

    def __init__(self, key: str) -> None:
        self.key = key
        self.q: queue.PriorityQueue[tuple[int, int, dict[str, Any]]] = queue.PriorityQueue()
        self._seq = 0
        self._seq_lock = threading.Lock()
        self.pause = threading.Event()
        self.paused_ack = threading.Event()
        self._sock: socket.socket | None = None
        self._sock_lock = threading.Lock()
        self._roster_cache: tuple[float, dict[str, Any]] | None = None
        self._thread = threading.Thread(target=self._run, daemon=True, name=f"worker-{key}")
        self._chat_thread = threading.Thread(target=self._listen_chat, daemon=True, name=f"chat-{key}")

    def start(self) -> None:
        self._thread.start()
        self._chat_thread.start()

    def submit(self, priority: int, fn: Callable[[], Any], timeout: float = 20.0) -> Any:
        with self._seq_lock:
            self._seq += 1
            seq = self._seq
        done = threading.Event()
        box: dict[str, Any] = {"done": done, "fn": fn, "result": None, "error": None, "t0": time.time()}
        self.q.put((priority, seq, box))
        self._break_sock()
        self.pause.set()
        if not done.wait(timeout=timeout):
            raise TimeoutError("очередь RCON не ответила вовремя")
        if box["error"] is not None:
            raise RuntimeError(str(box["error"]))
        return box["result"]

    def _break_sock(self) -> None:
        with self._sock_lock:
            sock = self._sock
        if sock is None:
            return
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        try:
            sock.close()
        except Exception:
            pass

    def _run(self) -> None:
        while True:
            try:
                _prio, _seq, box = self.q.get(timeout=0.5)
            except queue.Empty:
                self.pause.clear()
                self.paused_ack.clear()
                continue
            self.pause.set()
            self._break_sock()
            # give chat listener a moment to drop the port
            time.sleep(0.12)
            wait_ms = int((time.time() - float(box["t0"])) * 1000)
            try:
                box["result"] = box["fn"]()
                _metric("rcon_ok", key=self.key, wait_ms=wait_ms)
            except Exception as exc:
                box["error"] = f"{type(exc).__name__}:{exc}"
                _metric("rcon_fail", key=self.key, wait_ms=wait_ms)
            finally:
                box["done"].set()
                if self.q.empty():
                    self.pause.clear()

    def _listen_chat(self) -> None:
        while True:
            while self.pause.is_set():
                self.paused_ack.set()
                time.sleep(0.1)
            sock = None
            try:
                port, password = load_cfg(self.key)
                sock = socket.create_connection(("127.0.0.1", port), timeout=8)
                sock.settimeout(8)
                with self._sock_lock:
                    self._sock = sock
                buf = bytearray()

                def pull() -> tuple[int, str] | None:
                    while True:
                        if self.pause.is_set():
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
                        if self.pause.is_set():
                            raise RuntimeError("pause")
                        continue
                    if packet and packet[0] == 1:
                        handle_chat(self.key, packet[1], self)
            except Exception as exc:
                if "pause" in str(exc).lower() or self.pause.is_set():
                    self.paused_ack.set()
                    while self.pause.is_set():
                        time.sleep(0.1)
                else:
                    time.sleep(1.0)
            finally:
                with self._sock_lock:
                    if self._sock is sock:
                        self._sock = None
                if sock is not None:
                    try:
                        sock.close()
                    except Exception:
                        pass


WORKERS: dict[str, KeyWorker] = {k: KeyWorker(k) for k in KEYS}


def append_chat(row: dict[str, Any]) -> None:
    line = json.dumps(row, ensure_ascii=False)
    with _chat_lock:
        with CHAT_OUT.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        if CHAT_OUT.stat().st_size > 1_500_000:
            kept = CHAT_OUT.read_text(encoding="utf-8", errors="replace").splitlines()[-200:]
            CHAT_OUT.write_text("\n".join(kept) + ("\n" if kept else ""), encoding="utf-8")


def is_admins_command(text: str) -> bool:
    low = (text or "").strip().lower()
    if not low:
        return False
    low = re.sub(r"[!！]+", "!", low).strip(" !?.…")
    return low in ("admins", "admin") or low.startswith(("admins ", "admin "))


def maybe_reply_admins(key: str, steam_id: str, name: str, text: str, worker: KeyWorker) -> None:
    if not is_admins_command(text) or not steam_id:
        return
    now = time.time()
    with _admins_lock:
        prev = _last_admins.get(steam_id, 0.0)
        if now - prev < 30:
            return
        _last_admins[steam_id] = now

    def _send() -> str:
        replies = []
        for part in ADMINS_REPLY_PARTS:
            replies.append(source_rcon(key, f"AdminWarn {steam_id} {part}"))
            time.sleep(0.2)
        return " | ".join(replies)

    try:
        reply = worker.submit(P0, _send, timeout=25)
        _admins_log(f"{key} warn steam={steam_id} name={name!r} reply={str(reply)[:160]!r}")
    except Exception as exc:
        _admins_log(f"{key} WARN-FAIL steam={steam_id} err={exc}")
        with _admins_lock:
            _last_admins.pop(steam_id, None)


def handle_chat(key: str, body: str, worker: KeyWorker) -> None:
    match = CHAT_RE.search(body.strip())
    if not match:
        return
    ids_blob = match.group(2) or ""
    steam_m = STEAM_RE.search(ids_blob)
    steam_id = steam_m.group(1) if steam_m else ""
    name = match.group(3).strip()[:48]
    text = match.group(4).strip()[:240]
    dedupe_key = f"{key}|{steam_id or name}|{text.lower()}"
    now = time.time()
    with _chat_lock:
        prev = _seen_chat.get(dedupe_key, 0.0)
        if now - prev < 4.0:
            return
        _seen_chat[dedupe_key] = now
    append_chat(
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
            args=(key, steam_id, name, text, worker),
            daemon=True,
        ).start()


def read_staff_map() -> dict[str, str]:
    path = "/home/squad/admins/Admins.cfg"
    out: dict[str, str] = {}
    rank = {"admin": 3, "moderator": 2, "camera": 1}
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except Exception:
        return out
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("//") or not line.startswith("Admin="):
            continue
        m = re.match(r"Admin=(7656\d+)\s*:\s*(\w+)", line, re.I)
        if not m:
            continue
        group = m.group(2)
        right = ""
        if group == "Cameraman":
            right = "camera"
        elif group == "Admin":
            right = "admin"
        elif group in ("Moderator", "Intern"):
            right = "moderator"
        if not right:
            continue
        sid = m.group(1)
        prev = out.get(sid)
        if not prev or rank.get(right, 0) > rank.get(prev, 0):
            out[sid] = right
    return out


def read_chat(key: str) -> list[dict[str, Any]]:
    spoken: list[dict[str, Any]] = []
    seen: set[tuple] = set()
    if CHAT_OUT.is_file():
        for line in CHAT_OUT.read_text(encoding="utf-8", errors="replace").splitlines()[-500:]:
            try:
                row = json.loads(line)
            except Exception:
                continue
            if row.get("key") != key:
                continue
            item = {
                "clock": row.get("clock") or "",
                "date": row.get("date") or "",
                "channel": row.get("channel") or "чат",
                "name": (row.get("name") or "")[:48],
                "steamId": (row.get("steamId") or "")[:32],
                "text": (row.get("text") or "")[:240],
            }
            dedupe = (item["date"], item["clock"], item["channel"], item["name"], item["text"].lower())
            if dedupe in seen:
                continue
            seen.add(dedupe)
            spoken.append(item)
    return spoken[-60:]


def do_roster(key: str, light: bool = True) -> dict[str, Any]:
    worker = WORKERS[key]
    cache_ttl = 4.0
    if worker._roster_cache and time.time() - worker._roster_cache[0] < cache_ttl:
        cached = dict(worker._roster_cache[1])
        cached["cached"] = True
        return cached

    t0 = time.time()

    def _fetch() -> dict[str, Any]:
        players_text = source_rcon(key, "ListPlayers")
        squads_text = source_rcon(key, "ListSquads")
        steams = re.findall(r"steam:\s*(7656\d{13})", players_text, re.I)
        return {
            "ok": True,
            "players": players_text,
            "squads": squads_text,
            "staff": read_staff_map(),
            "health": {},
            "squadCreates": [],
            "steams": steams,
            "light": light,
        }

    try:
        data = worker.submit(P1, _fetch, timeout=18)
        ms = int((time.time() - t0) * 1000)
        data["ms"] = ms
        data["cached"] = False
        worker._roster_cache = (time.time(), data)
        _metric("roster_ok", key=key, ms=ms)
        return data
    except Exception as exc:
        _metric("roster_fail", key=key)
        return {"ok": False, "error": str(exc)}


def do_cmd(key: str, command: str) -> dict[str, Any]:
    if BLOCKED_CMDS.search(command or ""):
        return {"ok": False, "error": "команда запрещена агентом (защита игрового сервера)"}
    worker = WORKERS[key]
    t0 = time.time()

    def _run() -> str:
        return source_rcon(key, command)

    try:
        text = worker.submit(P0, _run, timeout=20)
        ms = int((time.time() - t0) * 1000)
        # invalidate roster cache after mutating commands
        worker._roster_cache = None
        _metric("cmd_ok", key=key, ms=ms)
        return {"ok": True, "text": text, "ms": ms}
    except Exception as exc:
        _metric("cmd_fail", key=key)
        return {"ok": False, "error": str(exc)}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def _json(self, code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 200_000:
            return {}
        raw = self.rfile.read(length)
        try:
            obj = json.loads(raw.decode("utf-8"))
        except Exception:
            return {}
        return obj if isinstance(obj, dict) else {}

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        if parsed.path == "/health":
            self._json(
                200,
                {
                    "ok": True,
                    "version": AGENT_VERSION,
                    "keys": list(KEYS),
                    "pid": os.getpid(),
                },
            )
            return
        if parsed.path == "/metrics":
            with _metrics_lock:
                self._json(200, {"ok": True, **_metrics})
            return
        if parsed.path == "/chat":
            key = (qs.get("key") or [""])[0]
            if key not in KEYS:
                self._json(400, {"ok": False, "error": "bad key"})
                return
            self._json(200, {"ok": True, "messages": read_chat(key)})
            return
        if parsed.path == "/roster":
            key = (qs.get("key") or [""])[0]
            if key not in KEYS:
                self._json(400, {"ok": False, "error": "bad key"})
                return
            light = (qs.get("light") or ["1"])[0] != "0"
            self._json(200, do_roster(key, light=light))
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        body = self._read_json()
        if parsed.path == "/cmd":
            key = str(body.get("key") or "")
            command = str(body.get("command") or "")
            if key not in KEYS or not command.strip():
                self._json(400, {"ok": False, "error": "bad cmd"})
                return
            self._json(200, do_cmd(key, command.strip()))
            return
        if parsed.path == "/sim":
            # Safe simulation only — List* / Show* — never mutates match
            key = str(body.get("key") or "PB1")
            if key not in KEYS:
                self._json(400, {"ok": False, "error": "bad key"})
                return
            rounds = max(1, min(5, int(body.get("rounds") or 3)))
            results = []
            for i in range(rounds):
                t0 = time.time()
                row = do_roster(key, light=True)
                results.append(
                    {
                        "i": i,
                        "ms": int((time.time() - t0) * 1000),
                        "ok": bool(row.get("ok")),
                        "cached": bool(row.get("cached")),
                        "players_len": len(row.get("players") or ""),
                        "error": row.get("error"),
                    }
                )
                time.sleep(0.3)
            # one harmless ShowCurrentMap via P0 path timing
            t1 = time.time()
            show = do_cmd(key, "ShowCurrentMap")
            results.append(
                {
                    "op": "ShowCurrentMap",
                    "ms": int((time.time() - t1) * 1000),
                    "ok": bool(show.get("ok")),
                    "error": show.get("error"),
                }
            )
            self._json(200, {"ok": True, "results": results, "version": AGENT_VERSION})
            return
        self._json(404, {"ok": False, "error": "not found"})


def stop_legacy_chat_bots() -> None:
    """Stop old bb_panelka_chat.py copies so they don't steal RCON."""
    for ent in os.listdir("/proc"):
        if not ent.isdigit():
            continue
        try:
            raw = open(f"/proc/{ent}/cmdline", "rb").read()
        except Exception:
            continue
        cmd = raw.replace(b"\x00", b" ").decode("utf-8", "replace")
        if "bb_panelka_chat.py" in cmd and "python" in cmd:
            try:
                os.kill(int(ent), 15)
            except Exception:
                pass
    time.sleep(0.4)
    for ent in os.listdir("/proc"):
        if not ent.isdigit():
            continue
        try:
            raw = open(f"/proc/{ent}/cmdline", "rb").read()
        except Exception:
            continue
        cmd = raw.replace(b"\x00", b" ").decode("utf-8", "replace")
        if "bb_panelka_chat.py" in cmd and "python" in cmd:
            try:
                os.kill(int(ent), 9)
            except Exception:
                pass


def main() -> None:
    # single instance
    if PID_PATH.is_file():
        old = PID_PATH.read_text(encoding="utf-8").strip()
        if old.isdigit() and old != str(os.getpid()) and Path(f"/proc/{old}").is_dir():
            try:
                cmdline = open(f"/proc/{old}/cmdline", "rb").read().decode("utf-8", "replace")
            except Exception:
                cmdline = ""
            if "bb_panelka_agent.py" in cmdline:
                # already running
                print(json.dumps({"ok": False, "error": "already running", "pid": old}))
                return

    stop_legacy_chat_bots()
    PID_PATH.write_text(str(os.getpid()), encoding="utf-8")
    _metrics["startedAt"] = datetime.now(MSK).isoformat()
    for worker in WORKERS.values():
        worker.start()
    _admins_log(f"agent-boot {AGENT_VERSION} pid={os.getpid()}")
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        try:
            PID_PATH.unlink()
        except Exception:
            pass


if __name__ == "__main__":
    main()
