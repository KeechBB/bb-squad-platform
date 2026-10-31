#!/usr/bin/env python3
"""Автопроверка: катки из training/YYYY-MM.json есть в личных профилях
и для них есть combat-карточка («Детальный разбор»).

Usage (VPS):
  python3 scripts/check_train_profile_coverage.py --days 3
  python3 scripts/check_train_profile_coverage.py --month 2026-10 --fix
  python3 scripts/check_train_profile_coverage.py --quiet

Exit: 0 ok / 2 gaps / 1 error.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TRAIN = Path(
    os.environ.get("BB_TRAIN_DIR")
    or "/var/www/bb-squad-platform/data/kv-cache/data/training"
)
COMBAT = TRAIN / "combat"
MSK = timezone(timedelta(hours=3))
SINCE = (os.environ.get("BB_TRAIN_STATS_SINCE") or "2026-10-20").strip()


def nick_key(n: str) -> str:
    return "".join(str(n or "").strip().lower().split())


def load_aliases() -> dict[str, str]:
    for cand in (
        TRAIN.parent / "tiers.json",
        Path("/var/www/blackberry-kv/public/data/tiers.json"),
    ):
        if not cand.is_file():
            continue
        try:
            t = json.loads(cand.read_text(encoding="utf-8"))
        except Exception:
            continue
        out: dict[str, str] = {}
        for raw, canon in (t.get("aliases") or {}).items():
            ak, ck = nick_key(str(raw)), nick_key(str(canon))
            if ak and ck:
                out[ak] = ck
        return out
    return {}


def resolve(n: str, aliases: dict[str, str]) -> str:
    k = nick_key(n)
    return nick_key(aliases.get(k, k))


def load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, _, v = s.partition("=")
        k = k.strip()
        v = v.strip().strip("'").strip('"')
        if k and k not in os.environ:
            os.environ[k] = v


def db_train_ids_by_nick() -> dict[str, set[str]]:
    """ProfileMatchLine kind=train → nickKey → matchIds."""
    load_dotenv()
    url = os.environ.get("DATABASE_URL") or ""
    if not url:
        return {}
    try:
        import psycopg2  # type: ignore
    except Exception:
        return {}
    out: dict[str, set[str]] = {}
    try:
        conn = psycopg2.connect(url)
        cur = conn.cursor()
        cur.execute(
            'SELECT "nickKey", "matchId" FROM "ProfileMatchLine" WHERE kind = %s',
            ("train",),
        )
        for nk, mid in cur.fetchall():
            nk = nick_key(str(nk or ""))
            mid = str(mid or "").strip()
            if not nk or not mid:
                continue
            out.setdefault(nk, set()).add(mid)
        cur.close()
        conn.close()
    except Exception as e:
        print(f"db read fail: {e}", flush=True)
        return {}
    return out


def roster(doc: dict) -> list[dict]:
    if isinstance(doc.get("players"), list) and doc["players"]:
        return [r for r in doc["players"] if isinstance(r, dict)]
    return [
        r
        for r in list(doc.get("teamA") or []) + list(doc.get("teamB") or [])
        if isinstance(r, dict)
    ]


def iter_matches(since_ymd: str, only_days: set[int] | None, month: str | None):
    paths = (
        [TRAIN / f"{month}.json"]
        if month
        else sorted(TRAIN.glob("20??-??.json"))
    )
    for month_path in paths:
        if not month_path.is_file():
            continue
        try:
            data = json.loads(month_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        ym = str(data.get("month") or month_path.stem)
        y, mo = ym.split("-")[:2]
        for m in data.get("matches") or []:
            day = m.get("day")
            if day is None:
                continue
            if only_days is not None and int(day) not in only_days:
                continue
            ymd = f"{int(y):04d}-{int(mo):02d}-{int(day):02d}"
            if ymd < since_ymd:
                continue
            mid = str(m.get("id") or "").strip()
            if not mid:
                continue
            yield {
                "id": mid,
                "ymd": ymd,
                "day": int(day),
                "map": m.get("layer") or m.get("map") or "",
                "playersUrl": m.get("playersUrl") or "",
            }


def load_players(mid: str, players_url: str) -> dict | None:
    cands = [TRAIN / "players" / f"{mid}.json"]
    rel = str(players_url or "").strip()
    if rel:
        if rel.startswith("data/"):
            cands.append(TRAIN.parent / rel[len("data/") :])
            cands.append(TRAIN.parent.parent / rel)
        cands.append(TRAIN / "players" / Path(rel).name)
    for p in cands:
        if p.is_file():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
    return None


def combat_ok(mid: str) -> bool:
    p = COMBAT / f"{mid}.json"
    if not p.is_file():
        return False
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return False
    players = doc.get("players") or {}
    return isinstance(players, dict) and len(players) > 0


def run_fix(missing_history_days: set[int], missing_combat: list[str], month: str) -> None:
    if missing_history_days:
        days = ",".join(str(d) for d in sorted(missing_history_days))
        script = HERE / "rebuild_train_history_days.py"
        if script.is_file():
            print(f"=== rebuild history days={days} month={month} ===", flush=True)
            subprocess.call(
                [
                    sys.executable,
                    str(script),
                    "--days",
                    days,
                    "--month",
                    month,
                ],
                cwd=str(ROOT),
            )
    if missing_combat:
        warm = HERE / "warm_train_combat_cards.py"
        if warm.is_file():
            # warm by unique days from match ids like 29-sec…
            days = sorted(
                {
                    int(mid.split("-", 1)[0])
                    for mid in missing_combat
                    if mid[:2].isdigit() and mid[2:3] == "-"
                }
            )
            if days:
                print(f"=== warm combat days={days} ===", flush=True)
                subprocess.call(
                    [
                        sys.executable,
                        str(warm),
                        "--month",
                        month,
                        "--days",
                        ",".join(str(d) for d in days),
                    ],
                    cwd=str(ROOT),
                )


def main() -> int:
    args = sys.argv[1:]
    quiet = "--quiet" in args
    do_fix = "--fix" in args
    month = "2026-10"
    days_back = 3
    only_days: set[int] | None = None
    for a in args:
        if a.startswith("--month="):
            month = a.split("=", 1)[1]
        elif a.startswith("--days=") and a[7:].isdigit():
            days_back = int(a.split("=", 1)[1])
        elif a.startswith("--only-days="):
            only_days = {
                int(x) for x in a.split("=", 1)[1].split(",") if x.strip().isdigit()
            }

    today = datetime.now(MSK).date()
    since_day = today - timedelta(days=days_back)
    since = max(SINCE, since_day.isoformat())
    if only_days is not None:
        # when explicit days, don't clip by rolling window
        since = SINCE

    if not TRAIN.is_dir():
        print(f"training dir missing: {TRAIN}", flush=True)
        return 1

    aliases = load_aliases()
    db = db_train_ids_by_nick()
    if not db:
        print("WARN: ProfileMatchLine empty or DB unread", flush=True)

    expected_pairs = 0
    missing_hist: list[dict] = []
    missing_combat: list[str] = []
    hist_gap_days: set[int] = set()
    match_ids: list[str] = []

    for m in iter_matches(since, only_days, month):
        mid = m["id"]
        match_ids.append(mid)
        if not combat_ok(mid):
            missing_combat.append(mid)
        doc = load_players(mid, m["playersUrl"])
        if not doc:
            continue
        for row in roster(doc):
            n = str(row.get("nick") or "").strip()
            if not n:
                continue
            nk = resolve(n, aliases)
            expected_pairs += 1
            have = db.get(nk) or set()
            if mid not in have:
                missing_hist.append(
                    {"nick": n, "nickKey": nk, "matchId": mid, "ymd": m["ymd"]}
                )
                hist_gap_days.add(int(m["day"]))

    report = {
        "month": month,
        "since": since,
        "matches": len(set(match_ids)),
        "expectedPlayerMatches": expected_pairs,
        "dbNicks": len(db),
        "missingHistory": len(missing_hist),
        "missingCombatCards": len(missing_combat),
        "sampleHistoryGaps": missing_hist[:25],
        "missingCombatIds": missing_combat[:40],
    }
    if not quiet:
        print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)

    if do_fix and (hist_gap_days or missing_combat):
        run_fix(hist_gap_days, missing_combat, month)

    if missing_hist or missing_combat:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
