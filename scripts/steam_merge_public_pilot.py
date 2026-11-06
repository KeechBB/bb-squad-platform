#!/usr/bin/env python3
"""
Phase 2 pilot: merge split public RP rows for one Steam into one canon nick.

Does NOT rescore combat from logs (lookback would drop old matches).
Merges already-scored match nets by match id, RP = START + Σnet, re-ranks ladder.

Usage (on VPS):
  python3 scripts/steam_merge_public_pilot.py --steam 76561199135274403 --canon chuwits --dry-run
  python3 scripts/steam_merge_public_pilot.py --steam 76561199135274403 --canon chuwits --apply
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/var/www/bb-squad-platform")
LADDER = ROOT / "data/public/rp-ladder.json"
LEDGER = ROOT / "data/public/rp-ledger.json"
TIERS = ROOT.parent / "KV/public/data/tiers.json"
# VPS layout: blackberry-kv may be sibling
TIERS_CANDIDATES = [
    ROOT.parent / "KV/public/data/tiers.json",
    Path("/var/www/blackberry-kv/data/tiers.json"),
    Path("/var/www/blackberry-kv/public/data/tiers.json"),
    ROOT / "data/kv-cache/data/tiers.json",
]

START_RP = 1000.0
MIN_RP = 1.0
WS = re.compile(r"\s+")


def nick_key(n: str) -> str:
    return WS.sub("", str(n or "").strip().lower())


def load_db_url() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no DATABASE_URL")


def psql(url: str, sql: str) -> list[list[str]]:
    out = subprocess.check_output(
        ["psql", url, "-At", "-F", "\t", "-c", sql], text=True, errors="replace"
    )
    return [ln.split("\t") for ln in out.splitlines() if ln.strip()]


def discover_nicks(steam: str, url: str) -> set[str]:
    """All nick keys ever seen for this steam on TPUB + site nick."""
    keys: set[str] = set()
    rows = psql(
        url,
        f"""
SELECT DISTINCT coalesce("nickAtSpawn",'')
FROM "SquadRoleEvent"
WHERE "steamId" = '{steam}'
  AND "serverKey" LIKE 'TPUB%'
  AND coalesce("nickAtSpawn",'') <> '';
""",
    )
    for (nick,) in rows:
        k = nick_key(nick)
        if k:
            keys.add(k)
    rows = psql(
        url,
        f"""
SELECT coalesce(nick,''), coalesce("steamName",'')
FROM "User" WHERE "steamId" = '{steam}';
""",
    )
    for r in rows:
        for part in r:
            k = nick_key(part)
            if k:
                keys.add(k)
    return keys


def find_player_keys(players: dict, steam_nicks: set[str]) -> dict[str, dict]:
    """Map playerKey -> player dict for keys belonging to this steam."""
    hit: dict[str, dict] = {}
    for pk, p in players.items():
        if not isinstance(p, dict):
            continue
        nk = nick_key(p.get("nick") or pk)
        pk_n = nick_key(pk)
        # exact
        if nk in steam_nicks or pk_n in steam_nicks:
            hit[pk] = p
            continue
        # fuzzy: ONLY log/site nick is a substring of ladder nick
        # (папочка ⊂ папочкаchuwits). NEVER reverse — почка ⊂ папочка is a trap.
        for sk in steam_nicks:
            if len(sk) < 5:
                continue
            if sk in nk and nk != sk:
                hit[pk] = p
                break
    return hit


def implied_rp(matches: list) -> float:
    s = 0.0
    for m in matches:
        try:
            s += float(m.get("net") or 0)
        except (TypeError, ValueError):
            pass
    return max(MIN_RP, round(START_RP + s, 1))


def rp_rank(rp: float) -> dict:
    # Minimal mirror of labels used in slim — import if available
    try:
        sys.path.insert(0, str(ROOT / "scripts"))
        import rp_log_parse as R  # type: ignore

        return R.rp_rank(rp)
    except Exception:
        return {
            "label": "?",
            "rankKey": "?",
            "roman": "",
            "predator": False,
        }


def merge_matches(players: dict[str, dict]) -> list[dict]:
    by_id: dict[str, dict] = {}
    order_src: list[tuple[str, dict]] = []
    for p in players.values():
        for m in p.get("matches") or []:
            if not isinstance(m, dict):
                continue
            mid = str(m.get("id") or "")
            if not mid:
                continue
            order_src.append((mid, m))
            # prefer row with more combat signal if dup
            prev = by_id.get(mid)
            if prev is None:
                by_id[mid] = m
            else:
                def _combat_score(row: dict) -> float:
                    try:
                        net = abs(float(row.get("net") or 0))
                    except (TypeError, ValueError):
                        net = 0.0
                    kills = row.get("kills")
                    if isinstance(kills, list):
                        k = float(len(kills))
                    else:
                        try:
                            k = float(kills or 0)
                        except (TypeError, ValueError):
                            k = 0.0
                    return net + k

                if _combat_score(m) >= _combat_score(prev):
                    by_id[mid] = m
    # chronological by match id (YYYYMMDD-HHMM-...)
    ids = sorted(by_id.keys())
    return [by_id[i] for i in ids]


def rebuild_leaderboard(players: dict) -> list[dict]:
    rows = []
    for pk, p in players.items():
        if not isinstance(p, dict):
            continue
        rows.append(
            {
                "nick": p.get("nick") or pk,
                "rp": float(p.get("rp") or 0),
                "rankLabel": p.get("rankLabel"),
                "rankKey": p.get("rankKey"),
                "predatorPlace": p.get("predatorPlace"),
            }
        )
    rows.sort(key=lambda r: -float(r["rp"]))
    # predator places
    pred = 0
    for r in rows:
        info = rp_rank(float(r["rp"]))
        r["rankLabel"] = info.get("label") or r.get("rankLabel")
        r["rankKey"] = info.get("rankKey") or r.get("rankKey")
        if info.get("predator"):
            pred += 1
            r["predatorPlace"] = pred
        else:
            r["predatorPlace"] = None
    return rows


def sync_predator_on_players(players: dict, board: list[dict]) -> None:
    by_nick = {nick_key(r["nick"]): r for r in board}
    for pk, p in players.items():
        if not isinstance(p, dict):
            continue
        r = by_nick.get(nick_key(p.get("nick") or pk))
        if not r:
            continue
        p["rankLabel"] = r.get("rankLabel")
        p["rankKey"] = r.get("rankKey")
        p["predatorPlace"] = r.get("predatorPlace")
        info = rp_rank(float(p.get("rp") or 0))
        p["roman"] = info.get("roman")
        p["predator"] = info.get("predator")


def add_tier_aliases(canon_display: str, nicks: set[str]) -> Path | None:
    path = next((p for p in TIERS_CANDIDATES if p.is_file()), None)
    if not path:
        print("warn: tiers.json not found — skip aliases")
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    aliases = dict(data.get("aliases") or {})
    canon_k = nick_key(canon_display)
    changed = 0
    for n in sorted(nicks):
        # tiers alias values are display forms historically; load_alias_keys nick_keys both sides
        # Store display canon so UI-ish value stays readable; loader nick_keys it.
        if aliases.get(n) != canon_display and n != canon_k:
            aliases[n] = canon_display
            changed += 1
        # also raw variants with spaces if we only have keys — nicks set is keys only
    if changed:
        data["aliases"] = dict(sorted(aliases.items(), key=lambda x: x[0].lower()))
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"tiers aliases +{changed} → {path}")
    else:
        print("tiers aliases unchanged")
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steam", required=True)
    ap.add_argument("--canon", required=True, help="canonical display nick after merge")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if args.dry_run == args.apply:
        raise SystemExit("pass exactly one of --dry-run or --apply")

    url = load_db_url()
    steam = args.steam.strip()
    canon = args.canon.strip()
    canon_k = nick_key(canon)

    steam_nicks = discover_nicks(steam, url)
    steam_nicks.add(canon_k)
    print(f"steam={steam} canon={canon!r} log/site nickKeys={sorted(steam_nicks)}")

    ladder = json.loads(LADDER.read_text(encoding="utf-8"))
    players = dict(ladder.get("players") or {})
    hit = find_player_keys(players, steam_nicks)
    print(f"ladder rows matched: {len(hit)}")
    before = []
    for pk, p in sorted(hit.items(), key=lambda kv: -float(kv[1].get("rp") or 0)):
        ms = p.get("matches") or []
        before.append(
            {
                "key": pk,
                "nick": p.get("nick"),
                "rp": p.get("rp"),
                "matches": len(ms),
                "implied": implied_rp(ms),
            }
        )
        print(
            f"  BEFORE {pk!r} nick={p.get('nick')!r} rp={p.get('rp')} "
            f"matches={len(ms)} implied={implied_rp(ms)}"
        )

    if len(hit) < 2:
        print("nothing to merge (<2 rows)")
        # still useful to show state
        return

    merged_matches = merge_matches(hit)
    new_rp = implied_rp(merged_matches)
    info = rp_rank(new_rp)
    print(
        f"\nMERGED matches={len(merged_matches)} "
        f"(raw sum rows={sum(b['matches'] for b in before)}, "
        f"unique={len(merged_matches)}) rp={new_rp} rank={info.get('label')}"
    )

    # simulate place
    sim_players = {k: dict(v) for k, v in players.items() if k not in hit}
    sim_players[canon_k] = {
        "nick": canon,
        "rp": new_rp,
        "rankLabel": info.get("label"),
        "rankKey": info.get("rankKey"),
        "roman": info.get("roman"),
        "predator": info.get("predator"),
        "predatorPlace": None,
        "matches": merged_matches,
    }
    board = rebuild_leaderboard(sim_players)
    place = next(
        (i + 1 for i, r in enumerate(board) if nick_key(r["nick"]) == canon_k),
        None,
    )
    print(f"AFTER place=#{place} nick={canon} rp={new_rp}")

    report = {
        "steamId": steam,
        "canon": canon,
        "before": before,
        "after": {
            "nick": canon,
            "nickKey": canon_k,
            "rp": new_rp,
            "place": place,
            "matches": len(merged_matches),
            "rankLabel": info.get("label"),
        },
        "removedKeys": sorted(hit.keys()),
    }
    out = ROOT / "scripts/_audit_out" / f"pilot-merge-{steam}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out)

    if args.dry_run:
        print("\nDRY-RUN only — no files changed")
        return

    # --- APPLY ---
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bak_dir = ROOT / "data/public/_bak_steam_merge" / f"{steam}_{ts}"
    bak_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(LADDER, bak_dir / "rp-ladder.json")
    if LEDGER.is_file():
        # ledger is huge — copy only if space; else skip and patch in place carefully
        print("backing up ladder; ledger will be patched in place (large file)")
    print("backup →", bak_dir)

    # Patch ladder
    for pk in list(hit.keys()):
        players.pop(pk, None)
    players[canon_k] = sim_players[canon_k]
    board = rebuild_leaderboard(players)
    sync_predator_on_players(players, board)
    # refresh merged player predator fields from board
    for r in board:
        if nick_key(r["nick"]) == canon_k:
            players[canon_k]["predatorPlace"] = r.get("predatorPlace")
            players[canon_k]["rankLabel"] = r.get("rankLabel")
            players[canon_k]["rankKey"] = r.get("rankKey")
            break

    ladder["players"] = players
    ladder["leaderboard"] = [
        {
            "nick": r["nick"],
            "rp": round(float(r["rp"]), 1),
            "rankLabel": r.get("rankLabel"),
            "rankKey": r.get("rankKey"),
            "predatorPlace": r.get("predatorPlace"),
        }
        for r in board
    ]
    ladder["updatedAt"] = datetime.now(timezone.utc).isoformat()
    LADDER.write_text(
        json.dumps(ladder, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print("wrote", LADDER)

    # Patch ledger players similarly (keep matches/events structure)
    if LEDGER.is_file():
        print("loading ledger…")
        ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
        lp = dict(ledger.get("players") or {})
        lhit = find_player_keys(lp, steam_nicks)
        # Prefer merged match list from ladder (slim nets); copy display fields
        for pk in list(lhit.keys()):
            lp.pop(pk, None)
        # If ledger had richer match objects, try merge from ledger hits first
        rich = merge_matches(lhit) if lhit else merged_matches
        # Use rich if more fields / same count
        use_matches = rich if len(rich) >= len(merged_matches) else merged_matches
        use_rp = implied_rp(use_matches)
        info2 = rp_rank(use_rp)
        lp[canon_k] = {
            **({} if not isinstance(lhit.get(canon_k), dict) else {}),
            "nick": canon,
            "rp": use_rp,
            "rankLabel": info2.get("label"),
            "rankKey": info2.get("rankKey"),
            "roman": info2.get("roman"),
            "predator": info2.get("predator"),
            "predatorPlace": players[canon_k].get("predatorPlace"),
            "matches": use_matches,
        }
        # also sync ladder player matches if ledger richer
        if len(use_matches) != len(merged_matches) or use_rp != new_rp:
            players[canon_k]["matches"] = use_matches
            players[canon_k]["rp"] = use_rp
            board = rebuild_leaderboard(players)
            sync_predator_on_players(players, board)
            ladder["players"] = players
            ladder["leaderboard"] = [
                {
                    "nick": r["nick"],
                    "rp": round(float(r["rp"]), 1),
                    "rankLabel": r.get("rankLabel"),
                    "rankKey": r.get("rankKey"),
                    "predatorPlace": r.get("predatorPlace"),
                }
                for r in board
            ]
            LADDER.write_text(
                json.dumps(ladder, ensure_ascii=False, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
            print("re-wrote ladder after ledger merge", use_rp, len(use_matches))

        ledger["players"] = lp
        # leaderboard in ledger if present
        if "leaderboard" in ledger:
            ledger["leaderboard"] = [
                {
                    "nick": p.get("nick") or k,
                    "rp": p.get("rp"),
                    "rankLabel": p.get("rankLabel"),
                    "rankKey": p.get("rankKey"),
                    "predatorPlace": p.get("predatorPlace"),
                }
                for k, p in sorted(
                    lp.items(),
                    key=lambda kv: -float(kv[1].get("rp") or 0)
                    if isinstance(kv[1], dict)
                    else 0,
                )
                if isinstance(p, dict)
            ]
        ledger["updatedAt"] = datetime.now(timezone.utc).isoformat()
        print("writing ledger…")
        LEDGER.write_text(json.dumps(ledger, ensure_ascii=False) + "\n", encoding="utf-8")
        print("wrote", LEDGER)

    # Aliases for future ingest (map nick keys → canon display)
    # Also add spaced display forms from before rows
    alias_nicks = set(steam_nicks)
    for b in before:
        alias_nicks.add(nick_key(b.get("nick") or ""))
        alias_nicks.add(nick_key(b.get("key") or ""))
    add_tier_aliases(canon, {n for n in alias_nicks if n and n != canon_k})

    # Sync Postgres slim ladder
    try:
        sys.path.insert(0, str(ROOT / "scripts"))
        import rp_ladder_db as RPDB  # type: ignore

        RPDB.sync_required("PUBLIC", ladder)
        print("RpLadderPlayer synced")
    except Exception as e:
        print(f"warn: rp_ladder_db sync failed: {e}")

    # Rebuild profile match lines for canon nick (invalidate stamp → ensure)
    try:
        env = {**__import__("os").environ}
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            if line.startswith("DATABASE_URL="):
                env["DATABASE_URL"] = line.split("=", 1)[1].strip().strip('"').strip("'")
        script = ROOT / "scripts/_tmp_rebuild_one_public_hist.ts"
        script.write_text(
            f"""
import {{ prisma }} from "../src/lib/prisma";
import {{ ensureProfileLines, profileHistoryKey }} from "../src/lib/profileMatchLines";

const nick = {json.dumps(canon)};
const steam = {json.dumps(steam)};
const key = profileHistoryKey(nick, steam);
await prisma.profileMatchStamp.deleteMany({{ where: {{ nickKey: key, kind: "public" }} }});
await prisma.profileMatchLine.deleteMany({{ where: {{ nickKey: key, kind: "public" }} }});
await ensureProfileLines(nick, "public");
const n = await prisma.profileMatchLine.count({{ where: {{ nickKey: key, kind: "public" }} }});
console.log("rebuilt public lines", {{ nick, key, n }});
await prisma.$disconnect();
""",
            encoding="utf-8",
        )
        subprocess.check_call(
            ["npx", "--yes", "tsx", str(script)],
            cwd=str(ROOT),
            env=env,
        )
    except Exception as e:
        print(f"warn: profile lines rebuild skipped: {e}")

    # Final place check
    ladder2 = json.loads(LADDER.read_text(encoding="utf-8"))
    board2 = ladder2.get("leaderboard") or []
    place2 = next(
        (
            i + 1
            for i, r in enumerate(board2)
            if nick_key(r.get("nick")) == canon_k
        ),
        None,
    )
    p2 = (ladder2.get("players") or {}).get(canon_k) or {}
    leftovers = find_player_keys(ladder2.get("players") or {}, steam_nicks)
    leftovers = {k: v for k, v in leftovers.items() if nick_key(k) != canon_k and nick_key(v.get("nick") or "") != canon_k}
    print(
        f"\nDONE place=#{place2} rp={p2.get('rp')} matches={len(p2.get('matches') or [])} "
        f"leftover_rows={len(leftovers)}"
    )
    if leftovers:
        print("leftover keys", list(leftovers)[:20])


if __name__ == "__main__":
    main()
