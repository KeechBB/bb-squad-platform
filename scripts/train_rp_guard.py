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


def _pin_log_for_match(mid: str, date_ymd: str = "") -> Path | None:
    """Find TR*-YYYY.MM.DD-{mid}.log in any train server cache."""
    import re

    mid = str(mid or "").strip()
    if not mid:
        return None
    day_hint = ""
    if date_ymd and len(date_ymd) >= 10:
        day_hint = date_ymd[:10].replace("-", ".")
    day_pat = re.escape(day_hint) if day_hint else r"\d{4}\.\d{2}\.\d{2}"
    pat = re.compile(rf"^TR\d+-{day_pat}-{re.escape(mid)}\.log$", re.I)
    loose = re.compile(rf"^TR\d+-\d{{4}}\.\d{{2}}\.\d{{2}}-{re.escape(mid)}\.log$", re.I)
    caches: list[Path] = []
    try:
        for srv in FLEET.train_servers() or ["TR1", "TR2", "TR3"]:
            caches.append(FLEET.server_cache(srv))
    except Exception:
        caches = []
    caches.append(HERE / "_tmp_tr1_logs_cache")
    for cache in caches:
        if not cache.is_dir():
            continue
        try:
            for p in cache.glob("TR*-*.log"):
                if day_hint and pat.match(p.name):
                    return p
                if not day_hint and loose.match(p.name):
                    return p
        except OSError:
            continue
    return None


def _auto_index(train_dir: Path) -> dict[str, dict]:
    auto_path = train_dir / "_auto_matches.json"
    if not auto_path.is_file():
        return {}
    try:
        raw = json.loads(auto_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, list):
        return {}
    return {
        str(a.get("id")): a
        for a in raw
        if isinstance(a, dict) and a.get("id")
    }


def own_log_ready(train_dir: Path, mid: str) -> bool:
    """True only when a pin file is named for this match. A night copy of another id does not count."""
    row = _auto_index(train_dir).get(mid) or {}
    return _pin_log_for_match(mid, str(row.get("date") or "")) is not None


def _parked_ids(data_dir: Path, *, kind: str = "train") -> set[str]:
    doc = load_pending(data_dir, kind=kind)
    out: set[str] = set()
    for it in doc.get("items") or []:
        if isinstance(it, dict) and it.get("parked") and it.get("id"):
            out.add(str(it["id"]))
    return out


def settle_pending(data_dir: Path, *, kind: str = "train") -> list[str]:
    """Stop the 15-minute loop.

    No own log → park at once (nothing to score).
    Own log, but the rebuild already failed three times → park, do not telegram again.
    A newer pin file un-parks the row so a real log still gets one more try.
    """
    if kind != "train":
        return []
    doc = load_pending(data_dir, kind=kind)
    parked_now: list[str] = []
    changed = False
    for it in doc.get("items") or []:
        if not isinstance(it, dict):
            continue
        mid = str(it.get("id") or "")
        if not mid:
            continue
        if it.get("parked"):
            pin = _pin_log_for_match(mid, str((_auto_index(data_dir).get(mid) or {}).get("date") or ""))
            stamped = str(it.get("parkedAt") or "")
            try:
                pin_ts = datetime.fromtimestamp(pin.stat().st_mtime, timezone.utc).isoformat() if pin else ""
            except OSError:
                pin_ts = ""
            if pin is not None and pin_ts and stamped and pin_ts > stamped:
                it["parked"] = False
                it["attempts"] = 0
                it["lastError"] = None
                changed = True
            continue
        attempts = int(it.get("attempts") or 0)
        if not own_log_ready(data_dir, mid):
            it["parked"] = True
            it["parkedAt"] = _iso()
            it["lastError"] = "нет своего лога — RP не из чего считать"
            parked_now.append(mid)
            changed = True
        elif attempts >= 3:
            it["parked"] = True
            it["parkedAt"] = _iso()
            it["lastError"] = "сборщик уже не записал RP, повтор остановлен"
            parked_now.append(mid)
            changed = True
    if changed:
        save_pending(data_dir, doc, kind=kind)
        if parked_now:
            print(f"pending-{kind}-rp parked {len(parked_now)}: {parked_now[:12]}", flush=True)
    return parked_now


def _skipped_auto_ids(train_dir: Path) -> set[str]:
    """Auto rows explicitly marked skip must not be re-queued from a night pin."""
    auto_path = train_dir / "_auto_matches.json"
    if not auto_path.is_file():
        return set()
    try:
        raw = json.loads(auto_path.read_text(encoding="utf-8"))
    except Exception:
        return set()
    if not isinstance(raw, list):
        return set()
    return {
        str(a.get("id"))
        for a in raw
        if isinstance(a, dict) and a.get("skip") and a.get("id")
    }


def calendar_ids_needing_rp(train_dir: Path) -> list[str]:
    """
    Calendar rows with a pinned log on disk but no ladder RP yet.
    Catches gaps where players JSON / month row exist but _auto_matches was missed.
    """
    done = ladder_ids(train_dir / "rp-ladder.json")
    if done is None:
        done = set()
    skipped = _skipped_auto_ids(train_dir)
    missing: list[str] = []
    seen: set[str] = set()
    for month_path in sorted(train_dir.glob("????-??.json")):
        try:
            data = json.loads(month_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        y_m = month_path.stem  # 2026-10
        for m in data.get("matches") or []:
            if not isinstance(m, dict):
                continue
            mid = str(m.get("id") or "")
            if not mid or mid in seen or mid.endswith("-skip"):
                continue
            if mid in done:
                continue
            day = m.get("day")
            date_ymd = ""
            if day is not None:
                try:
                    date_ymd = f"{y_m}-{int(day):02d}"
                except Exception:
                    date_ymd = ""
            # Ночной лог чужого матча — не доказательство, что этот можно посчитать.
            # Иначе календарная строка без своего файла вечно висит в «RP отстаёт».
            if _pin_log_for_match(mid, date_ymd) is None:
                continue
            seen.add(mid)
            missing.append(mid)
    return missing


def auto_ids_needing_rp(train_dir: Path) -> list[str]:
    auto_path = train_dir / "_auto_matches.json"
    missing: list[str] = []
    seen: set[str] = set()
    done = ladder_ids(train_dir / "rp-ladder.json")
    parked = _parked_ids(train_dir, kind="train")
    if auto_path.is_file():
        try:
            auto = json.loads(auto_path.read_text(encoding="utf-8"))
        except Exception:
            auto = []
        if isinstance(auto, list):
            for m in auto:
                if not isinstance(m, dict):
                    continue
                mid = str(m.get("id") or "")
                if not mid or m.get("skip") or mid.endswith("-skip"):
                    continue
                if mid in parked or not own_log_ready(train_dir, mid):
                    continue
                if done is None or mid not in done:
                    if mid not in seen:
                        missing.append(mid)
                        seen.add(mid)
    for mid in calendar_ids_needing_rp(train_dir):
        if mid in parked or mid in seen or not own_log_ready(train_dir, mid):
            continue
        missing.append(mid)
        seen.add(mid)
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
    # Drop anything already on the ladder before enqueue/alert — avoids false
    # Telegram when warehouse pending lags a newer mirrored ladder (or vice versa).
    settle_pending(data_dir, kind=kind)
    clear_pending_done(data_dir, kind=kind)
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
        if not isinstance(it, dict) or it.get("alertedAt") or it.get("parked"):
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


def _night_pin_for_date(date_ymd: str) -> Path | None:
    """Any TR*-YYYY.MM.DD-*.log for that civil date (full-night copies OK)."""
    import re

    if not date_ymd or len(date_ymd) < 10:
        return None
    day_dot = date_ymd[:10].replace("-", ".")
    pat = re.compile(rf"^TR\d+-{re.escape(day_dot)}-.+\.log$", re.I)
    caches: list[Path] = [HERE / "_tmp_tr1_logs_cache"]
    try:
        for srv in FLEET.train_servers() or ["TR1", "TR2", "TR3"]:
            caches.append(FLEET.server_cache(srv))
    except Exception:
        pass
    for cache in caches:
        if not cache.is_dir():
            continue
        try:
            hits = sorted(p for p in cache.glob("TR*-*.log") if pat.match(p.name))
        except OSError:
            continue
        if hits:
            return hits[0]
    return None


def ensure_auto_from_calendar_pins(train_dir: Path) -> list[str]:
    """
    Upsert _auto_matches for calendar ids missing from auto but present on disk pins.
    Match layer by map + timeMsk (pins are often full-night copies).
    """
    import re
    from datetime import timedelta

    auto_path = train_dir / "_auto_matches.json"
    auto: list[dict] = []
    if auto_path.is_file():
        try:
            raw = json.loads(auto_path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                auto = raw
        except Exception:
            auto = []
    by_id = {str(a.get("id") or ""): a for a in auto if isinstance(a, dict)}
    added: list[str] = []
    done = ladder_ids(train_dir / "rp-ladder.json") or set()

    try:
        import rp_log_parse as R  # noqa: WPS433
        from sync_train_from_tr1_logs import _map_stem  # noqa: WPS433
    except Exception as e:
        print(f"ensure_auto pins: import fail ({e})", flush=True)
        return []

    def fuzzy(a: str, b: str) -> bool:
        sa = _map_stem(a).lower().replace(" ", "")
        sb = _map_stem(b).lower().replace(" ", "")
        return bool(sa and sb and (sa in sb or sb in sa or sa[:6] == sb[:6]))

    msk = timezone(timedelta(hours=3))
    layers_cache: dict[str, list[dict]] = {}

    for month_path in sorted(train_dir.glob("????-??.json")):
        try:
            data = json.loads(month_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        y_m = month_path.stem
        try:
            year, month = (int(x) for x in y_m.split("-")[:2])
        except Exception:
            continue
        for m in data.get("matches") or []:
            if not isinstance(m, dict):
                continue
            mid = str(m.get("id") or "")
            if not mid or mid.endswith("-skip") or mid in done:
                continue
            existing = by_id.get(mid)
            if existing and not existing.get("skip") and existing.get("start") and existing.get("end"):
                continue
            day = m.get("day")
            if day is None:
                continue
            try:
                day_i = int(day)
                date_ymd = f"{y_m}-{day_i:02d}"
            except Exception:
                continue
            tm = str(m.get("timeMsk") or "").strip()
            hm = re.match(r"^(\d{1,2}):(\d{2})", tm)
            if not hm:
                continue
            hh, mm = int(hm.group(1)), int(hm.group(2))
            local = datetime(year, month, day_i, hh, mm, tzinfo=msk)
            if hh < 6:
                local = local + timedelta(days=1)
            start_guess = local.astimezone(timezone.utc)

            pin = _pin_log_for_match(mid, date_ymd) or _night_pin_for_date(date_ymd)
            if pin is None or not pin.is_file():
                continue
            day_dot = date_ymd[:10].replace("-", ".")
            if day_dot not in layers_cache:
                try:
                    layers_cache[day_dot] = R.discover_matches([pin])
                except Exception as e:
                    print(f"ensure_auto discover {day_dot}: {e}", flush=True)
                    layers_cache[day_dot] = []
            found = layers_cache.get(day_dot) or []
            cmap = str(m.get("map") or "")
            hit = None
            best_dt = None
            for L in found:
                layer = str(L.get("map") or L.get("layer") or "")
                if not fuzzy(cmap, layer):
                    continue
                dt = abs((L["start"] - start_guess).total_seconds())
                if best_dt is None or dt < best_dt:
                    hit, best_dt = L, dt
            if hit is None or best_dt is None or best_dt > 45 * 60:
                continue
            start = hit["start"]
            end = hit["end"]
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
                end = end.replace(tzinfo=timezone.utc)
            srv = "TR1"
            mmatch = re.match(r"^(TR\d+)-", pin.name, re.I)
            if mmatch:
                srv = mmatch.group(1).upper()
            log_name = pin.name
            # Ночной файл назван чужим id. Копия должна носить имя этого матча,
            # иначе сборщик ищет Harju в логе Mutaha и вечно пишет «нет RP».
            if mid.lower() not in pin.name.lower():
                try:
                    log_name = pin_match_log(pin, mid, date_ymd, server=srv)
                except Exception as e:
                    print(f"ensure_auto pin copy {mid}: {e}", flush=True)
                    continue
            entry = {
                "id": mid,
                "map": m.get("map") or hit.get("map") or "—",
                "date": date_ymd,
                "log": log_name,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "logPinned": True,
                "serverKey": srv,
                "note": f"auto-ensure map+time Δ{int(best_dt)}s",
            }
            if existing:
                auto = [entry if str(a.get("id")) == mid else a for a in auto]
            else:
                auto.append(entry)
            by_id[mid] = entry
            added.append(mid)
            print(f"ensure_auto +{mid} ← {pin.name} Δ{int(best_dt)}s", flush=True)

    if added:
        auto_path.write_text(
            json.dumps(auto, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return added


def drain_pending(data_dir: Path, kv_public: Path, *, kind: str = "train") -> dict:
    settle_pending(data_dir, kind=kind)
    if kind == "train":
        ensure_auto_from_calendar_pins(data_dir)
        missing = auto_ids_needing_rp(data_dir)
    else:
        missing = public_ids_needing_rp(data_dir)
    enqueue_pending(data_dir, missing, reason="drain", kind=kind)
    doc = load_pending(data_dir, kind=kind)
    pending_ids = [
        str(it.get("id"))
        for it in (doc.get("items") or [])
        if isinstance(it, dict) and it.get("id") and not it.get("parked")
    ]
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
