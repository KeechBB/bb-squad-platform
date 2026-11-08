# -*- coding: utf-8 -*-
"""
Бот регистрации в клан BlackBerry.

Шаг 1. Ник (Имя), пример: Keech (Александр)
Шаг 2. SteamID64 — по нему ищется аккаунт, с которым человек зашёл на сайт
Шаг 3. Регистрация на сайте и приём в клан кадровиком
Шаг 4. Подписка на канал и группу (личные одноразовые invite-ссылки)
После входа в группу бот ставит игровой ник в тег участника.
Дальше бот следит за сайтом и обоими чатами: если человек пропал
из чата — только алерт кадровикам (раз в час), автокика нет.
Кик с сайта/чатов — только вручную из меню кадровика.

Кадровики назначаются в боте.
Промежуточные алерты → ALERT_CHAT_ID (Bot для набора).
Финал «Новый участник клана…» → ANNOUNCE_CHAT_ID (Основной).
Своя база: data/recruit.sqlite, выгрузка двумя CSV.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path

import db
import clan_site as site

HERE = Path(__file__).resolve().parent
PAGE = 6
_last_done_poll = 0.0

ASK_NICK = (
    "Шаг 1 из 4.\n"
    "Напиши ник как в игре и имя в скобках.\n"
    "Пример: Keech (Александр)\n\n"
    "Дальше бот сам ведёт тебя по шагам — ничего лишний раз жать не нужно."
)

ASK_STEAM = (
    "Шаг 2 из 4.\n"
    "Пришли SteamID64: 17 цифр, начинается с 7656.\n"
    "Можно ссылкой: steamcommunity.com/profiles/7656…\n\n"
    "Важно: это должен быть тот же Steam, с которым ты заходишь на сайт bb-squad.ru.\n"
    "После отправки бот сам проверит сайт — ждать сообщение, не пиши сюда лишнего."
)

HR_BUTTONS = {
    "Поиск",
    "Поиск по нику",
    "Удалить игрока",
    "Сменить ник",
    "Кто на регистрации",
    "Назначить куратора",
    "Снять куратора",
    "Выгрузить базу",
}

STEP_RU = {
    db.STEP_NICK: "шаг 1, ждёт ник",
    db.STEP_STEAM: "шаг 2, ждёт SteamID64",
    db.STEP_SITE: "шаг 3, ждёт клан на сайте (автопроверка)",
    db.STEP_SUBS: "шаг 4, ждёт подписки (автопроверка)",
    db.STEP_DONE: "принят",
    db.STEP_REMOVED: "снят",
}


def load_env() -> None:
    # Ключи relay всегда берём из файла (PM2 иначе залипает на старом TELEGRAM_API_BASE).
    force = {
        "TELEGRAM_API_BASE",
        "TELEGRAM_API_BASE_FALLBACK",
        "TELEGRAM_API_BASE_CF",
        "POLL_SEC",
        "GAP_ALERT_SEC",
        "BOT_TOKEN",
    }
    for path in (HERE / "recruit-bot.env", HERE.parent / ".env"):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key in force:
                os.environ[key] = val
            else:
                os.environ.setdefault(key, val)


def env_int(name: str) -> int | None:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        logging.error("%s должен быть числом", name)
        return None


def hr_ids() -> list[int]:
    raw = os.environ.get("HR_BOOTSTRAP_IDS") or ""
    out = []
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        if part.lstrip("-").isdigit():
            out.append(int(part))
    return out


def channel_id() -> int | None:
    return env_int("CHANNEL_ID")


def group_id() -> int | None:
    return env_int("GROUP_ID")


def alert_chat() -> int | None:
    """HR-чат: шаги, алерты, кураторы (Bot для набора)."""
    return env_int("ALERT_CHAT_ID")


def announce_chat() -> int | None:
    """Публичный чат: только успешный финал регистрации (Основной)."""
    return env_int("ANNOUNCE_CHAT_ID") or env_int("ALERT_CHAT_ID")


def alert_thread() -> int | None:
    """Топик в HR-чате, если нужен."""
    return env_int("ALERT_THREAD_ID")


def announce_thread() -> int | None:
    """Топик в Основном (General можно не задавать)."""
    return env_int("ANNOUNCE_THREAD_ID")


def channel_title() -> str:
    return (os.environ.get("CHANNEL_TITLE") or "канал").strip() or "канал"


def group_title() -> str:
    return (os.environ.get("GROUP_TITLE") or "группа").strip() or "группа"


def clans_url() -> str:
    fallback = (os.environ.get("SITE_URL") or "https://bb-squad.ru/clans").strip()
    try:
        row = site.clan()
    except Exception as e:
        logging.warning("clan url: %s", type(e).__name__)
        return fallback
    if not row:
        return fallback
    return f"https://bb-squad.ru/clans/{row['id']}"


def who(user) -> str:
    if user is None:
        return ""
    if user.username:
        return f"@{user.username}"
    return str(user.id)


def tg_handle(row) -> str:
    username = (row["tg_username"] or "").strip() if row is not None else ""
    if username:
        return f"@{username.lstrip('@')}"
    return str(int(row["tg_id"])) if row is not None else "?"


def nick_tag(nick: str) -> str:
    """Тег участника в Telegram: до 16 символов, без эмодзи."""
    import unicodedata

    chars: list[str] = []
    for ch in (nick or "").strip():
        if unicodedata.category(ch) in ("So", "Sk", "Cs", "Cf"):
            continue
        chars.append(ch)
        if len(chars) >= 16:
            break
    tag = "".join(chars).strip()
    return tag[:16] if tag else "player"


async def _send_chat(
    bot, chat_id: int | None, text: str, thread_id: int | None, kind: str
) -> None:
    logging.info("%s: %s", kind, text.replace("\n", " | "))
    if not chat_id:
        return
    kwargs = {}
    if thread_id is not None:
        kwargs["message_thread_id"] = thread_id
    try:
        await bot.send_message(chat_id, text, **kwargs)
    except Exception as e:
        logging.warning("%s send: %s", kind, type(e).__name__)


async def send_alert(bot, text: str) -> None:
    """Промежуточные HR-алерты → Bot для набора."""
    await _send_chat(bot, alert_chat(), text, alert_thread(), "alert")


async def send_announce(bot, text: str) -> None:
    """Только финал успешной регистрации → Основной."""
    await _send_chat(bot, announce_chat(), text, announce_thread(), "announce")


async def in_chat(bot, chat_id: int | None, user_id: int) -> bool | None:
    """True / False / None (API не ответил — не считаем «вышел»)."""
    if not chat_id:
        return False
    try:
        member = await bot.get_chat_member(chat_id, user_id)
    except Exception as e:
        logging.info("get_chat_member %s/%s: %s", chat_id, user_id, type(e).__name__)
        return None
    name = str(getattr(member.status, "value", member.status)).lower()
    if name in ("member", "administrator", "creator", "owner"):
        return True
    if name == "restricted":
        return bool(getattr(member, "is_member", False))
    return False


def gap_alert_cooldown_sec() -> int:
    raw = (os.environ.get("GAP_ALERT_SEC") or "3600").strip() or "3600"
    try:
        return max(60, int(raw))
    except ValueError:
        return 3600


async def bot_blocked(bot, user_id: int) -> bool:
    from telegram.error import Forbidden

    try:
        await bot.get_chat(user_id)
        return False
    except Forbidden:
        return True
    except Exception:
        return False


async def kick_chat(bot, chat_id: int | None, user_id: int) -> str:
    if not chat_id:
        return "чат не задан"
    try:
        await bot.ban_chat_member(chat_id, user_id)
    except Exception as e:
        return f"не вышло ({type(e).__name__})"
    try:
        await bot.unban_chat_member(chat_id, user_id, only_if_banned=True)
    except Exception:
        pass
    return "кикнут"


def hr_markup():
    from telegram import ReplyKeyboardMarkup

    return ReplyKeyboardMarkup(
        [
            ["Поиск по нику", "Удалить игрока"],
            ["Сменить ник", "Кто на регистрации"],
            ["Выгрузить базу", "Назначить куратора"],
            ["Снять куратора"],
        ],
        resize_keyboard=True,
        is_persistent=True,
    )


def format_player_card(row) -> str:
    """Карточка из базы бота: ник, TG, Steam, шаг."""
    steam = (row["steam_id"] or "").strip() or "—"
    uname = tg_handle(row)
    return (
        f"{db.label(row)}\n"
        f"TG: {uname}\n"
        f"tg_id: {int(row['tg_id'])}\n"
        f"Steam: {steam}\n"
        f"Шаг: {STEP_RU.get(row['step'], row['step'])}"
    )


async def site_text() -> str:
    url = await asyncio.to_thread(clans_url)
    return (
        "Шаг 3 из 4 — сайт клана.\n\n"
        "Если ты УЖЕ в BlackBerry на сайте с этим Steam — ничего делать не нужно. "
        "Бот сам это увидит (обычно до минуты) и пришлёт шаг 4.\n\n"
        "Если ещё не в клане:\n"
        "1) зайди на сайт тем же Steam;\n"
        "2) зарегистрируйся при необходимости;\n"
        "3) вступи / подай заявку в BlackBerry:\n"
        f"{url}\n\n"
        "Когда кадровик примет заявку (или если ты уже в клане) — "
        "бот сам закроет этот шаг и напишет дальше. "
        "Не спамь сюда сообщениями — проверка автоматическая."
    )


async def create_one_invite(bot, chat_id: int | None, nick: str, kind: str) -> str | None:
    if not chat_id:
        return None
    name = f"{kind}:{nick}"[:32]
    try:
        link = await bot.create_chat_invite_link(
            chat_id=chat_id,
            name=name,
            member_limit=1,
        )
        return link.invite_link
    except Exception as e:
        logging.warning("invite %s %s: %s", kind, chat_id, type(e).__name__)
        return None


async def revoke_invite(bot, chat_id: int | None, invite: str) -> None:
    if not chat_id or not invite:
        return
    try:
        await bot.revoke_chat_invite_link(chat_id, invite)
    except Exception as e:
        logging.info("revoke invite: %s", type(e).__name__)


async def ensure_invites(bot, row) -> tuple[str, str]:
    """Личные одноразовые ссылки; fallback на CHANNEL_URL / GROUP_URL из env."""
    tg_id = int(row["tg_id"])
    nick = (row["game_nick"] or str(tg_id)).strip()
    ch = (row["invite_channel"] or "").strip()
    gr = (row["invite_group"] or "").strip()
    fallback_ch = (os.environ.get("CHANNEL_URL") or "").strip()
    fallback_gr = (os.environ.get("GROUP_URL") or "").strip()

    changed = False
    if not ch:
        ch = (await create_one_invite(bot, channel_id(), nick, "ch")) or fallback_ch
        if ch:
            db.set_invites(tg_id, channel=ch)
            changed = True
    if not gr:
        gr = (await create_one_invite(bot, group_id(), nick, "gr")) or fallback_gr
        if gr:
            db.set_invites(tg_id, group=gr)
            changed = True
    if changed:
        fresh = db.get_applicant(tg_id)
        if fresh is not None:
            ch = (fresh["invite_channel"] or "").strip() or ch
            gr = (fresh["invite_group"] or "").strip() or gr
    return (
        ch or "ссылка канала не задана",
        gr or "ссылка группы не задана",
    )


async def revoke_row_invites(bot, row) -> None:
    tg_id = int(row["tg_id"])
    ch = ""
    gr = ""
    try:
        ch = (row["invite_channel"] or "").strip()
        gr = (row["invite_group"] or "").strip()
    except (KeyError, IndexError, TypeError):
        pass
    db_ch, db_gr = db.clear_invites(tg_id)
    await revoke_invite(bot, channel_id(), ch or db_ch)
    await revoke_invite(bot, group_id(), gr or db_gr)


async def apply_member_tag(bot, chat_id: int | None, user_id: int, nick: str) -> bool:
    """Ник в тег участника (setChatMemberTag). Бот часто получает Chat_creator_required."""
    if not chat_id:
        return False
    tag = nick_tag(nick)
    try:
        if hasattr(bot, "set_chat_member_tag"):
            await bot.set_chat_member_tag(chat_id=chat_id, user_id=user_id, tag=tag)
        else:
            await bot._post(
                "setChatMemberTag",
                {"chat_id": chat_id, "user_id": user_id, "tag": tag},
            )
        return True
    except Exception as e:
        logging.warning(
            "setChatMemberTag %s: %s %s (теги через бота Telegram часто не даёт)",
            user_id,
            type(e).__name__,
            e,
        )
        return False


async def subs_text(bot, row) -> str:
    ch, gr = await ensure_invites(bot, row)
    return (
        "Шаг 3 пройден: этот Steam в клане BlackBerry на сайте.\n\n"
        "Шаг 4 из 4 — подписки.\n"
        "Открой обе ссылки ниже и вступи. Ссылки одноразовые и только для тебя "
        "(другу не сработают).\n\n"
        f"{channel_title()}:\n{ch}\n\n"
        f"{group_title()}:\n{gr}\n\n"
        "Когда будешь в обоих чатах — бот сам это увидит и напишет «принят». "
        "Ждать, не писать сюда «готово»."
    )


def accepted_text() -> str:
    return (
        "Готово — ты принят в клан BlackBerry.\n\n"
        "Дальше ничего жать не нужно. Оставайся в канале и в основной группе."
    )


async def force_fresh_invites(bot, row) -> tuple[str, str]:
    """Новые одноразовые ссылки (старые после кика/отзыва уже мёртвые)."""
    await revoke_row_invites(bot, row)
    fresh = db.get_applicant(int(row["tg_id"])) or row
    return await ensure_invites(bot, fresh)


async def done_status_text(bot, row) -> str:
    """Принят на сайте: если нет в чатах — сразу выдать ссылки, без «кнопок регистрации»."""
    tg_id = int(row["tg_id"])
    in_channel = await in_chat(bot, channel_id(), tg_id)
    in_group = await in_chat(bot, group_id(), tg_id)
    missing = []
    if in_channel is False:
        missing.append(channel_title())
    if in_group is False:
        missing.append(group_title())
    if not missing:
        return accepted_text()
    ch, gr = await force_fresh_invites(bot, row)
    return (
        "Ты уже в клане BlackBerry на сайте — заново регистрироваться не нужно.\n\n"
        "Но тебя сейчас нет в: "
        + ", ".join(missing)
        + ".\n"
        "Открой обе ссылки ниже и вступи (одноразовые, только для тебя):\n\n"
        f"{channel_title()}:\n{ch}\n\n"
        f"{group_title()}:\n{gr}\n\n"
        "Кнопок нет — достаточно ссылок. Когда будешь в обоих чатах, всё ок."
    )


async def status_text(bot, row) -> str:
    step = row["step"]
    if step == db.STEP_STEAM:
        return ASK_STEAM
    if step == db.STEP_SITE:
        return await site_text()
    if step == db.STEP_SUBS:
        return await subs_text(bot, row)
    if step == db.STEP_DONE:
        return await done_status_text(bot, row)
    if step == db.STEP_REMOVED:
        return (
            "Регистрация закрыта: тебя снимали с клана. "
            "Напиши ник заново, если подаёшь заявку снова.\n" + ASK_NICK
        )
    return ASK_NICK


async def tell(bot, tg_id: int, text: str) -> None:
    try:
        await bot.send_message(tg_id, text)
    except Exception as e:
        logging.info("dm %s: %s", tg_id, type(e).__name__)


async def check_one(bot, row) -> None:
    step = row["step"]
    if step not in (db.STEP_SITE, db.STEP_SUBS, db.STEP_DONE):
        return
    tg_id = int(row["tg_id"])
    nick = row["game_nick"] or ""
    steam_id = (row["steam_id"] or "").strip()
    if not nick or not steam_id:
        return
    try:
        info = await asyncio.to_thread(site.lookup_steam, steam_id, nick)
    except Exception as e:
        logging.warning("lookup tg %s: %s", tg_id, type(e).__name__)
        return

    if step == db.STEP_SITE:
        if info.get("found") and not info.get("nick_match"):
            site_nick = info.get("nick") or "без ника"
            sig = "nick:" + site_nick
            if db.set_alert_sig(tg_id, sig):
                await tell(
                    bot,
                    tg_id,
                    f"Этот Steam на сайте зашёл как {site_nick}. "
                    f"В анкете указан {nick}. В клан должен вступить аккаунт {site_nick}.",
                )
                await send_alert(
                    bot,
                    f"Алерт: {db.label(row)} указал ник {nick}, "
                    f"а Steam на сайте зарегистрирован как {site_nick}.",
                )
        if info.get("in_clan"):
            db.set_step(tg_id, db.STEP_SUBS, site_user_id=info.get("user_id"))
            db.event(tg_id, "step3", nick)
            fresh = db.get_applicant(tg_id)
            await tell(bot, tg_id, await subs_text(bot, fresh or row))
            await send_alert(
                bot,
                f"Игрок {db.label(fresh)} — 3-й шаг пройден (принят в клан).",
            )
            again = db.get_applicant(tg_id)
            if again is not None:
                await check_one(bot, again)
            return
        if info.get("join_pending"):
            sig = "join-pending"
            if db.set_alert_sig(tg_id, sig):
                await tell(
                    bot,
                    tg_id,
                    "Заявка в клан на сайте уже есть — ждём приёма кадровиком.\n"
                    "Бот сам увидит, когда тебя примут, и пришлёт шаг 4. "
                    "Сюда писать не нужно.",
                )
        elif info.get("other_clan"):
            sig = "other:" + str(info["other_clan"])
            if db.set_alert_sig(tg_id, sig):
                await send_alert(
                    bot,
                    f"Игрок {db.label(row)}: аккаунт этого Steam состоит в "
                    f"{info['other_clan']}, не в BlackBerry.",
                )
        return

    in_channel = await in_chat(bot, channel_id(), tg_id)
    in_group = await in_chat(bot, group_id(), tg_id)
    blocked = await bot_blocked(bot, tg_id)
    on_site = bool(info.get("in_clan"))

    if (
        step == db.STEP_SUBS
        and in_channel is True
        and in_group is True
        and not blocked
        and on_site
    ):
        db.set_step(tg_id, db.STEP_DONE, accepted=True)
        db.event(tg_id, "step4", nick)
        fresh = db.get_applicant(tg_id)
        await tell(bot, tg_id, accepted_text())
        await send_announce(
            bot,
            f"Новый участник клана {db.label(fresh)} {tg_handle(fresh)}",
        )
        return

    if step == db.STEP_SUBS and not blocked and (
        in_channel is True or in_group is True or on_site
    ):
        # Ещё не оба чата. Сайт пропал — только алерт, чаты не трогаем.
        if not on_site:
            sig = "site-lost-subs"
            if db.set_alert_sig(tg_id, sig, cooldown_sec=gap_alert_cooldown_sec()):
                await send_alert(
                    bot,
                    f"Алерт: {db.label(row)} на шаге 4, в клане на сайте этого Steam уже нет.",
                )
        return

    if step not in (db.STEP_SUBS, db.STEP_DONE):
        return

    missing = []
    if not on_site:
        missing.append("сайт")
    # None = API не ответил → не считаем отпиской (иначе массовые ложные алерты)
    if in_channel is False:
        missing.append(channel_title())
    if in_group is False:
        missing.append(group_title())
    if blocked:
        missing.append("бот заблокирован")
    if not missing:
        db.set_alert_sig(tg_id, "ok")
        return

    # Автокика нет — только алерт кадровикам, не чаще раза в час на одну дыру.
    sig = "gap:" + ",".join(missing)
    if not db.set_alert_sig(tg_id, sig, cooldown_sec=gap_alert_cooldown_sec()):
        return
    db.event(tg_id, "gap-alert", sig)
    await send_alert(
        bot,
        "Алерт: "
        + db.label(row)
        + " не в полном составе (кик не делаю).\n"
        + "\n".join(f"— {part}" for part in missing),
    )


async def checklist(bot, row, db_deleted: bool, note: str = "") -> str:
    steam_id = (row["steam_id"] or "").strip()
    tg_id = int(row["tg_id"])
    on_site: bool | None
    if not steam_id:
        on_site = False
    else:
        try:
            on_site = await asyncio.to_thread(site.still_in_clan, steam_id)
        except Exception:
            on_site = None
    in_channel = await in_chat(bot, channel_id(), tg_id)
    in_group = await in_chat(bot, group_id(), tg_id)
    fresh = None if db_deleted else db.get_applicant(tg_id)
    if db_deleted:
        db_line = "строка удалена"
    elif fresh is None:
        db_line = "строки нет"
    else:
        db_line = "строка есть, " + STEP_RU.get(fresh["step"], fresh["step"])
    if on_site is True:
        site_line = "всё ещё в клане"
    elif on_site is False:
        site_line = "в клане нет"
    else:
        site_line = "сайт не ответил"

    def _chat_line(flag: bool | None) -> str:
        if flag is True:
            return "состоит"
        if flag is False:
            return "не состоит"
        return "не удалось проверить"

    lines = [
        f"Игрок {db.label(row)} — чеклист удаления."
        + (f" Причина: {note}." if note else ""),
        f"Сайт: {site_line}",
        f"{channel_title()}: {_chat_line(in_channel)}",
        f"{group_title()}: {_chat_line(in_group)}",
        f"База бота: {db_line}",
    ]
    chats_clear = on_site is False and in_channel is False and in_group is False
    db_gone = db_deleted or fresh is None
    if chats_clear and db_gone:
        lines.append(f"Игрок {db.label(row)} удалён.")
    elif chats_clear:
        lines.append(
            f"Игрок {db.label(row)} снят с сайта и обоих чатов. Строка в базе бота ещё есть."
        )
    return "\n".join(lines)


async def poll(context) -> None:
    """Активная регистрация — часто; accepted (done) — раз в час, с паузами.

    CF Worker на free tier падает (Error 1027), если getChatMember×N
    уходит пачкой: бот тогда не отвечает даже на /start.
    Выход из чата ловит ChatMemberHandler сразу; этот poll — страховка.
    """
    global _last_done_poll
    active = db.list_applicants((db.STEP_SITE, db.STEP_SUBS))
    for row in active:
        try:
            await check_one(context.bot, row)
        except Exception as e:
            logging.exception("check %s: %s", row["tg_id"], type(e).__name__)
        await asyncio.sleep(0.2)

    # done: совпадает с GAP_ALERT_SEC (по умолчанию час)
    now = time.time()
    done_every = float(gap_alert_cooldown_sec())
    if now - _last_done_poll < done_every:
        return
    _last_done_poll = now
    done = db.list_applicants((db.STEP_DONE,))
    logging.info("poll done-batch size=%s interval=%ss", len(done), int(done_every))
    for row in done:
        try:
            await check_one(context.bot, row)
        except Exception as e:
            logging.exception("check %s: %s", row["tg_id"], type(e).__name__)
        await asyncio.sleep(0.35)


async def cmd_start(update, context) -> None:
    user = update.effective_user
    message = update.message
    if user is None or message is None:
        return
    # Регистрация и меню — только в личке, не в группах
    if message.chat.type != "private":
        return
    if db.is_hr(user.id):
        await message.reply_text("Кадровое меню.", reply_markup=hr_markup())
    row = db.get_applicant(user.id)
    if row and row["step"] in (db.STEP_STEAM, db.STEP_SITE, db.STEP_SUBS, db.STEP_DONE):
        await message.reply_text(await status_text(context.bot, row))
        return
    await message.reply_text(ASK_NICK)


async def cmd_menu(update, context) -> None:
    user = update.effective_user
    message = update.message
    if user is None or message is None:
        return
    if message.chat.type != "private":
        return
    if not db.is_hr(user.id):
        await message.reply_text("Это меню только для кадровиков.")
        return
    context.user_data.pop("hr_mode", None)
    await message.reply_text("Кадровое меню.", reply_markup=hr_markup())


async def on_text(update, context) -> None:
    message = update.message
    user = update.effective_user
    if message is None or user is None or not message.text:
        return
    # В группах молчим — иначе отвечает на «пинг» в Основном
    if message.chat.type != "private":
        return
    text = message.text.strip()
    # алиас без кнопки (старая клавиатура / набрали руками)
    if db.is_hr(user.id) and text.lower() in ("поиск", "поиск по нику", "/search"):
        context.user_data.pop("hr_mode", None)
        await hr_button(update, context, "Поиск по нику")
        return
    if db.is_hr(user.id) and text in HR_BUTTONS:
        context.user_data.pop("hr_mode", None)
        await hr_button(update, context, text)
        return
    mode = context.user_data.get("hr_mode")
    if db.is_hr(user.id) and mode == "search_pick":
        await hr_lookup_search(update, context, text)
        return
    if db.is_hr(user.id) and mode == "delete_pick":
        await hr_delete_search(update, context, text)
        return
    if db.is_hr(user.id) and mode == "nick_pick":
        await hr_nick_search(update, context, text)
        return
    if db.is_hr(user.id) and isinstance(mode, str) and mode.startswith("nick_edit:"):
        await hr_nick_apply(update, context, mode, text)
        return
    if db.is_hr(user.id) and mode in ("appoint", "revoke"):
        await hr_capture(update, context, mode, text)
        return
    row = db.get_applicant(user.id)
    steam = db.parse_steam(text)
    parsed = db.parse_nick(text)
    if steam and not parsed and row and row["step"] in (
        db.STEP_STEAM,
        db.STEP_SITE,
        db.STEP_SUBS,
        db.STEP_DONE,
    ):
        await take_steam(update, context, row, steam)
        return
    if not parsed:
        if row and row["step"] == db.STEP_STEAM:
            await message.reply_text(ASK_STEAM)
            return
        if row and row["step"] in (db.STEP_SITE, db.STEP_SUBS, db.STEP_DONE):
            await message.reply_text(
                "Ник уже записан: "
                + db.label(row)
                + ".\nЕсли ошибся в нике, пришли заново: Keech (Александр)\n"
                "Если ошибся в Steam, пришли SteamID64 ещё раз.\n\n"
                + await status_text(context.bot, row)
            )
            return
        await message.reply_text("Нужен ник и имя в скобках.\nПример: Keech (Александр)")
        return
    nick, name = parsed
    kind = db.upsert_nick(user.id, user.username or "", user.first_name or "", nick, name)
    row = db.get_applicant(user.id)
    label = db.label(row)
    if kind == "same":
        await message.reply_text(
            f"Ник тот же: {label}.\n\n" + await status_text(context.bot, row)
        )
        return
    if kind == "created":
        await send_alert(
            context.bot,
            f"Игрок {label} — 1-й шаг пройден. Ник: {nick}, имя: {name}. TG {who(user)}.",
        )
    else:
        await send_alert(
            context.bot,
            f"Игрок {label} — ник обновлён. Ник: {nick}, имя: {name}. TG {who(user)}.",
        )
    if row["step"] == db.STEP_STEAM:
        await message.reply_text(f"Записал: {label}.\n\n" + ASK_STEAM)
        return
    await message.reply_text(
        f"Ник обновлён: {label}.\n\n" + await status_text(context.bot, row)
    )


async def take_steam(update, context, row, steam_id: str) -> None:
    message = update.message
    user = update.effective_user
    result = db.set_steam(user.id, steam_id)
    if result == "taken":
        await message.reply_text(
            "Этот SteamID64 уже указан в другой заявке. Пришли свой."
        )
        return
    if result == "missing":
        await message.reply_text(ASK_NICK)
        return
    fresh = db.get_applicant(user.id)
    if result == "ok":
        await send_alert(
            context.bot,
            f"Игрок {db.label(fresh)} — 2-й шаг пройден. SteamID64: {steam_id}.",
        )
        await message.reply_text(f"Steam записан.\n\n" + await site_text())
        return
    await message.reply_text(
        "Этот SteamID64 уже записан.\n\n" + await status_text(context.bot, fresh)
    )


async def hr_button(update, context, text: str) -> None:
    message = update.message
    if text in ("Поиск", "Поиск по нику"):
        context.user_data["hr_mode"] = "search_pick"
        await message.reply_text(
            "Поиск по базе бота.\n"
            "Напиши ник, имя, @username или SteamID64.\n"
            "Можно часть: Varyag, Jester, DRAHKEL.",
            reply_markup=hr_markup(),
        )
        return
    if text == "Удалить игрока":
        from telegram import InlineKeyboardButton, InlineKeyboardMarkup

        context.user_data["hr_mode"] = "delete_pick"
        await message.reply_text(
            "Напиши ник или имя — найду в базе.\n"
            "Можно часть: shu, Никол, Bugor.\n\n"
            "Или листать весь список кнопкой ниже.",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("Листать всех", callback_data="pg:0")]]
            ),
        )
        # клавиатура снизу тоже обновится следующим сообщением
        await message.reply_text("Меню кадровика.", reply_markup=hr_markup())
        return
    if text == "Сменить ник":
        context.user_data["hr_mode"] = "nick_pick"
        await message.reply_text(
            "Смена ника в базе бота.\n"
            "Напиши текущий ник или имя — найду игрока.\n"
            "Можно часть: Hanter, Владимир.",
            reply_markup=hr_markup(),
        )
        return
    if text == "Кто на регистрации":
        rows = db.list_applicants()
        if not rows:
            await message.reply_text("В базе бота никого нет.", reply_markup=hr_markup())
            return
        lines = [f"{db.label(r)} — {STEP_RU.get(r['step'], r['step'])}" for r in rows[:40]]
        extra = f"\n…ещё {len(rows) - 40}" if len(rows) > 40 else ""
        await message.reply_text("\n".join(lines) + extra, reply_markup=hr_markup())
        return
    if text == "Назначить куратора":
        context.user_data["hr_mode"] = "appoint"
        await message.reply_text(
            "Пришли Telegram id числом, @username или перешли сюда сообщение человека.",
            reply_markup=hr_markup(),
        )
        return
    if text == "Снять куратора":
        await show_hr(message)
        await message.reply_text("Меню кадровика.", reply_markup=hr_markup())
        return
    if text == "Выгрузить базу":
        people, events = db.export_csv()
        from telegram import InputFile

        await message.reply_document(
            InputFile(people, filename="recruit-players.csv"),
            caption="Игроки бота. Открывается в таблице.",
        )
        await message.reply_document(
            InputFile(events, filename="recruit-events.csv"),
            caption="Журнал шагов и снятий.",
            reply_markup=hr_markup(),
        )
        await message.reply_text(
            "База выгружена. В меню сверху слева — «Поиск по нику».",
            reply_markup=hr_markup(),
        )


def forwarded_id(message) -> int | None:
    origin = getattr(message, "forward_origin", None)
    sender = getattr(origin, "sender_user", None) if origin else None
    if sender is not None:
        return int(sender.id)
    # PTB 21+: forward_from часто отсутствует — только через getattr
    fwd = getattr(message, "forward_from", None)
    if fwd is not None:
        return int(fwd.id)
    return None


async def hr_capture(update, context, mode: str, text: str) -> None:
    message = update.message
    user = update.effective_user
    context.user_data.pop("hr_mode", None)
    if mode == "revoke":
        if not text.lstrip("-").isdigit():
            await message.reply_text("Нужен числовой Telegram id.")
            return
        result = db.remove_hr(int(text))
        db.event(user.id, "hr-revoke", f"{text} {result}")
        await message.reply_text(result)
        await send_alert(context.bot, f"Куратор {text}: {result}. Снял {who(user)}.")
        return
    tg_id = forwarded_id(message)
    note = text
    if tg_id is None and text.lstrip("-").isdigit():
        tg_id = int(text)
    if tg_id is None and text.startswith("@"):
        try:
            chat = await context.bot.get_chat(text)
            tg_id = int(chat.id)
            note = text
        except Exception as e:
            logging.warning("hr get_chat %s: %s %s", text, type(e).__name__, e)
            tg_id = None
    if tg_id is None:
        await message.reply_text(
            "Не вижу id. Надёжнее так:\n"
            "1) человек пишет боту /start;\n"
            "2) перешли сюда любое его сообщение;\n"
            "или пришли числовой Telegram id (через @userinfobot).\n"
            "@username сработает только если человек уже писал этому боту."
        )
        context.user_data["hr_mode"] = "appoint"
        return
    added = db.add_hr(tg_id, note, user.id)
    db.event(user.id, "hr-add", str(tg_id))
    if added:
        await message.reply_text(f"Куратор назначен: {tg_id}.")
        await send_alert(context.bot, f"Назначен куратор {tg_id}. Назначил {who(user)}.")
        try:
            await context.bot.send_message(
                tg_id,
                "Тебе открыли кадровое меню бота регистрации BlackBerry. Команда /menu.",
                reply_markup=hr_markup(),
            )
        except Exception:
            await message.reply_text("В личку ему не дошло: пусть сам нажмёт /start у бота.")
    else:
        await message.reply_text("Этот человек уже куратор.")


async def show_players(message, page: int) -> None:
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    rows = db.list_applicants()
    if not rows:
        await message.reply_text("В базе бота никого нет.")
        return
    page = max(0, page)
    chunk = rows[page * PAGE : (page + 1) * PAGE]
    buttons = [
        [InlineKeyboardButton(db.label(r)[:48], callback_data=f"p:{r['tg_id']}")]
        for r in chunk
    ]
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton("←", callback_data=f"pg:{page - 1}"))
    if (page + 1) * PAGE < len(rows):
        nav.append(InlineKeyboardButton("→", callback_data=f"pg:{page + 1}"))
    if nav:
        buttons.append(nav)
    total = len(rows)
    await message.reply_text(
        f"Листай список ({total}). Или снова «Удалить игрока» и напиши ник.",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def hr_lookup_search(update, context, text: str) -> None:
    """Кадровик: поиск по нику → карточки с TG/Steam/шагом."""
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    message = update.message
    q = (text or "").strip()
    if len(q) < 1:
        await message.reply_text("Напиши ник, имя, @username или SteamID64.")
        return
    rows = db.find_applicants(q, limit=24)
    if not rows:
        await message.reply_text(
            f"По «{q}» никого нет.\n"
            "Другой ник/часть ника или проверь, что человек есть в боте."
        )
        return
    # Одним сообщением, если коротко; иначе пачками
    cards = [format_player_card(r) for r in rows]
    body = f"Нашёл {len(rows)} по «{q}»:\n\n" + "\n\n".join(cards)
    if len(body) <= 3500:
        buttons = [
            [InlineKeyboardButton(db.label(r)[:40], callback_data=f"i:{r['tg_id']}")]
            for r in rows[:12]
        ]
        await message.reply_text(
            body,
            reply_markup=InlineKeyboardMarkup(buttons) if buttons else None,
        )
        return
    await message.reply_text(f"Нашёл {len(rows)} по «{q}». Карточки ниже:")
    for r in rows:
        await message.reply_text(
            format_player_card(r),
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("Действия", callback_data=f"i:{r['tg_id']}")]]
            ),
        )


async def hr_delete_search(update, context, text: str) -> None:
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    message = update.message
    q = text.strip()
    if len(q) < 2:
        await message.reply_text("Минимум 2 символа. Пример: shu или Bugor.")
        return
    rows = db.find_applicants(q, limit=24)
    if not rows:
        await message.reply_text(
            f"По «{q}» никого нет. Другой ник/имя или «Листать всех» через «Удалить игрока»."
        )
        return
    if len(rows) == 1:
        row = rows[0]
        context.user_data.pop("hr_mode", None)
        await message.reply_text(
            f"{db.label(row)} — {STEP_RU.get(row['step'], row['step'])}.\nЧто снять.",
            reply_markup=player_actions(int(row["tg_id"])),
        )
        return
    buttons = [
        [InlineKeyboardButton(db.label(r)[:48], callback_data=f"p:{r['tg_id']}")]
        for r in rows
    ]
    await message.reply_text(
        f"Нашёл {len(rows)} по «{q}». Выбери ник.",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def hr_nick_search(update, context, text: str) -> None:
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    message = update.message
    q = text.strip()
    if len(q) < 2:
        await message.reply_text("Минимум 2 символа. Пример: Hanter или Владимир.")
        return
    rows = db.find_applicants(q, limit=24)
    if not rows:
        await message.reply_text(f"По «{q}» никого нет. Другой ник или имя.")
        return
    if len(rows) == 1:
        row = rows[0]
        context.user_data["hr_mode"] = f"nick_edit:{int(row['tg_id'])}"
        await message.reply_text(
            f"Сейчас: {db.label(row)}.\n"
            "Пришли новый ник как на сайте.\n"
            "Можно только ник: HunterN7\n"
            "Или с именем: HunterN7 (Владимир)"
        )
        return
    buttons = [
        [InlineKeyboardButton(db.label(r)[:48], callback_data=f"n:{r['tg_id']}")]
        for r in rows
    ]
    await message.reply_text(
        f"Нашёл {len(rows)} по «{q}». Выбери, кому менять ник.",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def hr_nick_apply(update, context, mode: str, text: str) -> None:
    message = update.message
    user = update.effective_user
    raw_id = mode.split(":", 1)[1]
    if not raw_id.isdigit():
        context.user_data.pop("hr_mode", None)
        await message.reply_text("Сбой режима. Нажми «Сменить ник» снова.")
        return
    tg_id = int(raw_id)
    row = db.get_applicant(tg_id)
    if row is None:
        context.user_data.pop("hr_mode", None)
        await message.reply_text("В базе бота этой строки уже нет.")
        return
    parsed = db.parse_nick(text)
    if parsed:
        nick, name = parsed
    else:
        nick = " ".join(text.split())
        name = None
        if len(nick) < 2 or len(nick) > 32 or "(" in nick or ")" in nick:
            await message.reply_text(
                "Нужен ник как на сайте, пример: HunterN7\n"
                "Или с именем: HunterN7 (Владимир)"
            )
            return
    old = db.label(row)
    result = db.hr_set_nick(tg_id, nick, name)
    if result == "missing":
        context.user_data.pop("hr_mode", None)
        await message.reply_text("В базе бота этой строки уже нет.")
        return
    if result == "bad":
        await message.reply_text("Слишком короткий или длинный ник/имя. Попробуй ещё.")
        return
    if result == "same":
        await message.reply_text(f"Уже так и было: {old}.")
        return
    context.user_data.pop("hr_mode", None)
    fresh = db.get_applicant(tg_id)
    new_label = db.label(fresh) if fresh else nick
    db.event(user.id, "hr-nick-by", f"{tg_id} {old} → {new_label}")
    await message.reply_text(f"Ник обновлён: {old} → {new_label}.")
    await send_alert(
        context.bot,
        f"Кадровик {who(user)} сменил ник: {old} → {new_label}.",
    )
    await tell(
        context.bot,
        tg_id,
        f"Кадровик поправил твой ник в регистрации на {nick} — как на сайте.\n"
        "Дальше бот сам ведёт по шагам.",
    )
    if fresh is not None and fresh["step"] in (db.STEP_SITE, db.STEP_SUBS, db.STEP_DONE):
        await check_one(context.bot, fresh)


async def show_hr(message) -> None:
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    rows = db.list_hr()
    buttons = [
        [
            InlineKeyboardButton(
                f"{r['note'] or r['tg_id']} ({r['tg_id']})"[:48],
                callback_data=f"uh:{r['tg_id']}",
            )
        ]
        for r in rows
    ]
    await message.reply_text(
        "Кого снять с кураторов.",
        reply_markup=InlineKeyboardMarkup(buttons or [[InlineKeyboardButton("пусто", callback_data="noop")]]),
    )


def player_actions(tg_id: int):
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "1. Полный сброс → набор с 0",
                    callback_data=f"c:{tg_id}",
                )
            ],
            [
                InlineKeyboardButton(
                    "2. Только сайт (без чатов)",
                    callback_data=f"s:{tg_id}",
                )
            ],
            [
                InlineKeyboardButton(
                    "3. Только строка БД бота",
                    callback_data=f"d:{tg_id}",
                )
            ],
        ]
    )


async def on_callback(update, context) -> None:
    query = update.callback_query
    user = update.effective_user
    if query is None or user is None:
        return
    await query.answer()
    if not db.is_hr(user.id):
        await query.edit_message_text("Это меню только для кадровиков.")
        return
    data = query.data or ""
    if data == "noop":
        return
    if data.startswith("pg:"):
        if query.message is None:
            return
        await show_players(query.message, int(data.split(":", 1)[1]))
        return
    if data.startswith("p:"):
        tg_id = int(data.split(":", 1)[1])
        row = db.get_applicant(tg_id)
        if row is None:
            await query.edit_message_text("В базе бота этой строки уже нет.")
            return
        context.user_data.pop("hr_mode", None)
        await query.edit_message_text(
            f"{db.label(row)} — {STEP_RU.get(row['step'], row['step'])}.\nЧто снять.",
            reply_markup=player_actions(tg_id),
        )
        return
    if data.startswith("i:"):
        tg_id = int(data.split(":", 1)[1])
        row = db.get_applicant(tg_id)
        if row is None:
            await query.edit_message_text("В базе бота этой строки уже нет.")
            return
        context.user_data.pop("hr_mode", None)
        await query.edit_message_text(
            format_player_card(row) + "\n\nДействия кадровика:",
            reply_markup=player_actions(tg_id),
        )
        return
    if data.startswith("n:"):
        tg_id = int(data.split(":", 1)[1])
        row = db.get_applicant(tg_id)
        if row is None:
            await query.edit_message_text("В базе бота этой строки уже нет.")
            return
        context.user_data["hr_mode"] = f"nick_edit:{tg_id}"
        await query.edit_message_text(
            f"Сейчас: {db.label(row)}.\n"
            "Пришли новый ник как на сайте.\n"
            "Можно только ник: HunterN7\n"
            "Или с именем: HunterN7 (Владимир)"
        )
        return
    if data.startswith("uh:"):
        tg_id = int(data.split(":", 1)[1])
        result = db.remove_hr(tg_id)
        db.event(user.id, "hr-revoke", f"{tg_id} {result}")
        await query.edit_message_text(f"{tg_id}: {result}")
        await send_alert(context.bot, f"Куратор {tg_id}: {result}. Снял {who(user)}.")
        return
    kind, _, raw = data.partition(":")
    if kind not in ("s", "c", "d") or not raw.isdigit():
        return
    tg_id = int(raw)
    row = db.get_applicant(tg_id)
    if row is None:
        await query.edit_message_text("В базе бота этой строки уже нет.")
        return
    steam_id = (row["steam_id"] or "").strip()
    if kind == "s":
        try:
            line = await asyncio.to_thread(site.kick, steam_id, f"кадровик {who(user)}")
        except Exception as e:
            line = f"сайт не ответил ({type(e).__name__})"
        db.event(tg_id, "hr-site", line)
        text = await checklist(context.bot, row, db_deleted=False, note=line)
    elif kind == "c":
        ch_line = await kick_chat(context.bot, channel_id(), tg_id)
        gr_line = await kick_chat(context.bot, group_id(), tg_id)
        await revoke_row_invites(context.bot, row)
        try:
            site_line = await asyncio.to_thread(site.kick, steam_id, f"кадровик {who(user)}")
        except Exception as e:
            site_line = f"сайт не ответил ({type(e).__name__})"
        db.mark_removed(tg_id)
        db.event(tg_id, "hr-reset0", f"{ch_line}; {gr_line}; {site_line}")
        text = (
            f"Полный сброс под набор с 0.\n"
            f"{channel_title()}: {ch_line}\n{group_title()}: {gr_line}\nСайт: {site_line}\n\n"
            + await checklist(
                context.bot,
                row,
                db_deleted=False,
                note="сайт+чаты+бот сброшены, можно принимать снова с 0",
            )
        )
        await tell(
            context.bot,
            tg_id,
            "Тебя сняли с канала, группы и клана BlackBerry.\n"
            "Можно снова написать /start и пройти набор с нуля.",
        )
    else:
        await revoke_row_invites(context.bot, row)
        label = db.label(row)
        db.delete_applicant(tg_id)
        db.event(tg_id, "hr-db", label)
        text = await checklist(context.bot, row, db_deleted=True, note="строка базы удалена")
    await query.edit_message_text(text[:4000])
    await send_alert(context.bot, text)


async def on_my_member(update, context) -> None:
    cmu = update.my_chat_member
    if cmu is None or cmu.chat.type != "private":
        return
    status = str(getattr(cmu.new_chat_member.status, "value", cmu.new_chat_member.status)).lower()
    if status not in ("kicked", "left"):
        return
    row = db.get_applicant(cmu.chat.id)
    if row is None:
        return
    tg_id = int(row["tg_id"])
    db.event(tg_id, "block", row["step"])
    # Автокика нет — только алерт (с hourly cooldown через check_one / sig)
    if row["step"] in (db.STEP_SUBS, db.STEP_DONE):
        sig = "gap:бот заблокирован"
        if db.set_alert_sig(tg_id, sig, cooldown_sec=gap_alert_cooldown_sec()):
            await send_alert(
                context.bot,
                f"Алерт: {db.label(row)} заблокировал бота (кик не делаю).\n"
                f"TG {tg_handle(row)} · {STEP_RU.get(row['step'], row['step'])}",
            )
        return
    await send_alert(
        context.bot,
        f"Алерт: {db.label(row)} заблокировал бота на шаге «{STEP_RU.get(row['step'], row['step'])}». "
        "В клан по боту ещё не дошёл.",
    )


def _member_joined(old_status: str, new_status: str) -> bool:
    leftish = {"left", "kicked", "banned"}
    inish = {"member", "administrator", "creator", "owner", "restricted"}
    return old_status in leftish and new_status in inish


def _member_left(old_status: str, new_status: str) -> bool:
    leftish = {"left", "kicked", "banned"}
    inish = {"member", "administrator", "creator", "owner", "restricted"}
    return old_status in inish and new_status in leftish


def _chat_place_name(chat_id: int) -> str:
    if channel_id() and chat_id == channel_id():
        return channel_title()
    if group_id() and chat_id == group_id():
        return group_title()
    return str(chat_id)


async def on_chat_member(update, context) -> None:
    cmu = update.chat_member
    if cmu is None:
        return
    chat_ids = {x for x in (channel_id(), group_id()) if x}
    if cmu.chat.id not in chat_ids:
        return
    user_id = int(cmu.new_chat_member.user.id)
    row = db.get_applicant(user_id)
    if row is None or row["step"] == db.STEP_REMOVED:
        return
    old = str(getattr(cmu.old_chat_member.status, "value", cmu.old_chat_member.status)).lower()
    new = str(getattr(cmu.new_chat_member.status, "value", cmu.new_chat_member.status)).lower()

    # Выход из чата — только лог; алерт раз в час шлёт poll/check_one
    if _member_left(old, new):
        place = _chat_place_name(cmu.chat.id)
        db.event(user_id, "left-chat", f"{place}:{new}")

    # После входа в Основной по ссылке — ник в тег участника
    if (
        group_id()
        and cmu.chat.id == group_id()
        and _member_joined(old, new)
        and (row["game_nick"] or "").strip()
    ):
        ok = await apply_member_tag(
            context.bot, group_id(), user_id, row["game_nick"]
        )
        if ok:
            db.event(user_id, "tag", nick_tag(row["game_nick"]))
    await check_one(context.bot, db.get_applicant(user_id) or row)


def _relay_bases() -> list[str]:
    """CF Worker (без ПК) + опциональный home ssh-tunnel как запас."""
    primary = (os.environ.get("TELEGRAM_API_BASE") or "").strip().rstrip("/")
    fallback = (os.environ.get("TELEGRAM_API_BASE_FALLBACK") or "").strip().rstrip("/")
    # совместимость: старый комментарий # TELEGRAM_API_BASE_CF=...
    cf = (os.environ.get("TELEGRAM_API_BASE_CF") or "").strip().rstrip("/")
    bases: list[str] = []
    for b in (primary, fallback, cf):
        if b and b not in bases:
            bases.append(b)
    return bases


def _make_failover_request(bases: list[str]):
    """HTTPXRequest с переключением relay, если один отвечает 429/1027/сеть."""
    import re
    from telegram.error import NetworkError, TelegramError
    from telegram.request import HTTPXRequest

    class FailoverRequest(HTTPXRequest):
        def __init__(self) -> None:
            super().__init__(
                connection_pool_size=4,
                read_timeout=40,
                write_timeout=40,
                connect_timeout=20,
                pool_timeout=20,
            )
            self._bases = bases
            self._idx = 0

        def _suffix(self, url: str) -> str | None:
            for b in self._bases:
                if url.startswith(b):
                    return url[len(b) :]
            m = re.search(r"/s/[^/]+/bot(.+)$", url)
            return m.group(1) if m else None

        async def do_request(
            self,
            url: str,
            method: str,
            request_data=None,
            read_timeout=None,
            write_timeout=None,
            connect_timeout=None,
            pool_timeout=None,
        ):
            from telegram.request import BaseRequest

            if read_timeout is None:
                read_timeout = BaseRequest.DEFAULT_NONE
            if write_timeout is None:
                write_timeout = BaseRequest.DEFAULT_NONE
            if connect_timeout is None:
                connect_timeout = BaseRequest.DEFAULT_NONE
            if pool_timeout is None:
                pool_timeout = BaseRequest.DEFAULT_NONE

            if not self._bases:
                return await super().do_request(
                    url, method, request_data, read_timeout, write_timeout, connect_timeout, pool_timeout
                )
            suffix = self._suffix(url)
            if suffix is None:
                return await super().do_request(
                    url, method, request_data, read_timeout, write_timeout, connect_timeout, pool_timeout
                )
            last: Exception | None = None
            n = len(self._bases)
            for off in range(n):
                i = (self._idx + off) % n
                try_url = self._bases[i] + suffix
                try:
                    result = await super().do_request(
                        try_url,
                        method,
                        request_data,
                        read_timeout,
                        write_timeout,
                        connect_timeout,
                        pool_timeout,
                    )
                    code = result[0] if isinstance(result, tuple) else 0
                    # CF 1027/429 отдаёт HTML — не JSON; сразу следующий relay
                    if code >= 400:
                        logging.info(
                            "relay HTTP %s on %s — try next",
                            code,
                            self._bases[i][:40],
                        )
                        last = NetworkError(f"relay HTTP {code}")
                        continue
                    if off:
                        logging.warning("telegram relay failover → %s…", self._bases[i][:48])
                    self._idx = i
                    return result
                except (TelegramError, NetworkError, OSError) as e:
                    last = e
                    logging.info(
                        "relay fail %s (%s) — try next",
                        self._bases[i][:40],
                        type(e).__name__,
                    )
                    continue
            assert last is not None
            raise last

    return FailoverRequest()


def main() -> None:
    load_env()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    token = (os.environ.get("BOT_TOKEN") or "").strip()
    if not token:
        raise SystemExit("В recruit-bot.env нет BOT_TOKEN")
    data = Path(os.environ.get("DB_PATH") or (HERE / "data" / "recruit.sqlite"))
    db.connect(data)
    db.bootstrap_hr(hr_ids())
    from telegram import Update
    from telegram.error import TelegramError
    from telegram.ext import (
        Application,
        CallbackQueryHandler,
        ChatMemberHandler,
        CommandHandler,
        MessageHandler,
        filters,
    )

    # Plaza режет api.telegram.org → только relay.
    # Основной: Cloudflare Worker (бот на Plaza, ПК не нужен).
    # Запасной: ssh-tunnel на домашний ПК (если CF в 1027).
    bases = _relay_bases()
    request = _make_failover_request(bases) if bases else None
    builder = Application.builder().token(token)
    if request is not None:
        builder = builder.request(request).get_updates_request(request)
    if bases:
        builder = builder.base_url(bases[0])
        logging.info(
            "telegram relays: primary=%s… (+%s fallback)",
            bases[0][:56],
            max(0, len(bases) - 1),
        )
    app = builder.build()
    async def cmd_search(update, context) -> None:
        user = update.effective_user
        message = update.message
        if user is None or message is None or message.chat.type != "private":
            return
        if not db.is_hr(user.id):
            await message.reply_text("Только для кадровиков.")
            return
        context.user_data.pop("hr_mode", None)
        await hr_button(update, context, "Поиск по нику")

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("menu", cmd_menu))
    app.add_handler(CommandHandler("search", cmd_search))
    app.add_handler(CallbackQueryHandler(on_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))
    app.add_handler(ChatMemberHandler(on_my_member, ChatMemberHandler.MY_CHAT_MEMBER))
    app.add_handler(ChatMemberHandler(on_chat_member, ChatMemberHandler.CHAT_MEMBER))
    poll_sec = int((os.environ.get("POLL_SEC") or "120").strip() or "120")
    if app.job_queue is None:
        raise SystemExit("Нужен пакет python-telegram-bot[job-queue]")
    app.job_queue.run_repeating(poll, interval=max(60, poll_sec), first=20)
    logging.info("recruit bot polling, db=%s", data)

    delay = 5
    while True:
        try:
            app.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=False)
            break
        except (TelegramError, OSError) as e:
            logging.error(
                "telegram relay unavailable (%s): %s — retry in %ss",
                type(e).__name__,
                e,
                delay,
            )
            time.sleep(delay)
            delay = min(120, delay * 2)


if __name__ == "__main__":
    main()
