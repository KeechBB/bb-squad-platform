#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Watchdog для squad_log_collector.py.

Держит коллектор живым:
  - запускает как дочерний процесс;
  - если упал — поднимает снова (с backoff);
  - если state-файл не обновлялся слишком долго (завис на SSH) — убивает и перезапускает.

Запуск:
  python squad_collector_watchdog.py
  # или start-squad-collector-watchdog.cmd

Env (опционально):
  WATCHDOG_CHECK_SEC=30          как часто проверять «завис»
  WATCHDOG_STALE_SEC=600         state старше N секунд → рестарт (0 = выкл)
  WATCHDOG_RESTART_SEC=5         пауза после падения
  WATCHDOG_RESTART_MAX_SEC=60    потолок backoff
  WATCHDOG_LOG=./_watchdog.log
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
COLLECTOR = HERE / "squad_log_collector.py"
STATE_DEFAULT = HERE / "squad_collector_state.json"


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    p = Path(raw)
    return p if p.is_absolute() else HERE / p


CHECK_SEC = env_float("WATCHDOG_CHECK_SEC", 30)
STALE_SEC = env_float("WATCHDOG_STALE_SEC", 600)
# После старта не считать state «протухшим» N секунд (иначе рестарт-шторм).
GRACE_SEC = env_float("WATCHDOG_GRACE_SEC", 180)
RESTART_SEC = env_float("WATCHDOG_RESTART_SEC", 5)
RESTART_MAX = env_float("WATCHDOG_RESTART_MAX_SEC", 60)
LOG_PATH = env_path("WATCHDOG_LOG", HERE / "_watchdog.log")
STATE_PATH = HERE / "squad_collector_state.json"


def refresh_state_path() -> None:
    global STATE_PATH
    STATE_PATH = env_path("SQUAD_STATE_PATH", HERE / "squad_collector_state.json")


def log(msg: str) -> None:
    line = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        print(line.encode("ascii", "backslashreplace").decode("ascii"), flush=True)
    try:
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def state_age_sec() -> float | None:
    try:
        return max(0.0, time.time() - STATE_PATH.stat().st_mtime)
    except OSError:
        return None


def start_collector() -> subprocess.Popen[bytes]:
    creationflags = 0
    if sys.platform == "win32":
        # новая группа — можно убить всё дерево при рестарте
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    out = open(HERE / "_collector_out_live.txt", "a", encoding="utf-8", buffering=1)
    err = open(HERE / "_collector_err_live.txt", "a", encoding="utf-8", buffering=1)
    proc = subprocess.Popen(
        [sys.executable, "-u", str(COLLECTOR)],
        cwd=str(HERE),
        stdout=out,
        stderr=err,
        creationflags=creationflags,
    )
    # handles live with process lifetime; close on our side would break pipes early
    proc._watchdog_out = out  # type: ignore[attr-defined]
    proc._watchdog_err = err  # type: ignore[attr-defined]
    return proc


def stop_collector(proc: subprocess.Popen[bytes] | None) -> None:
    if proc is None:
        return
    if proc.poll() is not None:
        _close_proc_files(proc)
        return
    try:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    except Exception as e:
        log(f"stop error: {type(e).__name__} {e}")
        try:
            proc.kill()
        except Exception:
            pass
    finally:
        _close_proc_files(proc)


def _close_proc_files(proc: subprocess.Popen[bytes]) -> None:
    for attr in ("_watchdog_out", "_watchdog_err"):
        fh = getattr(proc, attr, None)
        if fh is not None:
            try:
                fh.close()
            except Exception:
                pass


def main() -> None:
    if not COLLECTOR.exists():
        raise SystemExit(f"collector not found: {COLLECTOR}")

    log(
        f"watchdog start check={CHECK_SEC}s stale={STALE_SEC}s "
        f"grace={GRACE_SEC}s collector={COLLECTOR.name} state={STATE_PATH.name}"
    )
    backoff = RESTART_SEC
    proc: subprocess.Popen[bytes] | None = None
    started_at = 0.0

    def _shutdown(*_args: object) -> None:
        log("watchdog stopping")
        stop_collector(proc)
        raise SystemExit(0)

    if sys.platform != "win32":
        signal.signal(signal.SIGTERM, _shutdown)
        signal.signal(signal.SIGINT, _shutdown)

    while True:
        if proc is None or proc.poll() is not None:
            code = None if proc is None else proc.returncode
            if proc is not None:
                log(f"collector exited code={code}; restart in {backoff:.0f}s")
                _close_proc_files(proc)
                time.sleep(backoff)
                backoff = min(RESTART_MAX, max(RESTART_SEC, backoff * 1.5))
            try:
                proc = start_collector()
                started_at = time.time()
                log(f"collector started pid={proc.pid}")
                backoff = RESTART_SEC
            except Exception as e:
                log(f"start failed: {type(e).__name__} {e}")
                time.sleep(backoff)
                backoff = min(RESTART_MAX, max(RESTART_SEC, backoff * 1.5))
                proc = None
                continue

        # hang detection via state mtime — только после grace
        if STALE_SEC > 0 and (time.time() - started_at) >= GRACE_SEC:
            age = state_age_sec()
            if age is not None and age >= STALE_SEC:
                log(
                    f"state stale {age:.0f}s (>= {STALE_SEC:.0f}s) — restart collector"
                )
                stop_collector(proc)
                proc = None
                time.sleep(RESTART_SEC)
                continue

        time.sleep(CHECK_SEC)


if __name__ == "__main__":
    # load collector env so SQUAD_STATE_PATH matches (override stale shell env)
    env_file = HERE / ".squad-collector.env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip("'").strip('"')
            if key:
                os.environ[key] = val
    refresh_state_path()
    main()
