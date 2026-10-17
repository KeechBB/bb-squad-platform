#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Incremental vehicle RP state (enter/exit/burn/dmg → kill/loss).

Shared by score_match_rp (batch) and Keech Hunt (live). Canon:
  tickets×12.5, F2 100% / driver 70%, finisher-only kill, passengers 0.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Callable

import rp_log_parse as R


class VehicleRpEngine:
    """Track hull crews and emit vehicle_kill / vehicle_loss / driver_share events."""

    def __init__(
        self,
        *,
        soft_gain: bool,
        teams: dict[str, str] | None = None,
        rp: dict[str, float] | None = None,
        disp: dict[str, str] | None = None,
        aliases: dict[str, str] | None = None,
        apply_delta: Callable[[str, float], float] | None = None,
    ) -> None:
        self.soft_gain = bool(soft_gain)
        self.teams: dict[str, str] = teams if teams is not None else {}
        self.rp: dict[str, float] = rp if rp is not None else {}
        self.disp: dict[str, str] = disp if disp is not None else {}
        self.aliases: dict[str, str] = aliases or {}
        self._apply_delta = apply_delta or self._default_apply
        self.hulls: dict[str, dict] = {}
        self.player_hull: dict[str, str] = {}
        self.player_seat: dict[str, int] = {}
        self.pawn_to_hull: dict[str, str] = {}
        # Exit can be stamped a few ms before the killing blow on an occupied hull.
        self.recent_exit: dict[str, tuple[str, int, datetime]] = {}
        self.exploded_at: dict[str, datetime] = {}

    def reset(self) -> None:
        self.hulls.clear()
        self.player_hull.clear()
        self.player_seat.clear()
        self.pawn_to_hull.clear()
        self.recent_exit.clear()
        self.exploded_at.clear()

    def died_in_explosion(self, key: str, at_dt: datetime | None) -> bool:
        """Crew death is infantry as well as the vehicle.

        A blast still writes vehicle_kill / vehicle_loss. The nok and the
        give-up are a separate life and stay on the card. This returns
        False so Hunt does not drop that life.
        """
        return False

    def set_teams(self, teams: dict[str, str]) -> None:
        self.teams = teams

    def _default_apply(self, key: str, signed: float) -> float:
        cur = self.rp.get(key, R.START_RP)
        if self.soft_gain and signed > 0:
            signed = round(signed * R.rp_gain_coef(cur), 2)
        nxt = cur + signed
        if nxt < R.MIN_RP:
            signed = R.MIN_RP - cur
            nxt = R.MIN_RP
        self.rp[key] = nxt
        return signed

    def ensure(self, key: str, nick: str) -> str:
        ck = self.aliases.get(key, key)
        if ck not in self.disp:
            self.disp[ck] = nick
        self.rp.setdefault(ck, R.START_RP)
        return ck

    def same_team(self, a: str, b: str) -> bool:
        return a in self.teams and b in self.teams and self.teams[a] == self.teams[b]

    def _ensure_hull(self, hid: str, asset: str) -> dict:
        h = self.hulls.get(hid)
        if h is None:
            h = {
                "asset": asset,
                "seats": {},
                "seat_roles": {},
                "last_crew": {},
                "burn_crew": None,
                "burning": False,
                "dead": False,
                "last_hit": None,
                "finisher": None,
            }
            self.hulls[hid] = h
        elif asset and not h.get("asset"):
            h["asset"] = asset
        h.setdefault("seat_roles", {})
        return h

    def _resolve_hull_id(self, asset: str, instance: str, seat: int) -> str:
        if not instance:
            return ""
        if seat == 0:
            self.pawn_to_hull[instance] = instance
            return instance
        if instance in self.pawn_to_hull:
            return self.pawn_to_hull[instance]
        inst_n = R._veh_id_num(instance)
        best, best_d = "", 10**18
        for hid, meta in self.hulls.items():
            if asset and meta.get("asset") and meta["asset"] != asset:
                continue
            hid_n = R._veh_id_num(hid)
            if inst_n is None or hid_n is None:
                continue
            d = abs(hid_n - inst_n)
            if d < best_d and d < 500:
                best_d = d
                best = hid
        if best:
            self.pawn_to_hull[instance] = best
            return best
        self.pawn_to_hull[instance] = instance
        return instance

    def _snapshot_crew(self, h: dict) -> dict[int, str]:
        seats = h.get("seats") or {}
        roles = h.get("seat_roles") or {}
        snap: dict[int, str] = {}
        for seat, key in seats.items():
            role = roles.get(seat) or R.vehicle_seat_role(
                str(h.get("asset") or ""), int(seat), ""
            )
            if role == "driver":
                snap[0] = key
            elif role == "gunner":
                snap[1] = key
        # Убивающий удар часто подписан только мехводом. Стрелок всё равно в экипаже.
        for seat, key in (h.get("last_crew") or {}).items():
            if key:
                snap.setdefault(int(seat), key)
        return snap

    def credit_driver_share(
        self, gunner_key: str, applied_gain: float, at_msk: str, reason: str
    ) -> list[dict[str, Any]]:
        """§5: мехвод +70% от +RP наводчика F2, пока оба в одном экипаже."""
        out: list[dict[str, Any]] = []
        if applied_gain <= 0:
            return out
        hid = self.player_hull.get(gunner_key)
        if not hid:
            return out
        h = self.hulls.get(hid) or {}
        roles = h.get("seat_roles") or {}
        g_seat = self.player_seat.get(gunner_key)
        if g_seat is None or roles.get(g_seat) != "gunner":
            return out
        driver = None
        for seat, key in (h.get("seats") or {}).items():
            if roles.get(seat) == "driver":
                driver = key
                break
        if not driver:
            driver = (h.get("last_crew") or {}).get(0)
        if not driver or driver == gunner_key:
            return out
        driver = self.ensure(driver, self.disp.get(driver, driver))
        share = round(abs(applied_gain) * R.VEHICLE_DRIVER_SHARE, 2)
        if share <= 0:
            return out
        gcoef = R.rp_gain_coef(self.rp.get(driver, R.START_RP)) if self.soft_gain else 1.0
        applied = self._apply_delta(driver, +share)
        asset = h.get("asset") or ""
        vlab = R.vehicle_label_ru(asset) if asset else "техника"
        gun_nick = self.disp.get(gunner_key, gunner_key)
        reason_ru = {"nok": "нок", "die": "килл", "vehicle_kill": "технику"}.get(
            reason, reason
        )
        out.append(
            {
                "kind": "driver_share",
                "time": at_msk,
                "killer": self.disp[driver],
                "killerKey": driver,
                "victim": gun_nick,
                "delta": round(abs(applied), 2),
                "gainCoef": gcoef,
                "vehicle": asset,
                "tickets": R.vehicle_tickets(asset) if asset else None,
                "reason": reason,
                "label": f"мехвод 70% · {reason_ru} F2 ({gun_nick}) · {vlab}",
                "formula": "v2",
            }
        )
        return out

    def _destroy_vehicle(
        self, hid: str, at_msk: str, dmg_row: dict | None = None
    ) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        h = self.hulls.get(hid)
        if not h or h.get("dead"):
            return out
        h["dead"] = True
        boom_at = (dmg_row or {}).get("at_dt")
        if boom_at is not None:
            liable = set((h.get("seats") or {}).values())
            liable.update((h.get("burn_crew") or {}).values())
            liable.update((h.get("last_crew") or {}).values())
            for pk in liable:
                if pk:
                    self.exploded_at[pk] = boom_at
        asset = h.get("asset") or ""
        if dmg_row and not asset:
            vid = dmg_row.get("vid") or hid
            asset = re.sub(r"_\d+$", "", vid)
            h["asset"] = asset
        base = R.vehicle_base_rp(asset)
        tickets = R.vehicle_tickets(asset)
        vlab = R.vehicle_label_ru(asset)
        crew = h.get("burn_crew") or self._snapshot_crew(h)
        f2 = crew.get(1)
        driver = crew.get(0)
        if f2:
            f2 = self.ensure(f2, self.disp.get(f2, f2))
            self._apply_delta(f2, -base)
            out.append(
                {
                    "kind": "vehicle_loss",
                    "time": at_msk,
                    "killer": asset or hid,
                    "victim": self.disp[f2],
                    "victimKey": f2,
                    "delta": round(base, 2),
                    "tickets": tickets,
                    "vehicle": asset,
                    "seat": 1,
                    "label": f"потеря {vlab} (F2, {tickets} тик.)",
                    "formula": "v2",
                }
            )
        if driver and driver != f2:
            driver = self.ensure(driver, self.disp.get(driver, driver))
            dpen = round(base * R.VEHICLE_DRIVER_SHARE, 2)
            self._apply_delta(driver, -dpen)
            out.append(
                {
                    "kind": "vehicle_loss_driver",
                    "time": at_msk,
                    "killer": asset or hid,
                    "victim": self.disp[driver],
                    "victimKey": driver,
                    "delta": dpen,
                    "tickets": tickets,
                    "vehicle": asset,
                    "seat": 0,
                    "label": f"потеря {vlab} (мехвод 70%, {tickets} тик.)",
                    "formula": "v2",
                }
            )
        fin = h.get("finisher") or h.get("last_hit")
        if dmg_row and not dmg_row.get("burning") and dmg_row.get("killerKey"):
            fin = {
                "killerKey": dmg_row["killerKey"],
                "killer": dmg_row.get("killer") or "",
                "causer": dmg_row.get("causer") or "",
            }
        kk = (fin or {}).get("killerKey") or ""
        if not kk or str(kk).startswith("?"):
            return out
        crew_keys = {c for c in (f2, driver) if c}
        if kk in crew_keys:
            return out
        if any(self.same_team(kk, c) for c in crew_keys):
            return out
        kk = self.ensure(kk, (fin or {}).get("killer") or kk)
        gcoef = R.rp_gain_coef(self.rp.get(kk, R.START_RP)) if self.soft_gain else 1.0
        applied = self._apply_delta(kk, +base)
        out.append(
            {
                "kind": "vehicle_kill",
                "time": at_msk,
                "killer": self.disp[kk],
                "killerKey": kk,
                "victim": asset or hid,
                "delta": round(abs(applied), 2),
                "tickets": tickets,
                "vehicle": asset,
                "weapon": (fin or {}).get("causer") or "",
                "gainCoef": gcoef,
                "label": f"уничтожил {vlab} ({tickets} тик.)",
                "formula": "v2",
            }
        )
        out.extend(self.credit_driver_share(kk, applied, at_msk, "vehicle_kill"))
        return out

    def handle(self, d: dict) -> list[dict[str, Any]]:
        """Process one v_enter / v_exit / v_burn / v_dmg op."""
        kind = d.get("kind") or ""
        at_msk = d.get("at_msk") or ""
        if kind == "v_enter":
            key = d.get("nickKey") or ""
            if not key or key.startswith("?"):
                return []
            key = self.ensure(key, d.get("nick") or key)
            seat = int(d.get("seat") or 0)
            asset = d.get("asset") or ""
            inst = d.get("instance") or ""
            hid = self._resolve_hull_id(asset, inst, seat)
            if not hid:
                return []
            h = self._ensure_hull(hid, asset)
            if h.get("dead"):
                return []
            old = self.player_hull.get(key)
            if old and old in self.hulls:
                seats = self.hulls[old]["seats"]
                roles_old = self.hulls[old].setdefault("seat_roles", {})
                for s, pk in list(seats.items()):
                    if pk == key:
                        del seats[s]
                        roles_old.pop(s, None)
            role = R.vehicle_seat_role(
                asset, seat, d.get("pawn") or d.get("instance") or ""
            )
            h["seats"][seat] = key
            h.setdefault("seat_roles", {})[seat] = role
            self.player_hull[key] = hid
            self.player_seat[key] = seat
            if role == "driver":
                h["last_crew"][0] = key
            elif role == "gunner":
                h["last_crew"][1] = key
            return []

        if kind == "v_exit":
            key = d.get("nickKey") or ""
            if not key:
                return []
            key = self.aliases.get(key, key)
            seat = int(d.get("seat") or 0)
            hid = self.player_hull.get(key)
            if not hid:
                inst = R._veh_instance(d.get("fullpath") or "") or d.get("instance") or ""
                hid = self.pawn_to_hull.get(inst) or inst
            if hid and hid in self.hulls:
                h = self.hulls[hid]
                seats = h["seats"]
                roles = h.setdefault("seat_roles", {})

                def _freeze_liable(s: int, pk: str) -> None:
                    role = roles.get(s) or R.vehicle_seat_role(
                        str(h.get("asset") or ""), s, ""
                    )
                    if role == "driver":
                        h["last_crew"][0] = pk
                    elif role == "gunner":
                        h["last_crew"][1] = pk

                if seats.get(seat) == key:
                    _freeze_liable(seat, key)
                    del seats[seat]
                    roles.pop(seat, None)
                else:
                    for s, pk in list(seats.items()):
                        if pk == key:
                            _freeze_liable(s, pk)
                            del seats[s]
                            roles.pop(s, None)
            if hid:
                at_dt = d.get("at_dt")
                if at_dt is not None:
                    self.recent_exit[key] = (hid, int(seat or 0), at_dt)
            self.player_hull.pop(key, None)
            self.player_seat.pop(key, None)
            return []

        if kind == "v_burn":
            vid = d.get("vid") or ""
            hid = self.pawn_to_hull.get(vid) or vid
            if hid not in self.hulls:
                self._ensure_hull(hid, re.sub(r"_\d+$", "", vid))
            h = self.hulls[hid]
            if h.get("dead"):
                return []
            if not h.get("burning"):
                h["burning"] = True
                h["burn_crew"] = self._snapshot_crew(h)
                if h.get("last_hit"):
                    h["finisher"] = dict(h["last_hit"])
            return []

        if kind == "v_dmg":
            vid = d.get("vid") or ""
            hid = self.pawn_to_hull.get(vid) or vid
            if hid not in self.hulls:
                self._ensure_hull(hid, re.sub(r"_\d+$", "", vid))
                self.pawn_to_hull[vid] = hid
            h = self.hulls[hid]
            if h.get("dead"):
                return []
            burning = bool(d.get("burning"))
            kk = d.get("killerKey") or ""
            if kk and not str(kk).startswith("?") and not burning:
                hit = {
                    "killerKey": self.aliases.get(kk, kk),
                    "killer": d.get("killer") or "",
                    "causer": d.get("causer") or "",
                    "at_msk": at_msk,
                }
                h["last_hit"] = hit
                if not h.get("burning"):
                    h["finisher"] = hit
            if burning and not h.get("burning"):
                h["burning"] = True
                h["burn_crew"] = self._snapshot_crew(h)
                if h.get("last_hit"):
                    h["finisher"] = dict(h["last_hit"])
            try:
                health = float(d.get("health"))
            except (TypeError, ValueError):
                health = 1.0
            h["health"] = health
            if health <= 0:
                return self._destroy_vehicle(hid, at_msk, d)
            return []

        if kind == "v_dmg_named":
            # Occupied hull: Squad writes the HP pool under the driver's nick.
            key = d.get("whoKey") or ""
            if not key or str(key).startswith("?"):
                return []
            key = self.aliases.get(key, key)
            hid = self.player_hull.get(key) or ""
            ghost: tuple[dict, int] | None = None
            if not hid:
                rec = self.recent_exit.get(key)
                at_dt = d.get("at_dt")
                if rec and at_dt is not None and rec[2] is not None:
                    rhid, rseat, rat = rec
                    if 0 <= (at_dt - rat).total_seconds() <= 2:
                        h0 = self.hulls.get(rhid)
                        if h0 and not h0.get("dead"):
                            role = R.vehicle_seat_role(
                                str(h0.get("asset") or ""), rseat, ""
                            )
                            h0.setdefault("seats", {})[rseat] = key
                            h0.setdefault("seat_roles", {})[rseat] = role
                            if role == "driver":
                                h0["last_crew"][0] = key
                            elif role == "gunner":
                                h0["last_crew"][1] = key
                            hid = rhid
                            ghost = (h0, rseat)
            h = self.hulls.get(hid) if hid else None

            def _drop_ghost() -> None:
                if not ghost:
                    return
                gh, gs = ghost
                if gh.get("seats", {}).get(gs) == key:
                    gh["seats"].pop(gs, None)
                    gh.get("seat_roles", {}).pop(gs, None)

            if not h or h.get("dead"):
                return []
            try:
                health = float(d.get("health"))
                dmg = float(d.get("dmg") or 0)
            except (TypeError, ValueError):
                _drop_ghost()
                return []
            # who ∈ hull ⇒ named HP is the vehicle pool. Continuity can break
            # on INVALID/self ticks we don't parse — re-seed absolute HP.
            last = h.get("health")
            if last is not None and abs((float(last) - dmg) - health) > 2.0:
                pass  # re-seed below
            out = self.handle(
                {
                    **d,
                    "kind": "v_dmg",
                    "vid": hid,
                    "health": health,
                    "burning": False,
                }
            )
            _drop_ghost()
            return out

        return []

    def gunner_key(self, nick_key: str) -> str | None:
        """If nick is F2 on a hull, return that key; else None."""
        key = self.aliases.get(nick_key, nick_key)
        hid = self.player_hull.get(key)
        if not hid:
            return None
        h = self.hulls.get(hid) or {}
        roles = h.get("seat_roles") or {}
        seat = self.player_seat.get(key)
        if seat is None or roles.get(seat) != "gunner":
            return None
        return key
