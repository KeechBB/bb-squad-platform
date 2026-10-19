# -*- coding: utf-8 -*-
"""
Post-ingest RP integrity checks (public + train).

Verifies for each scored match:
  - netByNick == signed sum of events (v2 ledger rules)
  - vehicle_kill delta == tickets × 12.5 × gainCoef
  - driver_share(vehicle_kill) ≈ 70% of gunner kill (soft-cap tolerant)
  - hist.vehicleKills == count of vehicle_kill events (when hist present)

Does not invent RP — only detects drift / pairing bugs after score_match_rp.

Also checks vehicle *ticket class* from Asset Name (e.g. BP_2A6 must be 15,
not default 5) so unknown tanks/boats are caught right after each PB1/TR score.
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

try:
    import rp_log_parse as R  # noqa: E402
except Exception:  # pragma: no cover
    R = None  # type: ignore

VEHICLE_DRIVER_SHARE = 0.7
NET_EPS = 0.08
FORMULA_EPS = 0.15
SHARE_EPS = 0.08
TICKET_CLASS_KINDS = frozenset(
    {"vehicle_kill", "vehicle_loss", "vehicle_loss_driver", "driver_share"}
)


@dataclass
class NickDiff:
    nick: str
    claimed: float
    recomputed: float
    diff: float


@dataclass
class MatchAudit:
    id: str
    map: str = ""
    date: str = ""
    ok: bool = True
    events: int = 0
    players: int = 0
    net_ok: int = 0
    net_bad: int = 0
    net_diffs: list[NickDiff] = field(default_factory=list)
    vehicle_kill: int = 0
    formula_ok: int = 0
    formula_bad: int = 0
    formula_issues: list[dict] = field(default_factory=list)
    share_veh: int = 0
    share_ok: int = 0
    share_bad: int = 0
    share_issues: list[dict] = field(default_factory=list)
    veh_without_share: int = 0
    hist_veh_mismatches: list[dict] = field(default_factory=list)
    ticket_class_ok: int = 0
    ticket_class_bad: int = 0
    ticket_class_issues: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def _event_vehicle_asset(e: dict) -> str:
    asset = str(e.get("vehicle") or "").strip()
    if asset.startswith("BP_"):
        return asset
    kind = str(e.get("kind") or "")
    if kind in ("vehicle_kill", "vehicle_loss", "vehicle_loss_driver"):
        killer = str(e.get("killer") or "").strip()
        if killer.startswith("BP_"):
            return killer
    return asset if asset.startswith("BP_") else ""


def _recompute_nets(events: list[dict]) -> dict[str, float]:
    """Signed RP by display nick from ledger events (score_match_rp v2 signs)."""
    acc: dict[str, float] = {}

    def add(nick: str, val: float) -> None:
        if not nick:
            return
        acc[nick] = acc.get(nick, 0.0) + val

    for e in events:
        kind = str(e.get("kind") or "")
        k = str(e.get("killer") or "")
        v = str(e.get("victim") or "")
        dlt = float(e.get("delta") or 0)
        vd_raw = e.get("victimDelta")
        vd = float(vd_raw) if vd_raw is not None else None
        tk = bool(e.get("teamkill"))

        if kind == "driver_share":
            add(k, +abs(dlt))
        elif kind == "vehicle_kill":
            add(k, +abs(dlt))
        elif kind.startswith("vehicle_loss"):
            add(v or k, -abs(dlt))
        elif kind in ("die", "nok", "tk"):
            if k:
                if tk or kind == "tk":
                    add(k, -abs(dlt))
                else:
                    add(k, +abs(dlt))
            # Victim loss only when victimDelta present (TK-nok has none).
            if v and vd is not None:
                add(v, -abs(vd))
        elif kind == "revive":
            add(k, +abs(dlt))
    return acc


def audit_match(
    m: dict,
    *,
    players: dict | None = None,
    max_diffs: int = 12,
) -> MatchAudit:
    mid = str(m.get("id") or "?")
    events = list(m.get("events") or [])
    net = dict(m.get("netByNick") or {})
    # Prefer netByKey→display if both present (rare collision safety).
    net_by_key = m.get("netByKey")
    if isinstance(net_by_key, dict) and net_by_key and not events:
        # cannot verify without events
        pass

    a = MatchAudit(
        id=mid,
        map=str(m.get("map") or ""),
        date=str(m.get("date") or ""),
        events=len(events),
        players=len(net),
    )

    if not events:
        a.notes.append("no events array — skip deep audit (train slim match row)")
        a.ok = True
        return a

    recomputed = _recompute_nets(events)
    diffs: list[NickDiff] = []
    for nick, claimed in net.items():
        got = float(recomputed.get(nick, 0.0))
        if abs(got - float(claimed)) > NET_EPS:
            diffs.append(
                NickDiff(
                    nick=nick,
                    claimed=round(float(claimed), 2),
                    recomputed=round(got, 2),
                    diff=round(got - float(claimed), 2),
                )
            )
    # Also flag event-only nicks with non-trivial RP missing from net
    for nick, got in recomputed.items():
        if nick in net:
            continue
        if abs(got) > NET_EPS:
            diffs.append(
                NickDiff(
                    nick=nick,
                    claimed=0.0,
                    recomputed=round(got, 2),
                    diff=round(got, 2),
                )
            )
            a.notes.append(f"event-only nick missing from netByNick: {nick}")

    diffs.sort(key=lambda x: -abs(x.diff))
    a.net_bad = len(diffs)
    a.net_ok = max(0, len(net) - sum(1 for d in diffs if d.nick in net))
    a.net_diffs = diffs[:max_diffs]

    veh = [e for e in events if e.get("kind") == "vehicle_kill"]
    shares = [
        e
        for e in events
        if e.get("kind") == "driver_share" and e.get("reason") == "vehicle_kill"
    ]
    a.vehicle_kill = len(veh)
    a.share_veh = len(shares)

    for e in veh:
        tickets = e.get("tickets")
        if tickets is None:
            continue
        g = float(e.get("gainCoef") or 1.0)
        dlt = float(e.get("delta") or 0)
        exp = round(float(tickets) * 12.5 * g, 2)
        if abs(exp - dlt) <= FORMULA_EPS:
            a.formula_ok += 1
        else:
            a.formula_bad += 1
            if len(a.formula_issues) < 8:
                a.formula_issues.append(
                    {
                        "t": e.get("time"),
                        "killer": e.get("killer"),
                        "tickets": tickets,
                        "gainCoef": g,
                        "delta": dlt,
                        "expected": exp,
                        "label": e.get("label"),
                    }
                )

    veh_by_gt: dict[tuple, list] = {}
    for e in veh:
        veh_by_gt.setdefault((e.get("killer"), e.get("time")), []).append(e)

    shared_keys: set[tuple] = set()
    for s in shares:
        gun = s.get("victim")
        t = s.get("time")
        sd = float(s.get("delta") or 0)
        pool = veh_by_gt.get((gun, t)) or []
        ok = False
        for e in pool:
            exp = round(abs(float(e.get("delta") or 0)) * VEHICLE_DRIVER_SHARE, 2)
            if abs(exp - sd) <= SHARE_EPS:
                ok = True
                break
            # driver soft-cap may shrink share further
            if exp > 0 and exp * 0.45 <= sd <= exp + SHARE_EPS:
                ok = True
                break
        if ok:
            a.share_ok += 1
            shared_keys.add((gun, t))
        else:
            a.share_bad += 1
            if len(a.share_issues) < 8:
                a.share_issues.append(
                    {
                        "t": t,
                        "driver": s.get("killer"),
                        "gunner": gun,
                        "share": sd,
                        "label": s.get("label"),
                        "veh_same_t": len(pool),
                    }
                )

    a.veh_without_share = sum(
        1 for e in veh if (e.get("killer"), e.get("time")) not in shared_keys
    )

    # Optional: player hist vehicleKills vs events
    if players:
        for _k, p in players.items():
            nick = str(p.get("nick") or "")
            for hm in p.get("matches") or []:
                if str(hm.get("id") or "") != mid:
                    continue
                claimed_vk = int(hm.get("vehicleKills") or 0)
                got_vk = sum(1 for e in veh if e.get("killer") == nick)
                if claimed_vk != got_vk:
                    a.hist_veh_mismatches.append(
                        {
                            "nick": nick,
                            "hist": claimed_vk,
                            "events": got_vk,
                        }
                    )

    # Ticket class from Asset Name (catch unknown tanks like BP_2A6 → was 5, must 15)
    if R is not None:
        seen_assets: set[tuple[str, int, int]] = set()
        for e in events:
            kind = str(e.get("kind") or "")
            if kind not in TICKET_CLASS_KINDS:
                continue
            asset = _event_vehicle_asset(e)
            if not asset:
                continue
            stored = e.get("tickets")
            if stored is None:
                continue
            try:
                stored_i = int(stored)
            except (TypeError, ValueError):
                continue
            exp_i = int(R.vehicle_tickets(asset))
            key = (asset, stored_i, exp_i)
            if stored_i == exp_i:
                if key not in seen_assets:
                    a.ticket_class_ok += 1
                    seen_assets.add(key)
                continue
            a.ticket_class_bad += 1
            if key not in seen_assets and len(a.ticket_class_issues) < 12:
                seen_assets.add(key)
                a.ticket_class_issues.append(
                    {
                        "t": e.get("time"),
                        "kind": kind,
                        "asset": asset,
                        "stored": stored_i,
                        "expected": exp_i,
                        "label": e.get("label"),
                        "who": e.get("victim") or e.get("killer"),
                    }
                )

    a.ok = (
        a.net_bad == 0
        and a.formula_bad == 0
        and a.share_bad == 0
        and a.ticket_class_bad == 0
        and not a.hist_veh_mismatches
    )
    return a


def audit_matches(
    matches: list[dict],
    *,
    players: dict | None = None,
    only_ids: set[str] | None = None,
) -> list[MatchAudit]:
    out: list[MatchAudit] = []
    for m in matches:
        mid = str(m.get("id") or "")
        if only_ids is not None and mid not in only_ids:
            continue
        if not m.get("events"):
            continue
        out.append(audit_match(m, players=players))
    return out


def summarize(audits: list[MatchAudit]) -> dict[str, Any]:
    bad = [a for a in audits if not a.ok]
    return {
        "checked": len(audits),
        "ok": len(audits) - len(bad),
        "bad": len(bad),
        "badIds": [a.id for a in bad],
        "vehicle_kill": sum(a.vehicle_kill for a in audits),
        "formula_bad": sum(a.formula_bad for a in audits),
        "share_bad": sum(a.share_bad for a in audits),
        "ticket_class_bad": sum(a.ticket_class_bad for a in audits),
        "net_bad_players": sum(a.net_bad for a in audits),
    }


def write_report(path: Path, *, kind: str, audits: list[MatchAudit]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "kind": kind,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": summarize(audits),
        "matches": [a.to_dict() for a in audits],
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def format_telegram(kind: str, audits: list[MatchAudit]) -> str | None:
    bad = [a for a in audits if not a.ok]
    if not bad:
        return None
    lines = [f"⚠️ BB RP integrity ({kind})", f"косяков: {len(bad)}/{len(audits)}"]
    for a in bad[:5]:
        bits = []
        if a.net_bad:
            bits.append(f"netΔ{a.net_bad}")
        if a.formula_bad:
            bits.append(f"vehForm{a.formula_bad}")
        if a.share_bad:
            bits.append(f"share{a.share_bad}")
        if a.ticket_class_bad:
            bits.append(f"ticketClass{a.ticket_class_bad}")
        if a.hist_veh_mismatches:
            bits.append(f"histVeh{len(a.hist_veh_mismatches)}")
        lines.append(f"• {a.id}: {', '.join(bits) or 'fail'}")
        if a.ticket_class_issues:
            t0 = a.ticket_class_issues[0]
            lines.append(
                f"  e.g. {t0.get('asset')}: tickets {t0.get('stored')}→{t0.get('expected')}"
            )
        elif a.net_diffs:
            d0 = a.net_diffs[0]
            lines.append(
                f"  e.g. {d0.nick}: claimed {d0.claimed} ≠ {d0.recomputed}"
            )
    if len(bad) > 5:
        lines.append(f"… ещё {len(bad) - 5}")
    return "\n".join(lines)
