#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tier Fitness Score (TFS) — только КВ.

Канон: platform/docs/TFS-CW.md
Выход: KV/public/data/tfs-cw.json

Usage:
  python platform/scripts/tier_tfs_cw.py
  python platform/scripts/tier_tfs_cw.py --print-chat
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
KV = ROOT / "KV" / "public"
DATA = KV / "data"
OUT_JSON = DATA / "tfs-cw.json"
ORR_DETAIL = HERE / "_tmp_orr_v21_perf.json"

WINDOW_MEETINGS = 12
MIN_ROUNDS = 8
THRESH_PROMOTE = 82.0
THRESH_HOLD_T1 = 72.0
THRESH_HOLD_T2 = 60.0

TARGET = {
    "res": 8.0,
    "kd": 2.0,
    "dmg": 350.0,
    "kills": 8.0,
    "surv": 0.30,
    "pres": 0.70,
    "nok": 6.0,
}

WEIGHTS: dict[str, dict[str, float]] = {
    "CMD": dict(res=0.05, kd=0.00, dmg=0.05, kills=0.05, surv=0.15, pres=0.50, nok=0.20),
    "SL": dict(res=0.10, kd=0.10, dmg=0.20, kills=0.10, surv=0.15, pres=0.25, nok=0.10),
    "MEDIC": dict(res=0.55, kd=0.05, dmg=0.05, kills=0.05, surv=0.15, pres=0.15, nok=0.00),
    "RIFLE": dict(res=0.05, kd=0.40, dmg=0.25, kills=0.15, surv=0.05, pres=0.10, nok=0.00),
    "GP": dict(res=0.05, kd=0.35, dmg=0.30, kills=0.15, surv=0.05, pres=0.10, nok=0.00),
    "MG": dict(res=0.05, kd=0.35, dmg=0.30, kills=0.15, surv=0.05, pres=0.10, nok=0.00),
    "AT_HEAVY": dict(res=0.05, kd=0.15, dmg=0.45, kills=0.15, surv=0.05, pres=0.15, nok=0.00),
    "AT_LIGHT": dict(res=0.05, kd=0.15, dmg=0.45, kills=0.15, surv=0.05, pres=0.15, nok=0.00),
    "CREW": dict(res=0.05, kd=0.15, dmg=0.50, kills=0.15, surv=0.05, pres=0.10, nok=0.00),
    "SAPPER": dict(res=0.10, kd=0.15, dmg=0.35, kills=0.15, surv=0.10, pres=0.15, nok=0.00),
    "OTHER": dict(res=0.05, kd=0.25, dmg=0.25, kills=0.15, surv=0.10, pres=0.15, nok=0.05),
}

FLOOR: dict[str, tuple[str, float]] = {
    "MEDIC": ("res_g", 5.5),
    "RIFLE": ("kd", 1.50),
    "GP": ("kd", 1.60),
    "MG": ("kd", 1.50),
    "AT_HEAVY": ("dmg_g", 300.0),
    "AT_LIGHT": ("dmg_g", 300.0),
    "CREW": ("dmg_g", 300.0),
    "SAPPER": ("dmg_g", 200.0),
    "CMD": ("pres", 0.55),
    "SL": ("pres", 0.50),
}

ROLE_LABEL = {
    "CMD": "CMD",
    "SL": "Командир отряда",
    "MEDIC": "Медик",
    "RIFLE": "Стрелок",
    "GP": "ГП",
    "MG": "Пулемёт",
    "AT_HEAVY": "Тандем",
    "AT_LIGHT": "Лёгкая труба",
    "CREW": "Водитель (техника)",
    "SAPPER": "Сапёр",
    "OTHER": "Прочее",
}

# Канон основной роли T1 (капитан)
T1_PRIMARY_KIT: dict[str, str] = {
    "LordWolf": "Сапёр",
    "Gadler": "Водитель (техника)",
    "Chidori": "CMD",
    "Hikkomaru": "Тандем",
    "CAT": "Командир отряда",
    "Morty": "Медик",
    "lepurple": "Медик",
    "Mukuru": "Командир отряда",
    "Summer": "Командир отряда",
    "Pymba": "ГП",
    "Keech": "CMD",
    "Kuchenchips": "Водитель (техника)",
    "angel": "Стрелок",
    "Blizzardrix": "Сапёр",
    "Diray": "Стрелок",
    "S.M.P": "Тандем",
    "iKEppA": "Стрелок",
    "Treppen": "Командир отряда",
    "Runetik": "Стрелок",
    "JESTER": "Стрелок",
    "AkiN": "ГП",
    "KillReal": "Медик",
    "GAD": "Водитель (техника)",
}


def nick_key(n: str) -> str:
    return n.strip().lower().replace("  ", " ")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_data_url(url: str) -> Path:
    u = url.replace("\\", "/").lstrip("/")
    if u.startswith("data/"):
        return KV / u
    return DATA / u


def kit_to_bucket(role: str) -> str:
    r = (role or "").lower()
    if r == "cmd" or r.startswith("cmd"):
        return "CMD"
    if "командир отряда" in r:
        return "SL"
    if "медик" in r:
        return "MEDIC"
    if "сапёр" in r or "сапер" in r:
        return "SAPPER"
    if "тандем" in r:
        return "AT_HEAVY"
    if "лёгкая труба" in r or "легкая труба" in r:
        return "AT_LIGHT"
    if r == "гп" or "гранат" in r or "подствол" in r:
        return "GP"
    if "пулемёт" in r or "пулемет" in r:
        return "MG"
    if "водитель" in r or "наводчик" in r or "техника" in r:
        return "CREW"
    if "стрелок" in r:
        return "RIFLE"
    return "OTHER"


def deploy_family_to_bucket(fam: str) -> str:
    f = (fam or "").upper()
    if f == "CMD":
        return "CMD"
    if f in ("SL", "FTL"):
        return "SL"
    if f == "MEDIC":
        return "MEDIC"
    if f == "HAT":
        return "AT_HEAVY"
    if f == "LAT":
        return "AT_LIGHT"
    if f == "CREW":
        return "CREW"
    if f == "RIFLE":
        return "RIFLE"
    return "OTHER"


def load_log_roles() -> dict[str, str]:
    """nick_key -> TFS bucket from ORR detail log_top."""
    out: dict[str, str] = {}
    if not ORR_DETAIL.is_file():
        return out
    try:
        detail = load_json(ORR_DETAIL)
    except OSError:
        return out
    for block in detail.get("tiers", {}).values():
        for row in block.get("ranked") or []:
            nick = str(row.get("nick") or "").strip()
            if not nick:
                continue
            top = row.get("log_top") or []
            if not top:
                continue
            fam = str(top[0][0] if isinstance(top[0], (list, tuple)) else top[0])
            out[nick_key(nick)] = deploy_family_to_bucket(fam)
    return out


def resolve_role_bucket(canon_nick: str, log_roles: dict[str, str]) -> str:
    k = nick_key(canon_nick)
    if canon_nick in T1_PRIMARY_KIT:
        return kit_to_bucket(T1_PRIMARY_KIT[canon_nick])
    if k in log_roles:
        return log_roles[k]
    return "RIFLE"


def iter_cw_meetings() -> list[dict[str, Any]]:
    index = load_json(DATA / "index.json")
    meetings: list[dict[str, Any]] = []
    for mref in index.get("months") or []:
        month_id = str(mref.get("id") or "")
        url = mref.get("url") or ""
        month_path = resolve_data_url(url) if url else None
        if not month_path or not month_path.is_file():
            continue
        month = load_json(month_path)
        for match in month.get("matches") or []:
            meetings.append({**match, "_month": month_id})
        for day in month.get("days") or []:
            for match in day.get("matches") or []:
                meetings.append({**match, "_month": month_id})
    meetings.sort(
        key=lambda m: (
            str(m.get("_month") or ""),
            int(m.get("day") or 0),
            str(m.get("id") or ""),
        )
    )
    return meetings


def load_players_file(pu: str) -> dict[str, Any] | None:
    if not pu or "training" in pu:
        return None
    pp = resolve_data_url(pu)
    if not pp.is_file():
        alt = DATA / "players" / Path(pu).name
        if alt.is_file():
            pp = alt
        else:
            return None
    return load_json(pp)


def lin_component(value: float, target: float) -> float:
    if target <= 0:
        return 0.0
    return max(0.0, min(100.0, 100.0 * float(value) / target))


def compute_tfs(
    role: str,
    stats: dict[str, float],
) -> tuple[float, dict[str, float], bool, list[str]]:
    w = WEIGHTS.get(role) or WEIGHTS["OTHER"]
    comps = {
        "res": lin_component(stats["res_g"], TARGET["res"]),
        "kd": lin_component(stats["kd"], TARGET["kd"]),
        "dmg": lin_component(stats["dmg_g"], TARGET["dmg"]),
        "kills": lin_component(stats["kills_g"], TARGET["kills"]),
        "surv": lin_component(stats["surv"], TARGET["surv"]),
        "pres": lin_component(stats["pres"], TARGET["pres"]),
        "nok": lin_component(stats["nok_g"], TARGET["nok"]),
    }
    tfs = sum(w[k] * comps[k] for k in w)
    reasons: list[str] = []
    min_g_ok = stats["rounds"] >= MIN_ROUNDS
    if not min_g_ok:
        reasons.append(f"мало раундов КВ ({int(stats['rounds'])} < {MIN_ROUNDS})")
    if not stats.get("activity_ok", True):
        reasons.append("активность: нет 2 из последних 3 КВ")
    floor_ok = True
    if role in FLOOR:
        fkey, fval = FLOOR[role]
        raw = stats
        if raw.get(fkey, 0) < fval:
            floor_ok = False
            reasons.append(f"пол {fkey} {raw.get(fkey):.2f} < {fval}")
    gates_ok = min_g_ok and stats.get("activity_ok", True) and floor_ok
    if not gates_ok:
        verdict = "FAIL_GATE"
    elif tfs >= THRESH_PROMOTE:
        verdict = "PROMOTE_T1"
    elif tfs >= THRESH_HOLD_T1:
        verdict = "HOLD_T1"
    elif tfs >= THRESH_HOLD_T2:
        verdict = "HOLD_T2"
    else:
        verdict = "AT_RISK"
    if verdict in ("PROMOTE_T1", "HOLD_T1") and not gates_ok:
        verdict = "FAIL_GATE"
    return round(tfs, 1), comps, gates_ok, reasons, verdict


def roster_tier(nick: str, tiers_data: dict[str, Any]) -> int:
    for t, key in ((1, "tier1"), (2, "tier2"), (3, "tier3")):
        if nick in tiers_data.get(key) or []:
            return t
    return 4


def suggest_tier_change(current: int, verdict: str, gates_ok: bool) -> int | None:
    if not gates_ok and current == 1 and verdict == "FAIL_GATE":
        return 2
    if verdict == "AT_RISK" and current == 1:
        return 2
    if verdict == "PROMOTE_T1" and gates_ok and current >= 2:
        return current - 1
    if verdict == "PROMOTE_T1" and gates_ok and current == 4:
        return 3
    if verdict == "HOLD_T1" and gates_ok and current == 2:
        return None
    return None


def build_report() -> dict[str, Any]:
    tiers_data = load_json(DATA / "tiers.json")
    aliases = tiers_data.get("aliases") or {}

    def canon(n: str) -> str:
        return aliases.get(nick_key(n), n.strip())

    log_roles = load_log_roles()
    all_meetings = iter_cw_meetings()
    with_stats = [m for m in all_meetings if load_players_file(m.get("playersUrl") or "")]
    window = with_stats[-WINDOW_MEETINGS:] if with_stats else []
    meeting_ids = [str(m.get("id") or Path(m.get("playersUrl") or "").stem) for m in window]

    # per-nick round stats in window + per-meeting presence
    agg: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "rounds": 0,
            "res": 0,
            "nok": 0,
            "kills": 0,
            "deaths": 0,
            "dmg": 0,
            "meetings_seen": set(),
            "nick": "",
        }
    )
    max_rounds = 0
    for match in window:
        pu = match.get("playersUrl") or ""
        pdata = load_players_file(pu)
        if not pdata:
            continue
        for rk in ("r1", "r2"):
            if pdata.get(rk):
                max_rounds += 1

    for mi, match in enumerate(window):
        pu = match.get("playersUrl") or ""
        pdata = load_players_file(pu)
        if not pdata:
            continue
        mid = str(match.get("id") or Path(pu).stem)
        for rk in ("r1", "r2"):
            rows = pdata.get(rk) or []
            if not rows:
                continue
            seen_this_meeting: set[str] = set()
            for p in rows:
                raw_nick = str(p.get("nick") or "").strip()
                if not raw_nick:
                    continue
                n = canon(raw_nick)
                k = nick_key(n)
                row = agg[k]
                row["nick"] = n
                row["rounds"] += 1
                seen_this_meeting.add(k)
                for f in ("res", "nok", "kills", "deaths", "dmg"):
                    row[f] += int(p.get(f) or 0)
            for k in seen_this_meeting:
                agg[k]["meetings_seen"].add(mid)

    last_three = window[-3:] if len(window) >= 3 else window[:]
    last_three_ids = [
        str(m.get("id") or Path(m.get("playersUrl") or "").stem) for m in last_three
    ]

    def activity_ok(meetings_seen: set[str]) -> bool:
        if len(last_three) < 3:
            return True
        hit = sum(1 for mid in last_three_ids if mid in meetings_seen)
        return hit >= 2

    players_out: list[dict[str, Any]] = []
    for k, row in agg.items():
        n = row["nick"] or k
        g = max(1, row["rounds"])
        stats = {
            "rounds": float(row["rounds"]),
            "res_g": row["res"] / g,
            "nok_g": row["nok"] / g,
            "kills_g": row["kills"] / g,
            "deaths_g": row["deaths"] / g,
            "dmg_g": row["dmg"] / g,
            "kd": row["kills"] / max(row["deaths"], 1),
            "surv": 1.0 / (row["deaths"] / g + 0.5),
            "pres": row["rounds"] / max(max_rounds, 1),
            "activity_ok": activity_ok(row["meetings_seen"]),
        }
        role = resolve_role_bucket(n, log_roles)
        tfs, comps, gates_ok, reasons, verdict = compute_tfs(role, stats)
        cur = roster_tier(n, tiers_data)
        suggested = suggest_tier_change(cur, verdict, gates_ok)
        players_out.append(
            {
                "nick": n,
                "roleBucket": role,
                "roleLabel": ROLE_LABEL.get(role, role),
                "currentTier": cur,
                "tfs": tfs,
                "verdict": verdict,
                "gatesOk": gates_ok,
                "suggestedTier": suggested,
                "rounds": int(row["rounds"]),
                "meetingsInWindow": len(row["meetings_seen"]),
                "stats": {
                    "res_g": round(stats["res_g"], 2),
                    "kd": round(stats["kd"], 2),
                    "dmg_g": round(stats["dmg_g"], 1),
                    "pres": round(stats["pres"], 2),
                },
                "components": {k: round(v, 1) for k, v in comps.items()},
                "notes": reasons,
            }
        )

    players_out.sort(key=lambda x: (-x["tfs"], x["nick"].lower()))

    candidates: list[dict[str, Any]] = []
    for p in players_out:
        st = p.get("suggestedTier")
        if st is None or st == p["currentTier"]:
            continue
        action = "promote" if st < p["currentTier"] else "demote"
        candidates.append(
            {
                "nick": p["nick"],
                "action": action,
                "fromTier": p["currentTier"],
                "toTier": st,
                "tfs": p["tfs"],
                "verdict": p["verdict"],
                "roleLabel": p["roleLabel"],
                "reason": "; ".join(p["notes"]) if p["notes"] else p["verdict"],
            }
        )

    return {
        "updatedAt": date.today().isoformat(),
        "source": "KV CW players only — training excluded",
        "windowMeetings": WINDOW_MEETINGS,
        "meetingsUsed": meeting_ids,
        "meetingsCount": len(window),
        "maxRoundsInWindow": max_rounds,
        "thresholds": {
            "promoteT1": THRESH_PROMOTE,
            "holdT1": THRESH_HOLD_T1,
            "holdT2": THRESH_HOLD_T2,
            "minRounds": MIN_ROUNDS,
        },
        "players": players_out,
        "candidates": candidates,
        "note": "Полуавто: candidates — предложения; tiers.json меняет только капитан.",
    }


def format_chat(report: dict[str, Any]) -> str:
    lines = [
        "**TFS (только КВ)** — кандидаты на перевод (полуавто, без автоприменения):",
        f"Окно: {report.get('meetingsCount')} встреч, обновлено {report.get('updatedAt')}.",
        "",
    ]
    cands = report.get("candidates") or []
    if not cands:
        lines.append("Кандидатов на ±1 тир нет.")
    else:
        for c in cands:
            arrow = "↑" if c["action"] == "promote" else "↓"
            lines.append(
                f"- {c['nick']} {arrow} T{c['fromTier']}→T{c['toTier']} "
                f"(TFS {c['tfs']}, {c['roleLabel']}) — {c['reason']}"
            )
    lines.append("")
    lines.append("Топ TFS (T1 roster):")
    tiers = load_json(DATA / "tiers.json")
    t1 = set(tiers.get("tier1") or [])
    top_t1 = [p for p in report.get("players") or [] if p["nick"] in t1]
    top_t1.sort(key=lambda x: -x["tfs"])
    for p in top_t1[:8]:
        lines.append(
            f"- {p['nick']}: {p['tfs']} ({p['verdict']}, {p['roleLabel']})"
        )
    at_risk = [
        p
        for p in report.get("players") or []
        if p["nick"] in t1 and p["verdict"] in ("FAIL_GATE", "AT_RISK")
    ]
    if at_risk:
        lines.append("")
        lines.append("T1 под риском / gate:")
        for p in at_risk:
            lines.append(
                f"- {p['nick']}: {p['tfs']} — {', '.join(p['notes']) or p['verdict']}"
            )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="CW Tier Fitness Score")
    parser.add_argument(
        "--print-chat",
        action="store_true",
        help="Print markdown block for Alex chat",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=OUT_JSON,
        help="Output JSON path",
    )
    args = parser.parse_args()
    report = build_report()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {args.out} ({len(report.get('players') or [])} players, "
          f"{len(report.get('candidates') or [])} candidates)")
    if args.print_chat:
        print()
        print(format_chat(report))


if __name__ == "__main__":
    main()
