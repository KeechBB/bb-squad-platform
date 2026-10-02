#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build KV/public/data/tfs-fit.json for «Тиры Fit» UI.

Variant A: Fit% to tier medians by role (CW only).
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import median
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
KV = ROOT / "KV" / "public"
DATA = KV / "data"
OUT = DATA / "tfs-fit.json"
ORR_DETAIL = HERE / "_tmp_orr_v21_perf.json"

T1_KIT = {
    "LordWolf": "Sap",
    "Gadler": "Crew",
    "Chidori": "CMD",
    "Hikkomaru": "Tandem",
    "CAT": "SL",
    "Morty": "Medic",
    "lepurple": "Medic",
    "Mukuru": "SL",
    "Summer": "SL",
    "Pymba": "GP",
    "Keech": "CMD",
    "Kuchenchips": "Crew",
    "angel": "Rifle",
    "Blizzardrix": "Sap",
    "Diray": "Rifle",
    "S.M.P": "Tandem",
    "iKEppA": "Rifle",
    "Treppen": "SL",
    "Runetik": "Rifle",
    "JESTER": "Rifle",
    "AkiN": "GP",
    "KillReal": "Medic",
}
FAM_MAP = {
    "CMD": "CMD",
    "SL": "SL",
    "FTL": "SL",
    "MEDIC": "Medic",
    "RIFLE": "Rifle",
    # HAT = тандем (тяжёлая труба). LAT = лёгкая труба → в Fit как Rifle (отдельной доски LAT нет).
    "HAT": "Tandem",
    "LAT": "Rifle",
    "CREW": "Crew",
}
ROLE_LABEL = {
    "CMD": "CMD",
    "SL": "КО (SL)",
    "Medic": "Медик",
    "Rifle": "Стрелок",
    "GP": "ГП",
    "Tandem": "Тандем",
    "Crew": "Тех / водитель",
    "Sap": "Сапёр",
}
ROLE_ORDER = ["CMD", "SL", "Medic", "Rifle", "GP", "Tandem", "Crew", "Sap"]
W = {
    "Medic": dict(res=0.45, kd=0.05, dmg=0.05, orr=0.35, pres=0.10),
    "Rifle": dict(res=0.05, kd=0.30, dmg=0.25, orr=0.30, pres=0.10),
    "Crew": dict(res=0.05, kd=0.15, dmg=0.40, orr=0.30, pres=0.10),
    "SL": dict(res=0.10, kd=0.15, dmg=0.20, orr=0.40, pres=0.15),
    "GP": dict(res=0.05, kd=0.30, dmg=0.25, orr=0.30, pres=0.10),
    "Tandem": dict(res=0.05, kd=0.15, dmg=0.40, orr=0.30, pres=0.10),
    "Sap": dict(res=0.10, kd=0.15, dmg=0.30, orr=0.35, pres=0.10),
    "CMD": dict(res=0.05, kd=0.05, dmg=0.10, orr=0.50, pres=0.30),
}
# Which metrics count as "best" (yellow) per role
BEST_KEYS = {
    "Medic": ["fit", "res_g", "orr", "g"],
    "Rifle": ["fit", "kd", "dmg_g", "orr"],
    "GP": ["fit", "kd", "dmg_g", "orr"],
    "Tandem": ["fit", "dmg_g", "kd", "orr"],
    "Crew": ["fit", "dmg_g", "kd", "orr"],
    "Sap": ["fit", "dmg_g", "orr", "res_g"],
    "CMD": ["fit", "orr", "g", "dmg_g"],
    "SL": ["fit", "orr", "kd", "dmg_g"],
}

PROMOTE_STRONG = 95.0
PROMOTE_ALMOST = 90.0
HOLD = 85.0
WARN = 75.0
MIN_G_ACTIVE = 8
MIN_G_BENCH = 4

# Мехвод: часть заслуг экипажа → водителю, если оба на табло одной КВ-встречи.
# ORR не трогаем — только kills/dmg для Fit.
CREW_SHARE = {
    "alpha": 0.35,
    "pairs": [
        {"driver": "Gadler", "gunners": ["Tankist", "Kuchenchips"]},
    ],
    "note": "Мех-шаринг: водитель получает 35% kills/dmg напарника (Tankist/Kuchenchips), если оба в одной встрече. ORR без изменений.",
}


def nick_key(n: str) -> str:
    return n.strip().lower().replace("  ", " ")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve(url: str) -> Path:
    u = url.replace("\\", "/").lstrip("/")
    return KV / u if u.startswith("data/") else DATA / u


def main() -> None:
    tiers_data = load_json(DATA / "tiers.json")
    aliases = tiers_data.get("aliases") or {}
    orr = load_json(DATA / "orr.json")
    orr_by = {k.lower(): v for k, v in (orr.get("byNick") or {}).items()}
    for p in orr.get("players") or []:
        orr_by[str(p.get("nick") or "").lower()] = p.get("orr")

    log_role: dict[str, str] = {}
    if ORR_DETAIL.is_file():
        detail = load_json(ORR_DETAIL)
        for block in detail.get("tiers", {}).values():
            for row in block.get("ranked") or []:
                nick = row.get("nick")
                top = row.get("log_top") or []
                if nick and top:
                    fam = top[0][0] if isinstance(top[0], (list, tuple)) else top[0]
                    log_role[nick_key(nick)] = str(fam)

    def canon(n: str) -> str:
        return aliases.get(nick_key(n), n.strip())

    def tier_of(nick: str) -> int:
        for t, key in ((1, "tier1"), (2, "tier2"), (3, "tier3")):
            if nick in (tiers_data.get(key) or []):
                return t
        return 4

    def role_of(nick: str) -> str:
        if nick in T1_KIT:
            return T1_KIT[nick]
        return FAM_MAP.get(log_role.get(nick_key(nick), ""), "Rifle")

    # meetings chronological with stats
    index = load_json(DATA / "index.json")
    meetings_raw: list[dict[str, Any]] = []
    for mref in index.get("months") or []:
        month_id = str(mref.get("id") or "")
        year = int(mref.get("year") or month_id.split("-")[0])
        month_n = int(mref.get("month") or month_id.split("-")[1])
        month = load_json(resolve(mref["url"]))
        for match in month.get("matches") or []:
            pu = match.get("playersUrl") or ""
            if not pu or "training" in pu:
                continue
            pp = resolve(pu)
            if not pp.is_file():
                pp = DATA / "players" / Path(pu).name
            if not pp.is_file():
                continue
            day = int(match.get("day") or 0)
            mid = str(match.get("id") or Path(pu).stem)
            ymd = f"{year:04d}-{month_n:02d}-{day:02d}"
            meetings_raw.append(
                {
                    "id": mid,
                    "ymd": ymd,
                    "year": year,
                    "month": month_n,
                    "day": day,
                    "opp": match.get("opp") or "",
                    "path": str(pp),
                }
            )
    meetings_raw.sort(key=lambda m: (m["ymd"], m["id"]))

    # per nick per meeting aggregates + totals
    by_nick_meet: dict[str, dict[str, dict[str, int]]] = defaultdict(dict)
    nick_canon: dict[str, str] = {}

    meetings_out = []
    for m in meetings_raw:
        pdata = load_json(Path(m["path"]))
        seen_rounds = 0
        for rk in ("r1", "r2"):
            rows = pdata.get(rk) or []
            if not rows:
                continue
            seen_rounds += 1
            for row in rows:
                n = canon(str(row.get("nick") or ""))
                if not n:
                    continue
                k = nick_key(n)
                nick_canon[k] = n
                slot = by_nick_meet[k].setdefault(
                    m["id"],
                    {"res": 0, "nok": 0, "kills": 0, "deaths": 0, "dmg": 0, "rounds": 0},
                )
                slot["rounds"] += 1
                for f in ("res", "nok", "kills", "deaths", "dmg"):
                    slot[f] += int(row.get(f) or 0)
        meetings_out.append(
            {
                "id": m["id"],
                "ymd": m["ymd"],
                "year": m["year"],
                "month": m["month"],
                "day": m["day"],
                "opp": m["opp"],
                "rounds": seen_rounds,
            }
        )

    meeting_ids = [m["id"] for m in meetings_out]
    max_rounds_all = sum(m["rounds"] for m in meetings_out) or 1

    def compute_for_meeting_ids(selected_ids: list[str]) -> dict[str, Any]:
        sel = set(selected_ids)
        max_rounds = sum(m["rounds"] for m in meetings_out if m["id"] in sel) or 1

        # nick_key -> mid -> slot (for crew share lookup)
        meet_lookup = {
            k: {mid: slot for mid, slot in meets.items() if mid in sel}
            for k, meets in by_nick_meet.items()
        }
        share_alpha = float(CREW_SHARE.get("alpha") or 0)
        driver_gunners: dict[str, list[str]] = {}
        for pair in CREW_SHARE.get("pairs") or []:
            d = nick_key(str(pair.get("driver") or ""))
            guns = [nick_key(g) for g in (pair.get("gunners") or []) if g]
            if d and guns:
                driver_gunners[d] = guns

        players: list[dict[str, Any]] = []
        for k, meets in by_nick_meet.items():
            nick = nick_canon[k]
            tot = {"res": 0, "nok": 0, "kills": 0, "deaths": 0, "dmg": 0, "rounds": 0}
            used = 0
            share_meets = 0
            share_k = 0.0
            share_dmg = 0.0
            for mid, slot in meets.items():
                if mid not in sel:
                    continue
                used += 1
                for f in tot:
                    tot[f] += slot[f]
                if share_alpha > 0 and k in driver_gunners:
                    best = None
                    best_dmg = -1
                    for gk in driver_gunners[k]:
                        gslot = (meet_lookup.get(gk) or {}).get(mid)
                        if not gslot:
                            continue
                        gd = int(gslot.get("dmg") or 0)
                        if gd > best_dmg:
                            best_dmg = gd
                            best = gslot
                    if best is not None:
                        share_meets += 1
                        sk = share_alpha * float(best.get("kills") or 0)
                        sd = share_alpha * float(best.get("dmg") or 0)
                        share_k += sk
                        share_dmg += sd
                        tot["kills"] += sk
                        tot["dmg"] += sd
            if tot["rounds"] < 1:
                continue
            g = tot["rounds"]
            players.append(
                {
                    "nick": nick,
                    "tier": tier_of(nick),
                    "role": role_of(nick),
                    "g": g,
                    "meetings": used,
                    "res_g": round(tot["res"] / g, 2),
                    "kd": round(tot["kills"] / max(tot["deaths"], 1), 2),
                    "dmg_g": round(tot["dmg"] / g, 1),
                    "kills_g": round(tot["kills"] / g, 2),
                    "orr": orr_by.get(k) or 0,
                    "pres": round(g / max_rounds, 3),
                    "pause": False,
                    "crewShareMeets": share_meets,
                    "crewShareK": round(share_k, 1),
                    "crewShareDmg": round(share_dmg, 1),
                }
            )

        def build_bench(target_tier: int) -> dict[str, Any]:
            pools: dict[str, list] = defaultdict(list)
            for p in players:
                if p["tier"] != target_tier:
                    continue
                if target_tier == 1 and p["role"] == "Medic" and p["res_g"] < 4:
                    continue
                if p["g"] >= MIN_G_BENCH:
                    pools[p["role"]].append(p)
            out = {}
            for role, rows in pools.items():
                active = [r for r in rows if r["g"] >= MIN_G_ACTIVE]
                src = active if len(active) >= 2 else rows
                if not src:
                    continue
                out[role] = {
                    "n": len(src),
                    "thin": len(src) < 2,
                    "who": [r["nick"] for r in sorted(src, key=lambda x: -x["orr"])[:6]],
                    "res_g": median([r["res_g"] for r in src]),
                    "kd": median([r["kd"] for r in src]),
                    "dmg_g": median([r["dmg_g"] for r in src]),
                    "orr": median([r["orr"] for r in src if r["orr"]] or [0]),
                }
            return out

        benches = {1: build_bench(1), 2: build_bench(2), 3: build_bench(3)}

        def fit_to(p: dict, bench: dict, role: str) -> float | None:
            if role not in bench or role not in W:
                return None
            b = bench[role]

            def f(val, tgt):
                if not tgt:
                    return 0.0
                return min(100.0, 100.0 * float(val) / float(tgt))

            comps = {
                "res": f(p["res_g"], b["res_g"]),
                "kd": f(p["kd"], b["kd"]),
                "dmg": f(p["dmg_g"], b["dmg_g"]),
                "orr": f(p["orr"], b["orr"] or 1),
                "pres": f(p["pres"], 0.45),
            }
            if role == "Medic":
                comps["kd"] = min(comps["kd"], 50.0)
            return round(sum(W[role][k] * comps[k] for k in W[role]), 1)

        # enrich players with fits
        for p in players:
            role = p["role"] if p["role"] in W else "Rifle"
            p["role"] = role
            p["roleLabel"] = ROLE_LABEL.get(role, role)
            p["pause"] = p["tier"] in (1, 2, 3) and p["g"] < MIN_G_ACTIVE
            p["fitOwn"] = (
                fit_to(p, benches[p["tier"]], role) if p["tier"] in benches else None
            )
            p["fitT1"] = fit_to(p, benches[1], role) if 1 in benches else None
            p["fitT2"] = fit_to(p, benches[2], role) if 2 in benches else None
            p["fitT3"] = fit_to(p, benches[3], role) if 3 in benches else None

        # role boards per tier: members of that tier + near candidates (fit to that tier >= 80)
        tier_boards: dict[str, Any] = {}
        for t in (1, 2, 3, 4):
            roles_block = {}
            for role in ROLE_ORDER:
                rows = [
                    p
                    for p in players
                    if p["role"] == role
                    and (
                        p["tier"] == t
                        or (
                            t < 4
                            and p["tier"] > t
                            and (p.get(f"fitT{t}") or 0) >= 80
                        )
                        or (t == 4 and p["tier"] == 4)
                    )
                ]
                if t == 4:
                    rows = [p for p in players if p["role"] == role and p["tier"] == 4]
                # Fit column = fit to this tier's bench (for T4 use fitT3 as aspire)
                fit_key = f"fitT{t}" if t <= 3 else "fitT3"
                enriched = []
                for p in rows:
                    fit = p.get(fit_key)
                    if t == p["tier"] and p.get("fitOwn") is not None:
                        fit = p["fitOwn"]
                    if fit is None:
                        continue
                    enriched.append({**p, "fit": fit})
                enriched.sort(key=lambda x: (-x["fit"], x["nick"].lower()))
                if not enriched:
                    continue
                # best-in-tier among those with tier==t
                in_tier = [r for r in enriched if r["tier"] == t and not r["pause"]]
                best_nick = None
                if in_tier:
                    best_nick = max(in_tier, key=lambda x: x["fit"])["nick"]
                keys = BEST_KEYS.get(role, ["fit", "orr"])
                rec = {}
                for key in keys:
                    rec[key] = max(r[key] for r in enriched if r.get(key) is not None)
                bench = benches.get(t, {}).get(role) if t <= 3 else benches.get(3, {}).get(role)
                roles_block[role] = {
                    "role": role,
                    "roleLabel": ROLE_LABEL[role],
                    "bench": bench,
                    "bestInTier": best_nick,
                    "records": rec,
                    "rows": [
                        {
                            "nick": r["nick"],
                            "tier": r["tier"],
                            "fit": r["fit"],
                            "res_g": r["res_g"],
                            "kd": r["kd"],
                            "dmg_g": r["dmg_g"],
                            "orr": r["orr"],
                            "g": r["g"],
                            "pause": r["pause"],
                            "bestInTier": r["nick"] == best_nick,
                        }
                        for r in enriched[:12]
                    ],
                }
            tier_boards[str(t)] = roles_block

        # candidates
        promote = []
        for p in players:
            if p["tier"] >= 4:
                # to T3
                fit = p.get("fitT3")
                target = 3
            elif p["tier"] == 3:
                fit = p.get("fitT2")
                target = 2
            elif p["tier"] == 2:
                fit = p.get("fitT1")
                target = 1
            else:
                continue
            if fit is None or fit < PROMOTE_ALMOST:
                continue
            if p["g"] < MIN_G_ACTIVE and p["tier"] != 4:
                continue
            promote.append(
                {
                    "nick": p["nick"],
                    "fromTier": p["tier"],
                    "toTier": target,
                    "role": p["role"],
                    "roleLabel": p["roleLabel"],
                    "fit": fit,
                    "band": "strong" if fit >= PROMOTE_STRONG else "almost",
                    "g": p["g"],
                    "res_g": p["res_g"],
                    "kd": p["kd"],
                    "dmg_g": p["dmg_g"],
                    "orr": p["orr"],
                }
            )
        # also T4->T3 already; T3->T2; need T4 who fit T2? only +1
        promote.sort(key=lambda x: (-x["fit"], x["fromTier"], x["nick"].lower()))

        demote = []
        warn = []
        for p in players:
            if p["tier"] not in (1, 2, 3):
                continue
            if p["pause"]:
                continue
            fit = p.get("fitOwn")
            if fit is None:
                continue
            row = {
                "nick": p["nick"],
                "fromTier": p["tier"],
                "toTier": p["tier"] + 1,
                "role": p["role"],
                "roleLabel": p["roleLabel"],
                "fit": fit,
                "g": p["g"],
                "res_g": p["res_g"],
                "kd": p["kd"],
                "dmg_g": p["dmg_g"],
                "orr": p["orr"],
            }
            if fit < WARN:
                demote.append(row)
            elif fit < HOLD:
                warn.append(row)
        demote.sort(key=lambda x: (x["fit"], x["nick"].lower()))
        warn.sort(key=lambda x: (x["fit"], x["nick"].lower()))

        # analytics
        by_tier_counts = {1: 0, 2: 0, 3: 0, 4: 0}
        pause_n = 0
        fit_own_vals = []
        for p in players:
            by_tier_counts[p["tier"]] = by_tier_counts.get(p["tier"], 0) + 1
            if p["pause"]:
                pause_n += 1
            if p.get("fitOwn") is not None and not p["pause"]:
                fit_own_vals.append(p["fitOwn"])

        role_gap = []
        for role in ROLE_ORDER:
            t1s = [p for p in players if p["tier"] == 1 and p["role"] == role and not p["pause"]]
            t2s = [p for p in players if p["tier"] == 2 and p["role"] == role and p["g"] >= MIN_G_ACTIVE]
            if not t1s or not t2s:
                continue
            role_gap.append(
                {
                    "role": role,
                    "roleLabel": ROLE_LABEL[role],
                    "t1MedianFit": round(median([p["fitOwn"] for p in t1s if p.get("fitOwn") is not None] or [0]), 1),
                    "bestT2FitT1": round(max((p.get("fitT1") or 0) for p in t2s), 1),
                    "bestT2": max(t2s, key=lambda x: x.get("fitT1") or 0)["nick"],
                }
            )

        return {
            "meetingIds": selected_ids,
            "meetingCount": len(selected_ids),
            "maxRounds": max_rounds,
            "benches": {str(k): v for k, v in benches.items()},
            "tierBoards": tier_boards,
            "candidates": {"promote": promote, "demote": demote, "warn": warn},
            "analytics": {
                "playersInScope": len(players),
                "byTier": by_tier_counts,
                "pauseCount": pause_n,
                "medianFitOwn": round(median(fit_own_vals), 1) if fit_own_vals else None,
                "promoteCount": len(promote),
                "demoteCount": len(demote),
                "warnCount": len(warn),
                "roleGap": role_gap,
                "topFitT1": sorted(
                    [
                        {
                            "nick": p["nick"],
                            "tier": p["tier"],
                            "roleLabel": p["roleLabel"],
                            "fit": p["fitT1"],
                        }
                        for p in players
                        if p.get("fitT1") is not None
                    ],
                    key=lambda x: -x["fit"],
                )[:10],
            },
            "players": players,
        }

    snapshot = compute_for_meeting_ids(meeting_ids)

    # compact raw for client re-filter
    raw_players = []
    for k, meets in by_nick_meet.items():
        raw_players.append(
            {
                "nick": nick_canon[k],
                "tier": tier_of(nick_canon[k]),
                "role": role_of(nick_canon[k]),
                "orr": orr_by.get(k) or 0,
                "meets": {
                    mid: {
                        "r": s["rounds"],
                        "res": s["res"],
                        "k": s["kills"],
                        "d": s["deaths"],
                        "dmg": s["dmg"],
                    }
                    for mid, s in meets.items()
                },
            }
        )

    payload = {
        "updatedAt": date.today().isoformat(),
        "source": "CW players only — training excluded",
        "thresholds": {
            "promoteStrong": PROMOTE_STRONG,
            "promoteAlmost": PROMOTE_ALMOST,
            "hold": HOLD,
            "warn": WARN,
            "minGamesActive": MIN_G_ACTIVE,
        },
        "roleOrder": ROLE_ORDER,
        "roleLabels": ROLE_LABEL,
        "bestKeys": BEST_KEYS,
        "weights": W,
        "crewShare": CREW_SHARE,
        "meetings": meetings_out,
        "rawPlayers": raw_players,
        "snapshot": snapshot,
        "note": "Fit% = доля от медианы текущего тира по роли. Жёлтый = рекорд в группе. Лучший в тире — top Fit среди членов тира.",
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUT} meetings={len(meetings_out)} players={len(raw_players)} "
        f"promote={len(snapshot['candidates']['promote'])} demote={len(snapshot['candidates']['demote'])}"
    )


if __name__ == "__main__":
    main()
