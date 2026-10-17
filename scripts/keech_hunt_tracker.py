#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Keech-only live hunt tracker (TPUB1/PB1 + TR1/TR2/TR3…).

Writes:
  platform/data/keech-hunt/live.json
  platform/data/keech-hunt/memory.json

Fed line-by-line from squad_log_collector.
Keeps one open match bucket per server so Public and TR1 don't overwrite each other.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import rp_log_parse as R
from rp_vehicle_engine import VehicleRpEngine

HERE = Path(__file__).resolve().parent
PLATFORM = HERE.parent
OUT_DIR = PLATFORM / "data" / "keech-hunt"
LIVE_PATH = OUT_DIR / "live.json"
MEMORY_PATH = OUT_DIR / "memory.json"
LEDGER_PATH = PLATFORM / "data" / "public" / "rp-ledger.json"
TRAIN_LEDGER_PATHS = (
    PLATFORM / "data" / "kv-cache" / "data" / "training" / "rp-ledger.json",
    PLATFORM / "data" / "training" / "rp-ledger.json",
)

KEECH_STEAM = "76561198028435874"
KEECH_KEY = "keech"
# Hunt event kinds that count as kills / deaths columns
_VEH_KILL_KINDS = frozenset({"vehicle_kill", "driver_share"})
_VEH_LOSS_KINDS = frozenset({"vehicle_loss", "vehicle_loss_driver"})
HIT_WINDOW_SEC = 45.0
MEMORY_MAX = 40
SERVERS = frozenset({"TPUB1", "PB1", "PUB", "TR1", "TR2", "TR3"})

MSK = timezone(timedelta(hours=3))
LINE_TS = re.compile(r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})")
LOGIN_RE = re.compile(
    r"LogNet: Login request: \?Name=(?P<name>[^?]+)"
    r"(?:\?[^\s]*)?"
    r"\s+userId: RedpointEOS:(?P<eos>[0-9a-fA-F]{32})",
    re.I,
)
REMOVE_RE = re.compile(
    r"RemovePlayer\(UserId:\s*(?P<eos>[0-9a-fA-F]{32})\)",
    re.I,
)
PC_RE = re.compile(
    r"PC=(?P<nick>.+?)\s*\(Online IDs:\s*EOS:\s*(?P<eos>[0-9a-fA-F]+)\s+steam:\s*(?P<steam>7656\d+)",
    re.I,
)
# Layer name at map end (fills "?" buckets before archive → «Память»).
MATCH_END_RE = re.compile(
    r"LogSquadGameEvents:\s*Display:\s*Team\s+(?P<team>[12]),\s+"
    r"(?P<faction>.+?)\s+\(\s*(?P<side>.+?)\s*\)\s+has\s+"
    r"(?P<outcome>won|lost)\s+the\s+match\s+with\s+(?P<tickets>\d+)\s+Tickets\s+"
    r"on\s+layer\s+(?P<layer>.+?)\s+\(level\s+(?P<level>.+?)\)!",
    re.I,
)
HIT_RE = re.compile(
    r"BBHitZone:\s*"
    r"AttackerEOS=<?(?P<aeos>[0-9a-fA-F]{32}|none)>?\s+"
    r"(?:AttackerSteam=<?(?P<asteam>7656\d{13}|none)>?\s+)?"
    r"VictimEOS=<?(?P<veos>[0-9a-fA-F]{32}|none)>?\s+"
    r"Zone=<?(?P<zone>[^>\s]+)>?\s+"
    r"Damage=<?(?P<damage>[^>\s]+)>?\s+"
    r"Bone=<?(?P<bone>[^>\s]+)>?",
    re.I,
)
# Real spawn → kit (same filter as squad_log_collector DeployRole)
DEPLOY_RE = re.compile(
    r"PC=(?P<nick>.+?)(?:\s+\(Online IDs:[^)]*\))?\s+"
    r"(?:Spawn=\S+\s+)?"
    r".*?DeployRole=(?P<role>\S+)",
    re.I,
)

try:
    from squad_log_collector import kit_from_role as _kit_from_role
except Exception:  # pragma: no cover
    def _kit_from_role(role: str) -> str | None:  # type: ignore
        return None


def _parse_ts(raw: str) -> datetime:
    y, mo, d = raw[:10].split(".")
    h, mi, s = raw[11:].split(".")
    return datetime(int(y), int(mo), int(d), int(h), int(mi), int(s), tzinfo=timezone.utc)


def _msk_time(dt: datetime) -> str:
    return dt.astimezone(MSK).strftime("%H:%M:%S")


def _layer_short(path: str) -> str:
    p = (path or "").strip().rstrip("/")
    if "/" in p:
        p = p.rsplit("/", 1)[-1]
    return p or "?"


def _is_seed_layer(layer: str) -> bool:
    """Jensen / Seed — не в Hunt-память и не в train RP."""
    return R.is_seed_layer(layer or "", "")


def _norm_server(key: str) -> str:
    k = (key or "").strip().upper()
    if k in ("PB1", "PUB", "TPUB1"):
        return "TPUB1"
    return k


class KeechHuntTracker:
    def __init__(self) -> None:
        self.steam_nick: dict[str, str] = {}
        self.eos_steam: dict[str, str] = {}
        self.eos_nick: dict[str, str] = {}
        # steam → faction (from "has created Squad … on Faction") for TK detect
        self.steam_faction: dict[str, str] = {}
        # last known kit from DeployRole (steam / nick_key)
        self._kit_by_steam: dict[str, str] = {}
        self._kit_by_nick: dict[str, str] = {}
        # victim nick_key Keech last wounded (for revive ×0.2 own-nok)
        self._last_wound_by_keech: dict[str, float] = {}
        # recent hits: list of {at, asteam, veos, bone, zone, dmg}
        self._hits: list[dict[str, Any]] = []
        # server -> open match
        self.matches: dict[str, dict[str, Any]] = {}
        # Only this server is shown in Hunt live (where Keech is right now).
        self.keech_server: str | None = None
        # Per-server: running Keech RP (soft-cap), vehicle engine
        self._keech_rp_run: dict[str, float] = {}
        self._veh: dict[str, VehicleRpEngine] = {}
        self._dirty = False
        self._last_write = 0.0
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        self._hydrate_from_live()
        if not LIVE_PATH.is_file():
            self._write_live_empty()

    def _mark_keech_on(self, server: str) -> None:
        srv = _norm_server(server)
        if not srv:
            return
        if self.keech_server != srv:
            self.keech_server = srv
            self._dirty = True

    def _mark_keech_left(self, server: str) -> None:
        srv = _norm_server(server)
        if self.keech_server == srv:
            self.keech_server = None
            self._dirty = True

    def _keech_here(self, server: str) -> bool:
        return bool(self.keech_server) and self.keech_server == _norm_server(server)

    def _is_keech_eos(self, eos: str) -> bool:
        e = (eos or "").strip().lower()
        if not e or e == "none":
            return False
        return self.eos_steam.get(e) == KEECH_STEAM

    def _hydrate_from_live(self) -> None:
        if not LIVE_PATH.is_file():
            return
        try:
            data = json.loads(LIVE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return
        ks = _norm_server(str(data.get("keechServer") or ""))
        if ks:
            self.keech_server = ks
        rows = list(data.get("matches") or [])
        if not rows and data.get("match"):
            rows = [data["match"]]
        for row in rows:
            if not isinstance(row, dict):
                continue
            srv = _norm_server(str(row.get("server") or ""))
            if not srv or row.get("endAt"):
                continue
            row = dict(row)
            row["server"] = srv
            self.matches[srv] = row
            # Infer presence from open match with Keech combat if not stored.
            if not self.keech_server and (row.get("events") or []):
                self.keech_server = srv

    @property
    def match(self) -> dict[str, Any] | None:
        """Primary (most recently active) open match — backward compatible."""
        return self._primary_match()

    def _is_stale_open(self, m: dict[str, Any], *, now: datetime | None = None) -> bool:
        """Open bucket with no fresh events — finished map that missed WaitingPostMatch."""
        if not m or m.get("endAt") or m.get("seed"):
            return True
        if _is_seed_layer(str(m.get("layer") or m.get("layerShort") or "")):
            return True
        ev = m.get("events") or []
        ref = now or datetime.now(timezone.utc)
        try:
            if not ev:
                st = datetime.fromisoformat(
                    str(m.get("startAt") or "").replace("Z", "+00:00")
                )
                if st.tzinfo is None:
                    st = st.replace(tzinfo=timezone.utc)
                # Empty placeholder older than 3 min — not a live map
                return (ref - st).total_seconds() > 3 * 60
            last = datetime.fromisoformat(
                str(ev[-1].get("at") or m.get("startAt") or "").replace("Z", "+00:00")
            )
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            # >8 min without combat while still "open" → treat as ended (UI must not show it)
            return (ref - last).total_seconds() > 8 * 60
        except Exception:
            return False

    def _primary_match(self) -> dict[str, Any] | None:
        """Live Hunt shows only the server Keech is on — never another TR/PB."""
        if not self.keech_server or not self.matches:
            return None
        m = self.matches.get(self.keech_server)
        if not m:
            return None
        now = datetime.now(timezone.utc)
        if (
            m.get("endAt")
            or m.get("seed")
            or _is_seed_layer(str(m.get("layer") or m.get("layerShort") or ""))
            or self._is_stale_open(m, now=now)
            or not (m.get("events") or [])
        ):
            return None
        return m

    def _ledger_for(self, server: str | None = None) -> Path:
        srv = _norm_server(server or "")
        if srv.startswith("TR") and srv[2:].isdigit():
            for p in TRAIN_LEDGER_PATHS:
                if p.is_file():
                    return p
        return LEDGER_PATH

    def _rp_map(self, server: str | None = None) -> tuple[dict[str, float], float]:
        """RP weights + P_max — as in train `score_match_rp` (max of current RPs).

        Do **not** trust ledger `pMax`: train ledger still stores a stale PWR peak
        (~770) which clamped Keech (~2300) down to START_RP and flattened Hunt to N=25.5.
        """
        start = float(R.START_RP)
        rp: dict[str, float] = {}
        path = self._ledger_for(server)
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                for k, row in (data.get("players") or {}).items():
                    if isinstance(row, dict) and row.get("rp") is not None:
                        rp[str(k)] = float(row["rp"])
            except Exception:
                pass
        pmax = max(rp.values()) if rp else start
        return rp, max(float(pmax), start)

    def _weight(self, nick: str, rp: dict[str, float]) -> float:
        k = R.nick_key(nick)
        return float(rp.get(k, R.START_RP))

    def _same_team_steam(self, other_steam: str) -> bool:
        mine = (self.steam_faction.get(KEECH_STEAM) or "").strip().lower()
        theirs = (self.steam_faction.get(other_steam) or "").strip().lower()
        return bool(mine and theirs and mine == theirs)

    @staticmethod
    def _v2(at: datetime) -> bool:
        """New RP coefs (nok/kill/death/revive) from cutover date MSK — same card as train/public."""
        return at.astimezone(MSK).strftime("%Y-%m-%d") >= R.RP_FORMULA_CUTOVER

    def _match_date(self, server: str, at: datetime) -> str:
        """MSK calendar date for soft-cap / vehicle cutover (prefer match start)."""
        bucket = self.matches.get(_norm_server(server))
        if bucket and bucket.get("startAt"):
            try:
                st = datetime.fromisoformat(
                    str(bucket["startAt"]).replace("Z", "+00:00")
                )
                if st.tzinfo is None:
                    st = st.replace(tzinfo=timezone.utc)
                return st.astimezone(MSK).strftime("%Y-%m-%d")
            except Exception:
                pass
        return at.astimezone(MSK).strftime("%Y-%m-%d")

    def _soft_on(self, server: str, at: datetime) -> bool:
        return R.match_at_or_after_night_cutover(
            match_date=self._match_date(server, at), at=at
        )

    def _veh_on(self, server: str, at: datetime) -> bool:
        return R.match_at_or_after_night_cutover(
            match_date=self._match_date(server, at), at=at
        )

    def _seed_keech_rp(self, server: str) -> float:
        srv = _norm_server(server)
        if srv not in self._keech_rp_run:
            rp, _ = self._rp_map(srv)
            self._keech_rp_run[srv] = float(rp.get(KEECH_KEY, R.START_RP))
        return self._keech_rp_run[srv]

    def _bump_keech_rp(self, server: str, signed: float) -> None:
        srv = _norm_server(server)
        cur = self._seed_keech_rp(srv)
        nxt = cur + float(signed)
        if nxt < R.MIN_RP:
            nxt = R.MIN_RP
        self._keech_rp_run[srv] = nxt

    def _apply_keech_gain(
        self, server: str, at: datetime, signed: float
    ) -> tuple[float, float]:
        """Soft-cap positive RP for Keech. Returns (applied, gainCoef). Losses ×1."""
        if signed <= 0:
            self._bump_keech_rp(server, signed)
            return float(signed), 1.0
        if not self._soft_on(server, at):
            self._bump_keech_rp(server, signed)
            return float(signed), 1.0
        cur = self._seed_keech_rp(server)
        coef = float(R.rp_gain_coef(cur))
        applied = round(float(signed) * coef, 2)
        self._bump_keech_rp(server, applied)
        return applied, coef

    def _teams_nickkeys(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for steam, fac in self.steam_faction.items():
            nick = self.steam_nick.get(steam) or ""
            if nick:
                out[R.nick_key(nick)] = (fac or "").strip().lower()
        if KEECH_STEAM in self.steam_faction:
            out[KEECH_KEY] = (self.steam_faction[KEECH_STEAM] or "").strip().lower()
        return out

    def _reset_vehicle(self, server: str) -> None:
        srv = _norm_server(server)
        self._veh.pop(srv, None)
        self._keech_rp_run.pop(srv, None)

    def _engine(self, server: str, at: datetime) -> VehicleRpEngine | None:
        if not self._veh_on(server, at):
            return None
        srv = _norm_server(server)
        eng = self._veh.get(srv)
        if eng is None:
            rp_map, _ = self._rp_map(srv)
            rp = dict(rp_map)
            rp[KEECH_KEY] = self._seed_keech_rp(srv)
            disp: dict[str, str] = {KEECH_KEY: "Keech"}
            for st, nick in self.steam_nick.items():
                disp[R.nick_key(nick)] = R.strip_tag(nick)

            def apply_delta(key: str, signed: float) -> float:
                cur = rp.get(key, R.START_RP)
                soft = self._soft_on(srv, at)
                if soft and signed > 0:
                    signed = round(signed * R.rp_gain_coef(cur), 2)
                nxt = cur + signed
                if nxt < R.MIN_RP:
                    signed = R.MIN_RP - cur
                    nxt = R.MIN_RP
                rp[key] = nxt
                if key == KEECH_KEY:
                    self._keech_rp_run[srv] = nxt
                return signed

            eng = VehicleRpEngine(
                soft_gain=self._soft_on(srv, at),
                teams=self._teams_nickkeys(),
                rp=rp,
                disp=disp,
                apply_delta=apply_delta,
            )
            self._veh[srv] = eng
        else:
            eng.set_teams(self._teams_nickkeys())
            for st, nick in self.steam_nick.items():
                eng.disp[R.nick_key(nick)] = R.strip_tag(nick)
            eng.disp.setdefault(KEECH_KEY, "Keech")
            eng.rp[KEECH_KEY] = self._seed_keech_rp(srv)
        return eng

    def _emit_vehicle_score(
        self, server: str, at: datetime, score_events: list[dict[str, Any]]
    ) -> None:
        """Turn score_match vehicle events into Keech Hunt rows (only Keech rows)."""
        for ev in score_events or []:
            kind = str(ev.get("kind") or "")
            label = str(ev.get("label") or "")
            tickets = ev.get("tickets")
            vehicle = str(ev.get("vehicle") or "")
            gcoef = ev.get("gainCoef")
            if kind == "vehicle_kill":
                if ev.get("killerKey") != KEECH_KEY:
                    continue
                nick = label or R.vehicle_label_ru(vehicle) or "техника"
                self._add_event(
                    server,
                    {
                        "id": f"vk-{server}-{at.timestamp():.3f}-{vehicle[-12:]}",
                        "kind": "vehicle_kill",
                        "at": at.isoformat(),
                        "time": _msk_time(at),
                        "nick": nick,
                        "delta": float(ev.get("delta") or 0),
                        "oppWeight": 0,
                        "bones": {},
                        "server": server,
                        "label": label,
                        "vehicle": vehicle,
                        "tickets": tickets,
                        "gainCoef": gcoef,
                    },
                    at,
                )
            elif kind in ("vehicle_loss", "vehicle_loss_driver"):
                if ev.get("victimKey") != KEECH_KEY:
                    continue
                nick = label or R.vehicle_label_ru(vehicle) or "техника"
                self._add_event(
                    server,
                    {
                        "id": f"vl-{server}-{at.timestamp():.3f}-{kind}-{vehicle[-12:]}",
                        "kind": kind,
                        "at": at.isoformat(),
                        "time": _msk_time(at),
                        "nick": nick,
                        "delta": -abs(float(ev.get("delta") or 0)),
                        "oppWeight": 0,
                        "bones": {},
                        "server": server,
                        "label": label,
                        "vehicle": vehicle,
                        "tickets": tickets,
                    },
                    at,
                )
            elif kind == "driver_share":
                if ev.get("killerKey") != KEECH_KEY:
                    continue
                nick = label or f"мехвод 70% · {ev.get('victim') or '?'}"
                self._add_event(
                    server,
                    {
                        "id": f"ds-{server}-{at.timestamp():.3f}-{R.nick_key(str(ev.get('victim') or ''))}",
                        "kind": "driver_share",
                        "at": at.isoformat(),
                        "time": _msk_time(at),
                        "nick": nick,
                        "delta": float(ev.get("delta") or 0),
                        "oppWeight": 0,
                        "bones": {},
                        "server": server,
                        "label": label,
                        "vehicle": vehicle,
                        "tickets": tickets,
                        "gainCoef": gcoef,
                        "reason": ev.get("reason"),
                    },
                    at,
                )

    def _parse_vehicle_line(self, line: str, at: datetime, server: str) -> None:
        eng = self._engine(server, at)
        if eng is None:
            return
        at_msk = _msk_time(at)
        op: dict[str, Any] | None = None
        if "Entered Vehicle" in line:
            em = R.ENTERED_VEH_RE.search(line)
            if em:
                asset = (em.group("asset") or "").strip()
                pawn = em.group("pawn") or ""
                if not R._skip_vehicle_asset(asset, pawn):
                    nick = R.strip_tag(em.group("nick"))
                    steam = em.group("steam") or ""
                    if steam:
                        self.steam_nick[steam] = nick
                    op = {
                        "kind": "v_enter",
                        "at_dt": at,
                        "at_msk": at_msk,
                        "nick": nick,
                        "nickKey": R.nick_key(nick),
                        "steam": steam,
                        "asset": asset,
                        "pawn": pawn,
                        "fullpath": em.group("fullpath") or "",
                        "instance": R._veh_instance(pawn)
                        or R._veh_instance(em.group("fullpath") or ""),
                        "seat": int(em.group("seat") or 0),
                    }
                    if steam == KEECH_STEAM or R.nick_key(nick) == KEECH_KEY:
                        self._mark_keech_on(server)
        elif "Exited Vehicle" in line:
            xm = R.EXITED_VEH_RE.search(line)
            if xm:
                asset = (xm.group("asset") or "").strip()
                if not R._skip_vehicle_asset(asset):
                    nick = R.strip_tag(xm.group("nick"))
                    op = {
                        "kind": "v_exit",
                        "at_dt": at,
                        "at_msk": at_msk,
                        "nick": nick,
                        "nickKey": R.nick_key(nick),
                        "steam": xm.group("steam") or "",
                        "asset": asset,
                        "fullpath": xm.group("fullpath") or "",
                        "instance": R._veh_instance(xm.group("fullpath") or ""),
                        "seat": int(xm.group("seat") or 0),
                    }
        elif "SQBurningDamage" in line:
            bm = R.VEH_BURN_RE.search(line)
            if bm:
                op = {"kind": "v_burn", "at_msk": at_msk, "vid": bm.group("vid")}
        elif "damage taken by causer" in line and "health remaining" in line:
            if not re.search(r"BP_[A-Za-z0-9_]+_C_\d+:", line):
                om = R.VEH_OCC_DMG_RE.search(line)
                if om and not str(om.group("who") or "").startswith("BP_"):
                    try:
                        who = R.strip_tag(om.group("who") or "")
                        nick = R.strip_tag(om.group("nick") or "")
                        op = {
                            "kind": "v_dmg_named",
                            "at_dt": at,
                            "at_msk": at_msk,
                            "who": who,
                            "whoKey": R.nick_key(who) if who else "",
                            "dmg": float(om.group("dmg") or 0),
                            "causer": om.group("causer") or "",
                            "killer": nick,
                            "killerKey": R.nick_key(nick) if nick else "",
                            "steam": om.group("steam") or "",
                            "health": float(om.group("health")),
                            "burning": False,
                        }
                    except ValueError:
                        op = None
            elif re.search(r"BP_[A-Za-z0-9_]+_C_\d+:", line):
                dm = R.VEH_DMG_RE.search(line)
                if dm:
                    nick_raw = (dm.group("nick") or dm.group("nick2") or "").strip()
                    nick_l = nick_raw.lower()
                    causer = dm.group("causer") or ""
                    vid = dm.group("vid")
                    burning = causer == vid or "SQBurningDamage" in line
                    try:
                        health = float(dm.group("health"))
                        dmg = float(dm.group("dmg") or 0)
                    except ValueError:
                        return
                    nick = (
                        ""
                        if nick_l in ("", "nullptr", "invalid")
                        else R.strip_tag(nick_raw)
                    )
                    steam = dm.group("steam") or ""
                    if steam and nick:
                        self.steam_nick[steam] = nick
                    kk = R.nick_key(nick) if nick else ""
                    if steam == KEECH_STEAM or kk == KEECH_KEY:
                        self._mark_keech_on(server)
                    op = {
                        "kind": "v_dmg",
                        "at_dt": at,
                        "at_msk": at_msk,
                        "vid": vid,
                        "dmg": dmg,
                        "causer": causer,
                        "killer": nick,
                        "killerKey": kk,
                        "steam": steam,
                        "health": health,
                        "burning": burning,
                    }
        if not op:
            return
        scored = eng.handle(op)
        if scored:
            self._emit_vehicle_score(server, at, scored)

    def _maybe_driver_share_from_gunner(
        self,
        *,
        server: str,
        at: datetime,
        killer_steam: str,
        victim: str,
        reason: str,
        raw_gain: float,
    ) -> None:
        """If Keech is мехвод and F2 just scored, credit Keech 70% (Hunt-only)."""
        if raw_gain <= 0 or killer_steam == KEECH_STEAM:
            return
        if not self._veh_on(server, at):
            return
        eng = self._engine(server, at)
        if eng is None:
            return
        killer = self._nick_of_steam(killer_steam)
        kk = R.nick_key(killer)
        if eng.gunner_key(kk) is None:
            return
        if eng.player_hull.get(KEECH_KEY) != eng.player_hull.get(kk):
            return
        hid = eng.player_hull.get(KEECH_KEY)
        if not hid:
            return
        h = eng.hulls.get(hid) or {}
        roles = h.get("seat_roles") or {}
        seat = eng.player_seat.get(KEECH_KEY)
        if seat is None or roles.get(seat) != "driver":
            return
        # Soft-cap the gunner's gain the same way score_match would, then 70%.
        soft = self._soft_on(server, at)
        pk = float(eng.rp.get(kk, self._weight(killer, self._rp_map(server)[0])))
        gcoef = R.rp_gain_coef(pk) if soft else 1.0
        applied_gun = round(float(raw_gain) * gcoef, 2)
        scored = eng.credit_driver_share(kk, applied_gun, _msk_time(at), reason)
        if scored:
            self._emit_vehicle_score(server, at, scored)

    def _raw_n_as_killer(self, victim: str, server: str | None = None) -> tuple[float, float, float]:
        rp, pmax = self._rp_map(server)
        srv = _norm_server(server or "")
        me = float(
            self._keech_rp_run[srv]
            if srv in self._keech_rp_run
            else rp.get(KEECH_KEY, R.START_RP)
        )
        pv = self._weight(victim, rp)
        return R.hunt_delta(me, pv, pmax), me, pv

    def _raw_n_as_victim(self, killer: str, server: str | None = None) -> tuple[float, float, float]:
        rp, pmax = self._rp_map(server)
        srv = _norm_server(server or "")
        me = float(
            self._keech_rp_run[srv]
            if srv in self._keech_rp_run
            else rp.get(KEECH_KEY, R.START_RP)
        )
        pk = self._weight(killer, rp)
        return R.hunt_delta(pk, me, pmax), me, pk

    def _raw_n_pair(
        self, killer: str, victim: str, server: str | None = None
    ) -> tuple[float, float, float]:
        """N for any killer→victim (driver-share from teammate F2)."""
        rp, pmax = self._rp_map(server)
        pk = self._weight(killer, rp)
        pv = self._weight(victim, rp)
        return R.hunt_delta(pk, pv, pmax), pk, pv

    def _delta_kill(
        self, victim: str, *, at: datetime, server: str, victim_steam: str = ""
    ) -> tuple[float, float, float, float]:
        """Returns (applied_mag, me, pv, gainCoef). Sign handled by caller."""
        n, me, pv = self._raw_n_as_killer(victim, server)
        if not self._v2(at):
            applied, coef = self._apply_keech_gain(server, at, round(n, 2))
            return applied, me, pv, coef
        if victim_steam and self._same_team_steam(victim_steam):
            # TK murder: Keech loses N×0.6 — no soft-cap
            mag = round(n * R.COEF_TK_KILL_EXTRA, 2)
            self._bump_keech_rp(server, -mag)
            return mag, me, pv, 1.0
        raw = round(n * R.COEF_ENEMY_KILL, 2)
        applied, coef = self._apply_keech_gain(server, at, raw)
        return applied, me, pv, coef

    def _delta_death(self, killer: str, *, at: datetime, server: str) -> tuple[float, float, float]:
        n, me, pk = self._raw_n_as_victim(killer, server)
        coef = R.COEF_OWN_DEATH if self._v2(at) else 1.0
        mag = round(n * coef, 2)
        self._bump_keech_rp(server, -mag)
        return mag, me, pk

    def _delta_nok(
        self, victim: str, *, at: datetime, server: str, victim_steam: str = ""
    ) -> tuple[float, float, float, float]:
        """Enemy nok +N×0.1; TK nok −N×0.5; pre-cutover 0. Returns (mag, me, pv, gainCoef)."""
        if not self._v2(at):
            return 0.0, 0.0, 0.0, 1.0
        n, me, pv = self._raw_n_as_killer(victim, server)
        if victim_steam and self._same_team_steam(victim_steam):
            mag = round(n * R.COEF_TK_NOK, 2)
            self._bump_keech_rp(server, -mag)
            return mag, me, pv, 1.0
        raw = round(n * R.COEF_ENEMY_NOK, 2)
        applied, gcoef = self._apply_keech_gain(server, at, raw)
        return applied, me, pv, gcoef

    def _delta_gotnok(
        self, killer: str, *, at: datetime, server: str, killer_steam: str = ""
    ) -> tuple[float, float, float]:
        """Being nokked −N×0.1 (enemy only). TK victim: 0 (penalty on killer)."""
        if not self._v2(at):
            return 0.0, 0.0, 0.0
        if killer_steam and self._same_team_steam(killer_steam):
            return 0.0, 0.0, 0.0
        n, me, pk = self._raw_n_as_victim(killer, server)
        mag = round(n * R.COEF_BEING_NOKKED, 2)
        self._bump_keech_rp(server, -mag)
        return mag, me, pk

    def _delta_revive(
        self, patient: str, *, at: datetime, server: str
    ) -> tuple[float, float, float, float]:
        n, me, pv = self._raw_n_as_killer(patient, server)
        if not self._v2(at):
            raw = round(n * R.REVIVE_COEF, 2)
            applied, gcoef = self._apply_keech_gain(server, at, raw)
            return applied, me, pv, gcoef
        own_nok = R.nick_key(patient) in self._last_wound_by_keech
        coef = R.COEF_REVIVE_OWN_NOK if own_nok else R.COEF_REVIVE
        raw = round(n * coef, 2)
        applied, gcoef = self._apply_keech_gain(server, at, raw)
        return applied, me, pv, gcoef

    def _new_bucket(self, server: str, layer: str, start: datetime) -> dict[str, Any]:
        short = _layer_short(layer) if layer else "?"
        self._reset_vehicle(server)
        row = {
            "id": f"{server}-{start.strftime('%Y%m%d-%H%M%S')}",
            "server": server,
            "layer": layer if layer else "?",
            "layerShort": short,
            "startAt": start.isoformat(),
            "endAt": None,
            "events": [],
            "net": 0.0,
            "noks": 0,
            "gotNoks": 0,
            "kills": 0,
            "deaths": 0,
            "revives": 0,
            "vehicleKills": 0,
            "vehicleLosses": 0,
        }
        self.matches[server] = row
        self._dirty = True
        return row

    def _ensure_match(self, server: str, layer: str, start: datetime) -> dict[str, Any]:
        """Open/rotate per-server match bucket. One layer = one bucket; never rename in place."""
        server = _norm_server(server)
        short = _layer_short(layer) if layer else "?"
        # Jensen/Seed: close previous real map into memory, but do not open a seed bucket.
        if layer and short not in ("", "?") and _is_seed_layer(layer):
            cur = self.matches.get(server)
            if cur and not cur.get("endAt") and cur.get("events"):
                prev = cur.get("layer") or cur.get("layerShort") or ""
                if not _is_seed_layer(str(prev)):
                    self._archive_match(cur, ended=start)
            self.matches.pop(server, None)
            self._dirty = True
            # Empty placeholder so callers have a dict; never archived / never scored.
            row = {
                "id": f"{server}-seed",
                "server": server,
                "layer": layer,
                "layerShort": short,
                "startAt": start.isoformat(),
                "endAt": None,
                "events": [],
                "net": 0.0,
                "noks": 0,
                "gotNoks": 0,
                "kills": 0,
                "deaths": 0,
                "revives": 0,
                "seed": True,
            }
            self.matches[server] = row
            return row

        cur = self.matches.get(server)

        if cur and not cur.get("endAt"):
            cur_short = cur.get("layerShort") or "?"
            # Same timestamp identity (rare) — allow discovering layer only on empty bucket
            if cur.get("startAt") == start.isoformat():
                if short not in ("", "?") and cur_short in ("", "?") and not cur.get("events"):
                    cur["layer"] = layer
                    cur["layerShort"] = short
                    self._dirty = True
                return cur

            # Still no layer name: keep absorbing only while empty of known layer
            if short in ("", "?"):
                return cur

            if cur_short in ("", "?"):
                # BUGFIX: never rename "?" → real map in place — that glued old kills
                # onto the new layer. Archive mystery bucket, start clean.
                if cur.get("events"):
                    self._archive_match(cur, ended=start)
                self.matches.pop(server, None)
                return self._new_bucket(server, layer, start)

            if short == cur_short:
                # Same layer name after a real map cycle (Gorodok→…→Gorodok) must
                # NOT reuse the old bucket — that glued finished-map kills into live.
                try:
                    st = datetime.fromisoformat(
                        str(cur.get("startAt") or "").replace("Z", "+00:00")
                    )
                    if st.tzinfo is None:
                        st = st.replace(tzinfo=timezone.utc)
                    gap = (start - st).total_seconds()
                except Exception:
                    gap = 0.0
                if gap <= 90:
                    # Mid-match SeamlessTravel / reload — keep
                    return cur
                if cur.get("events"):
                    self._archive_match(cur, ended=start)
                self.matches.pop(server, None)
                return self._new_bucket(server, layer, start)

            # Different map on same server → archive previous
            if cur.get("events"):
                self._archive_match(cur, ended=start)
            self.matches.pop(server, None)

        return self._new_bucket(server, layer, start)

    def _open_bucket(self, server: str, at: datetime) -> dict[str, Any]:
        server = _norm_server(server)
        cur = self.matches.get(server)
        if cur and not cur.get("endAt"):
            return cur
        return self._ensure_match(server, "?", at)

    def _bones_for(
        self, *, attacker_steam: str, victim_eos: str | None, at: datetime, window: float = HIT_WINDOW_SEC
    ) -> dict[str, int]:
        t0 = at.timestamp() - window
        bones: dict[str, int] = {}
        for h in self._hits:
            if h["at"].timestamp() < t0 or h["at"] > at:
                continue
            if h.get("asteam") != attacker_steam:
                continue
            if victim_eos and h.get("veos") and h["veos"] != victim_eos:
                continue
            b = h.get("bone") or ""
            if not b or b.lower() == "none":
                continue
            bones[b] = bones.get(b, 0) + 1
        return bones

    def _nick_of_steam(self, steam: str) -> str:
        return R.strip_tag(self.steam_nick.get(steam, f"?{steam[-6:]}"))

    def _nick_of_eos(self, eos: str) -> str:
        st = self.eos_steam.get(eos)
        if st:
            return self._nick_of_steam(st)
        return R.strip_tag(self.eos_nick.get(eos, f"?{eos[:6]}"))

    def _remember_kit(
        self, *, steam: str = "", nick: str = "", kit: str | None
    ) -> None:
        if not kit:
            return
        if steam:
            self._kit_by_steam[steam] = kit
        nk = R.nick_key(nick) if nick else ""
        if nk and nk != "keech":
            self._kit_by_nick[nk] = kit

    def _kit_of(self, *, steam: str = "", nick: str = "") -> str:
        if steam and steam in self._kit_by_steam:
            return self._kit_by_steam[steam]
        nk = R.nick_key(nick) if nick else ""
        if nk and nk in self._kit_by_nick:
            return self._kit_by_nick[nk]
        return ""

    def _parse_deploy_kit(self, line: str) -> None:
        if "DeployRole=" not in line:
            return
        if "RestartPlayer" not in line and "SpawnDefaultPawnFor" not in line:
            return
        dm = DEPLOY_RE.search(line)
        if not dm:
            return
        role = (dm.group("role") or "").strip().rstrip(",;")
        kit = _kit_from_role(role)
        if not kit:
            return
        nick = R.strip_tag(dm.group("nick") or "")
        steam = ""
        pm = PC_RE.search(line)
        if pm:
            steam = pm.group("steam") or ""
            nick = R.strip_tag(pm.group("nick") or nick)
            eos = (pm.group("eos") or "").lower()
            if eos and steam:
                self.eos_steam[eos] = steam
                self.eos_nick[eos] = nick
            if steam and nick:
                self.steam_nick[steam] = nick
        if not steam and nick:
            # reverse lookup from known steam_nick
            nk = R.nick_key(nick)
            for st, n in self.steam_nick.items():
                if R.nick_key(n) == nk:
                    steam = st
                    break
        self._remember_kit(steam=steam, nick=nick, kit=kit)

    def feed(self, line: str, server_key: str) -> None:
        if server_key not in SERVERS:
            return
        server = _norm_server(server_key)
        tm = LINE_TS.match(line)
        if not tm:
            return
        at = _parse_ts(tm.group("ts"))

        for pm in PC_RE.finditer(line):
            nick = R.strip_tag(pm.group("nick"))
            eos = pm.group("eos").lower()
            steam = pm.group("steam")
            self.steam_nick[steam] = nick
            self.eos_steam[eos] = steam
            self.eos_nick[eos] = nick
            if steam == KEECH_STEAM or R.nick_key(nick) == "keech":
                self._mark_keech_on(server)

        # Presence: Keech login / leave — Hunt live follows only that server.
        if "Login request:" in line:
            lm = LOGIN_RE.search(line)
            if lm:
                eos = (lm.group("eos") or "").lower()
                nick = R.strip_tag(lm.group("name") or "")
                if self._is_keech_eos(eos) or R.nick_key(nick) == "keech":
                    self._mark_keech_on(server)
        if "RemovePlayer" in line:
            rm = REMOVE_RE.search(line)
            if rm and self._is_keech_eos(rm.group("eos") or ""):
                self._mark_keech_left(server)

        if "has created Squad" in line:
            cm = R.CREATE_SQUAD_RE.search(line)
            if cm:
                self.steam_faction[cm.group("steam")] = (cm.group("faction") or "").strip()

        self._parse_deploy_kit(line)

        # Vehicle RP (enter/exit/dmg) — full crew state; emit only Keech rows.
        if self._veh_on(server, at) and (
            "Entered Vehicle" in line
            or "Exited Vehicle" in line
            or "SQBurningDamage" in line
            or ("damage taken by causer" in line and "health remaining" in line)
        ):
            self._parse_vehicle_line(line, at, server)

        # Map rotation only where Keech is. Combat below self-filters to Keech
        # and may mark presence (first fight after missed Login).
        if "SeamlessTravel to:" in line and "HandleSeamless" not in line and "InitSeamless" not in line and self._keech_here(server):
            m = R.TRAVEL_RE.search(line)
            if m:
                layer = m.group("path").strip()
                # New map — reset TK/own-nok/kit/vehicle context for this server feed
                self.steam_faction.clear()
                self._last_wound_by_keech.clear()
                self._kit_by_steam.clear()
                self._kit_by_nick.clear()
                self._reset_vehicle(server)
                # Force-close previous live bucket before opening the next
                # (covers missed WaitingPostMatch — finished map must leave live).
                cur = self.matches.get(server)
                if (
                    cur
                    and not cur.get("endAt")
                    and not cur.get("seed")
                    and cur.get("events")
                    and not _is_seed_layer(
                        str(cur.get("layer") or cur.get("layerShort") or "")
                    )
                ):
                    cur_short = cur.get("layerShort") or "?"
                    new_short = _layer_short(layer) if layer else "?"
                    try:
                        st = datetime.fromisoformat(
                            str(cur.get("startAt") or "").replace("Z", "+00:00")
                        )
                        if st.tzinfo is None:
                            st = st.replace(tzinfo=timezone.utc)
                        gap = (at - st).total_seconds()
                    except Exception:
                        gap = 9999.0
                    if new_short != cur_short or gap > 90:
                        self._archive_match(cur, ended=at)
                        self.matches.pop(server, None)
                        self._dirty = True
                self._ensure_match(server, layer, at)

        if (
            ("has won the match" in line or "has lost the match" in line)
            and self._keech_here(server)
        ):
            mm = MATCH_END_RE.search(line)
            if mm:
                layer = (mm.group("layer") or "").strip()
                cur = self.matches.get(server)
                if cur and layer and not _is_seed_layer(layer):
                    cur["layer"] = layer
                    cur["layerShort"] = _layer_short(layer)
                    self._dirty = True
                    # WaitingPostMatch often arrives BEFORE won/lost — finish archive now.
                    if cur.get("pendingEnd") or cur.get("endAt"):
                        ended = at
                        try:
                            ended = datetime.fromisoformat(
                                str(cur.get("pendingEnd") or cur.get("endAt") or "")
                                .replace("Z", "+00:00")
                            )
                            if ended.tzinfo is None:
                                ended = ended.replace(tzinfo=timezone.utc)
                        except Exception:
                            ended = at
                        self._archive_match(cur, ended=ended)
                        self.matches.pop(server, None)
                        self._dirty = True

        if (
            "Match State Changed" in line
            and "LogGameMode" in line
            and self._keech_here(server)
        ):
            sm = R.STATE_RE.search(line)
            if sm and sm.group("state") == "InProgress":
                cur = self.matches.get(server)
                layer = (cur or {}).get("layer") or "?"
                # New round after a finished map sometimes skips LeavingMap.
                # Only force-rotate when the open bucket has NO known layer ("?"):
                # a long live map (AlBasrah 40+ min) can re-fire InProgress and
                # must NOT be archived into «Память» while still going.
                if (
                    cur
                    and not cur.get("endAt")
                    and not cur.get("pendingEnd")
                    and cur.get("events")
                    and (cur.get("layerShort") or "?") in ("", "?")
                ):
                    try:
                        st = datetime.fromisoformat(
                            str(cur["startAt"]).replace("Z", "+00:00")
                        )
                        if st.tzinfo is None:
                            st = st.replace(tzinfo=timezone.utc)
                        gap = (at - st).total_seconds()
                    except Exception:
                        gap = 0.0
                    if gap > 15 * 60:
                        self._archive_match(cur, ended=at)
                        self.matches.pop(server, None)
                        layer = "?"
                self._ensure_match(server, layer, at)
            if sm and sm.group("state") in ("WaitingPostMatch", "LeavingMap"):
                cur = self.matches.get(server)
                if cur and not cur.get("endAt") and not cur.get("pendingEnd"):
                    cur["endAt"] = at.isoformat()
                    # If layer still unknown, wait for won/lost to name the map.
                    if (cur.get("layerShort") or "?") in ("", "?"):
                        cur["pendingEnd"] = at.isoformat()
                        self._dirty = True
                    else:
                        self._archive_match(cur, ended=at)
                        self.matches.pop(server, None)
                        self._dirty = True

        hm = HIT_RE.search(line)
        if hm:
            bone = (hm.group("bone") or "").strip()
            if bone and bone.lower() != "none":
                aeos = (hm.group("aeos") or "").strip().lower()
                asteam = (hm.group("asteam") or "").strip()
                if asteam.lower() == "none":
                    asteam = ""
                if not asteam and aeos and aeos != "none":
                    asteam = self.eos_steam.get(aeos, "")
                veos = (hm.group("veos") or "").strip().lower()
                if veos == "none":
                    veos = ""
                keech_eos = None
                for e, s in self.eos_steam.items():
                    if s == KEECH_STEAM:
                        keech_eos = e
                        break
                is_keech_atk = asteam == KEECH_STEAM or (
                    aeos not in ("", "none") and self.eos_steam.get(aeos) == KEECH_STEAM
                )
                is_keech_vic = bool(veos) and (
                    self.eos_steam.get(veos) == KEECH_STEAM or veos == keech_eos
                )
                if is_keech_atk or is_keech_vic:
                    self._mark_keech_on(server)
                    self._hits.append(
                        {
                            "at": at,
                            "asteam": asteam
                            or (
                                KEECH_STEAM
                                if is_keech_atk
                                else self.eos_steam.get(aeos, "")
                            ),
                            "veos": veos,
                            "bone": bone,
                            "zone": (hm.group("zone") or "Limb").strip(),
                            "onKeech": is_keech_vic,
                        }
                    )
                    if len(self._hits) > 400:
                        self._hits = self._hits[-300:]

        if "Wound():" in line:
            wm = R.WOUND_RE.search(line)
            if wm:
                victim_raw = wm.group("victim")
                ksteam = wm.group("steam")
                victim = R.strip_tag(victim_raw)
                vkey = R.nick_key(victim)
                # Nok = Wound() down. Card from cutover: enemy +N×0.1 / TK −N×0.5.
                if ksteam == KEECH_STEAM and vkey != "keech":
                    self._mark_keech_on(server)
                    veos = ""
                    for e, s in self.eos_steam.items():
                        if s != KEECH_STEAM and R.nick_key(
                            self.eos_nick.get(e, "")
                        ) == vkey:
                            veos = e
                            break
                    bones = self._bones_for(
                        attacker_steam=KEECH_STEAM,
                        victim_eos=veos or None,
                        at=at,
                    )
                    if not bones:
                        bones = self._bones_for(
                            attacker_steam=KEECH_STEAM,
                            victim_eos=None,
                            at=at,
                        )
                    # Resolve victim steam for TK
                    vsteam = ""
                    for e, s in self.eos_steam.items():
                        if R.nick_key(self.eos_nick.get(e, "")) == vkey:
                            vsteam = s
                            break
                    mag, _me, pv, gcoef = self._delta_nok(
                        victim, at=at, server=server, victim_steam=vsteam
                    )
                    tk = bool(vsteam and self._same_team_steam(vsteam) and self._v2(at))
                    dlt = -mag if tk else mag
                    if mag and not tk:
                        self._last_wound_by_keech[vkey] = at.timestamp()
                        # F2 kill → мехвод 70% if Keech is driver of same hull
                        eng = self._engine(server, at)
                        if eng and eng.gunner_key(KEECH_KEY):
                            scored = eng.credit_driver_share(
                                KEECH_KEY, mag, _msk_time(at), "nok"
                            )
                            self._emit_vehicle_score(server, at, scored)
                    kit = self._kit_of(steam=vsteam, nick=victim)
                    self._add_event(
                        server,
                        {
                            "id": f"n-{server}-{at.timestamp():.3f}-{vkey}",
                            "kind": "nok",
                            "at": at.isoformat(),
                            "time": _msk_time(at),
                            "nick": victim,
                            "kit": kit,
                            "delta": dlt,
                            "oppWeight": round(pv, 1) if mag else 0,
                            "bones": bones,
                            "server": server,
                            "teamkill": tk,
                            "gainCoef": gcoef if not tk and gcoef != 1.0 else None,
                        },
                        at,
                    )
                elif vkey == "keech" and ksteam != KEECH_STEAM:
                    self._mark_keech_on(server)
                    # Who knocked Keech down (Wound), not a final Die
                    attacker = self._nick_of_steam(ksteam)
                    bones_on_me: dict[str, int] = {}
                    t0 = at.timestamp() - HIT_WINDOW_SEC
                    for h in self._hits:
                        if not h.get("onKeech"):
                            continue
                        if h["at"].timestamp() < t0 or h["at"] > at:
                            continue
                        if h.get("asteam") and h["asteam"] != ksteam:
                            continue
                        b = h.get("bone") or ""
                        if not b or b.lower() == "none":
                            continue
                        bones_on_me[b] = bones_on_me.get(b, 0) + 1
                    mag, _me, pk = self._delta_gotnok(
                        attacker, at=at, server=server, killer_steam=ksteam
                    )
                    kit = self._kit_of(steam=ksteam, nick=attacker)
                    self._add_event(
                        server,
                        {
                            "id": f"gn-{server}-{at.timestamp():.3f}-{R.nick_key(attacker)}",
                            "kind": "gotnok",
                            "at": at.isoformat(),
                            "time": _msk_time(at),
                            "nick": attacker,
                            "kit": kit,
                            "delta": -mag if mag else 0.0,
                            "oppWeight": round(pk, 1) if mag else 0,
                            "bones": bones_on_me,
                            "server": server,
                        },
                        at,
                    )
                elif (
                    ksteam != KEECH_STEAM
                    and vkey != KEECH_KEY
                    and self._veh_on(server, at)
                    and self._v2(at)
                ):
                    # Teammate F2 nok while Keech is driver → мехвод 70%
                    vsteam_g = ""
                    for e, s in self.eos_steam.items():
                        if R.nick_key(self.eos_nick.get(e, "")) == vkey:
                            vsteam_g = s
                            break
                    keech_fac = (self.steam_faction.get(KEECH_STEAM) or "").strip().lower()
                    killer_fac = (self.steam_faction.get(ksteam) or "").strip().lower()
                    victim_fac = (
                        (self.steam_faction.get(vsteam_g) or "").strip().lower()
                        if vsteam_g
                        else ""
                    )
                    if (
                        keech_fac
                        and killer_fac == keech_fac
                        and victim_fac
                        and victim_fac != killer_fac
                    ):
                        n, _pk, _pv = self._raw_n_pair(
                            self._nick_of_steam(ksteam), victim, server
                        )
                        self._maybe_driver_share_from_gunner(
                            server=server,
                            at=at,
                            killer_steam=ksteam,
                            victim=victim,
                            reason="nok",
                            raw_gain=round(n * R.COEF_ENEMY_NOK, 2),
                        )

        if "Die():" in line:
            dm = R.DIE_RE.search(line)
            if dm:
                victim_raw = dm.group("victim")
                ksteam = dm.group("steam")
                victim = R.strip_tag(victim_raw)
                vkey = R.nick_key(victim)
                eng_boom = self._engine(server, at) if self._veh_on(server, at) else None
                if eng_boom and eng_boom.died_in_explosion(vkey, at):
                    pass
                elif ksteam == KEECH_STEAM and vkey != "keech":
                    self._mark_keech_on(server)
                    vsteam = ""
                    for e, s in self.eos_steam.items():
                        if R.nick_key(self.eos_nick.get(e, "")) == vkey:
                            vsteam = s
                            break
                    mag, _me, pv, gcoef = self._delta_kill(
                        victim, at=at, server=server, victim_steam=vsteam
                    )
                    tk = bool(vsteam and self._same_team_steam(vsteam) and self._v2(at))
                    dlt = -mag if tk else mag
                    if mag and not tk:
                        eng = self._engine(server, at)
                        if eng and eng.gunner_key(KEECH_KEY):
                            scored = eng.credit_driver_share(
                                KEECH_KEY, mag, _msk_time(at), "die"
                            )
                            self._emit_vehicle_score(server, at, scored)
                    veos = ""
                    for e, s in self.eos_steam.items():
                        if s != KEECH_STEAM and R.nick_key(self.eos_nick.get(e, "")) == vkey:
                            veos = e
                            break
                    bones = self._bones_for(attacker_steam=KEECH_STEAM, victim_eos=veos or None, at=at)
                    if not bones:
                        bones = self._bones_for(attacker_steam=KEECH_STEAM, victim_eos=None, at=at)
                    kit = self._kit_of(steam=vsteam, nick=victim)
                    self._add_event(
                        server,
                        {
                            "id": f"k-{server}-{at.timestamp()}-{vkey}",
                            "kind": "kill",
                            "at": at.isoformat(),
                            "time": _msk_time(at),
                            "nick": victim,
                            "kit": kit,
                            "delta": dlt,
                            "oppWeight": round(pv, 1),
                            "bones": bones,
                            "server": server,
                            "teamkill": tk,
                            "gainCoef": gcoef if not tk and gcoef != 1.0 else None,
                        },
                        at,
                    )
                elif (
                    ksteam != KEECH_STEAM
                    and vkey != KEECH_KEY
                    and self._veh_on(server, at)
                    and self._v2(at)
                ):
                    vsteam_g = ""
                    for e, s in self.eos_steam.items():
                        if R.nick_key(self.eos_nick.get(e, "")) == vkey:
                            vsteam_g = s
                            break
                    keech_fac = (self.steam_faction.get(KEECH_STEAM) or "").strip().lower()
                    killer_fac = (self.steam_faction.get(ksteam) or "").strip().lower()
                    victim_fac = (
                        (self.steam_faction.get(vsteam_g) or "").strip().lower()
                        if vsteam_g
                        else ""
                    )
                    if (
                        keech_fac
                        and killer_fac == keech_fac
                        and victim_fac
                        and victim_fac != killer_fac
                    ):
                        n, _pk, _pv = self._raw_n_pair(
                            self._nick_of_steam(ksteam), victim, server
                        )
                        self._maybe_driver_share_from_gunner(
                            server=server,
                            at=at,
                            killer_steam=ksteam,
                            victim=victim,
                            reason="die",
                            raw_gain=round(n * R.COEF_ENEMY_KILL, 2),
                        )
                elif vkey == "keech":
                    self._mark_keech_on(server)
                    if ksteam == KEECH_STEAM:
                        self._add_event(
                            server,
                            {
                                "id": f"s-{server}-{at.timestamp()}",
                                "kind": "self",
                                "at": at.isoformat(),
                                "time": _msk_time(at),
                                "nick": "сам",
                                "delta": 0.0,
                                "oppWeight": 0,
                                "bones": {},
                                "server": server,
                            },
                            at,
                        )
                    else:
                        killer = self._nick_of_steam(ksteam)
                        dlt, _me, pk = self._delta_death(killer, at=at, server=server)
                        bones_on_me: dict[str, int] = {}
                        t0 = at.timestamp() - HIT_WINDOW_SEC
                        for h in self._hits:
                            if not h.get("onKeech"):
                                continue
                            if h["at"].timestamp() < t0 or h["at"] > at:
                                continue
                            if h.get("asteam") and h["asteam"] != ksteam:
                                continue
                            b = h.get("bone") or ""
                            if not b or b.lower() == "none":
                                continue
                            bones_on_me[b] = bones_on_me.get(b, 0) + 1
                        kit = self._kit_of(steam=ksteam, nick=killer)
                        self._add_event(
                            server,
                            {
                                "id": f"d-{server}-{at.timestamp()}-{R.nick_key(killer)}",
                                "kind": "death",
                                "at": at.isoformat(),
                                "time": _msk_time(at),
                                "nick": killer,
                                "kit": kit,
                                "delta": -dlt,
                                "oppWeight": round(pk, 1),
                                "bones": bones_on_me,
                                "server": server,
                            },
                            at,
                        )

        if " has revived " in line:
            rm = R.REVIVE_RE.search(line)
            if rm and rm.group("msteam") == KEECH_STEAM:
                self._mark_keech_on(server)
                patient = R.strip_tag(rm.group("patient"))
                dlt, _me, pv, gcoef = self._delta_revive(patient, at=at, server=server)
                self._last_wound_by_keech.pop(R.nick_key(patient), None)
                self._add_event(
                    server,
                    {
                        "id": f"r-{server}-{at.timestamp()}-{R.nick_key(patient)}",
                        "kind": "revive",
                        "at": at.isoformat(),
                        "time": _msk_time(at),
                        "nick": patient,
                        "delta": dlt,
                        "oppWeight": round(pv, 1),
                        "bones": {},
                        "server": server,
                        "gainCoef": gcoef if gcoef != 1.0 else None,
                    },
                    at,
                )

        self._flush_if_needed()

    def _add_event(self, server: str, ev: dict[str, Any], at: datetime) -> None:
        bucket = self._open_bucket(server, at)
        if (
            bucket.get("seed")
            or bucket.get("endAt")
            or bucket.get("pendingEnd")
            or _is_seed_layer(
                str(bucket.get("layer") or bucket.get("layerShort") or "")
            )
        ):
            return
        # Never append into a finished map that is still lingering open.
        if self._is_stale_open(bucket, now=at):
            self._archive_match(bucket, ended=at)
            self.matches.pop(_norm_server(server), None)
            bucket = self._ensure_match(server, "?", at)
            if bucket.get("seed") or _is_seed_layer(
                str(bucket.get("layer") or bucket.get("layerShort") or "")
            ):
                return
        ids = {e.get("id") for e in bucket["events"]}
        if ev["id"] in ids:
            return
        row = dict(ev)
        row["server"] = row.get("server") or server
        row["layerShort"] = bucket.get("layerShort") or "?"
        row["matchId"] = bucket.get("id")
        bucket["events"].append(row)
        bucket["net"] = round(sum(float(e.get("delta") or 0) for e in bucket["events"]), 2)
        bucket["noks"] = sum(1 for e in bucket["events"] if e.get("kind") == "nok")
        bucket["gotNoks"] = sum(
            1 for e in bucket["events"] if e.get("kind") == "gotnok"
        )
        bucket["kills"] = sum(
            1
            for e in bucket["events"]
            if e.get("kind") in ("kill", *_VEH_KILL_KINDS)
        )
        bucket["deaths"] = sum(
            1
            for e in bucket["events"]
            if e.get("kind") in ("death", "self", *_VEH_LOSS_KINDS)
        )
        bucket["revives"] = sum(1 for e in bucket["events"] if e.get("kind") == "revive")
        bucket["vehicleKills"] = sum(
            1 for e in bucket["events"] if e.get("kind") == "vehicle_kill"
        )
        bucket["vehicleLosses"] = sum(
            1 for e in bucket["events"] if e.get("kind") in _VEH_LOSS_KINDS
        )
        self._dirty = True

    def _archive_match(self, row: dict[str, Any], ended: datetime) -> None:
        if not row or row.get("seed"):
            return
        layer = str(row.get("layer") or row.get("layerShort") or "")
        short = str(row.get("layerShort") or "")
        if _is_seed_layer(layer):
            return
        # Never put mystery "?" buckets into «Память» — only real finished maps.
        if short in ("", "?"):
            return
        archived = dict(row)
        archived["endAt"] = archived.get("endAt") or ended.isoformat()
        if not archived.get("events"):
            return
        if len(archived["events"]) < 2:
            return
        mem = self._load_memory()
        mem = [m for m in mem if m.get("id") != archived["id"]]
        mem.insert(0, archived)
        mem = mem[:MEMORY_MAX]
        MEMORY_PATH.write_text(
            json.dumps(
                {"updatedAt": datetime.now(timezone.utc).isoformat(), "matches": mem},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    def _load_memory(self) -> list[dict[str, Any]]:
        if not MEMORY_PATH.is_file():
            return []
        try:
            data = json.loads(MEMORY_PATH.read_text(encoding="utf-8"))
            return list(data.get("matches") or [])
        except Exception:
            return []

    def _merged_totals(self) -> dict[str, Any]:
        events: list[dict[str, Any]] = []
        for m in self.matches.values():
            events.extend(m.get("events") or [])
        return {
            "net": round(sum(float(e.get("delta") or 0) for e in events), 2),
            "noks": sum(1 for e in events if e.get("kind") == "nok"),
            "gotNoks": sum(1 for e in events if e.get("kind") == "gotnok"),
            "kills": sum(1 for e in events if e.get("kind") == "kill"),
            "deaths": sum(1 for e in events if e.get("kind") in ("death", "self")),
            "revives": sum(1 for e in events if e.get("kind") == "revive"),
            "events": sorted(events, key=lambda e: str(e.get("at") or "")),
        }

    def _write_live_empty(self) -> None:
        LIVE_PATH.write_text(
            json.dumps(
                {
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "match": None,
                    "matches": [],
                    "keechSteam": KEECH_STEAM,
                    "keechServer": None,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    def _flush_if_needed(self, force: bool = False) -> None:
        if not self._dirty and not force:
            return
        now = time.time()
        if not force and (now - self._last_write) < 1.0:
            return
        self._dirty = False
        self._last_write = now
        now_dt = datetime.now(timezone.utc)
        # Sweep stale "open" buckets into memory so live UI never shows a finished map.
        for srv, row in list(self.matches.items()):
            if self._is_stale_open(row, now=now_dt):
                try:
                    ev = row.get("events") or []
                    ended = now_dt
                    if ev:
                        ended = datetime.fromisoformat(
                            str(ev[-1].get("at") or "").replace("Z", "+00:00")
                        )
                        if ended.tzinfo is None:
                            ended = ended.replace(tzinfo=timezone.utc)
                    self._archive_match(row, ended=ended)
                except Exception:
                    self._archive_match(row, ended=now_dt)
                self.matches.pop(srv, None)
        open_list = sorted(
            [
                m
                for m in self.matches.values()
                if m
                and not m.get("endAt")
                and not m.get("seed")
                and not _is_seed_layer(
                    str(m.get("layer") or m.get("layerShort") or "")
                )
            ],
            key=lambda m: str(m.get("startAt") or ""),
        )
        # Primary = current map only. Finished → «Память», never live columns.
        primary = self._primary_match()
        match_out = dict(primary) if primary else None
        # Chips / live: only the server Keech is on (empty if offline).
        if self.keech_server:
            open_list = [
                m for m in open_list if _norm_server(str(m.get("server") or "")) == self.keech_server
            ]
        else:
            open_list = []
            match_out = None
        payload = {
            "updatedAt": now_dt.isoformat(),
            "match": match_out,
            "matches": open_list,
            "keechSteam": KEECH_STEAM,
            "keechServer": self.keech_server,
        }
        LIVE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def flush(self) -> None:
        self._flush_if_needed(force=True)

    def bootstrap_text(self, text: str, server_key: str) -> None:
        """Replay recent log chunk to rebuild current match (collector start)."""
        for ln in text.splitlines():
            self.feed(ln, server_key)
        self.flush()
