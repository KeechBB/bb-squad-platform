#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RP reliability for train (TR*) and public (PB1/TPUB*): pin logs, pending queue, Telegram.

Works for TR1…TRn without code changes — servers come from SQUAD_SERVERS.

Env:
  BB_TG_BOT_TOKEN, BB_TG_CHAT_ID
  BB_TG_RP_LAG_MIN=15
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent

import bb_log_fleet as FLEET  # noqa: E402

PENDING_TRAIN = "_pending_rp.json"
PENDING_PUBLIC = "_pending_public_rp.json"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _utc_now()).isoformat()


def load_collector_env() -> dict[str, str]:
    return FLEET.load_env()


# --- back-compat shims used by older call sites ---
def tr1_cache() -> Path:
    return FLEET.server_cache("TR1")


def tr2_cache() -> Path:
    return FLEET.server_cache("TR2")


def is_rotating_log_name(name: str) -> bool:
    return FLEET.is_rotating_name(name)


def pin_match_log(
    log_path: Path,
    mid: str,
    date_ymd: str,
    dest_cache: Path | None = None,
    server: str | None = None,
) -> str:
    s = server or FLEET.infer_server_from_path(log_path)
    name = FLEET.pin_match_log(log_path, server=s, mid=mid, date_ymd=date_ymd)
    # Optional: also mirror into dest_cache for legacy TR1 flat layout
    if dest_cache is not None:
        src = FLEET.resolve_log(name, mid=mid, date_ymd=date_ymd, server=s)
        if src is not None:
            dest_cache.mkdir(parents=True, exist_ok=True)
            dest = dest_cache / name
            if not dest.is_file() or dest.stat().st_size < src.stat().st_size:
                shutil.copy2(src, dest)
    return name


def resolve_match_log(
    log_name: str,
    mid: str = "",
    date_ymd: str = "",
    server: str | None = None,
) -> Path | None:
    return FLEET.resolve_log(log_name, mid=mid, date_ymd=date_ymd, server=server)


def pending_path(data_dir: Path, *, kind: str = "train") -> Path:
    return data_dir / (PENDING_PUBLIC if kind == "public" else PENDING_TRAIN)


def load_pending(data_dir: Path, *, kind: str = "train") -> dict:
    p = pending_path(data_dir, kind=kind)
    if not p.is_file():
        return {"version": 1, "kind": kind, "updatedAt": _iso(), "items": []}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"version": 1, "kind": kind, "updatedAt": _iso(), "items": []}
    if not isinstance(doc, dict):
        return {"version": 1, "kind": kind, "updatedAt": _iso(), "items": []}
    doc.setdefault("version", 1)
    doc.setdefault("kind", kind)
    doc.setdefault("items", [])
    return doc


def save_pending(data_dir: Path, doc: dict, *, kind: str = "train") -> None:
    doc["updatedAt"] = _iso()
    doc["kind"] = kind
    pending_path(data_dir, kind=kind).write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def ladder_ids(ladder_file: Path) -> set[str] | None:
    if not ladder_file.is_file():
        return None
    try:
        doc = json.loads(ladder_file.read_text(encoding="utf-8"))
    except Exception:
        return None
    return {str(x.get("id")) for x in (doc.get("matches") or []) if x.get("id")}


def auto_ids_needing_rp(train_dir: Path) -> list[str]:
    auto_path = train_dir / "_auto_matches.json"
    if not auto_path.is_file():
        return []
    try:
        auto = json.loads(auto_path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(auto, list):
        return []
    done = ladder_ids(train_dir / "rp-ladder.json")
    missing: list[str] = []
    for m in auto:
        if not isinstance(m, dict):
            continue
        mid = str(m.get("id") or "")
        if not mid or m.get("skip") or mid.endswith("-skip"):
            continue
        if done is None or mid not in done:
            missing.append(mid)
    return missing


def public_ids_needing_rp(public_dir: Path) -> list[str]:
    hist = public_dir / "match-history.json"
    if not hist.is_file():
        return []
    try:
        doc = json.loads(hist.read_text(encoding="utf-8"))
    except Exception:
        return []
    matches = doc if isinstance(doc, list) else (doc.get("matches") or [])
    done = ladder_ids(public_dir / "rp-ladder.json")
    missing: list[str] = []
    for m in matches:
        if not isinstance(m, dict):
            continue
        mid = str(m.get("id") or m.get("matchId") or "")
        if not mid:
            continue
        if done is None or mid not in done:
            missing.append(mid)
    return missing


def enqueue_pending(
    data_dir: Path,
    ids: list[str],
    reason: str = "",
    *,
    kind: str = "train",
) -> list[str]:
    if not ids:
        return []
    doc = load_pending(data_dir, kind=kind)
    by_id = {
        str(it.get("id")): it
        for it in (doc.get("items") or [])
        if isinstance(it, dict) and it.get("id")
    }
    added: list[str] = []
    now = _iso()
    for mid in ids:
        if mid in by_id:
            continue
        by_id[mid] = {
            "id": mid,
            "enqueuedAt": now,
            "attempts": 0,
            "lastError": None,
            "alertedAt": None,
            "reason": reason or "sync",
            "kind": kind,
        }
        added.append(mid)
    doc["items"] = sorted(by_id.values(), key=lambda x: str(x.get("enqueuedAt") or ""))
    save_pending(data_dir, doc, kind=kind)
    if added:
        print(f"pending-{kind}-rp enqueue +{len(added)}: {added}", flush=True)
    return added


def clear_pending_done(
    data_dir: Path,
    *,
    kind: str = "train",
    ladder_file: Path | None = None,
) -> list[str]:
    if ladder_file is None:
        ladder_file = (
            data_dir / "rp-ladder.json"
            if kind == "train"
            else data_dir / "rp-ladder.json"
        )
    done = ladder_ids(ladder_file) or set()
    doc = load_pending(data_dir, kind=kind)
    kept = []
    cleared = []
    for it in doc.get("items") or []:
        if not isinstance(it, dict):
            continue
        mid = str(it.get("id") or "")
        if mid and mid in done:
            cleared.append(mid)
            continue
        kept.append(it)
    doc["items"] = kept
    save_pending(data_dir, doc, kind=kind)
    if cleared:
        print(f"pending-{kind}-rp cleared {cleared}", flush=True)
    return cleared


def bump_attempt(
    data_dir: Path, mid: str, err: str | None = None, *, kind: str = "train"
) -> dict | None:
    doc = load_pending(data_dir, kind=kind)
    hit = None
    for it in doc.get("items") or []:
        if isinstance(it, dict) and str(it.get("id")) == mid:
            it["attempts"] = int(it.get("attempts") or 0) + 1
            it["lastAttemptAt"] = _iso()
            if err:
                it["lastError"] = err[:500]
            hit = it
            break
    save_pending(data_dir, doc, kind=kind)
    return hit


def telegram_send(text: str) -> bool:
    """Send via Cloudflare Worker relay (VPS→CF→Telegram) or direct Bot API."""
    env = load_collector_env()
    chat = (env.get("BB_TG_CHAT_ID") or "").strip()
    text = str(text or "")[:3900]
    if not chat or not text:
        print("telegram skip: empty chat/text", flush=True)
        return False

    relay = (env.get("BB_TG_RELAY_URL") or "").strip().rstrip("/")
    relay_secret = (env.get("BB_TG_RELAY_SECRET") or "").strip()
    if relay and relay_secret:
        payload = json.dumps(
            {"secret": relay_secret, "chat_id": chat, "text": text},
            ensure_ascii=False,
        ).encode("utf-8")
        req = urllib.request.Request(
            relay.rstrip("/") + "/",
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/json",
                # CF Bot Fight blocks empty/python UA → 1010; Worker then checks secret.
                "User-Agent": "Mozilla/5.0 (compatible; BB-Squad-Alert/1.0)",
                "X-Relay-Secret": relay_secret,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                raw = resp.read()[:300]
                print(
                    f"telegram relay status={getattr(resp, 'status', '?')} body={raw!r}",
                    flush=True,
                )
                return 200 <= getattr(resp, "status", 200) < 300
        except urllib.error.HTTPError as e:
            print(f"telegram relay HTTP {e.code}: {e.read()[:300]!r}", flush=True)
            return False
        except Exception as e:
            print(f"telegram relay error: {type(e).__name__}: {e}", flush=True)
            return False

    token = (env.get("BB_TG_BOT_TOKEN") or "").strip()
    if not token:
        print(
            "telegram skip: set BB_TG_RELAY_URL+BB_TG_RELAY_SECRET "
            "or BB_TG_BOT_TOKEN + BB_TG_CHAT_ID",
            flush=True,
        )
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = urllib.parse.urlencode(
        {
            "chat_id": chat,
            "text": text,
            "disable_web_page_preview": "1",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            print(f"telegram send status={getattr(resp, 'status', '?')}", flush=True)
            return 200 <= getattr(resp, "status", 200) < 300
    except urllib.error.HTTPError as e:
        print(f"telegram HTTP {e.code}: {e.read()[:200]!r}", flush=True)
        return False
    except Exception as e:
        print(f"telegram error: {type(e).__name__}: {e}", flush=True)
        return False


def lag_minutes() -> int:
    env = load_collector_env()
    try:
        return max(1, int(env.get("BB_TG_RP_LAG_MIN") or "15"))
    except ValueError:
        return 15


def alert_stale_pending(data_dir: Path, *, kind: str = "train") -> list[str]:
    if kind == "train":
        for mid in auto_ids_needing_rp(data_dir):
            enqueue_pending(data_dir, [mid], reason="lag-scan", kind=kind)
    else:
        for mid in public_ids_needing_rp(data_dir):
            enqueue_pending(data_dir, [mid], reason="lag-scan", kind=kind)

    doc = load_pending(data_dir, kind=kind)
    mins = lag_minutes()
    now = _utc_now()
    alerted: list[str] = []
    changed = False
    label = "train ТМ" if kind == "train" else "паб PB1"
    for it in doc.get("items") or []:
        if not isinstance(it, dict) or it.get("alertedAt"):
            continue
        mid = str(it.get("id") or "")
        if not mid:
            continue
        try:
            enq = datetime.fromisoformat(str(it.get("enqueuedAt")))
            if enq.tzinfo is None:
                enq = enq.replace(tzinfo=timezone.utc)
        except Exception:
            enq = now
        age_min = (now - enq).total_seconds() / 60.0
        if age_min < mins:
            continue
        err = it.get("lastError") or "RP ещё нет в ladder"
        try:
            import bb_alerts as AL  # noqa: WPS433

            ok_send = AL.send(
                kind="rp",
                title=f"RP отстаёт ({label})",
                level="warn",
                lines=[
                    f"матч: {mid}",
                    f"ждём уже {int(age_min)} мин (порог {mins})",
                    "история есть, стата RP нет — очередь догона",
                ],
                details={
                    "попыток": it.get("attempts") or 0,
                    "ошибка": err,
                },
                force=True,
            )
        except Exception:
            ok_send = telegram_send(
                f"⚠️ BB {label} RP lag\n"
                f"match: {mid}\n"
                f"ждём {int(age_min)} мин (порог {mins})\n"
                f"attempts: {it.get('attempts') or 0}\n"
                f"err: {err}"
            )
        if ok_send:
            it["alertedAt"] = _iso()
            changed = True
            alerted.append(mid)
    if changed:
        save_pending(data_dir, doc, kind=kind)
    return alerted


def run_rp_rebuild(kv_public: Path, *, kind: str = "train") -> int:
    env = {**os.environ, "BB_KV_PUBLIC": str(kv_public)}
    script = (
        HERE / "build_train_rp_ledger.py"
        if kind == "train"
        else HERE / "build_public_rp_ledger.py"
    )
    if not script.is_file():
        print(f"missing {script}", flush=True)
        return 1
    cmd = [sys.executable, str(script)]
    if shutil.which("nice"):
        cmd = ["nice", "-n", "15", *cmd]
    if shutil.which("ionice"):
        cmd = ["ionice", "-c3", *cmd]
    print(f"{kind} RP rebuild (guard)…", flush=True)
    return int(subprocess.run(cmd, cwd=str(HERE), env=env, check=False).returncode or 0)


def drain_pending(data_dir: Path, kv_public: Path, *, kind: str = "train") -> dict:
    if kind == "train":
        missing = auto_ids_needing_rp(data_dir)
    else:
        missing = public_ids_needing_rp(data_dir)
    enqueue_pending(data_dir, missing, reason="drain", kind=kind)
    doc = load_pending(data_dir, kind=kind)
    pending_ids = [str(it.get("id")) for it in (doc.get("items") or []) if it.get("id")]
    result: dict = {"kind": kind, "pending": pending_ids, "cleared": [], "alerted": [], "rc": 0}
    if not pending_ids and not missing:
        result["alerted"] = alert_stale_pending(data_dir, kind=kind)
        return result
    for mid in pending_ids or missing:
        bump_attempt(data_dir, mid, kind=kind)
    result["rc"] = run_rp_rebuild(kv_public, kind=kind)
    still = (
        auto_ids_needing_rp(data_dir)
        if kind == "train"
        else public_ids_needing_rp(data_dir)
    )
    for mid in still:
        bump_attempt(data_dir, mid, err="still missing after rebuild", kind=kind)
    result["cleared"] = clear_pending_done(data_dir, kind=kind)
    result["alerted"] = alert_stale_pending(data_dir, kind=kind)
    result["still"] = still
    return result


if __name__ == "__main__":
    kind = "train"
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--public" in sys.argv:
        kind = "public"
    root = Path(args[0]) if args else Path(
        os.environ.get("BB_KV_PUBLIC") or "/var/www/bb-squad-platform/data/kv-cache"
    )
    data = root / "data" / ("training" if kind == "train" else "public")
    print(json.dumps(drain_pending(data, root, kind=kind), ensure_ascii=False, indent=2))
