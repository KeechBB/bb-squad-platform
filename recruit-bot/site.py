# -*- coding: utf-8 -*-
"""Сверка и кик по клану BlackBerry. Игрок на сайте ищется по SteamID64."""
from __future__ import annotations

import os
import time
import secrets
from typing import Any

_clan: dict[str, Any] | None = None
_clan_at = 0.0


def _psycopg_dsn(url: str) -> str:
    if "://" not in url or "?" not in url:
        return url
    base, _, qs = url.partition("?")
    kept = [p for p in qs.split("&") if p and not p.lower().startswith("schema=")]
    return f"{base}?{'&'.join(kept)}" if kept else base


def _connect():
    url = _psycopg_dsn((os.environ.get("DATABASE_URL") or "").strip())
    if not url:
        raise RuntimeError("DATABASE_URL пуст")
    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(url)
    conn.autocommit = False
    return conn, psycopg2.extras


def clan() -> dict[str, Any] | None:
    """id, tag, name. Кэш на минуту."""
    global _clan, _clan_at
    if _clan and time.time() - _clan_at < 60:
        return _clan
    name = (os.environ.get("CLAN_NAME") or "BlackBerry").strip()
    tag = (os.environ.get("CLAN_TAG") or "").strip()
    conn, extras = _connect()
    try:
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)
        cur.execute(
            """
            SELECT id, tag, name
            FROM "Clan"
            WHERE "isExternal" = false
              AND (
                lower(name) = lower(%s)
                OR (%s <> '' AND lower(tag) = lower(%s))
              )
            ORDER BY CASE WHEN lower(name) = lower(%s) THEN 0 ELSE 1 END
            LIMIT 1
            """,
            (name, tag, tag, name),
        )
        row = cur.fetchone()
        _clan = dict(row) if row else None
        _clan_at = time.time()
        return _clan
    finally:
        conn.close()


def lookup_steam(steam_id: str, claimed_nick: str = "") -> dict[str, Any]:
    """
    Аккаунт сайта по SteamID64.
    user_id, nick, nick_match, in_clan, role, other_clan, join_pending.
    in_clan только для BlackBerry.
    """
    steam_id = (steam_id or "").strip()
    if not steam_id:
        return {"found": False, "in_clan": False, "join_pending": False, "nick_match": False}
    conn, extras = _connect()
    try:
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)
        cur.execute(
            """
            SELECT u.id AS user_id, u.nick
            FROM "User" u
            WHERE u."steamId" = %s
            LIMIT 1
            """,
            (steam_id,),
        )
        user = cur.fetchone()
        if not user:
            return {"found": False, "in_clan": False, "join_pending": False, "nick_match": False}
        target = clan()
        cur.execute(
            """
            SELECT c.id AS clan_id, c.tag, c.name, c."isExternal" AS external,
                   cm.id AS member_id, cm.role
            FROM "ClanMember" cm
            JOIN "Clan" c ON c.id = cm."clanId"
            WHERE cm."userId" = %s
            LIMIT 1
            """,
            (user["user_id"],),
        )
        mem = cur.fetchone()
        pending = False
        if target:
            cur.execute(
                """
                SELECT 1
                FROM "ClanJoinRequest"
                WHERE "userId" = %s AND "clanId" = %s AND status = 'PENDING'
                LIMIT 1
                """,
                (user["user_id"], target["id"]),
            )
            pending = cur.fetchone() is not None
        in_clan = bool(
            mem and target and mem["clan_id"] == target["id"] and not mem["external"]
        )
        other = None
        if mem and not in_clan:
            other = f"[{mem['tag']}] {mem['name']}"
        site_nick = (user["nick"] or "").strip()
        claimed = (claimed_nick or "").strip()
        return {
            "found": True,
            "user_id": user["user_id"],
            "nick": site_nick,
            "nick_match": bool(claimed) and site_nick.lower() == claimed.lower(),
            "in_clan": in_clan,
            "role": mem["role"] if in_clan else None,
            "member_id": mem["member_id"] if in_clan else None,
            "other_clan": other,
            "join_pending": pending,
        }
    finally:
        conn.close()


def _cuid() -> str:
    return f"c{int(time.time() * 1000):x}{secrets.token_hex(6)}"


def kick(steam_id: str, by: str) -> str:
    """Снять с клана аккаунт с этим SteamID64."""
    info = lookup_steam(steam_id)
    if not (steam_id or "").strip():
        return "SteamID64 не записан"
    if not info.get("found"):
        return "на сайте нет аккаунта с этим SteamID64"
    if not info.get("in_clan"):
        if info.get("other_clan"):
            return f"не в BlackBerry, состоит в {info['other_clan']}"
        return "в клане на сайте нет"
    if info.get("role") == "LEADER":
        return "это глава клана, бот его не снимает"
    target = clan()
    if not target:
        return "клан BlackBerry на сайте не найден"
    user_id = info["user_id"]
    conn, extras = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            DELETE FROM "ClanSquadMember"
            WHERE "userId" = %s
              AND "squadId" IN (SELECT id FROM "ClanSquad" WHERE "clanId" = %s)
            """,
            (user_id, target["id"]),
        )
        cur.execute(
            'DELETE FROM "ClanMember" WHERE id = %s AND "clanId" = %s',
            (info["member_id"], target["id"]),
        )
        if cur.rowcount != 1:
            conn.rollback()
            return "строка участника уже исчезла"
        cur.execute(
            """
            UPDATE "Clan"
            SET "soloSince" = CASE
              WHEN (SELECT COUNT(*) FROM "ClanMember" WHERE "clanId" = %s) >= 2 THEN NULL
              WHEN (SELECT COUNT(*) FROM "ClanMember" WHERE "clanId" = %s) = 1
                   AND "soloSince" IS NULL THEN NOW()
              ELSE "soloSince"
            END,
            "updatedAt" = NOW()
            WHERE id = %s
            """,
            (target["id"], target["id"], target["id"]),
        )
        msg = f"{by} кикнул {info['nick']} из [{target['tag']}] {target['name']} (бот регистрации)"
        cur.execute(
            """
            INSERT INTO "ActionLog"(
              id, "createdAt", category, action, message, "searchText",
              "actorNick", "targetId", "targetNick", "clanId", "clanTag"
            ) VALUES (%s, NOW(), 'clan', 'kick', %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                _cuid(),
                msg,
                msg.lower(),
                by[:80],
                user_id,
                info["nick"],
                target["id"],
                target["tag"],
            ),
        )
        conn.commit()
        return "снят с клана на сайте"
    except Exception as e:
        conn.rollback()
        return f"сайт не снял: {type(e).__name__}"
    finally:
        conn.close()


def still_in_clan(steam_id: str) -> bool | None:
    try:
        if not (steam_id or "").strip():
            return False
        return bool(lookup_steam(steam_id).get("in_clan"))
    except Exception:
        return None
