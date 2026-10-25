#!/usr/bin/env python3
"""Verifier: CanonMatch (screen/log JSON) ↔ siphon layer slice.

Statuses: pass | fail | skip_no_log | skip_thin | error
On pass → sets CanonMatch.verifiedAt.
On fail → Telegram (optional) + report on disk; site still shows match unless BB_VERIFIER_GATE=1.

Usage:
  python3 scripts/canon_verify_match.py --match-key 2026-10-25_tr1_cslmutaha_2329
  python3 scripts/canon_verify_match.py --kind CW --id 25-alpha --month 2026-10
  python3 scripts/canon_verify_match.py --pending   # all unverified with a slice
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import canon_match_write as CANON  # noqa: E402
import rp_log_parse as R  # noqa: E402

ARCHIVE = Path(
    os.environ.get("BB_LOG_ARCHIVE_ROOT") or "/var/www/bb-squad-logs"
)
REPORT_DIR = Path(__file__).resolve().parents[1] / "data" / "cache" / "verify"


def nick_key(n: str) -> str:
    try:
        return R.canon_key(n, {})
    except Exception:
        return re.sub(r"\s+", "", (n or "").lower())


def _hhmm_minutes(key: str) -> int | None:
    m = re.search(r"_(\d{4})$", key or "")
    if not m:
        return None
    v = int(m.group(1))
    hh, mm = divmod(v, 100)
    if hh > 23 or mm > 59:
        return None
    return hh * 60 + mm


def _map_stem_key(match_key: str) -> str | None:
    """`YYYY-MM-DD_server_mapstem` without trailing _HHMM."""
    m = re.match(r"^(\d{4}-\d{2}-\d{2}_[^_]+_.+)_(\d{4})$", match_key or "")
    return m.group(1).lower() if m else None


def find_slice_dirs(
    match_key: str,
    *,
    day: str | None = None,
    server: str | None = None,
    map_name: str | None = None,
) -> list[Path]:
    """Exact matchKey dir, else same day+server+mapstem ordered by HHMM distance."""
    out: list[Path] = []
    # strip CW legacy suffix _25-alpha
    base_key = re.sub(r"_[0-9]{2}-[a-z0-9-]+$", "", match_key)
    day = day or (match_key[:10] if len(match_key) >= 10 else None)
    if day and re.match(r"^\d{4}-\d{2}-\d{2}$", day):
        y, m, d = day.split("-")
        parent = ARCHIVE / "matches" / y / m / d
        if parent.is_dir():
            exact = parent / match_key
            if exact.is_dir():
                out.append(exact)
            base = parent / base_key
            if base.is_dir() and base not in out:
                out.append(base)
            stem = _map_stem_key(base_key) or _map_stem_key(match_key)
            if stem:
                for p in parent.iterdir():
                    if not p.is_dir() or p in out:
                        continue
                    nl = p.name.lower()
                    if nl == stem or nl.startswith(stem + "_"):
                        out.append(p)
            target = _hhmm_minutes(match_key)

            def _score(p: Path) -> tuple[int, int]:
                if p.name == match_key or p.name == base_key:
                    return (0, 0)
                h = _hhmm_minutes(p.name)
                if target is None or h is None:
                    return (2, 9999)
                return (1, abs(h - target))

            out.sort(key=_score)
    return out


def load_log_kills(slice_dir: Path) -> dict[str, dict[str, int]] | None:
    """nick_key → {kills, deaths, nok} from layer.log or source.ref window via meta."""
    layer = slice_dir / "layer.log"
    meta_path = slice_dir / "meta.json"
    log_path: Path | None = None
    t0 = t1 = None
    if layer.is_file() and layer.stat().st_size > 100:
        log_path = layer
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                t0 = datetime.fromisoformat(meta["start"].replace("Z", "+00:00"))
                t1 = datetime.fromisoformat(meta["end"].replace("Z", "+00:00"))
            except Exception:
                t0 = t1 = None
    if log_path is None and meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            ref = (slice_dir / "source.ref").read_text(encoding="utf-8").strip()
            cand = ARCHIVE / ref if not Path(ref).is_file() else Path(ref)
            if cand.is_file():
                log_path = cand
                t0 = datetime.fromisoformat(meta["start"].replace("Z", "+00:00"))
                t1 = datetime.fromisoformat(meta["end"].replace("Z", "+00:00"))
        except Exception:
            return None
    if log_path is None or not log_path.is_file():
        return None
    if t0 is None or t1 is None:
        # whole file as one window — only for small layer.log
        if log_path.name != "layer.log":
            return None
        # invent wide window from first/last ts
        t0 = datetime(2020, 1, 1, tzinfo=timezone.utc)
        t1 = datetime(2099, 1, 1, tzinfo=timezone.utc)

    try:
        from collections import defaultdict

        aliases: dict[str, str] = {}
        idx = R.index_log_combat(log_path, aliases)
        steam = dict(idx.get("steam_to_nick") or {})
        def _aware(dt: datetime) -> datetime:
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt

        def _combat(a: datetime, b: datetime) -> dict[str, dict[str, int]]:
            dies, _ = R.dies_in_window(idx, _aware(a), _aware(b), steam, aliases)
            wounds = R.wounds_in_window(idx, _aware(a), _aware(b), steam, aliases)
            kills: dict[str, int] = defaultdict(int)
            deaths: dict[str, int] = defaultdict(int)
            nok: dict[str, int] = defaultdict(int)
            for d in dies or []:
                kk = nick_key(str(d.get("killer") or d.get("killerKey") or ""))
                vk = nick_key(str(d.get("victim") or d.get("victimKey") or ""))
                if kk:
                    kills[kk] += 1
                if vk:
                    deaths[vk] += 1
            for w in wounds or []:
                kk = nick_key(str(w.get("killer") or w.get("killerKey") or ""))
                if kk:
                    nok[kk] += 1
            return {
                k: {
                    "kills": kills.get(k, 0),
                    "deaths": deaths.get(k, 0),
                    "nok": nok.get(k, 0),
                }
                for k in set(kills) | set(deaths) | set(nok)
            }

        out = _combat(t0, t1)
        # layer.log already time-sliced — if window TZ missed, take whole index span
        if not out and log_path.name == "layer.log":
            out = _combat(
                datetime(2020, 1, 1, tzinfo=timezone.utc),
                datetime(2099, 1, 1, tzinfo=timezone.utc),
            )
        return out

    except Exception as e:
        print(f"log parse fail {log_path}: {e}", flush=True)
        return None


def screen_kills_from_players(players: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for p in players:
        # BB only for CW (side BB or A/B); skip OPP
        side = (p.get("side") or "").upper()
        if side == "OPP":
            continue
        k = nick_key(str(p.get("nick") or ""))
        if not k:
            continue
        cur = out.get(k) or {"kills": 0, "deaths": 0, "nok": 0}
        cur["kills"] += int(p.get("kills") or 0)
        cur["deaths"] += int(p.get("deaths") or 0)
        cur["nok"] += int(p.get("nok") or 0)
        out[k] = cur
    return out


def compare(
    screen: dict[str, dict[str, int]],
    log: dict[str, dict[str, int]],
) -> dict[str, Any]:
    if not screen:
        return {"status": "skip_thin", "reason": "no screen players"}
    if log is None:
        return {"status": "skip_no_log", "reason": "no parseable log"}
    if not log:
        return {"status": "skip_thin", "reason": "empty log combat"}

    shared = set(screen) & set(log)
    overlap = len(shared) / max(1, len(screen))
    mismatches: list[dict[str, Any]] = []
    for k in shared:
        sk, lk = screen[k]["kills"], log[k]["kills"]
        tol = max(2, int(0.25 * max(sk, lk, 1)))
        if abs(sk - lk) > tol:
            mismatches.append(
                {
                    "nick": k,
                    "field": "kills",
                    "screen": sk,
                    "log": lk,
                    "tol": tol,
                }
            )
    # fail if overlap low or many kill mismatches
    status = "pass"
    if overlap < 0.45 and len(screen) >= 8:
        status = "fail"
    elif len(mismatches) > max(3, int(0.25 * len(shared))):
        status = "fail"
    return {
        "status": status,
        "overlap": round(overlap, 3),
        "shared": len(shared),
        "screenN": len(screen),
        "logN": len(log),
        "mismatches": mismatches[:40],
    }


def fetch_match(
    *,
    match_key: str | None = None,
    kind: str | None = None,
    legacy_id: str | None = None,
    year: int | None = None,
    month: int | None = None,
) -> dict[str, Any] | None:
    db = CANON.load_env_db()
    if not db:
        print("no DATABASE_URL", file=sys.stderr)
        return None
    import psycopg2
    from psycopg2.extras import RealDictCursor

    conn = psycopg2.connect(db)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if match_key:
                cur.execute(
                    'SELECT * FROM "CanonMatch" WHERE "matchKey"=%s LIMIT 1',
                    (match_key,),
                )
            else:
                cur.execute(
                    """
                    SELECT * FROM "CanonMatch"
                    WHERE kind=%s::"CanonMatchKind" AND year=%s AND month=%s AND "legacyId"=%s
                    LIMIT 1
                    """,
                    (kind, year, month, legacy_id),
                )
            row = cur.fetchone()
            if not row:
                return None
            cur.execute(
                'SELECT nick, side, round, kills, deaths, nok FROM "CanonMatchPlayer" WHERE "matchId"=%s',
                (row["id"],),
            )
            players = [dict(p) for p in cur.fetchall()]
            return {**dict(row), "players": players}
    finally:
        conn.close()


def set_verified(match_id: str, ok: bool) -> None:
    db = CANON.load_env_db()
    if not db:
        return
    import psycopg2

    conn = psycopg2.connect(db)
    try:
        with conn.cursor() as cur:
            if ok:
                cur.execute(
                    'UPDATE "CanonMatch" SET "verifiedAt"=%s, "updatedAt"=%s WHERE id=%s',
                    (datetime.now(timezone.utc), datetime.now(timezone.utc), match_id),
                )
            else:
                cur.execute(
                    'UPDATE "CanonMatch" SET "verifiedAt"=NULL, "updatedAt"=%s WHERE id=%s',
                    (datetime.now(timezone.utc), match_id),
                )
        conn.commit()
    finally:
        conn.close()


def write_report(match_key: str, report: dict[str, Any], slice_dir: Path | None) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / f"{match_key}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if slice_dir and slice_dir.is_dir():
        (slice_dir / "verify.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return path


def verify_one(match: dict[str, Any]) -> dict[str, Any]:
    key = match["matchKey"]
    slices = find_slice_dirs(
        key,
        day=f"{match['year']:04d}-{match['month']:02d}-{int(match['day']):02d}",
        server=match.get("serverKey"),
        map_name=match.get("mapName"),
    )
    report: dict[str, Any] = {
        "matchKey": key,
        "legacyId": match.get("legacyId"),
        "kind": match.get("kind"),
        "source": match.get("source"),
        "at": datetime.now(timezone.utc).isoformat(),
        "slices": [str(p) for p in slices],
    }
    if not slices:
        report["status"] = "skip_no_log"
        report["reason"] = "no siphon slice (foreign server or not sliced yet)"
        write_report(key, report, None)
        return report

    screen = screen_kills_from_players(match.get("players") or [])
    # merge log kills from all candidate slices (CW r1/r2)
    merged_log: dict[str, dict[str, int]] = {}
    parsed_any = False
    for sd in slices:
        logk = load_log_kills(sd)
        if logk is None:
            continue
        parsed_any = True
        for k, v in logk.items():
            cur = merged_log.get(k) or {"kills": 0, "deaths": 0, "nok": 0}
            # CW: multiple slices = rounds — sum, don't max
            cur["kills"] += int(v["kills"] or 0)
            cur["deaths"] += int(v["deaths"] or 0)
            cur["nok"] += int(v["nok"] or 0)
            merged_log[k] = cur

    cmp = compare(screen, merged_log if parsed_any else None)
    report.update(cmp)
    write_report(key, report, slices[0])
    if report["status"] == "pass":
        set_verified(match["id"], True)
    elif report["status"] == "fail":
        set_verified(match["id"], False)
        if (os.environ.get("BB_VERIFIER_TG") or "").strip() in ("1", "true", "yes"):
            try:
                import bb_alerts as AL

                AL.send(
                    kind="выгрузка",
                    title="Verifier: расхождение скрин↔лог",
                    level="warn",
                    lines=[
                        f"key: {key}",
                        f"overlap: {report.get('overlap')}",
                        f"mismatches: {len(report.get('mismatches') or [])}",
                    ],
                    force=False,
                )
            except Exception:
                pass
    return report


def list_pending(limit: int = 40) -> list[dict[str, Any]]:
    db = CANON.load_env_db()
    if not db:
        return []
    import psycopg2
    from psycopg2.extras import RealDictCursor

    conn = psycopg2.connect(db)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT * FROM "CanonMatch"
                WHERE "verifiedAt" IS NULL
                  AND source IN ('SCREENSHOT'::"CanonMatchSource", 'LOG'::"CanonMatchSource")
                ORDER BY "updatedAt" DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = [dict(r) for r in cur.fetchall()]
            for row in rows:
                cur.execute(
                    'SELECT nick, side, round, kills, deaths, nok FROM "CanonMatchPlayer" WHERE "matchId"=%s',
                    (row["id"],),
                )
                row["players"] = [dict(p) for p in cur.fetchall()]
            return rows
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--match-key")
    ap.add_argument("--kind", choices=["TRAIN", "CW", "train", "cw"])
    ap.add_argument("--id", dest="legacy_id")
    ap.add_argument("--month", help="YYYY-MM")
    ap.add_argument("--pending", action="store_true")
    ap.add_argument("--limit", type=int, default=40)
    args = ap.parse_args()

    reports: list[dict[str, Any]] = []
    if args.pending:
        for m in list_pending(args.limit):
            reports.append(verify_one(m))
    elif args.match_key:
        m = fetch_match(match_key=args.match_key)
        if not m:
            print("match not found", file=sys.stderr)
            return 1
        reports.append(verify_one(m))
    elif args.kind and args.legacy_id and args.month:
        y, mo = map(int, args.month.split("-")[:2])
        m = fetch_match(
            kind=args.kind.upper(),
            legacy_id=args.legacy_id,
            year=y,
            month=mo,
        )
        if not m:
            print("match not found", file=sys.stderr)
            return 1
        reports.append(verify_one(m))
    else:
        ap.print_help()
        return 2

    for r in reports:
        print(
            json.dumps(
                {
                    "matchKey": r.get("matchKey"),
                    "status": r.get("status"),
                    "overlap": r.get("overlap"),
                    "mismatches": len(r.get("mismatches") or []),
                    "reason": r.get("reason"),
                },
                ensure_ascii=False,
            )
        )
    fails = sum(1 for r in reports if r.get("status") == "fail")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
