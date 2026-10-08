#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Периодическая проверка: сайт, PM2, нагрузка, кеш логов.
Cron: */3 * * * * cd /var/www/bb-squad-platform/scripts && .venv-collector/bin/python bb_health_watch.py
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import bb_alerts as A  # noqa: E402

SITE_URL = os.environ.get("BB_HEALTH_URL", "https://bb-squad.ru/")
PM2_PROCS = ["bb-squad", "bb-squad-collector"]
STATE = HERE / "_tmp_health_watch_state.json"
CACHE_LIMIT_GB = float(os.environ.get("BB_LOG_CACHE_LIMIT_GB", "8"))


def _load() -> dict:
    if not STATE.is_file():
        return {}
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save(d: dict) -> None:
    STATE.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def check_site(st: dict) -> None:
    was_down = bool(st.get("site_down"))
    try:
        req = urllib.request.Request(
            SITE_URL,
            headers={"User-Agent": "BB-HealthWatch/1.0"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            code = getattr(resp, "status", 200)
            if code >= 500:
                raise RuntimeError(f"HTTP {code}")
            if was_down:
                A.site_up(SITE_URL)
            st["site_down"] = False
    except Exception as e:
        st["site_down"] = True
        if not was_down:
            code = getattr(e, "code", None)
            A.site_down(SITE_URL, str(e), status=code)


def pm2_status() -> dict[str, str]:
    """name → status (online/stopped/…)"""
    try:
        raw = subprocess.check_output(
            ["pm2", "jlist"], text=True, stderr=subprocess.DEVNULL, timeout=20
        )
        arr = json.loads(raw)
    except Exception:
        return {}
    out: dict[str, str] = {}
    for p in arr if isinstance(arr, list) else []:
        name = str(p.get("name") or "")
        status = str((p.get("pm2_env") or {}).get("status") or "")
        if name:
            out[name] = status
    return out


def check_pm2(st: dict) -> None:
    statuses = pm2_status()
    down_prev = dict(st.get("pm2_down") or {})
    down_now: dict[str, bool] = {}
    for name in PM2_PROCS:
        status = statuses.get(name, "missing")
        is_down = status != "online"
        down_now[name] = is_down
        was = bool(down_prev.get(name))
        if is_down and not was:
            A.pm2_down(name, detail=f"статус: {status}")
        elif not is_down and was:
            A.pm2_up(name)
    st["pm2_down"] = down_now


def mem_stats() -> tuple[float, float]:
    """return ram_used_pct, swap_used_mb"""
    meminfo = Path("/proc/meminfo").read_text(encoding="utf-8", errors="replace")
    vals: dict[str, float] = {}
    for line in meminfo.splitlines():
        if ":" not in line:
            continue
        k, rest = line.split(":", 1)
        num = rest.strip().split()[0]
        try:
            vals[k] = float(num)  # kB
        except ValueError:
            pass
    total = vals.get("MemTotal") or 1
    avail = vals.get("MemAvailable") or vals.get("MemFree") or 0
    used_pct = 100.0 * (1.0 - avail / total)
    swap_total = vals.get("SwapTotal") or 0
    swap_free = vals.get("SwapFree") or 0
    swap_used_mb = max(0.0, (swap_total - swap_free) / 1024.0)
    return used_pct, swap_used_mb


def disk_pct(path: str = "/") -> float:
    u = shutil.disk_usage(path)
    return 100.0 * u.used / max(u.total, 1)


def load1() -> float:
    try:
        return float(Path("/proc/loadavg").read_text().split()[0])
    except Exception:
        return 0.0


def dir_size_gb(path: Path) -> float:
    if not path.exists():
        return 0.0
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += (Path(root) / f).stat().st_size
            except OSError:
                pass
    return total / (1024**3)


def check_load(st: dict) -> None:
    ram, swap_mb = mem_stats()
    disk = disk_pct("/")
    ld = load1()
    hot = ram >= 85 or disk >= 90 or ld >= 6 or swap_mb >= 512
    was = bool(st.get("load_hot"))
    if hot and (not was or ram >= 92 or disk >= 95):
        A.load_alert(ram, disk, ld, swap_mb)
    st["load_hot"] = hot
    st["load_last"] = {
        "ram": round(ram, 1),
        "disk": round(disk, 1),
        "load1": round(ld, 2),
        "swap_mb": round(swap_mb, 0),
    }


def check_caches(st: dict) -> None:
    roots = [
        HERE / "_tmp_squad_logs",
        HERE / "_tmp_tr1_logs_cache",
        HERE / "_tmp_tr2_logs_cache",
        HERE / "_tmp_tpub1_logs_cache",
        Path("/var/www/bb-squad-platform/data/kv-cache/data/training"),
    ]
    for p in roots:
        gb = dir_size_gb(p)
        key = f"cache::{p}"
        flagged = set(st.get("cache_flagged") or [])
        if gb >= CACHE_LIMIT_GB and key not in flagged:
            A.cache_alert(str(p), gb, CACHE_LIMIT_GB)
            flagged.add(key)
        elif gb < CACHE_LIMIT_GB * 0.7 and key in flagged:
            flagged.discard(key)
        st["cache_flagged"] = list(flagged)


def main() -> int:
    st = _load()
    try:
        check_site(st)
    except Exception as e:
        print("site check", e, flush=True)
    try:
        check_pm2(st)
    except Exception as e:
        print("pm2 check", e, flush=True)
    try:
        check_load(st)
    except Exception as e:
        print("load check", e, flush=True)
    try:
        check_caches(st)
    except Exception as e:
        print("cache check", e, flush=True)
    _save(st)
    print("health watch ok", st.get("load_last"), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
