#!/usr/bin/env python3
"""Проверка синхрона Battle Pass ↔ public rp-ledger.

Кейс 22.10 Diray: матч Harju уже в ledger (3 техники), но не в
scoredMatchIds BP → в UI было 1/2 вместо закрытия уровня.

Usage:
  python check_bp_sync.py              # audit + auto-heal
  python check_bp_sync.py --dry-run    # только отчёт
  python check_bp_sync.py --last 0     # проверить ВСЕ матчи после cutover
  python check_bp_sync.py --quiet      # exit-code only (для cron)

Exit: 0 ok / 2 рассинхрон не починился / 1 ошибка.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))


def _load_db_url() -> None:
    if (os.environ.get("DATABASE_URL") or "").strip():
        return
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            os.environ["DATABASE_URL"] = (
                line.split("=", 1)[1].strip().strip("'").strip('"')
            )
            return


def main() -> int:
    _load_db_url()
    import build_battle_pass as BP  # noqa: WPS433

    last = 40
    dry = "--dry-run" in sys.argv
    quiet = "--quiet" in sys.argv
    if "--last" in sys.argv:
        i = sys.argv.index("--last")
        last = int(sys.argv[i + 1])

    rep = BP.heal_bp_vs_ledger(last=last, fix=not dry)
    if not quiet:
        print(json.dumps(rep, ensure_ascii=False, indent=2), flush=True)
        action = rep.get("action") or "—"
        missing = rep.get("missingIds") or []
        print(
            f"BP sync: ok={rep.get('ok')} action={action} "
            f"missing={missing} healed={rep.get('healed')}",
            flush=True,
        )
    if rep.get("ok"):
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
