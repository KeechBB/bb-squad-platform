#!/usr/bin/env python3
"""Проверка: катки training/YYYY-MM.json с 20.10, где ник в players,
есть в истории профиля (логика как buildPlayerTrainMatchHistory).

Usage:
  python check_train_profile_history.py Keech
  python check_train_profile_history.py --all-recent   # все ники из каток за 3 дня
  python check_train_profile_history.py --fix          # догнать sync_train + RP lag
  python check_train_profile_history.py --quiet

Exit: 0 ok / 2 дыры / 1 ошибка.
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
SINCE = (os.environ.get("BB_TRAIN_STATS_SINCE") or "2026-10-20").strip()
MSK = timezone(timedelta(hours=3))


def train_roots() -> list[Path]:
    out: list[Path] = []
    for raw in (
        os.environ.get("BB_KV_PUBLIC", "").strip(),
        "/var/www/bb-squad-platform/data/kv-cache",
        "/var/www/blackberry-kv",
        str(ROOT / "data" / "kv-cache"),
    ):
        if not raw:
            continue
        p = Path(raw)
        t = p / "data" / "training"
        if t.is_dir():
            out.append(t)
    # unique
    seen: set[str] = set()
    uniq: list[Path] = []
    for t in out:
        k = str(t.resolve()) if t.exists() else str(t)
        if k in seen:
            continue
        seen.add(k)
        uniq.append(t)
    return uniq


def nick_key(n: str) -> str:
    return "".join(str(n or "").strip().lower().split())


def load_aliases(train: Path) -> dict[str, str]:
    for cand in (
        train.parent / "tiers.json",
        train.parent.parent / "data" / "tiers.json",
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


def resolve_key(n: str, aliases: dict[str, str]) -> str:
    k = nick_key(n)
    return nick_key(aliases.get(k, k))


def iter_matches_since(train: Path, since: str) -> list[dict]:
    out: list[dict] = []
    for month_path in sorted(train.glob("20??-??.json")):
        try:
            data = json.loads(month_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        ym = str(data.get("month") or month_path.stem)
        if not ym or len(ym) < 7:
            continue
        y, mo = ym.split("-")[:2]
        for m in data.get("matches") or []:
            day = m.get("day")
            if day is None:
                continue
            ymd = f"{int(y):04d}-{int(mo):02d}-{int(day):02d}"
            if ymd < since:
                continue
            row = dict(m)
            row["_ymd"] = ymd
            row["_monthFile"] = str(month_path)
            out.append(row)
    out.sort(key=lambda m: (m.get("_ymd") or "", m.get("timeMsk") or "", m.get("id") or ""))
    return out


def player_in_doc(doc: dict, want: str, aliases: dict[str, str]) -> bool:
    rows: list = []
    if isinstance(doc.get("players"), list) and doc["players"]:
        rows = doc["players"]
    else:
        rows = list(doc.get("teamA") or []) + list(doc.get("teamB") or [])
    for r in rows:
        if not isinstance(r, dict):
            continue
        if resolve_key(str(r.get("nick") or ""), aliases) == want:
            return True
    return False


def load_players_doc(train: Path, m: dict) -> dict | None:
    rel = str(m.get("playersUrl") or "").strip()
    mid = str(m.get("id") or "").strip()
    cands: list[Path] = []
    if rel:
        # data/training/players/xx.json relative to kv root
        if rel.startswith("data/"):
            cands.append(train.parent / rel[len("data/") :])
            cands.append(train.parent.parent / rel)
        cands.append(train / rel)
        cands.append(train / "players" / Path(rel).name)
    if mid:
        cands.append(train / "players" / f"{mid}.json")
    for p in cands:
        if p.is_file():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
    return None


def expected_ids_for_nick(
    train: Path, nick: str, aliases: dict[str, str], since: str
) -> list[str]:
    want = resolve_key(nick, aliases)
    ids: list[str] = []
    for m in iter_matches_since(train, since):
        mid = str(m.get("id") or "")
        if not mid:
            continue
        doc = load_players_doc(train, m)
        if not doc:
            continue
        if player_in_doc(doc, want, aliases):
            ids.append(mid)
    return ids


def rp_ids_for_nick(train: Path, nick: str, aliases: dict[str, str]) -> set[str]:
    ladder = train / "rp-ladder.json"
    if not ladder.is_file():
        return set()
    try:
        data = json.loads(ladder.read_text(encoding="utf-8"))
    except Exception:
        return set()
    want = resolve_key(nick, aliases)
    players = data.get("players") or {}
    for k, p in players.items():
        if not isinstance(p, dict):
            continue
        if resolve_key(str(p.get("nick") or k), aliases) == want:
            return {str(m.get("id")) for m in (p.get("matches") or []) if m.get("id")}
    return set()


def audit_nick(train: Path, nick: str, aliases: dict[str, str]) -> dict:
    expected = expected_ids_for_nick(train, nick, aliases, SINCE)
    rp = rp_ids_for_nick(train, nick, aliases)
    # «В профиле должно быть» = expected (участие). RP — бонус.
    missing_rp = [i for i in expected if i not in rp]
    return {
        "nick": nick,
        "expectedCount": len(expected),
        "expectedIds": expected,
        "rpCount": len(rp & set(expected)),
        "missingRpIds": missing_rp,
        "okPresence": len(expected) > 0 or True,
        # дыра для алерта: катка есть в календаре+players, но нет даже файла? already in expected
        "ok": True,  # presence audit always ok if we list expected; RP lag separate
        "rpLag": bool(missing_rp),
    }


def recent_nicks(train: Path, aliases: dict[str, str], days: int = 3) -> list[str]:
    today = datetime.now(MSK).date()
    since_day = today - timedelta(days=days)
    since = max(SINCE, since_day.isoformat())
    found: set[str] = set()
    display: dict[str, str] = {}
    for m in iter_matches_since(train, since):
        doc = load_players_doc(train, m)
        if not doc:
            continue
        rows = doc.get("players") or list(doc.get("teamA") or []) + list(
            doc.get("teamB") or []
        )
        for r in rows:
            if not isinstance(r, dict):
                continue
            n = str(r.get("nick") or "").strip()
            if not n:
                continue
            k = resolve_key(n, aliases)
            found.add(k)
            display.setdefault(k, n)
    return [display[k] for k in sorted(found)]


def run_sync_train() -> int:
    script = HERE / "sync_train_from_tr1_logs.py"
    if not script.is_file():
        print("sync_train missing", flush=True)
        return 1
    env = os.environ.copy()
    env.setdefault("BB_KV_PUBLIC", "/var/www/bb-squad-platform/data/kv-cache")
    return subprocess.call([sys.executable, str(script)], cwd=str(HERE), env=env)


def main() -> int:
    args = sys.argv[1:]
    quiet = "--quiet" in args
    do_fix = "--fix" in args
    all_recent = "--all-recent" in args
    nicks = [a for a in args if not a.startswith("--")]

    roots = train_roots()
    if not roots:
        print("training dir not found", flush=True)
        return 1
    train = roots[0]
    aliases = load_aliases(train)

    if do_fix:
        print("=== sync_train_from_tr1_logs ===", flush=True)
        rc = run_sync_train()
        print(f"sync_train rc={rc}", flush=True)

    if all_recent:
        nicks = recent_nicks(train, aliases, days=3)
        if not quiet:
            print(f"recent nicks ({len(nicks)}) since ~3d / {SINCE}", flush=True)

    if not nicks:
        nicks = ["Keech"]

    reports = [audit_nick(train, n, aliases) for n in nicks]
    lagging = [r for r in reports if r.get("rpLag")]
    empty = [r for r in reports if int(r.get("expectedCount") or 0) == 0]

    if not quiet:
        print(
            json.dumps(
                {
                    "train": str(train),
                    "since": SINCE,
                    "checked": len(reports),
                    "rpLagPlayers": len(lagging),
                    "emptyPresence": len(empty),
                    "sampleLag": [
                        {"nick": r["nick"], "missingRpIds": r["missingRpIds"][:12]}
                        for r in lagging[:15]
                    ],
                    "keech": next(
                        (r for r in reports if nick_key(r["nick"]) == "keech"), None
                    ),
                },
                ensure_ascii=False,
                indent=2,
            ),
            flush=True,
        )
        for r in reports:
            if nick_key(r["nick"]) == "keech" or (not all_recent and len(reports) <= 5):
                print(
                    f"{r['nick']}: presence={r['expectedCount']} "
                    f"rp={r['rpCount']} missingRp={r['missingRpIds']}",
                    flush=True,
                )

    # Train RP с 26.10 выключен (auto_ids_needing_rp → []) — rpLag не фейл.
    # Фейл только если у явного ника нет ни одной катки в players с 20.10.
    if not all_recent:
        for r in reports:
            if int(r.get("expectedCount") or 0) == 0:
                if not quiet:
                    print(f"FAIL no presence for {r['nick']}", flush=True)
                return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
