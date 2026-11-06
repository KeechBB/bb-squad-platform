#!/usr/bin/env python3
"""Проверка синхрона Battle Pass ↔ public rp-ledger.

Кейс 22.10 Diray: матч Harju уже в ledger, но не в scoredMatchIds BP.
Кейс 27.10 Bambozy: матчи в scored, но без teamsByKey → won=None, стрик 0.

Usage:
  python check_bp_sync.py                 # audit+heal хвост (last=80)
  python check_bp_sync.py --today         # все матчи/игроки за сегодня МСК
  python check_bp_sync.py --today --day 20261027
  python check_bp_sync.py --full          # все матчи после cutover (last=0)
  python check_bp_sync.py --dry-run       # только отчёт
  python check_bp_sync.py --quiet         # exit-code only (cron)

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

    dry = "--dry-run" in sys.argv
    quiet = "--quiet" in sys.argv
    today = "--today" in sys.argv
    full = "--full" in sys.argv or (
        "--last" in sys.argv and sys.argv[sys.argv.index("--last") + 1] == "0"
    )

    last = 80
    if "--last" in sys.argv:
        last = int(sys.argv[sys.argv.index("--last") + 1])
    if full:
        last = 0

    if today:
        day = None
        if "--day" in sys.argv:
            day = sys.argv[sys.argv.index("--day") + 1]
        rep = BP.audit_today_players(day=day, fix=not dry)
    else:
        rep = BP.heal_bp_vs_ledger(last=last, fix=not dry)

    if not quiet:
        # для --today не печатаем весь список игроков в cron-логе — кратко + JSON file
        out = dict(rep)
        players = out.pop("players", None)
        print(json.dumps(out, ensure_ascii=False, indent=2), flush=True)
        if today and isinstance(players, list):
            print(
                f"BP today: day={rep.get('day')} matches={rep.get('todayMatchCount')} "
                f"players={rep.get('registeredPlayersToday')} "
                f"missing={rep.get('missingIds')} "
                f"wonNone={rep.get('wonNoneCount')} ok={rep.get('ok')}",
                flush=True,
            )
            # топ по числу карт сегодня
            top = sorted(
                players, key=lambda r: (-int(r.get("matchesToday") or 0), str(r.get("nick")))
            )[:25]
            for r in top:
                print(
                    f"  {r.get('nick')}: maps={r.get('matchesToday')} "
                    f"W/L/?={r.get('wins')}/{r.get('losses')}/{r.get('noResult')} "
                    f"BP L{r.get('bpLevel')} {r.get('bpCurrent')}/{r.get('bpTarget')}",
                    flush=True,
                )
        else:
            print(
                f"BP sync: ok={rep.get('ok')} action={rep.get('action')} "
                f"missing={rep.get('missingIds')} healed={rep.get('healed')}",
                flush=True,
            )

    if rep.get("ok"):
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
