#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Смоук турнирного хаба: live JSON живой, стата не «нули», Trix≠Trixx, growth на месте.
Exit 0 = ok, 1 = дыра. При --alert шлёт Telegram.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIVE = ROOT / "data" / "tournaments" / "fruit-strike-s1-live.json"
TIERS = ROOT / "data" / "kv-cache" / "data" / "tiers.json"
GROWTH_INDEX = ROOT / "data" / "kv-cache" / "index.html"


def nick_key(n: str) -> str:
    return re.sub(r"\s+", "", (n or "").strip().lower())


def check() -> list[str]:
    fails: list[str] = []

    if not LIVE.is_file() or LIVE.stat().st_size < 1000:
        fails.append(f"live JSON отсутствует или пуст: {LIVE}")
        return fails

    try:
        live = json.loads(LIVE.read_text(encoding="utf-8"))
    except Exception as e:
        fails.append(f"live JSON не читается: {e}")
        return fails

    matches = live.get("matches") or {}
    done = [
        k
        for k, v in matches.items()
        if isinstance(v, dict) and v.get("status") == "done"
    ]
    history = live.get("history") or []
    players = live.get("playerStats") or []
    teams = live.get("teamStats") or []

    if len(done) < 1:
        fails.append("в live нет ни одного done-матча")
    if len(history) < 1 and len(done) >= 1:
        fails.append(f"history пустой при {len(done)} done-матчах")
    if len(teams) < 1 and len(done) >= 1:
        fails.append("teamStats пустой при сыгранных матчах")
    else:
        with_games = [t for t in teams if int(t.get("matches") or 0) > 0]
        if len(done) >= 1 and not with_games:
            fails.append("teamStats есть, но у всех matches=0")
    if len(players) < 1 and len(done) >= 1:
        fails.append("playerStats пустой при сыгранных матчах")

    # Sheets say both Trix and Trixx exist → playerStats must keep them separate
    sheet_trix = set()
    for row in matches.values():
        if not isinstance(row, dict):
            continue
        sheet = row.get("sheet") or {}
        for key in ("r1", "r2", "oppR1", "oppR2"):
            for p in sheet.get(key) or []:
                if not isinstance(p, dict):
                    continue
                nk = nick_key(str(p.get("nick") or ""))
                if nk in ("trix", "trixx"):
                    sheet_trix.add(nk)
    if sheet_trix == {"trix", "trixx"}:
        ps_keys = {nick_key(str(p.get("nick") or "")) for p in players}
        if "trix" not in ps_keys or "trixx" not in ps_keys:
            fails.append(
                "в листах есть и Trix и Trixx, а в playerStats они снова слиплись"
            )

    if TIERS.is_file():
        try:
            aliases = (json.loads(TIERS.read_text(encoding="utf-8")).get("aliases")) or {}
            for a, c in aliases.items():
                ak, ck = nick_key(str(a)), nick_key(str(c))
                if {ak, ck} == {"trix", "trixx"} and ak != ck:
                    fails.append(f"tiers.json снова клеит {a}→{c}")
        except Exception as e:
            fails.append(f"tiers.json битый: {e}")

    if GROWTH_INDEX.is_file():
        html = GROWTH_INDEX.read_text(encoding="utf-8", errors="replace")
        if 'data-tm="growth"' not in html or 'id="tm-growth"' not in html:
            fails.append("kv-cache/index.html без вкладки «Развитие»")
    else:
        fails.append("нет kv-cache/index.html")

    # Forbidden draft patterns still in shipped UI source
    bad_src = [
        (
            ROOT / "src/components/TournamentTeamRatingTab.tsx",
            "пока с нулями",
            "рейтинг команд снова с заглушкой нулей",
        ),
        (
            ROOT / "src/components/TournamentMatchHistoryTab.tsx",
            "TOURNAMENT_MATCH_HISTORY_DRAFT",
            "история матчей снова на DRAFT",
        ),
        (
            ROOT / "src/components/TournamentPlayerStatsTab.tsx",
            'trixx: "trix"',
            "в UI снова alias trixx→trix",
        ),
    ]
    for path, needle, msg in bad_src:
        if path.is_file() and needle in path.read_text(encoding="utf-8", errors="replace"):
            fails.append(msg)

    return fails


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--alert", action="store_true", help="Telegram при дырах")
    ap.add_argument("--quiet-ok", action="store_true", help="не алертить успех")
    args = ap.parse_args()
    fails = check()
    if fails:
        print("SMOKE FAIL:")
        for f in fails:
            print(" -", f)
        if args.alert:
            sys.path.insert(0, str(ROOT / "scripts"))
            import bb_alerts as A

            A.send(
                kind="смоук",
                title="Турнирный хаб: дыра в данных/UI",
                level="crit",
                lines=fails[:12],
                force=True,
                cooldown=900,
            )
        return 1

    print(
        "SMOKE OK: live/history/teamStats/playerStats/growth/trix split выглядят живо"
    )
    if args.alert and not args.quiet_ok:
        sys.path.insert(0, str(ROOT / "scripts"))
        import bb_alerts as A

        A.send(
            kind="смоук",
            title="Турнирный хаб: смоук OK",
            level="ok",
            lines=["live JSON и критичные вкладки в порядке"],
            cooldown=3600,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
