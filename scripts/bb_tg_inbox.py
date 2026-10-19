#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Читает Telegram-бота (getUpdates) → inbox JSON + открытые ошибки.

Затем (по умолчанию) вызывает bb_alert_autofix для известных RP/алерт-косяков.

Cron (MSK): */5 * * * * … python bb_tg_inbox.py
CLI:
  python bb_tg_inbox.py
  python bb_tg_inbox.py --no-fix
  python bb_tg_inbox.py --dump
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

MSK = timezone(timedelta(hours=3), name="MSK")
INBOX = HERE.parent / "data" / "cache" / "bb-tg-inbox.json"
OPEN = HERE.parent / "data" / "cache" / "bb-tg-open-errors.json"
OFFSET = HERE / "_tmp_tg_inbox_offset.json"

# Patterns that mean "agent/VPS should fix this"
ERROR_RE = re.compile(
    r"(?i)("
    r"⚠️|🚨|косяк|рассинхрон|integrity|ticketClass|ticket.?class|"
    r"netΔ|RP lag|RP отстаёт|ПРОВАЛИЛСЯ|упал|не отвечает|"
    r"FAIL|error|ошибк|formula bad|share bad"
    r")"
)
OK_RE = re.compile(r"(?i)(✅|успешн|снова (доступен|online))")


def _load_env() -> dict[str, str]:
    import train_rp_guard as TRG  # noqa: WPS433

    return TRG.load_collector_env()


def _get_updates(token: str, offset: int | None) -> list[dict]:
    q = {"timeout": 0, "limit": 50, "allowed_updates": json.dumps(["message", "channel_post"])}
    if offset is not None:
        q["offset"] = offset
    url = f"https://api.telegram.org/bot{token}/getUpdates?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={"User-Agent": "BB-TgInbox/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not data.get("ok"):
        raise RuntimeError(f"getUpdates not ok: {data}")
    return list(data.get("result") or [])


def _msg_text(upd: dict) -> tuple[str, dict[str, Any]]:
    msg = upd.get("message") or upd.get("channel_post") or {}
    text = str(msg.get("text") or msg.get("caption") or "")
    chat = msg.get("chat") or {}
    meta = {
        "update_id": upd.get("update_id"),
        "message_id": msg.get("message_id"),
        "date": msg.get("date"),
        "chat_id": chat.get("id"),
        "chat_title": chat.get("title") or chat.get("username"),
        "from": (msg.get("from") or {}).get("username")
        or (msg.get("from") or {}).get("first_name"),
    }
    return text, meta


def _classify(text: str) -> str:
    if ERROR_RE.search(text or ""):
        return "error"
    if OK_RE.search(text or ""):
        return "ok"
    return "info"


def _error_fingerprint(text: str) -> str:
    # Stable-ish key for dedupe/autofix
    line0 = (text or "").splitlines()[0][:120] if text else ""
    ids = re.findall(r"20\d{6}-\d{4}-[a-z0-9-]+", text or "", flags=re.I)
    return f"{line0}|{','.join(ids[:4])}"


def _seed_open_from_sent_log() -> None:
    """Promote recent outbound warn/crit alerts into open-errors queue."""
    sent_path = HERE.parent / "data" / "cache" / "bb-tg-sent-log.json"
    if not sent_path.is_file():
        return
    try:
        sent = json.loads(sent_path.read_text(encoding="utf-8"))
    except Exception:
        return
    open_doc: dict[str, Any] = {"items": []}
    if OPEN.is_file():
        try:
            open_doc = json.loads(OPEN.read_text(encoding="utf-8"))
        except Exception:
            open_doc = {"items": []}
    by_fp = {
        str(it.get("fp")): it
        for it in (open_doc.get("items") or [])
        if isinstance(it, dict) and it.get("fp") and not it.get("resolvedAt")
    }
    for row in sent.get("messages") or []:
        if not isinstance(row, dict):
            continue
        if row.get("level") not in ("warn", "crit"):
            continue
        if row.get("kind") in ("autofix",):
            continue
        title = str(row.get("title") or "")
        if "успешн" in title.lower():
            continue
        text = str(row.get("text") or "")
        fp = f"{row.get('kind')}|{title}|{(text.splitlines() or [''])[0][:80]}"
        if fp in by_fp:
            continue
        by_fp[fp] = {
            "fp": fp,
            "kind": "error",
            "status": "open",
            "hits": 1,
            "openedAt": row.get("at"),
            "lastSeenAt": row.get("at"),
            "text": text[:3500],
            "title": title,
            "alertKind": row.get("kind"),
            "source": "sent-log",
        }
    open_doc["items"] = list(by_fp.values())
    open_doc["updatedAt"] = datetime.now(timezone.utc).isoformat()
    OPEN.parent.mkdir(parents=True, exist_ok=True)
    OPEN.write_text(
        json.dumps(open_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def run(*, do_fix: bool = True, dump: bool = False) -> dict[str, Any]:
    env = _load_env()
    token = (env.get("BB_TG_BOT_TOKEN") or "").strip()
    chat_want = str(env.get("BB_TG_CHAT_ID") or "").strip()
    if not token:
        print("bb_tg_inbox: no BB_TG_BOT_TOKEN", flush=True)
        return {"ok": False, "error": "no token"}

    off_doc = {"offset": None}
    if OFFSET.is_file():
        try:
            off_doc = json.loads(OFFSET.read_text(encoding="utf-8"))
        except Exception:
            pass
    offset = off_doc.get("offset")

    updates: list[dict] = []
    try:
        updates = _get_updates(token, offset)
    except Exception as e:
        # Bot may use webhook / no polling — still autofix from outbound open-errors.
        print(f"bb_tg_inbox getUpdates fail: {type(e).__name__}: {e}", flush=True)
        updates = []

    prev_inbox = {"messages": []}
    if INBOX.is_file():
        try:
            prev_inbox = json.loads(INBOX.read_text(encoding="utf-8"))
        except Exception:
            pass
    messages = list(prev_inbox.get("messages") or [])
    new_errors: list[dict] = []
    max_uid = offset or 0

    for upd in updates:
        uid = int(upd.get("update_id") or 0)
        max_uid = max(max_uid, uid)
        text, meta = _msg_text(upd)
        if chat_want and str(meta.get("chat_id") or "") != chat_want:
            # still advance offset; ignore other chats
            continue
        if not text.strip():
            continue
        kind = _classify(text)
        row = {
            **meta,
            "kind": kind,
            "text": text[:3500],
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "fp": _error_fingerprint(text),
        }
        messages.append(row)
        if kind == "error":
            new_errors.append(row)

    # keep last 200
    messages = messages[-200:]
    INBOX.parent.mkdir(parents=True, exist_ok=True)
    inbox_doc = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "msk": datetime.now(MSK).strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(messages),
        "messages": messages,
    }
    INBOX.write_text(
        json.dumps(inbox_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    if max_uid:
        OFFSET.write_text(
            json.dumps({"offset": max_uid + 1, "updatedAt": inbox_doc["updatedAt"]})
            + "\n",
            encoding="utf-8",
        )

    # Outbound alerts are source of truth (VPS often cannot reach api.telegram.org).
    _seed_open_from_sent_log()

    # merge open errors (+ any inbound getUpdates errors)
    open_doc: dict[str, Any] = {"items": []}
    if OPEN.is_file():
        try:
            open_doc = json.loads(OPEN.read_text(encoding="utf-8"))
        except Exception:
            pass
    by_fp = {
        str(it.get("fp")): it
        for it in (open_doc.get("items") or [])
        if isinstance(it, dict) and it.get("fp") and not it.get("resolvedAt")
    }
    for row in new_errors:
        fp = str(row.get("fp") or "")
        if not fp:
            continue
        if fp in by_fp:
            by_fp[fp]["lastSeenAt"] = row.get("fetchedAt")
            by_fp[fp]["hits"] = int(by_fp[fp].get("hits") or 1) + 1
        else:
            by_fp[fp] = {
                **row,
                "status": "open",
                "hits": 1,
                "openedAt": row.get("fetchedAt"),
            }
    open_doc = {
        "updatedAt": inbox_doc["updatedAt"],
        "items": list(by_fp.values()),
    }
    OPEN.write_text(
        json.dumps(open_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(
        f"bb_tg_inbox: updates={len(updates)} new_errors={len(new_errors)} "
        f"open={len(open_doc['items'])} → {INBOX}",
        flush=True,
    )
    if dump:
        for it in (open_doc.get("items") or [])[:10]:
            print("---", it.get("fp"), flush=True)
            print((it.get("text") or "")[:400], flush=True)

    fix_summary = None
    if do_fix and (open_doc.get("items") or []):
        try:
            import bb_alert_autofix as AF  # noqa: WPS433

            fix_summary = AF.run(open_doc)
            # refresh open count after fix
            if OPEN.is_file():
                open_doc = json.loads(OPEN.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"autofix fail: {type(e).__name__}: {e}", flush=True)
            fix_summary = {"error": str(e)}

    open_n = len(
        [
            i
            for i in (open_doc.get("items") or [])
            if isinstance(i, dict) and not i.get("resolvedAt")
        ]
    )
    return {
        "ok": True,
        "updates": len(updates),
        "newErrors": len(new_errors),
        "open": open_n,
        "fix": fix_summary,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-fix", action="store_true")
    ap.add_argument("--dump", action="store_true")
    args = ap.parse_args()
    out = run(do_fix=not args.no_fix, dump=args.dump)
    print(json.dumps({k: v for k, v in out.items() if k != "fix"}, ensure_ascii=False))
    # getUpdates may fail; autofix from outbound queue still counts as success
    return 0 if (out.get("ok") or out.get("fix") is not None) else 1


if __name__ == "__main__":
    raise SystemExit(main())
