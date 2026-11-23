# -*- coding: utf-8 -*-
"""Исключения орг. ролей: в боте и каналах без ClanMember BlackBerry.

Стримеры / медиа — не игроки. Варн «не в клане BB / сайт» им не шлём.
Аккаунт на сайте оставляем; свой клан помощников — позже, без давления.
"""
from __future__ import annotations

from typing import Any

# steamId64 → карточка. Канон: platform/docs/BB-ORG-STREAMERS.md
STREAMERS: dict[str, dict[str, Any]] = {
    "76561199421997729": {
        "nick": "Shmeliys",
        "site_nick": "Shmeliys YouTube",
        "name": "Станислав",
        "joined": "2026-11-18",
        "role": "streamer",
        "note": (
            "Орг. стример BlackBerry (не игрок). "
            "Бот + сайт + два канала — норма. "
            "ClanMember BB снят; свой клан помощников создаст позже. "
            "Варн «не в клане BB» не слать."
        ),
    },
}


def is_clan_exempt(steam_id: str | None) -> bool:
    """True → проверку «в клане BB на сайте» для gap-алертов пропускаем."""
    sid = (steam_id or "").strip()
    return bool(sid) and sid in STREAMERS


def streamer_card(steam_id: str | None) -> dict[str, Any] | None:
    sid = (steam_id or "").strip()
    return STREAMERS.get(sid)
