#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Единые Telegram-алерты BlackBerry (через Cloudflare Worker-реле).

Всегда на русском: дата/время МСК, сервер/хост, подробности.
Кулдаун одинаковых событий — не спамить.

Env (scripts/.squad-collector.env или process):
  BB_TG_RELAY_URL, BB_TG_RELAY_SECRET, BB_TG_CHAT_ID
  BB_ALERT_STATE=/var/www/bb-squad-platform/scripts/_tmp_alert_state.json
  BB_ALERT_COOLDOWN_SEC=1800
"""
from __future__ import annotations

import json
import os
import socket
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
MSK = timezone(timedelta(hours=3), name="MSK")

# kind → emoji prefix
LEVEL = {
    "ok": "✅",
    "info": "ℹ️",
    "warn": "⚠️",
    "crit": "🚨",
}


def _load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for p in (HERE / ".squad-collector.env", HERE / ".squad-collector.env.run", HERE.parent / ".env"):
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in out:
                out[k] = v
                os.environ.setdefault(k, v)
    out.update({k: v for k, v in os.environ.items() if k.startswith("BB_")})
    return out


def msk_now() -> datetime:
    return datetime.now(MSK)


def msk_stamp(dt: datetime | None = None) -> str:
    return (dt or msk_now()).strftime("%d.%m.%Y %H:%M:%S МСК")


def host_label() -> str:
    try:
        return socket.gethostname()
    except Exception:
        return "vps"


def state_path() -> Path:
    env = _load_env()
    raw = (env.get("BB_ALERT_STATE") or "").strip()
    if raw:
        return Path(raw)
    return HERE / "_tmp_alert_state.json"


def cooldown_sec() -> int:
    try:
        return max(60, int((_load_env().get("BB_ALERT_COOLDOWN_SEC") or "1800")))
    except ValueError:
        return 1800


def _load_state() -> dict:
    p = state_path()
    if not p.is_file():
        return {"sent": {}}
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(d, dict):
            d.setdefault("sent", {})
            return d
    except Exception:
        pass
    return {"sent": {}}


def _save_state(doc: dict) -> None:
    p = state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    # prune old keys (>7d)
    cut = time.time() - 7 * 86400
    sent = {k: v for k, v in (doc.get("sent") or {}).items() if float(v or 0) >= cut}
    doc["sent"] = sent
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _dedupe_key(kind: str, title: str, server: str | None) -> str:
    return f"{kind}|{server or '-'}|{title}"


def format_message(
    *,
    kind: str,
    title: str,
    lines: list[str] | None = None,
    server: str | None = None,
    details: dict[str, Any] | None = None,
    level: str = "info",
) -> str:
    icon = LEVEL.get(level, "ℹ️")
    parts = [
        f"{icon} {title}",
        f"📅 {msk_stamp()}",
        f"🖥 хост: {host_label()}",
    ]
    if server:
        parts.append(f"🎮 сервер: {server}")
    parts.append(f"🏷 тип: {kind}")
    for line in lines or []:
        if line:
            parts.append(str(line))
    if details:
        parts.append("———")
        for k, v in details.items():
            if v is None or v == "":
                continue
            parts.append(f"• {k}: {v}")
    return "\n".join(parts)[:3900]


def send(
    *,
    kind: str,
    title: str,
    lines: list[str] | None = None,
    server: str | None = None,
    details: dict[str, Any] | None = None,
    level: str = "info",
    force: bool = False,
    cooldown: int | None = None,
) -> bool:
    """Send alert; returns True if delivered (or skipped as duplicate)."""
    key = _dedupe_key(kind, title, server)
    st = _load_state()
    now = time.time()
    cd = cooldown if cooldown is not None else cooldown_sec()
    # ok/info events: shorter default cooldown for success maps
    if level == "ok" and cooldown is None:
        cd = min(cd, 600)
    if level == "crit" and cooldown is None:
        cd = min(cd, 300)
    last = float((st.get("sent") or {}).get(key) or 0)
    if not force and last and (now - last) < cd:
        print(f"alert skip cooldown {key} ({int(cd - (now - last))}s left)", flush=True)
        return True

    text = format_message(
        kind=kind,
        title=title,
        lines=lines,
        server=server,
        details=details,
        level=level,
    )
    try:
        import train_rp_guard as TRG  # noqa: WPS433
    except Exception as e:
        print(f"alert import fail: {e}", flush=True)
        return False
    ok = TRG.telegram_send(text)
    if ok:
        st.setdefault("sent", {})[key] = now
        _save_state(st)
        print(f"alert sent [{kind}] {title}", flush=True)
    else:
        print(f"alert FAIL [{kind}] {title}", flush=True)
    return ok


# --- convenience wrappers ---

def site_down(url: str, err: str, status: int | None = None) -> bool:
    return send(
        kind="сайт",
        title="Сайт не отвечает",
        level="crit",
        lines=[f"URL: {url}", f"ошибка: {err}"],
        details={"HTTP": status, "действие": "проверить pm2 bb-squad / nginx"},
    )


def site_up(url: str) -> bool:
    return send(
        kind="сайт",
        title="Сайт снова доступен",
        level="ok",
        lines=[f"URL: {url}"],
        cooldown=3600,
    )


def pm2_down(process: str, detail: str = "") -> bool:
    return send(
        kind="pm2",
        title=f"Процесс PM2 упал: {process}",
        level="crit",
        lines=[detail] if detail else None,
        details={"процесс": process, "действие": f"pm2 restart {process}"},
    )


def pm2_up(process: str) -> bool:
    return send(
        kind="pm2",
        title=f"Процесс PM2 снова online: {process}",
        level="ok",
        details={"процесс": process},
        cooldown=3600,
    )


def load_alert(ram_pct: float, disk_pct: float, load1: float, swap_used_mb: float) -> bool:
    level = "crit" if ram_pct >= 92 or disk_pct >= 95 else "warn"
    return send(
        kind="нагрузка",
        title="Высокая нагрузка VPS",
        level=level,
        details={
            "RAM %": round(ram_pct, 1),
            "диск / %": round(disk_pct, 1),
            "load1": round(load1, 2),
            "swap МБ": round(swap_used_mb, 0),
        },
        cooldown=900,
    )


def cache_alert(path: str, size_gb: float, limit_gb: float) -> bool:
    return send(
        kind="кеш",
        title="Кеш логов разросся",
        level="warn",
        lines=[f"путь: {path}"],
        details={"размер ГБ": round(size_gb, 2), "порог ГБ": limit_gb},
        cooldown=3600,
    )


def backup_ok(kind: str, path: str, size: str) -> bool:
    return send(
        kind="бэкап",
        title=f"Бэкап успешен ({kind})",
        level="ok",
        details={"файл": path, "размер": size},
        cooldown=0,  # always notify success once per run via unique path in title
        force=True,
    )


def backup_fail(kind: str, err: str) -> bool:
    return send(
        kind="бэкап",
        title=f"Бэкап ПРОВАЛИЛСЯ ({kind})",
        level="crit",
        lines=[err[:500]],
        force=True,
    )


def deploy_ok(sha: str) -> bool:
    return send(
        kind="деплой",
        title="Деплой успешен",
        level="ok",
        details={"commit": sha, "хост": host_label()},
        force=True,
    )


def deploy_fail(err: str) -> bool:
    return send(
        kind="деплой",
        title="Деплой ПРОВАЛИЛСЯ",
        level="crit",
        lines=[err[:800]],
        details={"действие": "смотреть лог deploy / maintenance.on"},
        force=True,
    )


def map_ingested(
    *,
    server: str,
    match_id: str,
    map_name: str,
    score: str,
    kind: str = "тренировка",
    rp_ok: bool | None = None,
) -> bool:
    lines = [f"карта: {map_name}", f"счёт: {score}", f"id: {match_id}"]
    if rp_ok is True:
        lines.append("RP: пересчитан")
    elif rp_ok is False:
        lines.append("RP: ещё догоняется (очередь)")
    return send(
        kind="выгрузка",
        title=f"Карта залита ({kind})",
        level="ok",
        server=server,
        lines=lines,
        force=True,
    )


def map_failed(
    *,
    server: str,
    reason: str,
    match_id: str | None = None,
    kind: str = "тренировка",
) -> bool:
    return send(
        kind="выгрузка",
        title=f"Проблема выгрузки ({kind})",
        level="warn",
        server=server,
        lines=[reason],
        details={"id": match_id},
        force=True,
    )


def rp_lag(match_ids: list[str], kind: str = "тренировка") -> bool:
    return send(
        kind="rp",
        title=f"RP отстаёт от истории ({kind})",
        level="warn",
        lines=[f"матчи без RP: {', '.join(match_ids[:12])}"],
        details={"кол-во": len(match_ids)},
        cooldown=900,
    )


def register_user(*, nick: str, name: str, steam_id: str, reg_no: Any = None) -> bool:
    return send(
        kind="регистрация",
        title="Новый участник на сайте",
        level="ok",
        details={
            "ник": nick,
            "имя": name,
            "Steam": steam_id,
            "№": reg_no,
        },
        force=True,
    )


def nick_unmatched(*, server: str, nicks: list[str], match_id: str) -> bool:
    return send(
        kind="ники",
        title="Ники с табло без аккаунта",
        level="info",
        server=server,
        lines=[f"матч: {match_id}", "ники: " + ", ".join(nicks[:20])],
        details={"кол-во": len(nicks)},
        cooldown=3600,
    )


if __name__ == "__main__":
    # CLI: python bb_alerts.py test
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        ok = send(
            kind="тест",
            title="Тест системы алертов",
            level="ok",
            lines=["Если видишь это — bb_alerts + реле работают."],
            force=True,
        )
        raise SystemExit(0 if ok else 1)
    print("usage: bb_alerts.py test")
