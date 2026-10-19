#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Автофикс по открытым ошибкам из Telegram-инбокса / RP audit.

Читает data/cache/bb-tg-open-errors.json (или переданный doc),
для известных паттернов чинит и пишет результат обратно в бота.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

OPEN = HERE.parent / "data" / "cache" / "bb-tg-open-errors.json"
STATE = HERE / "_tmp_alert_autofix_state.json"

MATCH_ID_RE = re.compile(r"20\d{6}-\d{4}-[a-z0-9-]+", re.I)


def _load_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_open(doc: dict) -> None:
    OPEN.parent.mkdir(parents=True, exist_ok=True)
    OPEN.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _notify(title: str, lines: list[str], *, level: str = "info") -> None:
    try:
        import bb_alerts as AL  # noqa: WPS433

        AL.send(
            kind="autofix",
            title=title,
            level=level,
            lines=lines,
            force=True,
            cooldown=0,
        )
    except Exception as e:
        print(f"autofix notify skip: {e}", flush=True)


def _extract_ids(text: str) -> list[str]:
    return list(dict.fromkeys(MATCH_ID_RE.findall(text or "")))


def _rescore_public(ids: list[str]) -> tuple[int, str]:
    if not ids:
        return 0, "no ids"
    env = {
        **os.environ,
        "RP_AUDIT_REPAIR_PASS": "1",
        "RP_AUDIT_FIX": "0",
        "RP_AUDIT_TELEGRAM": "1",
    }
    cmd = [
        sys.executable,
        str(HERE / "build_public_rp_ledger.py"),
        "--rescore-ids",
        ",".join(ids[:12]),
    ]
    print(f"autofix public rescore {ids[:12]}", flush=True)
    p = subprocess.run(cmd, cwd=str(HERE), env=env, check=False, capture_output=True, text=True)
    tail = (p.stdout or "")[-800:] + "\n" + (p.stderr or "")[-400:]
    return int(p.returncode or 0), tail


def _rebuild_train() -> tuple[int, str]:
    env = {
        **os.environ,
        "RP_AUDIT_REPAIR_PASS": "1",
        "RP_AUDIT_FIX": "0",
        "RP_AUDIT_TELEGRAM": "1",
    }
    cmd = [sys.executable, str(HERE / "build_train_rp_ledger.py")]
    print("autofix train rebuild", flush=True)
    p = subprocess.run(cmd, cwd=str(HERE), env=env, check=False, capture_output=True, text=True)
    tail = (p.stdout or "")[-800:] + "\n" + (p.stderr or "")[-400:]
    return int(p.returncode or 0), tail


def _ticket_scan_fix() -> tuple[int, str]:
    cmd = [
        sys.executable,
        str(HERE / "rp_ticket_class_audit.py"),
        "--kind",
        "public",
        "--all",
        "--fix",
    ]
    env = {**os.environ, "RP_AUDIT_TELEGRAM": "1"}
    p = subprocess.run(cmd, cwd=str(HERE), env=env, check=False, capture_output=True, text=True)
    return int(p.returncode or 0), ((p.stdout or "") + (p.stderr or ""))[-1200:]


def _classify_action(text: str) -> str | None:
    t = text or ""
    low = t.lower()
    if "ticketclass" in low or "ticket class" in low or "ticket-class" in low:
        return "ticket_class"
    if "rp integrity" in low or "rp audit" in low or "рассинхрон" in low:
        return "rp_integrity"
    if "rp отстаёт" in low or "rp lag" in low:
        return "rp_lag"
    if "train" in low and ("rp" in low or "тм" in low):
        return "train_rp"
    return None


def run(open_doc: dict | None = None) -> dict[str, Any]:
    doc = open_doc or _load_json(OPEN)
    items = [it for it in (doc.get("items") or []) if isinstance(it, dict)]
    st = _load_json(STATE)
    done_fps = set(st.get("fixedFps") or [])
    results: list[dict] = []

    for it in items:
        if it.get("resolvedAt"):
            continue
        fp = str(it.get("fp") or "")
        if fp and fp in done_fps:
            continue
        # don't hammer same error more than once per 30 min
        last = float((st.get("lastTry") or {}).get(fp) or 0)
        now = time_now()
        if last and now - last < 1800:
            continue

        text = str(it.get("text") or "")
        action = _classify_action(text)
        if not action:
            continue

        st.setdefault("lastTry", {})[fp] = now
        ids = _extract_ids(text)
        lines_out: list[str] = [f"источник: {(text.splitlines() or [''])[0][:120]}"]
        rc = 0
        detail = ""

        try:
            if action == "ticket_class":
                rc, detail = _ticket_scan_fix()
                lines_out.append("действие: ticket-class audit --all --fix")
            elif action == "rp_integrity":
                if ids:
                    rc, detail = _rescore_public(ids)
                    lines_out.append(f"действие: rescore public {','.join(ids[:8])}")
                else:
                    rc, detail = _ticket_scan_fix()
                    lines_out.append("действие: ticket-class scan (нет id в тексте)")
            elif action in ("rp_lag", "train_rp"):
                if "паб" in text.lower() or "pb1" in text.lower() or "public" in text.lower():
                    if ids:
                        rc, detail = _rescore_public(ids)
                    else:
                        rc, detail = _rescore_public([])
                        # full pending rebuild
                        p = subprocess.run(
                            [sys.executable, str(HERE / "build_public_rp_ledger.py")],
                            cwd=str(HERE),
                            env={**os.environ, "RP_AUDIT_REPAIR_PASS": "1"},
                            check=False,
                            capture_output=True,
                            text=True,
                        )
                        rc = int(p.returncode or 0)
                        detail = (p.stdout or "")[-800:]
                    lines_out.append("действие: public RP rebuild/rescore")
                else:
                    rc, detail = _rebuild_train()
                    lines_out.append("действие: train RP rebuild")
            else:
                continue
        except Exception as e:
            rc = 1
            detail = f"{type(e).__name__}: {e}"

        # Re-check: do not mark resolved if desync still present.
        still_bad = False
        verify_note = ""
        if ids and action in ("rp_integrity", "ticket_class", "rp_lag"):
            try:
                import rp_post_ingest_audit as AUD  # noqa: WPS433

                audits = AUD.audit_ledger(
                    "public", last=None, ids=set(ids), blocks=None
                )
                still_bad = any(not a.ok for a in audits)
                verify_note = (
                    f"verify: bad={sum(1 for a in audits if not a.ok)}/{len(audits)}"
                )
            except Exception as e:
                still_bad = True
                verify_note = f"verify fail: {e}"

        level = "ok" if (rc == 0 and not still_bad) else "warn"
        lines_out.append(f"exit: {rc}")
        if verify_note:
            lines_out.append(verify_note)
        if detail.strip():
            lines_out.append("лог (хвост):")
            lines_out.extend(detail.strip().splitlines()[-8:])

        _notify(
            f"Autofix {'OK' if level == 'ok' else 'нужен повтор/агент'} ({action})",
            lines_out,
            level=level,
        )

        it["lastFixAt"] = datetime.now(timezone.utc).isoformat()
        it["lastFixRc"] = rc
        it["lastFixAction"] = action
        it["stillBad"] = still_bad
        if rc == 0 and not still_bad:
            it["resolvedAt"] = it["lastFixAt"]
            it["status"] = "resolved"
            if fp:
                done_fps.add(fp)
        else:
            it["status"] = "needs_agent" if still_bad else "open"
            it["agentHint"] = (
                "netΔ/ticket desync survived rescore — agent must inspect events"
                if still_bad
                else ""
            )
        results.append(
            {
                "fp": fp,
                "action": action,
                "rc": rc,
                "ids": ids,
                "stillBad": still_bad,
            }
        )

    st["fixedFps"] = list(done_fps)[-200:]
    st["updatedAt"] = datetime.now(timezone.utc).isoformat()
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    doc["items"] = items
    doc["updatedAt"] = st["updatedAt"]
    _save_open(doc)

    print(f"autofix processed={len(results)}", flush=True)
    return {"processed": len(results), "results": results}


def time_now() -> float:
    import time

    return time.time()


def main() -> int:
    out = run()
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
