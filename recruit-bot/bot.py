# -*- coding: utf-8 -*-
"""
Бот регистрации в клан BlackBerry.

Шаг 1. Ник (Имя), пример: Keech (Александр)
Шаг 2. SteamID64 — по нему ищется аккаунт, с которым человек зашёл на сайт
Шаг 3. Регистрация на сайте и приём в клан кадровиком
Шаг 4. Подписка на канал и группу (личные одноразовые invite-ссылки)
После входа в группу бот ставит игровой ник в тег участника.
Дальше бот следит за сайтом и обоими чатами.

Кадровики назначаются в боте.
Промежуточные алерты → ALERT_CHAT_ID (Bot для набора).
Финал «Новый участник клана…» → ANNOUNCE_CHAT_ID (Основной).
Своя база: data/recruit.sqlite, выгрузка двумя CSV.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

import db
import clan_site as site

HERE = Path(__file__).resolve().parent
PAGE = 6
_purging: set[int] = set()

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
    "Удалить игрока",
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
    for path in (HERE / "recruit-bot.env", HERE.parent / ".env"):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


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


async def in_chat(bot, chat_id: int | None, user_id: int) -> bool:
    if not chat_id:
        return False
    try:
        member = await bot.get_chat_member(chat_id, user_id)
    except Exception:
        return False
    name = str(getattr(member.status, "value", member.status)).lower()
    if name in ("member", "administrator", "creator", "owner"):
        return True
    if name == "restricted":
        return bool(getattr(member, "is_member", False))
    return False


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
            ["Удалить игрока", "Кто на регистрации"],
            ["Назначить куратора", "Снять куратора"],
            ["Выгрузить базу"],
        ],
        resize_keyboard=True,
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
        "Дальше ничего жать не нужно. Бот сам следит за сайтом и чатами.\n"
        "Если отпишешься от канала/группы или заблокируешь бота — "
        "автоматически снимут с клана."
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
        return accepted_text()
    if step == db.STEP_REMOVED:
        return "Регистрация закрыта: тебя снимали с клана. Напиши ник заново, если подаёшь заявку снова.\n" + ASK_NICK
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
    if not nick or not steam_id or tg_id in _purging:
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

    if step == db.STEP_SUBS and in_channel and in_group and not blocked and on_site:
        db.set_step(tg_id, db.STEP_DONE, accepted=True)
        db.event(tg_id, "step4", nick)
        fresh = db.get_applicant(tg_id)
        await tell(bot, tg_id, accepted_text())
        await send_announce(
            bot,
            f"Новый участник клана {db.label(fresh)} {tg_handle(fresh)}",
        )
        return

    if step == db.STEP_SUBS and not blocked and (in_channel or in_group or on_site):
        # Ещё не оба чата. Сайт пропал — только алерт, чаты не трогаем.
        if not on_site:
            sig = "site-lost-subs"
            if db.set_alert_sig(tg_id, sig):
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
    if not in_channel:
        missing.append(channel_title())
    if not in_group:
        missing.append(group_title())
    if blocked:
        missing.append("бот заблокирован")
    if not missing:
        db.set_alert_sig(tg_id, "ok")
        return

    # Отписка или блок после приёма в клан снимает с клана.
    # Пропажа только с сайта (чаты и бот живы) — алерт, чаты не кикаем.
    auto = blocked or (step == db.STEP_DONE and (not in_channel or not in_group))
    if auto:
        reason = "блокировка бота" if blocked else "отписка от канала или группы"
        await purge(bot, db.get_applicant(tg_id) or row, reason)
        return
    sig = "gap:" + ",".join(missing)
    if not db.set_alert_sig(tg_id, sig):
        return
    await send_alert(
        bot,
        "Алерт: "
        + db.label(row)
        + " выпал из проверки.\n"
        + "\n".join(f"— {part}" for part in missing),
    )


async def purge(bot, row, reason: str) -> None:
    tg_id = int(row["tg_id"])
    if tg_id in _purging:
        return
    current = db.get_applicant(tg_id)
    if current is None or current["step"] == db.STEP_REMOVED:
        return
    _purging.add(tg_id)
    try:
        steam_id = (current["steam_id"] or "").strip()
        site_line = "SteamID64 не записан"
        if steam_id:
            try:
                site_line = await asyncio.to_thread(site.kick, steam_id, "бот регистрации")
            except Exception as e:
                site_line = f"сайт не ответил ({type(e).__name__})"
        ch_line = await kick_chat(bot, channel_id(), tg_id)
        gr_line = await kick_chat(bot, group_id(), tg_id)
        await revoke_row_invites(bot, current)
        db.mark_removed(tg_id)
        db.event(tg_id, "purge", f"{reason}; {site_line}; {ch_line}; {gr_line}")
        text = await checklist(bot, current, db_deleted=False, note=reason)
        text = (
            f"{channel_title()}: {ch_line}\n{group_title()}: {gr_line}\n"
            f"Сайт: {site_line}\n\n{text}"
        )
        await send_alert(bot, text)
        await tell(bot, tg_id, f"Ты исключён из клана BlackBerry. Причина: {reason}.")
    finally:
        _purging.discard(tg_id)


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
    lines = [
        f"Игрок {db.label(row)} — чеклист удаления."
        + (f" Причина: {note}." if note else ""),
        f"Сайт: {site_line}",
        f"{channel_title()}: {'состоит' if in_channel else 'не состоит'}",
        f"{group_title()}: {'состоит' if in_group else 'не состоит'}",
        f"База бота: {db_line}",
    ]
    chats_clear = on_site is False and not in_channel and not in_group
    db_gone = db_deleted or fresh is None
    if chats_clear and db_gone:
        lines.append(f"Игрок {db.label(row)} удалён.")
    elif chats_clear:
        lines.append(
            f"Игрок {db.label(row)} снят с сайта и обоих чатов. Строка в базе бота ещё есть."
        )
    return "\n".join(lines)


async def poll(context) -> None:
    rows = db.list_applicants((db.STEP_SITE, db.STEP_SUBS, db.STEP_DONE))
    for row in rows:
        try:
            await check_one(context.bot, row)
        except Exception as e:
            logging.exception("check %s: %s", row["tg_id"], type(e).__name__)


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
    if db.is_hr(user.id) and text in HR_BUTTONS:
        context.user_data.pop("hr_mode", None)
        await hr_button(update, context, text)
        return
    mode = context.user_data.get("hr_mode")
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
    if text == "Удалить игрока":
        await show_players(message, 0)
        return
    if text == "Кто на регистрации":
        rows = db.list_applicants()
        if not rows:
            await message.reply_text("В базе бота никого нет.")
            return
        lines = [f"{db.label(r)} — {STEP_RU.get(r['step'], r['step'])}" for r in rows[:40]]
        extra = f"\n…ещё {len(rows) - 40}" if len(rows) > 40 else ""
        await message.reply_text("\n".join(lines) + extra)
        return
    if text == "Назначить куратора":
        context.user_data["hr_mode"] = "appoint"
        await message.reply_text(
            "Пришли Telegram id числом, @username или перешли сюда сообщение человека."
        )
        return
    if text == "Снять куратора":
        await show_hr(message)
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
        )


def forwarded_id(message) -> int | None:
    origin = getattr(message, "forward_origin", None)
    sender = getattr(origin, "sender_user", None) if origin else None
    if sender is not None:
        return int(sender.id)
    if message.forward_from is not None:
        return int(message.forward_from.id)
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
        except Exception:
            tg_id = None
    if tg_id is None:
        await message.reply_text(
            "Не вижу id. Пришли число, @username или перешли сообщение, "
            "у которого не скрыт аккаунт."
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
    await message.reply_text(
        "Выбери ник.",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


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

    ch = channel_title()
    gr = group_title()
    second = f"2. Удалить из {ch} и {gr}"
    if len(second) > 60:
        second = "2. Удалить из обоих чатов"
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("1. Удалить с клана на сайте", callback_data=f"s:{tg_id}")],
            [InlineKeyboardButton(second, callback_data=f"c:{tg_id}")],
            [InlineKeyboardButton("3. Удалить с БД бота", callback_data=f"d:{tg_id}")],
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
        await query.edit_message_text(
            f"{db.label(row)} — {STEP_RU.get(row['step'], row['step'])}.\nЧто снять.",
            reply_markup=player_actions(tg_id),
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
        db.mark_removed(tg_id)
        try:
            site_line = await asyncio.to_thread(site.kick, steam_id, f"кадровик {who(user)}")
        except Exception as e:
            site_line = f"сайт не ответил ({type(e).__name__})"
        db.event(tg_id, "hr-chats", f"{ch_line}; {gr_line}; {site_line}")
        text = (
            f"{channel_title()}: {ch_line}\n{group_title()}: {gr_line}\nСайт: {site_line}\n\n"
            + await checklist(
                context.bot,
                row,
                db_deleted=False,
                note="снят с обоих чатов и с клана на сайте",
            )
        )
        await tell(
            context.bot,
            tg_id,
            "Тебя сняли с канала, группы и клана BlackBerry.",
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
    if row["step"] in (db.STEP_SUBS, db.STEP_DONE):
        await purge(context.bot, row, "блокировка бота")
        return
    db.event(int(row["tg_id"]), "block", row["step"])
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

    # Сразу алерт в Bot для набора при выходе из канала или группы
    if _member_left(old, new):
        place = _chat_place_name(cmu.chat.id)
        how = "кикнут" if new in ("kicked", "banned") else "вышел"
        await send_alert(
            context.bot,
            f"Алерт: {db.label(row)} {how} из «{place}».\n"
            f"TG {tg_handle(row)} · {STEP_RU.get(row['step'], row['step'])}",
        )
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
    from telegram.ext import (
        Application,
        CallbackQueryHandler,
        ChatMemberHandler,
        CommandHandler,
        MessageHandler,
        filters,
    )

    # На Plaza api.telegram.org недоступен → TELEGRAM_API_BASE через CF Worker
    # PTB склеивает: base_url + token + "/" + method
    # Пример: https://bb-squad-alert.….workers.dev/s/{RELAY_SECRET}/bot
    builder = Application.builder().token(token)
    api_base = (os.environ.get("TELEGRAM_API_BASE") or "").strip().rstrip("/")
    if api_base:
        builder = builder.base_url(api_base)
        logging.info("telegram api via relay base_url=%s…", api_base[:56])
    app = builder.build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("menu", cmd_menu))
    app.add_handler(CallbackQueryHandler(on_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))
    app.add_handler(ChatMemberHandler(on_my_member, ChatMemberHandler.MY_CHAT_MEMBER))
    app.add_handler(ChatMemberHandler(on_chat_member, ChatMemberHandler.CHAT_MEMBER))
    poll_sec = int((os.environ.get("POLL_SEC") or "60").strip() or "60")
    if app.job_queue is None:
        raise SystemExit("Нужен пакет python-telegram-bot[job-queue]")
    app.job_queue.run_repeating(poll, interval=max(15, poll_sec), first=8)
    logging.info("recruit bot polling, db=%s", data)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
