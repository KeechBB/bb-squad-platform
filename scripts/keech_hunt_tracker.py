#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Keech-only live hunt tracker (PB1/TPUB1 + optional TR).

Writes:
  platform/data/keech-hunt/live.json
  platform/data/keech-hunt/memory.json

Fed line-by-line from squad_log_collector.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import rp_log_parse as R

HERE = Path(__file__).resolve().parent
PLATFORM = HERE.parent
OUT_DIR = PLATFORM / "data" / "keech-hunt"
LIVE_PATH = OUT_DIR / "live.json"
MEMORY_PATH = OUT_DIR / "memory.json"
LEDGER_PATH = PLATFORM / "data" / "public" / "rp-ledger.json"

KEECH_STEAM = "76561198028435874"
HIT_WINDOW_SEC = 45.0
MEMORY_MAX = 40
SERVERS = frozenset({"TPUB1", "PB1", "PUB", "TR1", "TR2"})

MSK = timezone(timedelta(hours=3))
LINE_TS = re.compile(r"^\[(?P<ts>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})")
PC_RE = re.compile(
    r"PC=(?P<nick>.+?)\s*\(Online IDs:\s*EOS:\s*(?P<eos>[0-9a-fA-F]+)\s+steam:\s*(?P<steam>7656\d+)",
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


class KeechHuntTracker:
    def __init__(self) -> None:
        self.steam_nick: dict[str, str] = {}
        self.eos_steam: dict[str, str] = {}
        self.eos_nick: dict[str, str] = {}
        # recent hits: list of {at, asteam, veos, bone, zone, dmg}
        self._hits: list[dict[str, Any]] = []
        self.match: dict[str, Any] | None = None
        self._dirty = False
        self._last_write = 0.0
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        if not LIVE_PATH.is_file():
            self._write_live_empty()

    def _rp_map(self) -> tuple[dict[str, float], float]:
        start = float(R.START_RP)
        rp: dict[str, float] = {}
        if LEDGER_PATH.is_file():
            try:
                data = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
                for k, row in (data.get("players") or {}).items():
                    if isinstance(row, dict) and row.get("rp") is not None:
                        rp[str(k)] = float(row["rp"])
                if data.get("pMax") is not None:
                    return rp, max(float(data["pMax"]), start)
            except Exception:
                pass
        pmax = max(rp.values()) if rp else start
        return rp, max(pmax, start)

    def _weight(self, nick: str, rp: dict[str, float]) -> float:
        k = R.nick_key(nick)
        return float(rp.get(k, R.START_RP))

    def _delta_kill(self, victim: str) -> tuple[float, float, float]:
        rp, pmax = self._rp_map()
        me = float(rp.get("keech", R.START_RP))
        pv = self._weight(victim, rp)
        return round(R.hunt_delta(me, pv, pmax), 2), me, pv

    def _delta_death(self, killer: str) -> tuple[float, float, float]:
        rp, pmax = self._rp_map()
        me = float(rp.get("keech", R.START_RP))
        pk = self._weight(killer, rp)
        return round(R.hunt_delta(pk, me, pmax), 2), me, pk

    def _delta_revive(self, patient: str) -> tuple[float, float, float]:
        rp, pmax = self._rp_map()
        me = float(rp.get("keech", R.START_RP))
        pv = self._weight(patient, rp)
        d = round(R.hunt_delta(me, pv, pmax) * R.REVIVE_COEF, 2)
        return d, me, pv

    def _ensure_match(self, server: str, layer: str, start: datetime) -> None:
        if self.match and self.match.get("server") == server and self.match.get("startAt") == start.isoformat():
            return
        # closing previous open match into memory if had events
        if self.match and (self.match.get("events") or []):
            self._archive_match(ended=start)
        self.match = {
            "id": f"{server}-{start.strftime('%Y%m%d-%H%M%S')}",
            "server": server,
            "layer": layer,
            "layerShort": _layer_short(layer),
            "startAt": start.isoformat(),
            "endAt": None,
            "events": [],
            "net": 0.0,
            "kills": 0,
            "deaths": 0,
            "revives": 0,
        }
        self._dirty = True

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

    def feed(self, line: str, server_key: str) -> None:
        if server_key not in SERVERS:
            return
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

        if "SeamlessTravel to:" in line and "HandleSeamless" not in line and "InitSeamless" not in line:
            m = R.TRAVEL_RE.search(line)
            if m:
                layer = m.group("path").strip()
                self._ensure_match(server_key, layer, at)

        if "Match State Changed" in line and "LogGameMode" in line:
            sm = R.STATE_RE.search(line)
            if sm and sm.group("state") == "InProgress":
                layer = (self.match or {}).get("layer") or "?"
                self._ensure_match(server_key, layer, at)
            if sm and sm.group("state") in ("WaitingPostMatch", "LeavingMap"):
                if self.match and not self.match.get("endAt"):
                    self.match["endAt"] = at.isoformat()
                    self._archive_match(ended=at)
                    self.match = None
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

        if "Die():" in line:
            dm = R.DIE_RE.search(line)
            if dm and self.match:
                victim_raw = dm.group("victim")
                ksteam = dm.group("steam")
                victim = R.strip_tag(victim_raw)
                vkey = R.nick_key(victim)
                if ksteam == KEECH_STEAM and vkey != "keech":
                    dlt, _me, pv = self._delta_kill(victim)
                    veos = ""
                    for e, s in self.eos_steam.items():
                        if s != KEECH_STEAM and R.nick_key(self.eos_nick.get(e, "")) == vkey:
                            veos = e
                            break
                    bones = self._bones_for(attacker_steam=KEECH_STEAM, victim_eos=veos or None, at=at)
                    # if no eos filter match, take all keech hits in window
                    if not bones:
                        bones = self._bones_for(attacker_steam=KEECH_STEAM, victim_eos=None, at=at)
                    self._add_event(
                        {
                            "id": f"k-{at.timestamp()}-{vkey}",
                            "kind": "kill",
                            "at": at.isoformat(),
                            "time": _msk_time(at),
                            "nick": victim,
                            "delta": dlt,
                            "oppWeight": round(pv, 1),
                            "bones": bones,
                            "server": server_key,
                        }
                    )
                elif vkey == "keech":
                    if ksteam == KEECH_STEAM:
                        self._add_event(
                            {
                                "id": f"s-{at.timestamp()}",
                                "kind": "self",
                                "at": at.isoformat(),
                                "time": _msk_time(at),
                                "nick": "сам",
                                "delta": 0.0,
                                "oppWeight": 0,
                                "bones": {},
                                "server": server_key,
                            }
                        )
                    else:
                        killer = self._nick_of_steam(ksteam)
                        dlt, _me, pk = self._delta_death(killer)
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
                        self._add_event(
                            {
                                "id": f"d-{at.timestamp()}-{R.nick_key(killer)}",
                                "kind": "death",
                                "at": at.isoformat(),
                                "time": _msk_time(at),
                                "nick": killer,
                                "delta": -dlt,
                                "oppWeight": round(pk, 1),
                                "bones": bones_on_me,
                                "server": server_key,
                            }
                        )

        if " has revived " in line:
            rm = R.REVIVE_RE.search(line)
            if rm and self.match and rm.group("msteam") == KEECH_STEAM:
                patient = R.strip_tag(rm.group("patient"))
                dlt, _me, pv = self._delta_revive(patient)
                self._add_event(
                    {
                        "id": f"r-{at.timestamp()}-{R.nick_key(patient)}",
                        "kind": "revive",
                        "at": at.isoformat(),
                        "time": _msk_time(at),
                        "nick": patient,
                        "delta": dlt,
                        "oppWeight": round(pv, 1),
                        "bones": {},
                        "server": server_key,
                    }
                )

        self._flush_if_needed()

    def _add_event(self, ev: dict[str, Any]) -> None:
        if not self.match:
            # open anonymous match bucket
            self._ensure_match(ev.get("server") or "TPUB1", "?", datetime.now(timezone.utc))
        assert self.match is not None
        # de-dupe by id
        ids = {e.get("id") for e in self.match["events"]}
        if ev["id"] in ids:
            return
        self.match["events"].append(ev)
        self.match["net"] = round(sum(float(e.get("delta") or 0) for e in self.match["events"]), 2)
        self.match["kills"] = sum(1 for e in self.match["events"] if e.get("kind") == "kill")
        self.match["deaths"] = sum(
            1 for e in self.match["events"] if e.get("kind") in ("death", "self")
        )
        self.match["revives"] = sum(1 for e in self.match["events"] if e.get("kind") == "revive")
        self._dirty = True

    def _archive_match(self, ended: datetime) -> None:
        if not self.match:
            return
        row = dict(self.match)
        row["endAt"] = row.get("endAt") or ended.isoformat()
        if not row.get("events"):
            return
        mem = self._load_memory()
        mem = [m for m in mem if m.get("id") != row["id"]]
        mem.insert(0, row)
        mem = mem[:MEMORY_MAX]
        MEMORY_PATH.write_text(
            json.dumps({"updatedAt": datetime.now(timezone.utc).isoformat(), "matches": mem}, ensure_ascii=False, indent=2)
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

    def _write_live_empty(self) -> None:
        LIVE_PATH.write_text(
            json.dumps(
                {
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "match": None,
                    "keechSteam": KEECH_STEAM,
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
        payload = {
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "match": self.match,
            "keechSteam": KEECH_STEAM,
        }
        LIVE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def flush(self) -> None:
        self._flush_if_needed(force=True)

    def bootstrap_text(self, text: str, server_key: str) -> None:
        """Replay recent log chunk to rebuild current match (collector start)."""
        for ln in text.splitlines():
            self.feed(ln, server_key)
        self.flush()
