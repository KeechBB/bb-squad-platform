#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Периодическая проверка: сайт, PM2, нагрузка, кеш логов,
orphan heavy-lock (блокирует train/CW sync), deferred spam.

Cron: */3 * * * * cd /var/www/bb-squad-platform/scripts && .venv-collector/bin/python bb_health_watch.py

Ручной прогон только heavy-lock:
  python bb_health_watch.py --heavy-lock
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
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
# deploy.sh ставит флаг → nginx 503 намеренно; не орём «сайт упал»
MAINT_FLAG = Path(
    os.environ.get("BB_MAINT_FLAG", "/var/www/bb-squad-platform/maintenance.on")
)

HEAVY_LOCK = HERE / "_tmp_heavy_job.lock"
# Лок без живого sync-процесса дольше этого → orphan (снять + алерт)
HEAVY_ORPHAN_SEC = float(os.environ.get("BB_HEAVY_ORPHAN_SEC", "90"))
# Сколько «deferred» строк в хвосте лога коллектора считать проблемой
DEFERRED_TAIL_BYTES = int(os.environ.get("BB_DEFERRED_TAIL_BYTES", str(200_000)))
DEFERRED_MIN_HITS = int(os.environ.get("BB_DEFERRED_MIN_HITS", "4"))
HEAVY_WORKER_NEEDLES = (
    "sync_train_from_tr1_logs.py",
    "sync_kv_cw_from_tr_logs.py",
    "build_train_rp_ledger.py",
)


def under_maintenance() -> bool:
    return MAINT_FLAG.is_file()


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
    if under_maintenance():
        # Техработы / деплой — 503 ожидаем, алерт не шлём
        st["site_down"] = False
        st["maint"] = True
        return
    st["maint"] = False
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
    maint = under_maintenance()
    for name in PM2_PROCS:
        status = statuses.get(name, "missing")
        # во время деплоя bb-squad специально stop — это не авария
        if maint and name == "bb-squad" and status in ("stopped", "stopping", "missing"):
            down_now[name] = False
            continue
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


def check_collector_heartbeat(st: dict) -> None:
    """PM2 может быть online, а цикл опроса логов уже не пишет state."""
    statuses = pm2_status()
    if statuses.get("bb-squad-collector") != "online":
        st["collector_silent"] = False
        return
    candidates = [
        HERE / "squad_collector_state.json",
        Path("/var/www/bb-squad-platform/scripts/squad_collector_state.json"),
    ]
    newest = 0.0
    for p in candidates:
        try:
            if p.is_file():
                newest = max(newest, p.stat().st_mtime)
        except OSError:
            pass
    age = time.time() - newest if newest else 10**9
    silent = age > 20 * 60
    was = bool(st.get("collector_silent"))
    if silent and not was:
        mins = "нет файла" if newest == 0 else f"{int(age // 60)} мин"
        A.send(
            kind="сборщик",
            title="Сборщик логов замолчал",
            level="crit",
            lines=[f"состояние не обновлялось: {mins}"],
            details={"процесс": "bb-squad-collector online, логи не пишутся"},
            force=True,
        )
    elif not silent and was:
        A.send(
            kind="сборщик",
            title="Сборщик логов снова пишет",
            level="ok",
            force=True,
        )
    st["collector_silent"] = silent


def heavy_workers_running() -> list[str]:
    """Живые python-процессы sync/RP, которые держат heavy-lock легитимно."""
    found: list[str] = []
    try:
        for ent in Path("/proc").iterdir():
            if not ent.name.isdigit():
                continue
            try:
                raw = (ent / "cmdline").read_bytes()
            except OSError:
                continue
            if not raw:
                continue
            cmd = raw.replace(b"\x00", b" ").decode("utf-8", errors="replace")
            for needle in HEAVY_WORKER_NEEDLES:
                if needle in cmd:
                    found.append(f"pid={ent.name} {needle}")
                    break
    except OSError:
        pass
    return found


def _lock_label(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip().split()[0]
    except Exception:
        return "?"


def _collector_deferred_hits() -> int:
    """Сколько train/CW deferred в хвосте out-лога коллектора."""
    paths = [
        Path("/root/.pm2/logs/bb-squad-collector-out.log"),
        HERE / "_collector_out_live.txt",
    ]
    hits = 0
    for p in paths:
        if not p.is_file():
            continue
        try:
            data = p.read_bytes()[-DEFERRED_TAIL_BYTES:].decode("utf-8", errors="replace")
        except OSError:
            continue
        hits += data.count("train sync deferred")
        hits += data.count("CW TR sync deferred")
        if hits:
            break
    return hits


def check_heavy_job_lock(st: dict, *, autofix: bool = True) -> dict:
    """
    Orphan `_tmp_heavy_job.lock` после рестарта PM2/деплоя блокирует
    train sync и CW TR sync до TTL (до 15 мин) — как с 21-cslmutaha 21.10.

    Если лока нет живого worker дольше HEAVY_ORPHAN_SEC — снимаем и алертим.
    """
    report: dict = {
        "lock": False,
        "orphan": False,
        "fixed": False,
        "age_sec": None,
        "label": None,
        "workers": [],
        "deferred_hits": 0,
    }
    workers = heavy_workers_running()
    report["workers"] = workers
    deferred = _collector_deferred_hits()
    report["deferred_hits"] = deferred

    if not HEAVY_LOCK.is_file():
        was_orphan = bool(st.get("heavy_lock_orphan"))
        if was_orphan:
            A.send(
                kind="сборщик",
                title="Heavy-lock снят — sync снова может идти",
                level="ok",
                force=True,
            )
        st["heavy_lock_orphan"] = False
        st["heavy_lock_last"] = report
        # deferred без лока: просто шум после фикса — не орём
        return report

    try:
        age = max(0.0, time.time() - HEAVY_LOCK.stat().st_mtime)
    except OSError:
        age = 0.0
    label = _lock_label(HEAVY_LOCK)
    report["lock"] = True
    report["age_sec"] = round(age, 1)
    report["label"] = label

    orphan = (not workers) and age >= HEAVY_ORPHAN_SEC
    report["orphan"] = orphan
    was = bool(st.get("heavy_lock_orphan"))

    if orphan:
        if autofix:
            try:
                HEAVY_LOCK.unlink(missing_ok=True)
                report["fixed"] = True
            except OSError as e:
                report["fixed"] = False
                report["fix_error"] = str(e)
        if not was or report.get("fixed"):
            lines = [
                f"лок: {label} · возраст {int(age)}с · worker-ов нет",
                "train/CW sync откладывались (deferred)",
            ]
            if report.get("fixed"):
                lines.append("автофикс: лок удалён — следующий цикл коллектора подхватит карты")
            else:
                lines.append("автофикс не удался — сними вручную _tmp_heavy_job.lock")
            if deferred >= DEFERRED_MIN_HITS:
                lines.append(f"в логе коллектора deferred≈{deferred}")
            A.send(
                kind="сборщик",
                title="Orphan heavy-lock блокировал sync",
                level="crit",
                lines=lines,
                details={
                    "файл": str(HEAVY_LOCK),
                    "порог_orphan_сек": HEAVY_ORPHAN_SEC,
                },
                force=True,
            )
        st["heavy_lock_orphan"] = True
    else:
        # Живой worker или свежий лок — ок; но deferred+старый лок (>5 мин) с worker-ом
        # тоже подозрительно (зависший sync) — только warn без unlink.
        if workers and age >= 600 and deferred >= DEFERRED_MIN_HITS and not was:
            A.send(
                kind="сборщик",
                title="Heavy-lock держится слишком долго",
                level="warn",
                lines=[
                    f"лок: {label} · {int(age)}с · workers: {len(workers)}",
                    f"deferred в логе ≈{deferred}",
                    "проверь sync_train / cw-tr — возможно завис",
                ],
                details={"workers": "; ".join(workers[:4])},
            )
        if was and not orphan:
            st["heavy_lock_orphan"] = False

    st["heavy_lock_last"] = report
    print(
        "heavy-lock",
        f"lock={report['lock']} orphan={orphan} age={report['age_sec']} "
        f"workers={len(workers)} deferred={deferred} fixed={report['fixed']}",
        flush=True,
    )
    return report


def _cw_rows() -> dict[str, dict]:
    roots = [
        Path("/var/www/bb-squad-platform/data/kv-cache/data"),
        Path("/var/www/blackberry-kv/data"),
    ]
    root = next((p for p in roots if p.is_dir()), None)
    if root is None:
        return {}
    out: dict[str, dict] = {}
    for path in sorted(root.glob("20??-??.json")):
        if "training" in path.name:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        month = str(data.get("month") or path.stem)
        for m in data.get("matches") or []:
            mid = str(m.get("id") or "")
            if not mid:
                continue
            out[mid] = {
                "month": month,
                "day": m.get("day"),
                "time": m.get("timeMsk") or "",
                "opp": m.get("opp") or "",
                "stack": m.get("stack") or "",
                "map": m.get("map") or "",
                "status": str(m.get("status") or ""),
                "meeting": m.get("meeting") or "",
                "r1": m.get("r1") or "",
                "r2": m.get("r2") or "",
            }
    return out


def _cw_line(row: dict) -> str:
    month = str(row.get("month") or "")
    day = row.get("day")
    when_date = f"{day}.{month}"
    parts = month.split("-")
    if len(parts) == 2 and day is not None:
        try:
            when_date = f"{int(day):02d}.{int(parts[1]):02d}.{parts[0]}"
        except (TypeError, ValueError):
            pass
    when = f"{when_date} {row.get('time') or ''}".strip()
    who = f"{row.get('stack') or 'Main'} vs {row.get('opp') or '?'}"
    return f"{when} · {who} · {row.get('map') or '—'}"


def check_cw_calendar(st: dict) -> None:
    rows = _cw_rows()
    if not rows:
        return
    prev = st.get("cw_seen")
    if not isinstance(prev, dict):
        st["cw_seen"] = rows
        print(f"cw calendar seeded {len(rows)}", flush=True)
        return
    for mid, row in rows.items():
        old = prev.get(mid)
        status = row.get("status") or ""
        if old is None:
            if status == "cancel":
                title = "КВ отмена"
                level = "warn"
            elif status in ("win", "lose"):
                title = "КВ итог"
                level = "ok" if status == "win" else "warn"
            else:
                title = "КВ бронь"
                level = "ok"
            lines = [_cw_line(row)]
            if status in ("win", "lose"):
                lines.append(
                    f"{'победа' if status == 'win' else 'поражение'} · серия {row.get('meeting') or '—'} · {row.get('r1') or '—'} / {row.get('r2') or '—'}"
                )
            A.send(
                kind="кв",
                title=f"{title} {mid}",
                level=level,
                lines=lines,
                force=True,
            )
            continue
        old_status = str(old.get("status") or "")
        if old_status == status:
            continue
        if status == "cancel":
            A.send(
                kind="кв",
                title=f"КВ отмена {mid}",
                level="warn",
                lines=[_cw_line(row)],
                force=True,
            )
        elif status in ("win", "lose") and old_status not in ("win", "lose"):
            A.send(
                kind="кв",
                title=f"КВ итог {mid}",
                level="ok" if status == "win" else "warn",
                lines=[
                    _cw_line(row),
                    f"{'победа' if status == 'win' else 'поражение'} · серия {row.get('meeting') or '—'} · {row.get('r1') or '—'} / {row.get('r2') or '—'}",
                ],
                force=True,
            )
    st["cw_seen"] = rows


def check_bp_sync(st: dict, *, autofix: bool = True) -> None:
    """Раз в ~15 мин: дыры Battle Pass ↔ rp-ledger → heal (кейс Diray)."""
    now = time.time()
    last = float(st.get("bp_sync_at") or 0)
    if now - last < 900:
        return
    st["bp_sync_at"] = now
    try:
        import build_battle_pass as BP  # noqa: WPS433
    except Exception as e:
        print(f"bp sync import skip: {type(e).__name__}: {e}", flush=True)
        return
    try:
        rep = BP.heal_bp_vs_ledger(last=40, fix=autofix)
    except Exception as e:
        print(f"bp sync failed: {type(e).__name__}: {e}", flush=True)
        return
    missing = rep.get("missingIds") or []
    print(
        f"bp sync: ok={rep.get('ok')} action={rep.get('action')} "
        f"healed={rep.get('healed')} missing={missing}",
        flush=True,
    )
    if rep.get("healed"):
        A.send(
            kind="autofix",
            title="Autofix OK (battle_pass)",
            level="ok",
            lines=[
                f"действие: {rep.get('action')}",
                f"было missing: {rep.get('beforeMissing') or []}",
            ],
            force=True,
        )
    elif not rep.get("ok"):
        A.send(
            kind="bp-audit",
            title="Battle Pass — дыра после heal",
            level="warn",
            lines=[
                f"missing: {missing}",
                f"action: {rep.get('action')}",
                f"join: {rep.get('joinDetail')}",
            ],
            force=True,
        )


def main(argv: list[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    only_heavy = "--heavy-lock" in args
    no_fix = "--no-fix" in args
    st = _load()
    if only_heavy:
        try:
            rep = check_heavy_job_lock(st, autofix=not no_fix)
        except Exception as e:
            print("heavy-lock check", e, flush=True)
            return 1
        _save(st)
        # exit 2 = была проблема (orphan / долгий лок)
        if rep.get("orphan") or (rep.get("lock") and (rep.get("age_sec") or 0) >= 600):
            return 2
        return 0

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
    try:
        check_collector_heartbeat(st)
    except Exception as e:
        print("collector heartbeat", e, flush=True)
    try:
        check_heavy_job_lock(st, autofix=not no_fix)
    except Exception as e:
        print("heavy-lock check", e, flush=True)
    try:
        check_cw_calendar(st)
    except Exception as e:
        print("cw calendar", e, flush=True)
    try:
        check_bp_sync(st, autofix=not no_fix)
    except Exception as e:
        print("bp sync", e, flush=True)
    _save(st)
    print("health watch ok", st.get("load_last"), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
