#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Ops alert: Squad dropped the GameState bunch (over 64 KB).

That drop is why clients sit on an infinite map load. One Telegram message
per incident, into the same chat as deploy alerts. Repeats while the error
is still firing stay quiet. A new incident is the error coming back after
10 minutes without it. The first sight of a log skips history.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import bb_alerts  # noqa: E402

LOG_ROOT = Path("/var/www/bb-squad-logs")
STATE_PATH = HERE / "_tmp_gamestate_bunch_state.json"
QUIET_SEC = 600
NEEDLE = "exceeding max allowed size"
LAYER_RE = re.compile(r"Gameplay_Layers/([A-Za-z0-9_]+)")
SIZE_RE = re.compile(r"BunchSize=(\d+)")


def logs() -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    if not LOG_ROOT.is_dir():
        return found
    for folder in sorted(LOG_ROOT.iterdir()):
        if not folder.is_dir():
            continue
        path = folder / "_live" / "SquadGame.log"
        if path.is_file():
            found.append((folder.name, path))
    return found


def load_state() -> dict:
    if not STATE_PATH.is_file():
        return {"files": {}}
    try:
        doc = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"files": {}}
    if not isinstance(doc, dict):
        return {"files": {}}
    doc.setdefault("files", {})
    return doc


def save_state(doc: dict) -> None:
    STATE_PATH.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def read_new(path: Path, offset: int) -> tuple[int, str]:
    size = path.stat().st_size
    if size < offset:
        offset = 0
    if size == offset:
        return size, ""
    with path.open("rb") as handle:
        handle.seek(offset)
        # Cap a catch-up read so a rotated multi-megabyte file cannot
        # replay the old incident into one alert storm.
        blob = handle.read(min(size - offset, 2_000_000))
    return offset + len(blob), blob.decode("utf-8", "replace")


def scan_text(text: str) -> tuple[int, int, str]:
    count = 0
    biggest = 0
    layer = ""
    for line in text.splitlines():
        if NEEDLE not in line or "BP_GameStateSquad" not in line:
            continue
        count += 1
        size_m = SIZE_RE.search(line)
        if size_m:
            biggest = max(biggest, int(size_m.group(1)))
        layer_m = LAYER_RE.search(line)
        if layer_m:
            layer = layer_m.group(1)
    return count, biggest, layer


def alert(server: str, count: int, biggest: int, layer: str) -> None:
    kb = f"{biggest / 1024:.1f}" if biggest else "?"
    lines = [
        "Состояние матча не влезло в пакет. Клиент не снимает экран загрузки.",
        f"размер: {kb} КБ при лимите 64 КБ",
        f"за этот заход: {count}",
    ]
    if layer:
        lines.append(f"карта: {layer}")
    bb_alerts.send(
        kind="сервер",
        title="Игроки зависли на загрузке карты",
        level="crit",
        server=server,
        lines=lines,
        details={"действие": "если загрузка снова не идёт — перезагрузка сервера"},
        force=True,
    )


def watch() -> int:
    doc = load_state()
    files = doc["files"]
    now = time.time()
    for server, path in logs():
        slot = files.get(server)
        size = path.stat().st_size
        if not isinstance(slot, dict):
            files[server] = {
                "offset": size,
                "incident": False,
                "last_error": 0,
            }
            print(f"seed {server} offset={size}", flush=True)
            continue
        offset = int(slot.get("offset") or 0)
        new_offset, text = read_new(path, offset)
        slot["offset"] = new_offset
        count, biggest, layer = scan_text(text)
        last_error = float(slot.get("last_error") or 0)
        incident = bool(slot.get("incident"))
        if count:
            fresh = (not incident) or (now - last_error) > QUIET_SEC
            slot["last_error"] = now
            slot["incident"] = True
            if fresh:
                alert(server, count, biggest, layer)
                print(f"alert {server} n={count} size={biggest} {layer}", flush=True)
            else:
                print(f"quiet {server} n={count} still in incident", flush=True)
        elif incident and last_error and (now - last_error) > QUIET_SEC:
            slot["incident"] = False
            print(f"incident closed {server}", flush=True)
    save_state(doc)
    return 0


def announce_restart(ok: bool, detail: str) -> int:
    if ok:
        bb_alerts.send(
            kind="сервер",
            title="PB1 перезапущен",
            level="ok",
            server="PB1",
            lines=[
                "Причина: состояние матча не влезло в пакет, игроки зависли на загрузке.",
                detail or "Сервер снова поднимается, заход через минуту.",
            ],
            force=True,
        )
    else:
        bb_alerts.send(
            kind="сервер",
            title="PB1 не перезапустился",
            level="crit",
            server="PB1",
            lines=[detail or "процесс не поднялся"],
            force=True,
        )
    return 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--announce-restart":
        ok = sys.argv[2] == "ok" if len(sys.argv) > 2 else False
        detail = sys.argv[3] if len(sys.argv) > 3 else ""
        return announce_restart(ok, detail)
    return watch()


if __name__ == "__main__":
    raise SystemExit(main())
