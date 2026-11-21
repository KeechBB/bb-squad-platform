#!/usr/bin/env python3
"""BlackBerry identity.

The person is the Steam ID on the site. The nick is only a label.
A match line is written onto an account when the Steam in the log is that
account's Steam. A nick worn for one round still lands on the same account.
Two different Steams with the same nick are not glued together.
Steam IDs are not printed.
"""
from __future__ import annotations

import re
import subprocess
from collections import defaultdict

_TAG = re.compile(r"\[[^\]]*\]")
_KEY = re.compile(r"[^0-9a-zA-Z]")


def nick_key(raw: str) -> str:
    s = _TAG.sub(" ", raw or "")
    return _KEY.sub("", s).lower()


class BbIdentity:
    def __init__(self) -> None:
        self.steam_to_key: dict[str, str] = {}
        self.key_owners: dict[str, set[str]] = defaultdict(set)
        self.mask_by_key: dict[str, str] = {}
        self.labels: set[str] = set()
        # Сжатый ник есть и у человека вне клана. По одному нику таких не склеивать.
        self.ambiguous: set[str] = set()

    def add(self, steam: str, site_nick: str, steam_name: str) -> None:
        key = nick_key(site_nick) or nick_key(steam_name)
        if not key or not steam:
            return
        self.steam_to_key[steam] = key
        self.key_owners[key].add(steam)
        shown = (steam_name or site_nick or "").strip()
        if shown and key not in self.mask_by_key:
            self.mask_by_key[key] = shown
        for label in (site_nick, steam_name):
            text = (label or "").strip()
            if not text:
                continue
            self.labels.add(text.casefold())
            extra = nick_key(text)
            if extra:
                self.key_owners[extra].add(steam)

    def member_name(self, name: str) -> bool:
        """Имя из списка китов — только если это ник или имя Steam человека из клана."""
        return (name or "").strip().casefold() in self.labels

    def mark_other(self, nick: str, steam_name: str) -> None:
        for label in (nick, steam_name):
            key = nick_key(label)
            if key and key in self.key_owners:
                self.ambiguous.add(key)

    def known(self, key: str) -> bool:
        return bool(key) and key in self.key_owners

    def owners(self, key: str) -> int:
        return len(self.key_owners.get(key) or ())

    def mask(self, key: str, fallback: str) -> str:
        return self.mask_by_key.get(key) or fallback


def load_bb_identity() -> BbIdentity | None:
    sql = (
        "SELECT u.\"steamId\", COALESCE(u.nick, ''), COALESCE(u.\"steamName\", '') "
        "FROM \"ClanMember\" m "
        "JOIN \"User\" u ON u.id = m.\"userId\" "
        "JOIN \"Clan\" c ON c.id = m.\"clanId\" "
        "WHERE upper(c.tag) = 'BB' AND c.\"isExternal\" = false "
        "AND COALESCE(u.\"steamId\", '') <> ''"
    )
    try:
        proc = subprocess.run(
            ["sudo", "-u", "postgres", "psql", "-d", "bb_squad", "-At", "-F", "\t", "-c", sql],
            capture_output=True,
            text=True,
            timeout=40,
        )
    except Exception as exc:
        print("bb identity skipped", exc.__class__.__name__)
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        print("bb identity skipped")
        return None
    ident = BbIdentity()
    for line in proc.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        steam, nick, steam_name = parts[0].strip(), parts[1].strip(), parts[2].strip()
        if not steam.startswith("7656"):
            continue
        ident.add(steam, nick, steam_name)
    if not ident.steam_to_key:
        print("bb identity empty")
        return None
    others = (
        "SELECT COALESCE(u.nick, ''), COALESCE(u.\"steamName\", '') "
        "FROM \"User\" u "
        "WHERE NOT EXISTS ("
        "  SELECT 1 FROM \"ClanMember\" m "
        "  JOIN \"Clan\" c ON c.id = m.\"clanId\" "
        "  WHERE m.\"userId\" = u.id AND upper(c.tag) = 'BB' AND c.\"isExternal\" = false"
        ")"
    )
    more = subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-d", "bb_squad", "-At", "-F", "\t", "-c", others],
        capture_output=True,
        text=True,
        timeout=40,
    )
    if more.returncode == 0:
        for line in more.stdout.splitlines():
            parts = line.split("\t")
            nick = parts[0].strip() if parts else ""
            steam_name = parts[1].strip() if len(parts) > 1 else ""
            ident.mark_other(nick, steam_name)
    print("bb identity", len(ident.steam_to_key), "clan", "shared", len(ident.ambiguous))
    return ident


class MatchConfirm:
    """Fold a worn nick onto the site account when the Steam matches."""

    def __init__(self, ident: BbIdentity | None, roster_keys: set[str]) -> None:
        self.ident = ident
        self.roster_keys = set(roster_keys)
        self.steam_to: dict[str, str] = {}
        self.eos_to: dict[str, str] = {}
        self.possesses: list[tuple] = []

    def observe(self, ts, srv: str, nick: str, steam: str, eos: str | None = None) -> None:
        worn = nick_key(nick)
        if worn and steam and ts is not None:
            self.possesses.append((ts, srv, worn, steam))
        if not steam:
            return
        if self.ident is None:
            if worn:
                self.steam_to[steam] = worn
                if eos:
                    self.eos_to[eos.lower()] = worn
            return
        roster = self.ident.steam_to_key.get(steam)
        if roster and roster in self.roster_keys:
            self.steam_to[steam] = roster
            if eos:
                self.eos_to[eos.lower()] = roster

    def fold(self, t0, t1, srv: str, raw_key: str) -> str | None:
        if not raw_key:
            return None
        if self.ident is None:
            return raw_key
        steams = {
            steam
            for ts, ssrv, worn, steam in self.possesses
            if ssrv == srv and worn == raw_key and ts is not None and t0 <= ts < t1
        }
        if len(steams) > 1:
            # Несколько Steam на одном нике в окне — только наш клановый, если ровно один.
            bb = {s for s in steams if s in self.ident.steam_to_key}
            if len(bb) == 1:
                return self.steam_to.get(next(iter(bb))) or self.ident.steam_to_key.get(
                    next(iter(bb))
                )
            return None
        if len(steams) == 1:
            # Чужой Steam на этом нике не записывается на аккаунт клана.
            return self.steam_to.get(next(iter(steams)))
        # Нет possess в окне: если ник в ростере и у клана один владелец — это наш человек
        # (кейс angel: омоним вне BB помечает nick ambiguous, но Саня один в клане).
        if raw_key in self.roster_keys and self.ident.owners(raw_key) == 1:
            return raw_key
        if raw_key in self.ident.ambiguous:
            return None
        if raw_key in self.roster_keys and self.ident.owners(raw_key) > 1:
            return None
        return raw_key
