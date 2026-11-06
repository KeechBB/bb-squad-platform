#!/usr/bin/env python3
"""
Event-level soft-cap rescore for one Steam after nick-split merge.

Does NOT reparse logs (old matches would drop). Walks ledger events for all
nicks of this steam, reverses baked gainCoef, reapplies soft-cap on ONE RP
curve (START → chronological), writes ladder+ledger, republishes.

  python3 scripts/rescore_steam_public_rp.py --steam 76561199135274403 --canon chuwits --dry-run
  python3 scripts/rescore_steam_public_rp.py --steam 76561199135274403 --canon chuwits --apply
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
sys.path.insert(0, str(ROOT / "scripts"))
import rp_log_parse as R  # noqa: E402

LADDER = ROOT / "data/public/rp-ladder.json"
LEDGER = ROOT / "data/public/rp-ledger.json"
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


def discover_nicks(steam: str, url: str, canon: str) -> set[str]:
    keys: set[str] = {nick_key(canon)}
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
    # tiers aliases that already point at canon
    for tiers in (
        ROOT / "data/kv-cache/data/tiers.json",
        Path("/var/www/blackberry-kv/data/tiers.json"),
    ):
        if not tiers.is_file():
            continue
        al = (json.loads(tiers.read_text(encoding="utf-8")).get("aliases") or {})
        ck = nick_key(canon)
        for raw, dest in al.items():
            if nick_key(dest) == ck:
                keys.add(nick_key(raw))
    return {k for k in keys if k}


def event_touches(e: dict, alias_keys: set[str]) -> bool:
    for field in ("killer", "victim", "actor", "nick", "key", "reviver"):
        v = e.get(field)
        if v and nick_key(str(v)) in alias_keys:
            return True
    return False


def event_signed_for_alias(e: dict, alias_keys: set[str]) -> float | None:
    """
    Return signed RP delta affecting this steam, or None if not ours.

    Ledger events store `delta` already applied to the primary actor:
    - gains: killer / driver / reviver
    - losses: victim (death) or killer (TK / vehicle_loss_*)
    """
    killer = nick_key(str(e.get("killer") or ""))
    victim = nick_key(str(e.get("victim") or ""))
    try:
        delta = float(e.get("delta") or 0)
    except (TypeError, ValueError):
        delta = 0.0
    if delta == 0:
        return None

    us_k = killer in alias_keys
    us_v = victim in alias_keys
    if not us_k and not us_v:
        return None

    kind = str(e.get("kind") or "")
    # Loss events attributed to victim or to self (TK / vehicle loss)
    if delta < 0:
        if us_v or us_k:
            return delta
        return None

    # Positive: must be credited to killer/driver/reviver side
    if us_k:
        return delta
    # Positive on victim-only — ignore (not our gain)
    if kind in {"revive"} and us_k:
        return delta
    return None


def raw_from_applied(delta: float, gain_coef: float | None, soft: bool) -> float:
    """Undo soft-cap on a positive applied delta."""
    if delta <= 0 or not soft:
        return delta
    try:
        g = float(gain_coef) if gain_coef is not None else 1.0
    except (TypeError, ValueError):
        g = 1.0
    if g <= 0.05:
        g = 1.0
    return delta / g


def apply_soft(rp: float, signed_raw: float, soft: bool) -> tuple[float, float]:
    """Apply raw signed delta with soft-cap; return (new_rp, applied)."""
    if soft and signed_raw > 0:
        signed = round(signed_raw * R.rp_gain_coef(rp), 2)
    else:
        signed = round(signed_raw, 2)
    nxt = rp + signed
    if nxt < R.MIN_RP:
        signed = R.MIN_RP - rp
        nxt = R.MIN_RP
    return round(nxt, 4), round(signed, 2)


def rebuild_leaderboard(players: dict) -> list[dict]:
    rows = []
    for p in players.values():
        if not isinstance(p, dict):
            continue
        nick = str(p.get("nick") or "")
        if not nick:
            continue
        try:
            rp = float(p.get("rp") or 0)
        except (TypeError, ValueError):
            continue
        info = R.rp_rank(rp)
        row = {
            "nick": nick,
            "rp": round(rp, 1),
            "rankLabel": info.get("label"),
            "rankKey": info.get("rankKey"),
        }
        if info.get("predator"):
            row["predatorPlace"] = 0  # filled below
        rows.append(row)
    rows.sort(key=lambda r: (-float(r["rp"]), r["nick"].lower()))
    pred_i = 0
    for r in rows:
        if r.get("rankKey") == "predator" or "PREDATOR" in str(r.get("rankLabel") or ""):
            pred_i += 1
            r["predatorPlace"] = pred_i
        else:
            r.pop("predatorPlace", None)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steam", required=True)
    ap.add_argument("--canon", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if not args.dry_run and not args.apply:
        raise SystemExit("pass --dry-run or --apply")

    steam = args.steam.strip()
    canon = args.canon.strip()
    canon_k = nick_key(canon)
    url = load_db_url()
    alias_keys = discover_nicks(steam, url, canon)
    print(f"steam={steam} canon={canon!r} aliases={sorted(alias_keys)}")

    ladder = json.loads(LADDER.read_text(encoding="utf-8"))
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    players = ladder.get("players") or {}
    before_row = players.get(canon_k) or players.get(canon)
    before_rp = float((before_row or {}).get("rp") or 0)
    before_n = len((before_row or {}).get("matches") or [])

    # Chronological match walk from ledger
    matches = [m for m in (ledger.get("matches") or []) if isinstance(m, dict) and m.get("id")]
    matches.sort(key=lambda m: str(m["id"]))

    rp = float(R.START_RP)
    new_match_nets: dict[str, float] = {}
    touched = 0
    event_n = 0

    for m in matches:
        mid = str(m["id"])
        soft = R.use_rp_gain_softcap(str(m.get("date") or ""), mid)
        # Prefer detailed events
        applied_sum = 0.0
        used_events = False
        for e in m.get("events") or []:
            if not isinstance(e, dict) or not event_touches(e, alias_keys):
                continue
            signed = event_signed_for_alias(e, alias_keys)
            if signed is None:
                continue
            used_events = True
            event_n += 1
            gcoef = e.get("gainCoef")
            raw = raw_from_applied(signed, gcoef, soft and signed > 0)
            rp, applied = apply_soft(rp, raw, soft)
            applied_sum += applied

        if not used_events:
            # Fallback: sum netByNick for alias display keys
            net_map = m.get("netByNick") or {}
            chunk = 0.0
            hit = False
            for nick, val in net_map.items():
                if nick_key(nick) in alias_keys:
                    hit = True
                    try:
                        chunk += float(val)
                    except (TypeError, ValueError):
                        pass
            if not hit:
                continue
            # net already soft-capped per old identity — treat as raw-ish undercount risk;
            # still apply as signed without reverse (no gainCoef available).
            rp, applied = apply_soft(rp, chunk, False)
            applied_sum = applied

        touched += 1
        new_match_nets[mid] = round(applied_sum, 2)

    after_rp = max(R.MIN_RP, round(rp, 1))
    # Consistency with START+Σnet
    sum_nets = sum(new_match_nets.values())
    implied = max(R.MIN_RP, round(R.START_RP + sum_nets, 1))
    if abs(implied - after_rp) > 0.2:
        print(f"warn: walk_rp={after_rp} vs START+Σ={implied} — using START+Σ")
        after_rp = implied

    print(
        json.dumps(
            {
                "beforeRp": before_rp,
                "afterRp": after_rp,
                "delta": round(after_rp - before_rp, 1),
                "matchesTouched": touched,
                "events": event_n,
                "beforeMatches": before_n,
                "nets": len(new_match_nets),
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    audit_dir = ROOT / "scripts/_audit_out"
    audit_dir.mkdir(parents=True, exist_ok=True)
    audit_path = audit_dir / f"rescore-steam-{steam}.json"
    audit = {
        "steamId": steam,
        "canon": canon,
        "aliases": sorted(alias_keys),
        "beforeRp": before_rp,
        "afterRp": after_rp,
        "delta": round(after_rp - before_rp, 1),
        "matchesTouched": touched,
        "events": event_n,
        "sampleNets": dict(list(sorted(new_match_nets.items()))[:8]),
    }
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print("audit →", audit_path)

    if args.dry_run:
        print("dry-run — no write")
        return

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bak = ROOT / "data/public/_bak_steam_rescore" / f"{steam}_{ts}"
    bak.mkdir(parents=True, exist_ok=True)
    shutil.copy2(LADDER, bak / "rp-ladder.json")
    shutil.copy2(LEDGER, bak / "rp-ledger.json")
    print("backup →", bak)

    # --- patch ladder player row ---
    row = dict(before_row or {})
    row["nick"] = canon
    old_matches = list(row.get("matches") or [])
    by_old = {str(x.get("id")): x for x in old_matches if isinstance(x, dict)}
    new_matches = []
    for mid, net in sorted(new_match_nets.items()):
        base = dict(by_old.get(mid) or {"id": mid})
        base["id"] = mid
        base["net"] = net
        new_matches.append(base)
    # keep combat fields from old merge; if match missing in old, leave net-only
    row["matches"] = new_matches
    info = R.rp_rank(after_rp)
    row["rp"] = after_rp
    row["rankLabel"] = info.get("label")
    row["rankKey"] = info.get("rankKey")
    if info.get("predator"):
        row["predatorPlace"] = 1  # temporary; leaderboard pass fixes
    else:
        row.pop("predatorPlace", None)

    players[canon_k] = row
    for frag in list(alias_keys):
        if frag != canon_k:
            players.pop(frag, None)
            # also drop display-key variants sometimes stored raw
            for pk in list(players.keys()):
                if nick_key(pk) == frag:
                    players.pop(pk, None)

    ladder["players"] = players
    board = rebuild_leaderboard(players)
    ladder["leaderboard"] = board
    # sync predatorPlace onto player rows
    place_by_nick = {nick_key(r["nick"]): r for r in board}
    for pk, p in players.items():
        if not isinstance(p, dict):
            continue
        br = place_by_nick.get(nick_key(p.get("nick") or pk))
        if not br:
            continue
        if br.get("predatorPlace"):
            p["predatorPlace"] = br["predatorPlace"]
        else:
            p.pop("predatorPlace", None)
        p["rankLabel"] = br.get("rankLabel")
        p["rankKey"] = br.get("rankKey")
        p["rp"] = br.get("rp")

    ladder["updatedAt"] = datetime.now(timezone.utc).isoformat()
    try:
        ladder["pMax"] = round(max(float(p.get("rp") or 0) for p in players.values() if isinstance(p, dict)), 1)
    except ValueError:
        pass

    # --- patch ledger ---
    lp = ledger.get("players") or {}
    # mirror ladder row slim into ledger players if present
    if isinstance(lp, dict):
        lrow = dict(lp.get(canon_k) or lp.get(canon) or {})
        lrow.update({k: row[k] for k in ("nick", "rp", "rankLabel", "rankKey", "matches") if k in row})
        if row.get("predatorPlace"):
            lrow["predatorPlace"] = row["predatorPlace"]
        for frag in list(alias_keys):
            if frag != canon_k:
                lp.pop(frag, None)
        lp[canon_k] = lrow
        ledger["players"] = lp

    for m in ledger.get("matches") or []:
        if not isinstance(m, dict):
            continue
        mid = str(m.get("id") or "")
        if mid not in new_match_nets:
            continue
        net_map = dict(m.get("netByNick") or {})
        # remove alias keys, set canon
        for nick in list(net_map.keys()):
            if nick_key(nick) in alias_keys:
                net_map.pop(nick, None)
        net_map[canon] = new_match_nets[mid]
        m["netByNick"] = net_map

    ledger["leaderboard"] = board
    ledger["updatedAt"] = datetime.now(timezone.utc).isoformat()
    ledger["pMax"] = ladder.get("pMax")

    LADDER.write_text(json.dumps(ladder, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("wrote ladder+ledger")

    # publish surfaces + db
    try:
        import publish_public_surfaces as PUBLISH

        PUBLISH.catch_up(LADDER)
        print("publish_public_surfaces OK")
    except Exception as e:
        print(f"warn: publish failed: {e}")

    try:
        import rp_ladder_db as DB

        DB.upsert_ladder(ladder)
        print("rp_ladder_db OK")
    except Exception as e:
        print(f"warn: rp_ladder_db: {e}")

    # final place
    br = place_by_nick.get(canon_k) or {}
    print(
        json.dumps(
            {
                "ok": True,
                "nick": canon,
                "rp": after_rp,
                "place": board.index(next(r for r in board if nick_key(r["nick"]) == canon_k)) + 1
                if any(nick_key(r["nick"]) == canon_k for r in board)
                else None,
                "predatorPlace": br.get("predatorPlace"),
                "rankLabel": br.get("rankLabel"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
