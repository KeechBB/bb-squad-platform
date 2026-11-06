#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Evening attendance: online now, tiers 1-4, yesterday/week gaps vs schedule → PNG.

Presence is TR1–TR5 (training and the extra arena servers)."""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg2
import psycopg2.extras
from PIL import Image, ImageDraw, ImageFont

MSK = timezone(timedelta(hours=3))
NOW = datetime.now(MSK)
# До 12:00 МСК «сегодня» = вчерашний тренировочный вечер (как на календаре явки).
CAL_TODAY = NOW.date()
TODAY = CAL_TODAY - timedelta(days=1) if NOW.hour < 12 else CAL_TODAY
YDAY = TODAY - timedelta(days=1)
WEEK_START = TODAY - timedelta(days=7)

PLATFORM = Path("/var/www/bb-squad-platform")
LOG = Path("/var/www/bb-squad-logs/TR1/_live/SquadGame.log")
TIERS = PLATFORM / "data/kv-cache/data/tiers.json"
OUT_JSON = Path("/tmp/tr1_tonight_report.json")
OUT_PNG = Path("/tmp/tr1-tonight-attendance.png")
# also copy to workspace-friendly path if mounted — caller scp's

LOGIN_RE = re.compile(
    r"LogSquad: PostLogin: NewPlayer:.*?Online IDs:.*?EOS:\s*(?P<eos>[0-9a-fA-F]{32})\s+steam:\s*(?P<steam>7656\d+)",
    re.I,
)
LOGIN_NAME_RE = re.compile(
    r"LogNet: Login request: \?Name=(?P<name>[^?&]+)",
    re.I,
)
REMOVE_RE = re.compile(
    r"RemovePlayer\(UserId:\s*(?P<eos>[0-9a-fA-F]{32})\)",
    re.I,
)
POSSESS_RE = re.compile(
    r"OnPossess\(\):\s*PC=(?P<nick>.+?)\s*\(Online IDs:.*?steam:\s*(?P<steam>7656\d+)\)",
    re.I,
)
TS_RE = re.compile(r"\[(20\d{2})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})")


def as_utc_naive(dt: datetime) -> datetime:
    """Колонки сессий без пояса, значения в UTC. В запрос нельзя класть MSK-aware."""
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def nick_key(s: str | None) -> str:
    if not s:
        return ""
    s = str(s).strip().lower()
    s = re.sub(r"\[.*?\]", "", s)
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"[^a-z0-9а-яё]+", "", s, flags=re.I)
    return s


def load_db_url() -> str:
    for line in (PLATFORM / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no DATABASE_URL")


def parse_ts(line: str) -> datetime | None:
    m = TS_RE.search(line)
    if not m:
        return None
    y, mo, d, h, mi, s = map(int, m.groups())
    return datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc).astimezone(MSK)


def load_tiers() -> dict[str, int]:
    raw = json.loads(TIERS.read_text(encoding="utf-8"))
    aliases = {nick_key(k): nick_key(v) for k, v in (raw.get("aliases") or {}).items()}
    out: dict[str, int] = {}
    for t in (1, 2, 3):
        for n in raw.get(f"tier{t}") or []:
            k = nick_key(n)
            out[k] = t
            # reverse aliases pointing to this display
            for ak, av in aliases.items():
                if av == k or nick_key(av) == k:
                    out[ak] = t
    return out


def tier_of(nick: str, index: dict[str, int]) -> int:
    k = nick_key(nick)
    return index.get(k) or 4


def current_online_from_log(log_path: Path, now: datetime) -> list[dict]:
    """EOS currently on server + last nick/steam from tonight."""
    # Track join/leave for last ~6h (evening)
    cutoff = now - timedelta(hours=6)
    online_eos: dict[str, dict] = {}
    pending_name: str | None = None
    steam_nick: dict[str, str] = {}
    eos_steam: dict[str, str] = {}

    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            ts = parse_ts(line)
            if ts is None or ts < cutoff:
                continue
            m = LOGIN_NAME_RE.search(line)
            if m:
                from urllib.parse import unquote

                pending_name = unquote(m.group("name")).replace("+", " ")
                continue
            m = LOGIN_RE.search(line)
            if m:
                eos, steam = m.group("eos").lower(), m.group("steam")
                eos_steam[eos] = steam
                nick = pending_name or steam_nick.get(steam) or online_eos.get(eos, {}).get("nick") or "?"
                pending_name = None
                online_eos[eos] = {
                    "eos": eos,
                    "steam": steam,
                    "nick": nick,
                    "joinedAt": ts.isoformat(),
                }
                continue
            m = REMOVE_RE.search(line)
            if m:
                eos = m.group("eos").lower()
                online_eos.pop(eos, None)
                continue
            m = POSSESS_RE.search(line)
            if m:
                nick = m.group("nick").strip()
                steam = m.group("steam")
                steam_nick[steam] = nick
                for eos, st in list(eos_steam.items()):
                    if st == steam and eos in online_eos:
                        online_eos[eos]["nick"] = nick
                        online_eos[eos]["steam"] = steam

    return list(online_eos.values())


def sessions_by_day(conn, *, days: list, until: datetime | None = None) -> dict:
    """MSK calendar day → nick_keys on TR1/TR2 that evening (CW often on TR2)."""
    """MSK calendar day → nick_keys on TR1–TR5 that evening."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    # pull TR1–TR5 sessions overlapping last 8 days
    end = datetime.combine(max(days), datetime.max.time(), tzinfo=MSK) + timedelta(hours=3)
    if until is not None and until < end:
        end = until + timedelta(seconds=1)
    cur.execute(
        """
        SELECT s."steamId", s."nickAtJoin", s."joinedAt", s."leftAt",
               u.nick AS user_nick
        FROM "SquadServerSession" s
        LEFT JOIN "User" u ON u.id = s."userId"
        WHERE s."serverKey" IN ('TR1', 'TR2')
        WHERE s."serverKey" IN ('TR1', 'TR2', 'TR3', 'TR4', 'TR5')
        """,
        (as_utc_naive(start), as_utc_naive(end)),
    )
    by_day: dict[str, dict[str, str]] = defaultdict(dict)  # ymd -> nick_key -> display
    for r in cur.fetchall():
        jt = r["joinedAt"]
        if jt.tzinfo is None:
            jt = jt.replace(tzinfo=timezone.utc)
        jt_msk = jt.astimezone(MSK)
        if until is not None and jt_msk > until:
            continue
        # evening training: count if joined after 18:00 MSK or session spans evening
        if jt_msk.hour < 18 and jt_msk.hour >= 12:
            # day-time join same calendar day — skip unless left into evening
            left = r["leftAt"]
            if left:
                if left.tzinfo is None:
                    left = left.replace(tzinfo=timezone.utc)
                left_msk = left.astimezone(MSK)
                if left_msk.hour < 18 and left_msk.date() == jt_msk.date():
                    continue
            else:
                continue
        # 00:00–11:59 МСК = продолжение вчерашнего вечера
        day_d = jt_msk.date()
        if jt_msk.hour < 12:
            day_d = day_d - timedelta(days=1)
        if day_d not in days:
            continue
        ymd = day_d.isoformat()
        disp = (r["user_nick"] or r["nickAtJoin"] or r["steamId"] or "?").strip()
        by_day[ymd][nick_key(disp)] = disp
    return by_day


def absent_over_week(conn, today, until, member_by_key, today_keys: set[str]) -> list[dict]:
    """Последний визит на тренировке раньше, чем неделя назад. Дни от новых к старым."""
    start = datetime(2026, 9, 15, tzinfo=MSK).date()
    days: list = []
    day = start
    while day <= today:
        days.append(day)
        day += timedelta(days=1)
    hist = sessions_by_day(conn, days=days, until=until)
    cutoff = today - timedelta(days=8)
    last: dict[str, datetime.date] = {}
    for seen in days:
        if seen >= today:
            continue
        for key in hist.get(seen.isoformat(), {}):
            if key not in member_by_key or key in today_keys:
                continue
            prev = last.get(key)
            if prev is None or seen > prev:
                last[key] = seen
    grouped: dict[str, list[str]] = defaultdict(list)
    for key, seen in last.items():
        if seen > cutoff:
            continue
        nick = (member_by_key[key].get("nick") or "").strip()
        if nick:
            grouped[seen.isoformat()].append(nick)
    out: list[dict] = []
    for ymd in sorted(grouped, reverse=True):
        seen = datetime.strptime(ymd, "%Y-%m-%d").date()
        names = sorted(set(grouped[ymd]), key=str.lower)
        out.append(
            {
                "day": ymd,
                "label": f"{seen.day:02d}.{seen.month:02d}",
                "names": names,
            }
        )
    return out


def bb_members(conn) -> list[dict]:
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT u.id, u.nick, u."steamName", u."steamId",
               u."dayOffUntil", u."reserveUntil"
        FROM "ClanMember" cm
        JOIN "Clan" c ON c.id = cm."clanId"
        JOIN "User" u ON u.id = cm."userId"
        WHERE upper(c.tag) IN ('BB','BLACKBERRY')
           OR c.name ILIKE '%blackberry%'
        """
    )
    return list(cur.fetchall())


def expected_from_schedule(xlsx_path: Path, today: datetime.date) -> dict[str, dict]:
    """Parse schedule for who should be available today."""
    try:
        from openpyxl import load_workbook
    except ImportError:
        return {}
    wb = load_workbook(xlsx_path, data_only=True)
    ws = wb["График"]
    headers = {ws.cell(1, c).value: c for c in range(1, ws.max_column + 1)}
    # Oct 28 2026 = Wednesday
    dow_map = {0: "Пн", 1: "Вт", 2: "Ср", 3: "Чт", 4: "Пт", 5: "Сб", 6: "Вс"}
    day_col = headers.get(dow_map[today.weekday()])
    ddmm = f"{today.day:02d}.{today.month:02d}"
    ddmm_short = f"{today.day}.{today.month}"
    out: dict[str, dict] = {}
    for r in range(2, ws.max_row + 1):
        nick = str(ws.cell(r, headers["Ник / Telegram"]).value or "").strip()
        if not nick:
            continue
        st = str(ws.cell(r, headers["Статус опроса"]).value or "").strip().lower()
        words = str(ws.cell(r, headers.get("Когда можно (своими словами)", 1)).value or "")
        day_val = str(ws.cell(r, day_col).value or "").strip() if day_col else ""
        blob = f"{day_val} {words}".lower()
        is_bb = str(ws.cell(r, headers.get("BB", 1)).value or "").strip().lower() in (
            "да",
            "yes",
            "bb",
            "1",
        )
        # expected?
        expect = False
        conf = "maybe"
        vl = day_val.lower()
        if any(x in vl for x in ("нет", "резерв")) and "да" not in vl:
            expect = False
            conf = "no"
        elif ddmm in vl or ddmm_short in vl or re.search(rf"\b{today.day}\.10\b", vl):
            expect = True
            conf = "date"
        elif vl in ("да", "да*", "да после 16*", "обычно") or vl.startswith("да"):
            expect = True
            conf = "yes"
        elif "кажд" in words.lower() or "ежеднев" in words.lower():
            expect = True
            conf = "daily"
        elif ddmm in words.lower() or f"{today.day}.10" in words.lower():
            expect = True
            conf = "words_date"
        out[nick_key(nick)] = {
            "nick": nick,
            "expect": expect,
            "conf": conf,
            "day_val": day_val,
            "status": st,
            "bb_mark": is_bb,
            "words": words[:120],
        }
    return out


def schedule_rows(xlsx_path: Path) -> list[dict]:
    """Все строки графика: как написано в Excel и ключи для сверки с кланом."""
    try:
        from openpyxl import load_workbook
    except ImportError:
        return []
    if not xlsx_path.is_file():
        return []
    wb = load_workbook(xlsx_path, data_only=True)
    ws = wb["График"]
    headers = {ws.cell(1, c).value: c for c in range(1, ws.max_column + 1)}
    nick_col = headers.get("Ник / Telegram")
    bb_col = headers.get("BB")
    if not nick_col:
        return []
    rows = []
    for r in range(2, ws.max_row + 1):
        raw = str(ws.cell(r, nick_col).value or "").strip()
        if not raw:
            continue
        keys = {nick_key(raw)}
        for phrase in re.findall(
            r"[A-Za-z0-9][A-Za-z0-9._]*(?:\s+[A-Za-z0-9][A-Za-z0-9._]*)*",
            raw,
        ):
            keys.add(nick_key(phrase))
            for word in phrase.split():
                keys.add(nick_key(word))
        for tok in re.findall(r"[А-Яа-яЁё][А-Яа-яЁё]{2,}", raw):
            keys.add(nick_key(tok))
        keys.discard("")
        keys.discard("bb")
        mark = ""
        if bb_col:
            mark = str(ws.cell(r, bb_col).value or "").strip().lower()
        rows.append({"nick": raw, "keys": keys, "bb": mark in ("да", "yes", "bb", "1")})
    return rows


def schedule_not_in_clan(xlsx_path: Path, members: list[dict]) -> list[str]:
    member_keys: set[str] = set()
    for member in members:
        for raw in (member.get("nick"), member.get("steamName")):
            key = nick_key(raw or "")
            if key:
                member_keys.add(key)
    def on_site(keys: set[str]) -> bool:
        if keys & member_keys:
            return True
        for key in keys:
            if len(key) < 6:
                continue
            for member_key in member_keys:
                if len(member_key) < 6:
                    continue
                if key in member_key or member_key in key:
                    return True
        return False

    out: list[str] = []
    seen: set[str] = set()
    for row in schedule_rows(xlsx_path):
        if on_site(row["keys"]):
            continue
        key = nick_key(row["nick"])
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(row["nick"])
    return sorted(out, key=str.lower)


def draw_report(data: dict, out_path: Path) -> None:
    W, H = 1400, 2200
    img = Image.new("RGB", (W, H), "#0f1117")
    draw = ImageDraw.Draw(img)
    try:
        font_title = ImageFont.truetype("DejaVuSans-Bold.ttf", 36)
        font_h = ImageFont.truetype("DejaVuSans-Bold.ttf", 22)
        font = ImageFont.truetype("DejaVuSans.ttf", 16)
        font_sm = ImageFont.truetype("DejaVuSans.ttf", 14)
    except OSError:
        font_title = font_h = font = font_sm = ImageFont.load_default()

    y = 28
    draw.text((40, y), "TR1 · вечерняя явка", fill="#e8e6f0", font=font_title)
    y += 44
    draw.text(
        (40, y),
        f"{data['now']} МСК  ·  онлайн сейчас: {data['online_total']}  ·  из них BB тир1–4: {data['online_bb']}",
        fill="#a78bfa",
        font=font,
    )
    y += 36

    # Summary cards
    cards = [
        ("Сейчас T1–T4", f"{data['online_by_tier']}", "#22c55e"),
        ("Вчера были,\nсегодня нет", str(data["yday_missing_n"]), "#f59e0b"),
        ("Неделя были,\nсегодня нет", str(data["week_missing_n"]), "#ef4444"),
        ("График: ждали\n/ пришли", f"{data['sched_expected']} / {data['sched_present']}", "#38bdf8"),
    ]
    x = 40
    for title, val, col in cards:
        draw.rounded_rectangle((x, y, x + 310, y + 100), radius=12, fill="#1a1d27", outline=col)
        draw.text((x + 16, y + 12), title, fill="#94a3b8", font=font_sm)
        draw.text((x + 16, y + 48), val, fill=col, font=font_h)
        x += 330
    y += 120

    def section(title: str, lines: list[str], color: str = "#e2e8f0", max_lines: int = 28):
        nonlocal y
        if y > H - 80:
            return
        draw.text((40, y), title, fill=color, font=font_h)
        y += 30
        show = lines[:max_lines]
        for ln in show:
            draw.text((48, y), ln[:110], fill="#cbd5e1", font=font_sm)
            y += 18
        if len(lines) > max_lines:
            draw.text((48, y), f"… ещё {len(lines) - max_lines}", fill="#64748b", font=font_sm)
            y += 18
        y += 14

    # Online by tier
    for t in (1, 2, 3, 4):
        names = data["online_names_by_tier"].get(str(t), [])
        section(
            f"Онлайн сейчас · Тир {t} ({len(names)})",
            [", ".join(names[i : i + 6]) for i in range(0, len(names), 6)] or ["— никого"],
            "#86efac" if t <= 2 else "#fde68a" if t == 3 else "#fda4af",
            max_lines=6,
        )

    section(
        f"Вчера ({data['yday']}) были на TR, сегодня нет ({data['yday_missing_n']})",
        [", ".join(data["yday_missing"][i : i + 5]) for i in range(0, len(data["yday_missing"]), 5)]
        or ["— все вчерашние на месте / пусто"],
        "#fbbf24",
        max_lines=10,
    )

    section(
        f"За неделю ({data['week_from']}–{data['yday']}) были, сегодня нет ({data['week_missing_n']})",
        [", ".join(data["week_missing"][i : i + 5]) for i in range(0, len(data["week_missing"]), 5)]
        or ["—"],
        "#f87171",
        max_lines=12,
    )

    section(
        f"График: ждали сегодня ({data['sched_expected']}), не пришли ({len(data['sched_missing'])})",
        [", ".join(data["sched_missing"][i : i + 4]) for i in range(0, len(data["sched_missing"]), 4)]
        or ["— все ожидаемые на сервере"],
        "#7dd3fc",
        max_lines=10,
    )

    section(
        f"График: пришли из ожидаемых ({data['sched_present']})",
        [", ".join(data["sched_present_names"][i : i + 5]) for i in range(0, len(data["sched_present_names"]), 5)]
        or ["—"],
        "#67e8f9",
        max_lines=6,
    )

    # Footnote
    draw.text(
        (40, H - 40),
        "Источник: TR1/_live лог + SquadServerSession + tiers.json + BB-schedule-visits.xlsx · только BB/тиры где указано",
        fill="#64748b",
        font=font_sm,
    )
    img.save(out_path, "PNG", optimize=True)
    print("wrote", out_path, img.size)


# Чужой тег в логе боя: ɪʜ VermithraxTR (Online IDs: … steam: 7656…)
_FOREIGN_TAG_RE = re.compile(
    r"(?:ɪʜ|(?<![A-Za-z0-9])IH)\s+(.+?)\s*\(Online IDs:.*?steam:\s*(7656\d+)",
    re.I,
)
_FOREIGN_NAME_RE = re.compile(
    r"(?:ɪʜ|(?<![A-Za-z0-9])IH)\s+([^\n\|]{2,40}?)(?=\s*(?:\(|Online IDs|\||$))",
    re.I,
)


def _merge_spans(times: list[datetime], gap_min: int = 20) -> list[tuple[datetime, datetime]]:
    if not times:
        return []
    times = sorted(times)
    gap = timedelta(minutes=gap_min)
    spans: list[tuple[datetime, datetime]] = []
    a = b = times[0]
    for t in times[1:]:
        if t - b <= gap:
            b = t
        else:
            spans.append((a, b + timedelta(minutes=2)))
            a = b = t
    spans.append((a, b + timedelta(minutes=2)))
    return spans


def _foreign_from_logs(
    today: datetime.date,
) -> tuple[set[str], set[str], dict[str, list[tuple[datetime, datetime]]]]:
    """Ники, steam и окна присутствия другого клана (тег IH в логе TR1/TR2)."""
    """Ники, steam и окна присутствия другого клана (тег IH в логе TR1–TR5)."""
    keys: set[str] = set()
    steams: set[str] = set()
    hits: dict[str, list[datetime]] = {srv: [] for srv in TRAIN_SERVERS}
    day_start = datetime.combine(today, datetime.min.time()).timestamp() - 6 * 3600
    files: list[tuple[str, Path]] = []
    for srv in TRAIN_SERVERS:
        live = base / "_live" / "SquadGame.log"
        if live.is_file():
            files.append((srv, live))
        month = base / f"{today.year:04d}-{today.month:02d}"
        if month.is_dir():
            for path in month.glob("*.log"):
                try:
                    if path.stat().st_mtime >= day_start:
                        files.append((srv, path))
                except OSError:
                    continue
    ts_re = re.compile(r"\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})")
    for srv, path in files:
        try:
            fh = path.open("r", encoding="utf-8", errors="ignore")
        except OSError:
            continue
        with fh:
            for line in fh:
                if "ɪʜ" not in line and "IH " not in line and "ih " not in line.lower():
                    continue
                stamped = False
                for match in _FOREIGN_TAG_RE.finditer(line):
                    name = match.group(1).strip(" .>")
                    key = nick_key(name)
                    if key:
                        keys.add(key)
                    steams.add(match.group(2))
                    stamped = True
                if "ɪʜ" in line or re.search(r"(?<![A-Za-z0-9])IH\s", line):
                    for match in _FOREIGN_NAME_RE.finditer(line):
                        key = nick_key(match.group(1).strip(" .>"))
                        if key:
                            keys.add(key)
                    stamped = True
                if not stamped:
                    continue
                tm = ts_re.search(line)
                if not tm:
                    continue
                y, mo, d, h, mi, s = map(int, tm.groups())
                hits[srv].append(datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc).astimezone(MSK))
    windows = {srv: _merge_spans(times) for srv, times in hits.items()}
    root = PLATFORM / "data/kv-cache/data/players"
    if root.is_dir():
        for path in root.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(data, dict):
                continue
            for side in ("oppR1", "oppR2"):
                for row in data.get(side) or []:
                    nick = row.get("nick") if isinstance(row, dict) else ""
                    key = nick_key(re.sub(r"^(?:ɪʜ|IH)\s+", "", str(nick or ""), flags=re.I))
                    if key:
                        keys.add(key)
    return keys, steams, windows


def _overlaps_foreign(
    server: str,
    start: datetime,
    end: datetime,
    windows: dict[str, list[tuple[datetime, datetime]]],
) -> bool:
    for a, b in windows.get(server) or []:
        if start < b and end > a:
            return True
    return False


def peak_and_joined(
    conn,
    today: datetime.date,
    until: datetime,
    members: list[dict],
) -> tuple[int, int, list[str], dict]:
    """Пик и сколько людей было на TR1/TR2, плюс кто был, но не состоит в клане на сайте.
    """Пик и сколько людей было на TR1–TR5, плюс кто был, но не состоит в клане на сайте.
    Игроки другого клана (тег IH в логе, ростер соперника, член чужого клана на сайте)
    не входят ни в пик, ни в общее число, ни в список гостей.
    """
    start = datetime.combine(today, datetime.min.time(), tzinfo=MSK).replace(hour=18)
    clan_steams = {m["steamId"] for m in members if m.get("steamId")}
    foreign_keys, foreign_steams, foreign_windows = _foreign_from_logs(today)
    try:
        cur_clans = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur_clans.execute(
            """
            SELECT u.nick, u."steamName", u."steamId"
            FROM "ClanMember" cm
            JOIN "User" u ON u.id = cm."userId"
            JOIN "Clan" c ON c.id = cm."clanId"
            WHERE NOT (
              upper(coalesce(c.tag, '')) IN ('BB', 'BLACKBERRY')
              OR c.name ILIKE '%blackberry%'
            )
            """
        )
        for row in cur_clans.fetchall():
            if row.get("steamId"):
                foreign_steams.add(row["steamId"])
            for raw in (row.get("nick"), row.get("steamName")):
                key = nick_key(raw)
                if key:
                    foreign_keys.add(key)
    except Exception:
        pass
    clan_keys: set[str] = set()
    for m in members:
        for raw in (m.get("nick"), m.get("steamName")):
            k = nick_key(raw)
            if k:
                clan_keys.add(k)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT s."steamId", s."nickAtJoin", s."joinedAt", s."leftAt", s."serverKey",
               u.nick AS user_nick
        FROM "SquadServerSession" s
        LEFT JOIN "User" u ON u.id = s."userId"
        WHERE s."serverKey" IN ('TR1', 'TR2')
        WHERE s."serverKey" IN ('TR1', 'TR2', 'TR3', 'TR4', 'TR5')
          AND (s."leftAt" IS NULL OR s."leftAt" > %s)
        """,
        (as_utc_naive(until), as_utc_naive(start)),
    )
    events: list[tuple[datetime, int]] = []
    people: set[str] = set()
    guests: dict[str, str] = {}
    by_srv: dict[str, tuple[set[str], list[tuple[datetime, int]]]] = {
        "TR1": (set(), []),
        srv: (set(), []) for srv in TRAIN_SERVERS
    for r in cur.fetchall():
        jt = r["joinedAt"]
        if jt is None:
            continue
        if jt.tzinfo is None:
            jt = jt.replace(tzinfo=timezone.utc)
        jt = jt.astimezone(MSK)
        left = r["leftAt"]
        if left is not None and left.tzinfo is None:
            left = left.replace(tzinfo=timezone.utc)
        if left is not None:
            left = left.astimezone(MSK)
        elif jt < start - timedelta(hours=6):
            continue
        else:
            left = until
        vis_from = max(jt, start)
        vis_to = min(left, until)
        if vis_to <= vis_from:
            continue
        steam = r["steamId"] or ""
        disp = re.sub(
            r"^\[[^\]]+\]\s*",
            "",
            (r["user_nick"] or r["nickAtJoin"] or "").strip(),
        ).strip()
        nick_keys = {k for k in (nick_key(disp), nick_key(r["nickAtJoin"])) if k}
        is_bb = steam in clan_steams or bool(nick_keys & clan_keys)
        is_foreign = (not is_bb) and (
            bool(steam and steam in foreign_steams)
            or bool(nick_keys & foreign_keys)
            or bool(disp and re.match(r"^(?:ɪʜ|IH)\s+", disp, flags=re.I))
            or _overlaps_foreign(r.get("serverKey") or "", vis_from, vis_to, foreign_windows)
        )
        if is_foreign:
            continue
        people.add(steam or f"nick:{jt.isoformat()}")
        events.append((vis_from, 1))
        events.append((vis_to, -1))
        sk = r.get("serverKey") or ""
        if sk in by_srv:
            by_srv[sk][0].add(steam or f"nick:{jt.isoformat()}")
            by_srv[sk][1].append((vis_from, 1))
            by_srv[sk][1].append((vis_to, -1))
        if not disp:
            continue
        if (
            steam in clan_steams
            or steam in foreign_steams
            or nick_key(disp) in clan_keys
            or nick_key(r["nickAtJoin"]) in clan_keys
            or nick_key(disp) in foreign_keys
            or nick_key(r["nickAtJoin"]) in foreign_keys
            or re.match(r"^(?:ɪʜ|IH)\s+", disp, flags=re.I)
            or _overlaps_foreign(r.get("serverKey") or "", vis_from, vis_to, foreign_windows)
        ):
            continue
        guests[nick_key(disp) or steam or disp] = disp
    def _peak(ev: list[tuple[datetime, int]]) -> int:
        ev.sort(key=lambda e: (e[0], e[1]))
        cur_n = 0
        best = 0
        for _, delta in ev:
            cur_n += delta
            if cur_n > best:
                best = cur_n
        return best

    peak = _peak(events)
    srv_stats = {
        srv: {"people": len(ppl), "peak": _peak(ev)}
        for srv, (ppl, ev) in by_srv.items()
    }
    names = sorted(set(guests.values()), key=str.lower)
    return peak, len(people), names, srv_stats


def write_bb_report(conn, data: dict, today: datetime.date, slot: str, taken_at: datetime) -> None:
    payload = {
        "yday": data["yday"],
        "weekFrom": data["week_from"],
        "ydayMissing": data["yday_missing"],
        "weekMissing": data["week_missing"],
        "schedMissing": data["sched_missing"],
        "schedPresent": data["sched_present_names"],
        "lateFirst": data["late_first_after"],
        "notInClan": data["not_in_clan"],
        "excusedAbsent": data["excused_absent"],
        "absentOverWeek": data["absent_over_week"],
        "neverSeen": data["never_seen"],
        "scheduleOffSite": data["schedule_off_site"],
        "clanOnSite": int(data["clan_on_site"]),
    }
    rid = f"{today.isoformat()}-{slot}"
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO "BbTrainReport" (
          id, "reportDate", slot, "takenAt",
          "peakOnline", "joinedTotal",
          "ydayMissingN", "weekMissingN", "schedExpected", "schedPresent", "lateFirstN",
          payload, "createdAt", "updatedAt"
        ) VALUES (
          %s, %s::date, %s, %s,
          %s, %s,
          %s, %s, %s, %s, %s,
          %s::jsonb, now(), now()
        )
        ON CONFLICT ("reportDate", slot) DO UPDATE SET
          "takenAt" = EXCLUDED."takenAt",
          "peakOnline" = EXCLUDED."peakOnline",
          "joinedTotal" = EXCLUDED."joinedTotal",
          "ydayMissingN" = EXCLUDED."ydayMissingN",
          "weekMissingN" = EXCLUDED."weekMissingN",
          "schedExpected" = EXCLUDED."schedExpected",
          "schedPresent" = EXCLUDED."schedPresent",
          "lateFirstN" = EXCLUDED."lateFirstN",
          payload = EXCLUDED.payload,
          "updatedAt" = now()
        """,
        (
            rid,
            today.isoformat(),
            slot,
            as_utc_naive(taken_at),
            int(data["peak_online"]),
            int(data["joined_total"]),
            int(data["yday_missing_n"]),
            int(data["week_missing_n"]),
            int(data["sched_expected"]),
            int(data["sched_present"]),
            int(data["late_first_n"]),
            json.dumps(payload, ensure_ascii=False),
        ),
    )
    conn.commit()
    print("saved", rid)


def parse_cli() -> tuple[Path, datetime | None, str | None, bool]:
    xlsx = Path("/tmp/BB-schedule-visits.xlsx")
    as_of: datetime | None = None
    slot: str | None = None
    write_db = False
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--at" and i + 1 < len(args):
            as_of = datetime.strptime(args[i + 1], "%Y-%m-%d %H:%M").replace(tzinfo=MSK)
            i += 2
            continue
        if a == "--slot" and i + 1 < len(args):
            slot = args[i + 1].strip()
            i += 2
            continue
        if a == "--write-db":
            write_db = True
            i += 1
            continue
        if not a.startswith("--"):
            xlsx = Path(a)
        i += 1
    return xlsx, as_of, slot, write_db


def main() -> None:
    xlsx, as_of, slot, write_db = parse_cli()
    now = as_of or datetime.now(MSK)
    cal_today = now.date()
    # До 12:00 МСК «сегодня» = вчерашний тренировочный вечер.
    today = cal_today - timedelta(days=1) if now.hour < 12 else cal_today
    yday = today - timedelta(days=1)
    week_start = today - timedelta(days=7)
    tiers = load_tiers()
    conn = psycopg2.connect(load_db_url())
    members = bb_members(conn)
    member_by_steam = {m["steamId"]: m for m in members if m["steamId"]}
    member_by_key = {nick_key(m["nick"] or m["steamName"] or ""): m for m in members}

    online_raw = [] if write_db else current_online_from_log(LOG, now)
    # enrich nick from DB
    online_bb = []
    online_names_by_tier: dict[str, list[str]] = {"1": [], "2": [], "3": [], "4": []}
    online_keys = set()
    for p in online_raw:
        steam = p.get("steam")
        m = member_by_steam.get(steam) if steam else None
        nick = (m["nick"] if m else None) or p.get("nick") or "?"
        # strip clan tags for display
        nick_disp = re.sub(r"^\[[^\]]+\]\s*", "", nick).strip()
        is_bb = m is not None or nick_key(nick) in member_by_key
        if not is_bb:
            # still show if nick matches member
            mk = member_by_key.get(nick_key(nick))
            if mk:
                is_bb = True
                m = mk
                nick_disp = m["nick"] or nick_disp
        if not is_bb:
            continue
        t = tier_of(nick_disp, tiers)
        online_bb.append({"nick": nick_disp, "tier": t, "steam": steam})
        online_names_by_tier[str(t)].append(nick_disp)
        online_keys.add(nick_key(nick_disp))

    for t in online_names_by_tier:
        online_names_by_tier[t] = sorted(set(online_names_by_tier[t]), key=str.lower)

    days = [today - timedelta(days=i) for i in range(0, 8)]
    by_day = sessions_by_day(conn, days=days, until=now)
    # also merge live online into training-day set
    today_s = today.isoformat()
    for k, n in [(nick_key(x["nick"]), x["nick"]) for x in online_bb]:
        by_day[today_s][k] = n

    # After midnight / empty server: card «кто онлайн» = кто был на вечере (сессии).
    live_bb_n = len(online_bb)
    roster_mode = "live"
    if live_bb_n < 3 and now.hour < 12:
        roster_mode = "evening"
        online_names_by_tier = {"1": [], "2": [], "3": [], "4": []}
        online_bb = []
        online_keys = set()
        for k, disp in by_day.get(today_s, {}).items():
            if k not in member_by_key and nick_key(disp) not in member_by_key:
                continue
            nick_disp = (member_by_key.get(k) or member_by_key.get(nick_key(disp)) or {}).get(
                "nick"
            ) or disp
            t = tier_of(nick_disp, tiers)
            online_bb.append({"nick": nick_disp, "tier": t, "steam": None})
            online_names_by_tier[str(t)].append(nick_disp)
            online_keys.add(nick_key(nick_disp))
        for t in online_names_by_tier:
            online_names_by_tier[t] = sorted(
                set(online_names_by_tier[t]), key=str.lower
            )

    yday_s = yday.isoformat()
    yday_keys = set(by_day.get(yday_s, {}))
    today_keys = set(by_day.get(today_s, {})) | online_keys
    yday_missing_keys = sorted(yday_keys - today_keys)
    yday_missing = [by_day[yday_s][k] for k in yday_missing_keys]

    week_keys: set[str] = set()
    week_disp: dict[str, str] = {}
    for d in days[1:]:  # exclude training day
        for k, n in by_day.get(d.isoformat(), {}).items():
            week_keys.add(k)
            week_disp[k] = n
    week_missing_keys = sorted((week_keys - today_keys) - yday_keys)
    week_missing = [week_disp[k] for k in week_missing_keys]

    # Only BB clan members in gap lists (training focus)
    def only_bb(names: list[str]) -> list[str]:
        out = []
        for n in names:
            k = nick_key(n)
            if k in member_by_key:
                m = member_by_key[k]
                out.append(m.get("nick") or n)
        return sorted(set(out), key=str.lower)

    yday_missing = only_bb(yday_missing)
    week_missing = only_bb(week_missing)

    def until_day(value) -> datetime.date | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            if value.tzinfo is not None:
                value = value.astimezone(timezone.utc)
            return value.date()
        if isinstance(value, datetime.date):
            return value
        return None

    immune: dict[str, str] = {}
    for member in members:
        off = until_day(member.get("dayOffUntil"))
        reserve = until_day(member.get("reserveUntil"))
        if off is not None and off >= today:
            kind = "выходной"
        elif reserve is not None and reserve >= today:
            kind = "резерв"
        else:
            continue
        display = (member.get("nick") or member.get("steamName") or "").strip()
        if not display:
            continue
        for raw in (member.get("nick"), member.get("steamName")):
            key = nick_key(raw or "")
            if not key or key in immune:
                continue
            immune[key] = kind

    def drop_immune(names: list[str]) -> list[str]:
        return [name for name in names if nick_key(name) not in immune]

    yday_missing = drop_immune(yday_missing)
    week_missing = drop_immune(week_missing)

    # BB who visited training day (sessions + online)
    today_bb = only_bb(
        [by_day.get(today_s, {}).get(k, k) for k in today_keys]
        + [x["nick"] for x in online_bb]
    )
    today_bb_keys = {nick_key(n) for n in today_bb}
    yday_bb_n = len(only_bb(list(by_day.get(yday_s, {}).values())))

    here_keys = set(today_bb_keys) | set(online_keys)
    here_steams = {p.get("steam") for p in online_bb if p.get("steam")}
    excused_rows: list[tuple[str, str]] = []
    seen_excused: set[str] = set()
    for member in members:
        nick = (member.get("nick") or member.get("steamName") or "").strip()
        key = nick_key(nick)
        steam = (member.get("steamId") or "").strip()
        kind = immune.get(key)
        if not nick or not key or not kind or key in seen_excused:
            continue
        if key in here_keys or (steam and steam in here_steams):
            continue
        seen_excused.add(key)
        excused_rows.append((kind, nick))
    excused_absent = [
        f"{nick} · {kind}"
        for kind, nick in sorted(
            excused_rows, key=lambda row: (0 if row[0] == "выходной" else 1, row[1].lower())
        )
    ]

    sched = expected_from_schedule(xlsx, today) if xlsx.is_file() else {}
    sched = {
        key: row
        for key, row in sched.items()
        if key not in immune and nick_key(row.get("nick") or "") not in immune
    }
    # Prefer schedule rows marked BB or matching clan members
    expected = {
        k: v
        for k, v in sched.items()
        if v.get("expect") and (v.get("bb_mark") or k in member_by_key)
    }
    # if too few BB-marked, fall back to all expected that fuzzy-match members
    if len(expected) < 8:
        expected = {
            k: v
            for k, v in sched.items()
            if v.get("expect")
            and (
                v.get("bb_mark")
                or k in member_by_key
                or any(k in mk or mk in k for mk in member_by_key)
            )
        }
    sched_present_keys = []
    for k, v in expected.items():
        hit = k in today_bb_keys or k in online_keys
        if not hit:
            for ok in today_bb_keys | online_keys:
                if k in ok or ok in k or nick_key(v["nick"]) == ok:
                    hit = True
                    break
        if hit:
            sched_present_keys.append(k)
    sched_present_keys = sorted(set(sched_present_keys))
    sched_missing = [
        expected[k]["nick"] for k in sorted(expected) if k not in sched_present_keys
    ]
    sched_present_names = [expected[k]["nick"] for k in sched_present_keys if k in expected]

    # Первый заход за тренировочный день строго после 21:30 МСК.
    # Вылет и перезаход не считаются: берётся самый ранний joinedAt человека.
    # День вечера: с 12:00 МСК этого дня до 12:00 МСК следующего.
    late_cut = datetime.combine(today, datetime.min.time(), tzinfo=MSK).replace(
        hour=21, minute=30, second=0
    )
    win_start = datetime.combine(today, datetime.min.time(), tzinfo=MSK).replace(hour=12)
    win_end = min(win_start + timedelta(days=1), now)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT s."steamId", s."nickAtJoin", s."joinedAt", s."userId",
               u.nick AS user_nick
        FROM "SquadServerSession" s
        LEFT JOIN "User" u ON u.id = s."userId"
        WHERE s."serverKey" IN ('TR1', 'TR2')
        WHERE s."serverKey" IN ('TR1', 'TR2', 'TR3', 'TR4', 'TR5')
        """,
        (as_utc_naive(win_start), as_utc_naive(win_end)),
    )
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    raw_hits: list[tuple[str, datetime, str, str | None]] = []
    for r in cur.fetchall():
        jt = r["joinedAt"]
        if jt is None:
            continue
        if jt.tzinfo is None:
            jt = jt.replace(tzinfo=timezone.utc)
        jt = jt.astimezone(MSK)
        disp = (r["user_nick"] or r["nickAtJoin"] or "").strip()
        steam = (r["steamId"] or "").strip() or None
        keys = []
        if r["userId"]:
            keys.append(f"u:{r['userId']}")
        if steam:
            keys.append(f"s:{steam}")
        nk = nick_key(disp)
        if nk:
            keys.append(f"n:{nk}")
        if not keys:
            continue
        for k in keys[1:]:
            union(keys[0], k)
        raw_hits.append((keys[0], jt, disp, steam))

    earliest: dict[str, dict] = {}
    for key, jt, disp, steam in raw_hits:
        root = find(key)
        prev = earliest.get(root)
        if prev is None or jt < prev["joined"]:
            earliest[root] = {"joined": jt, "nick": disp, "steam": steam}

    late_rows: list[tuple[datetime, str]] = []
    for rec in earliest.values():
        if rec["joined"] < late_cut or rec["joined"] > now:
            continue
        disp = rec["nick"]
        steam = rec["steam"]
        m = member_by_steam.get(steam) if steam else None
        if not m:
            m = member_by_key.get(nick_key(disp))
        if not m:
            continue
        nick = (m.get("nick") or disp or "?").strip()
        if nick_key(nick) in immune or nick_key(disp) in immune:
            continue
        late_rows.append((rec["joined"], nick))
    # one chip per nick: самый ранний заход, после полуночи — в конец вечера
    late_by_nick: dict[str, datetime] = {}
    for jt, nick in late_rows:
        prev = late_by_nick.get(nick)
        if prev is None or jt < prev:
            late_by_nick[nick] = jt
    late_first = []
    for nick, jt in sorted(late_by_nick.items(), key=lambda kv: (kv[1], kv[0].lower())):
        when = jt.strftime("%H:%M")
        if jt.date() != today:
            when = f"{when} {jt.strftime('%d.%m')}"
        late_first.append(f"{when}  {nick}")

    peak_online, joined_total, not_in_clan, peak_by_server = peak_and_joined(
        conn, today, now, members
    )
    absent_over_week_rows = []
    for group in absent_over_week(conn, today, now, member_by_key, today_bb_keys):
        names = drop_immune(group.get("names") or [])
        if names:
            absent_over_week_rows.append({**group, "names": names})

    def label_nick(label: str) -> str:
        if " · " in label:
            return label.split(" · ", 1)[0].strip()
        if "  " in label:
            head, tail = label.split("  ", 1)
            if ":" in head[:5]:
                return tail.strip()
        return label.strip()

    long_gone = {
        nick_key(name)
        for group in absent_over_week_rows
        for name in group.get("names") or []
        if nick_key(name)
    }

    def drop_long(names: list[str]) -> list[str]:
        return [name for name in names if nick_key(label_nick(name)) not in long_gone]

    yday_missing = drop_long(yday_missing)
    week_missing = drop_long(week_missing)
    sched_missing = drop_long(sched_missing)
    sched_present_names = drop_long(sched_present_names)
    late_first = drop_long(late_first)
    excused_absent = drop_long(excused_absent)
    not_in_clan = drop_long(not_in_clan)

    counted = set(today_bb_keys) | set(long_gone)
    for name in yday_missing + week_missing + excused_absent + late_first:
        key = nick_key(label_nick(name))
        if key:
            counted.add(key)
    never_seen = []
    seen_gap: set[str] = set()
    for member in members:
        keys = {nick_key(member.get("nick") or ""), nick_key(member.get("steamName") or "")}
        keys.discard("")
        if keys & counted:
            continue
        nick = (member.get("nick") or member.get("steamName") or "").strip()
        key = nick_key(nick)
        if not nick or not key or key in seen_gap:
            continue
        seen_gap.add(key)
        never_seen.append(nick)
    never_seen.sort(key=str.lower)

    online_by_tier = " · ".join(
        f"T{t}:{len(online_names_by_tier[str(t)])}" for t in (1, 2, 3, 4)
    )

    data = {
        "now": now.strftime("%d.%m.%Y %H:%M"),
        "train_day": today.isoformat(),
        "roster_mode": roster_mode,
        "yday": yday.isoformat(),
        "week_from": week_start.isoformat(),
        "online_total": len(online_raw) if roster_mode == "live" else len(online_bb),
        "online_bb": len(online_bb),
        "online_by_tier": online_by_tier,
        "online_names_by_tier": online_names_by_tier,
        "yday_missing": yday_missing,
        "yday_missing_n": len(yday_missing),
        "week_missing": week_missing,
        "week_missing_n": len(week_missing),
        "sched_expected": len(sched_missing) + len(sched_present_names),
        "sched_present": len(sched_present_names),
        "sched_missing": sched_missing,
        "sched_present_names": sched_present_names,
        "today_session_n": len(today_bb),
        "yday_session_n": yday_bb_n,
        "late_cutoff": "21:30",
        "late_first_n": len(late_first),
        "late_first_after": late_first,
        "peak_online": peak_online,
        "joined_total": joined_total,
        "not_in_clan": not_in_clan,
        "excused_absent": excused_absent,
        "absent_over_week": absent_over_week_rows,
        "never_seen": never_seen,
        "schedule_off_site": [],
        "clan_on_site": len({m["id"] for m in members if m.get("id")}),
    }
    if write_db:
        if slot not in ("2130", "0100"):
            raise SystemExit("slot must be 2130 or 0100")
        write_bb_report(conn, data, today, slot, now)
        conn.close()
        print(json.dumps({
            "train_day": data["train_day"],
            "slot": slot,
            "peak_online": peak_online,
            "joined_total": joined_total,
            "peak_tr1": peak_by_server["TR1"]["peak"],
            **{
                f"peak_{srv.lower()}": peak_by_server.get(srv, {}).get("peak", 0)
                for srv in TRAIN_SERVERS
            },
            **{
                f"joined_{srv.lower()}": peak_by_server.get(srv, {}).get("people", 0)
                for srv in TRAIN_SERVERS
            },
            "week_missing_n": data["week_missing_n"],
            "sched_expected": data["sched_expected"],
            "sched_present": data["sched_present"],
            "late_first_n": data["late_first_n"],
            "not_in_clan_n": len(data["not_in_clan"]),
            "excused_absent_n": len(data["excused_absent"]),
            "never_seen_n": len(data["never_seen"]),
            "never_seen": data["never_seen"],
            "clan_on_site": data["clan_on_site"],
            "absent_over_week_n": sum(len(g["names"]) for g in data["absent_over_week"]),
            "absent_over_week_first": (
                data["absent_over_week"][0]["label"] if data["absent_over_week"] else ""
            ),
        }, ensure_ascii=False))
        return
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: data[k] for k in data if k not in ("online_names_by_tier", "yday_missing", "week_missing", "sched_missing", "sched_present_names", "late_first_after")}, ensure_ascii=False, indent=2))
    draw_report(data, OUT_PNG)
    conn.close()


if __name__ == "__main__":
    main()
