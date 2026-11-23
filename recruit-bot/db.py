# -*- coding: utf-8 -*-
"""Своя база бота регистрации. Сайтовая Postgres сюда не пишется."""
from __future__ import annotations

import csv
import io
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

NICK_RE = re.compile(r"^(.{2,32}?)\s*\(\s*([^()]{2,40})\s*\)\s*$")
STEAM_RE = re.compile(r"7656\d{13}")
BIRTH_RE = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})$")

STEP_NICK = "nick"
STEP_STEAM = "steam"
STEP_HOURS = "hours"
STEP_CLANS = "clans"
STEP_AGE = "age"
STEP_REVIEW = "review"
STEP_SITE = "site"
STEP_SUBS = "subs"
STEP_DONE = "done"
STEP_REMOVED = "removed"

# Активные шаги до приёма в клан (без done/removed).
ACTIVE_STEPS = (
    STEP_STEAM,
    STEP_HOURS,
    STEP_CLANS,
    STEP_AGE,
    STEP_REVIEW,
    STEP_SITE,
    STEP_SUBS,
)

_lock = threading.RLock()  # event() вызывается из mark_slag/clear_slag под тем же lock
_conn: sqlite3.Connection | None = None


def parse_nick(text: str) -> tuple[str, str] | None:
    raw = " ".join((text or "").replace("\n", " ").split())
    m = NICK_RE.match(raw)
    if not m:
        return None
    nick, name = m.group(1).strip(), m.group(2).strip()
    if len(nick) < 2 or len(name) < 2:
        return None
    return nick, name


def parse_steam(text: str) -> str | None:
    """SteamID64: 17 цифр с 7656, можно ссылкой steamcommunity.com/profiles/…"""
    found = list(dict.fromkeys(STEAM_RE.findall(text or "")))
    if len(found) != 1:
        return None
    return found[0]


def connect(path: Path) -> sqlite3.Connection:
    global _conn
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS applicants (
          tg_id INTEGER PRIMARY KEY,
          tg_username TEXT,
          tg_first TEXT,
          game_nick TEXT,
          real_name TEXT,
          step TEXT NOT NULL,
          site_user_id TEXT,
          alert_sig TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          accepted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS hr (
          tg_id INTEGER PRIMARY KEY,
          note TEXT,
          appointed_by INTEGER,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL,
          tg_id INTEGER,
          kind TEXT NOT NULL,
          detail TEXT
        );
        CREATE INDEX IF NOT EXISTS events_tg ON events(tg_id, id);
        CREATE TABLE IF NOT EXISTS slag (
          tg_id INTEGER PRIMARY KEY,
          note TEXT,
          source TEXT NOT NULL DEFAULT 'auto',
          created_at TEXT NOT NULL,
          created_by INTEGER,
          cleared_at TEXT,
          cleared_by INTEGER
        );
        """
    )
    cols = {r[1] for r in conn.execute("PRAGMA table_info(applicants)")}
    if "steam_id" not in cols:
        conn.execute("ALTER TABLE applicants ADD COLUMN steam_id TEXT")
    for col in (
        "invite_channel",
        "invite_group",
        "squad_hours",
        "prior_clans",
        "applicant_age",
    ):
        if col not in cols:
            conn.execute(f"ALTER TABLE applicants ADD COLUMN {col} TEXT")
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS applicants_steam_active
        ON applicants(steam_id)
        WHERE steam_id IS NOT NULL AND steam_id != '' AND step != 'removed'
        """
    )
    conn.commit()
    _conn = conn
    return conn


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _c() -> sqlite3.Connection:
    if _conn is None:
        raise RuntimeError("db is not open")
    return _conn


def event(tg_id: int | None, kind: str, detail: str = "") -> None:
    with _lock:
        _c().execute(
            "INSERT INTO events(at, tg_id, kind, detail) VALUES(?,?,?,?)",
            (now(), tg_id, kind, detail[:500]),
        )
        _c().commit()


def bootstrap_hr(ids: list[int]) -> None:
    with _lock:
        for tg_id in ids:
            _c().execute(
                """
                INSERT INTO hr(tg_id, note, appointed_by, created_at)
                VALUES(?, 'bootstrap', NULL, ?)
                ON CONFLICT(tg_id) DO NOTHING
                """,
                (tg_id, now()),
            )
        _c().commit()


def is_hr(tg_id: int) -> bool:
    row = _c().execute("SELECT 1 FROM hr WHERE tg_id=?", (tg_id,)).fetchone()
    return row is not None


def list_hr() -> list[sqlite3.Row]:
    return list(_c().execute("SELECT * FROM hr ORDER BY created_at").fetchall())


def add_hr(tg_id: int, note: str, by: int) -> bool:
    with _lock:
        cur = _c().execute(
            """
            INSERT INTO hr(tg_id, note, appointed_by, created_at)
            VALUES(?,?,?,?)
            ON CONFLICT(tg_id) DO NOTHING
            """,
            (tg_id, note[:80], by, now()),
        )
        _c().commit()
        return cur.rowcount > 0


def remove_hr(tg_id: int) -> str:
    with _lock:
        n = _c().execute("SELECT COUNT(*) AS n FROM hr").fetchone()["n"]
        if n <= 1:
            return "последнего кадровика снять нельзя"
        cur = _c().execute("DELETE FROM hr WHERE tg_id=?", (tg_id,))
        _c().commit()
        if cur.rowcount == 0:
            return "такого кадровика нет"
        return "снят"


def get_applicant(tg_id: int) -> sqlite3.Row | None:
    return _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()


def upsert_nick(tg_id: int, username: str, first: str, nick: str, name: str) -> str:
    """created, updated или same."""
    ts = now()
    with _lock:
        prev = _c().execute(
            "SELECT step, game_nick, real_name FROM applicants WHERE tg_id=?",
            (tg_id,),
        ).fetchone()
        if prev is None or prev["step"] == STEP_REMOVED:
            _c().execute(
                """
                INSERT INTO applicants(
                  tg_id, tg_username, tg_first, game_nick, real_name, step,
                  steam_id, site_user_id, alert_sig, created_at, updated_at, accepted_at,
                  squad_hours, prior_clans, applicant_age
                ) VALUES(?,?,?,?,?,?,NULL,NULL,'',?,?,NULL,NULL,NULL,NULL)
                ON CONFLICT(tg_id) DO UPDATE SET
                  tg_username=excluded.tg_username,
                  tg_first=excluded.tg_first,
                  game_nick=excluded.game_nick,
                  real_name=excluded.real_name,
                  step=excluded.step,
                  steam_id=NULL,
                  site_user_id=NULL,
                  squad_hours=NULL,
                  prior_clans=NULL,
                  applicant_age=NULL,
                  alert_sig='',
                  updated_at=excluded.updated_at,
                  accepted_at=NULL
                """,
                (tg_id, username, first, nick, name, STEP_STEAM, ts, ts),
            )
            kind = "created"
        elif prev["game_nick"] == nick and prev["real_name"] == name:
            _c().execute(
                "UPDATE applicants SET tg_username=?, tg_first=?, updated_at=? WHERE tg_id=?",
                (username, first, ts, tg_id),
            )
            kind = "same"
        else:
            _c().execute(
                """
                UPDATE applicants
                SET tg_username=?, tg_first=?, game_nick=?, real_name=?,
                    step=CASE
                      WHEN step IN (
                        'steam','hours','clans','age','review','site','subs','done'
                      ) THEN step
                      ELSE 'steam'
                    END,
                    alert_sig='', updated_at=?
                WHERE tg_id=?
                """,
                (username, first, nick, name, ts, tg_id),
            )
            kind = "updated"
        _c().commit()
    if kind != "same":
        event(tg_id, "step1", f"{nick} ({name})")
    return kind


def set_tg_username(
    tg_id: int,
    username: str | None,
    first: str | None = None,
) -> str:
    """Обновить TG @username (и опционально first_name). ok / missing / same."""
    u = (username or "").strip().lstrip("@")
    ts = now()
    with _lock:
        row = _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()
        if row is None or row["step"] == STEP_REMOVED:
            return "missing"
        old_u = (row["tg_username"] or "").strip().lstrip("@")
        old_f = row["tg_first"] or ""
        new_f = old_f if first is None else (first or "").strip()
        if old_u == u and (first is None or old_f == new_f):
            return "same"
        if first is None:
            _c().execute(
                "UPDATE applicants SET tg_username=?, updated_at=? WHERE tg_id=?",
                (u, ts, tg_id),
            )
        else:
            _c().execute(
                "UPDATE applicants SET tg_username=?, tg_first=?, updated_at=? WHERE tg_id=?",
                (u, new_f, ts, tg_id),
            )
        _c().commit()
    event(tg_id, "tg-username", f"{old_u or '—'}→{u or '—'}")
    return "ok"


def hr_set_nick(tg_id: int, nick: str, name: str | None = None) -> str:
    """Кадровик меняет игровой ник (и опционально имя). ok / missing / same."""
    nick = (nick or "").strip()
    if len(nick) < 2 or len(nick) > 32:
        return "bad"
    ts = now()
    with _lock:
        row = _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()
        if row is None or row["step"] == STEP_REMOVED:
            return "missing"
        new_name = (name or "").strip() if name is not None else (row["real_name"] or "")
        if name is not None and (len(new_name) < 2 or len(new_name) > 40):
            return "bad"
        if row["game_nick"] == nick and (row["real_name"] or "") == new_name:
            return "same"
        _c().execute(
            """
            UPDATE applicants
            SET game_nick=?, real_name=?, alert_sig='', updated_at=?
            WHERE tg_id=?
            """,
            (nick, new_name or row["real_name"], ts, tg_id),
        )
        _c().commit()
    event(tg_id, "hr-nick", f"{nick} ({new_name or row['real_name'] or ''})")
    return "ok"


def set_survey_hours(tg_id: int, hours: str) -> str:
    """ok / missing / bad."""
    hours = " ".join((hours or "").split())
    if len(hours) < 1 or len(hours) > 80:
        return "bad"
    ts = now()
    with _lock:
        row = _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()
        if row is None or row["step"] not in (STEP_HOURS, STEP_CLANS, STEP_AGE, STEP_REVIEW):
            return "missing"
        if not (row["steam_id"] or "").strip():
            return "missing"
        _c().execute(
            """
            UPDATE applicants
            SET squad_hours=?, step=?, alert_sig='', updated_at=?
            WHERE tg_id=?
            """,
            (hours, STEP_CLANS, ts, tg_id),
        )
        _c().commit()
    event(tg_id, "hours", hours)
    return "ok"


def set_survey_clans(tg_id: int, answer: str) -> str:
    """ok / missing / bad — дальше возраст."""
    answer = " ".join((answer or "").split())
    if len(answer) < 1 or len(answer) > 200:
        return "bad"
    ts = now()
    with _lock:
        row = _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()
        if row is None or row["step"] not in (STEP_CLANS, STEP_AGE, STEP_REVIEW):
            return "missing"
        if not (row["squad_hours"] or "").strip():
            return "missing"
        _c().execute(
            """
            UPDATE applicants
            SET prior_clans=?, step=?, alert_sig='', updated_at=?
            WHERE tg_id=?
            """,
            (answer, STEP_AGE, ts, tg_id),
        )
        _c().commit()
    event(tg_id, "clans", answer)
    return "ok"


def parse_birth_date(text: str) -> str | None:
    """ДД.ММ.ГГГГ → нормализованная строка или None."""
    raw = " ".join((text or "").split())
    m = BIRTH_RE.match(raw)
    if not m:
        return None
    day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        birth = datetime(year, month, day, tzinfo=timezone.utc)
    except ValueError:
        return None
    today = datetime.now(timezone.utc).date()
    if birth.date() > today:
        return None
    # разумный диапазон: 10…80 лет
    age_years = today.year - birth.year - (
        (today.month, today.day) < (birth.month, birth.day)
    )
    if age_years < 10 or age_years > 80:
        return None
    return f"{day:02d}.{month:02d}.{year:04d}"


def set_survey_age(tg_id: int, age: str) -> str:
    """ok / missing / bad — дата рождения ДД.ММ.ГГГГ, дальше review."""
    birth = parse_birth_date(age)
    if birth is None:
        return "bad"
    ts = now()
    with _lock:
        row = _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()
        if row is None or row["step"] not in (STEP_AGE, STEP_REVIEW):
            return "missing"
        if not (row["squad_hours"] or "").strip() or not (row["prior_clans"] or "").strip():
            return "missing"
        _c().execute(
            """
            UPDATE applicants
            SET applicant_age=?, step=?, alert_sig='', updated_at=?
            WHERE tg_id=?
            """,
            (birth, STEP_REVIEW, ts, tg_id),
        )
        _c().commit()
    event(tg_id, "age", birth)
    return "ok"


def approve_application(tg_id: int) -> str:
    """ok / missing / wrong_step — после одобрения сайт + каналы."""
    ts = now()
    with _lock:
        row = _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()
        if row is None or row["step"] == STEP_REMOVED:
            return "missing"
        if row["step"] != STEP_REVIEW:
            return "wrong_step"
        if not (row["steam_id"] or "").strip():
            return "missing"
        _c().execute(
            """
            UPDATE applicants
            SET step=?, alert_sig='', updated_at=?
            WHERE tg_id=?
            """,
            (STEP_SITE, ts, tg_id),
        )
        _c().commit()
    event(tg_id, "approve", "")
    return "ok"


def reject_application(tg_id: int) -> str:
    """ok / missing / wrong_step."""
    with _lock:
        row = _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()
        if row is None or row["step"] == STEP_REMOVED:
            return "missing"
        if row["step"] != STEP_REVIEW:
            return "wrong_step"
    mark_removed(tg_id)
    event(tg_id, "reject", "")
    return "ok"


def set_steam(tg_id: int, steam_id: str) -> str:
    """ok — записан, same — тот же, taken — уже у другой заявки, missing — нет анкеты."""
    ts = now()
    with _lock:
        row = _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()
        if row is None or row["step"] == STEP_REMOVED:
            return "missing"
        if row["step"] in (STEP_HOURS, STEP_CLANS, STEP_AGE, STEP_REVIEW):
            # Steam уже есть — правка только до опроса/заявки не через этот путь,
            # но на шаге steam пишем и идём в hours.
            pass
        other = _c().execute(
            """
            SELECT tg_id FROM applicants
            WHERE steam_id=? AND tg_id!=? AND step!=?
            """,
            (steam_id, tg_id, STEP_REMOVED),
        ).fetchone()
        if other:
            return "taken"
        if row["steam_id"] == steam_id and row["step"] != STEP_STEAM:
            return "same"
        # До одобрения: steam → hours. После сайта/сабов/done — правка steam → site.
        if row["step"] in (STEP_STEAM, STEP_HOURS, STEP_CLANS, STEP_AGE, STEP_REVIEW):
            new_step = STEP_HOURS if row["step"] == STEP_STEAM else row["step"]
        elif row["step"] in (STEP_SITE, STEP_SUBS):
            new_step = STEP_SITE
        elif row["step"] == STEP_DONE:
            new_step = STEP_SITE if row["steam_id"] and row["steam_id"] != steam_id else row["step"]
        else:
            new_step = row["step"]
        try:
            _c().execute(
                """
                UPDATE applicants
                SET steam_id=?,
                    step=?,
                    site_user_id=CASE WHEN steam_id IS NOT ? THEN NULL ELSE site_user_id END,
                    alert_sig='',
                    updated_at=?
                WHERE tg_id=?
                """,
                (steam_id, new_step, steam_id, ts, tg_id),
            )
            _c().commit()
        except sqlite3.IntegrityError:
            _c().rollback()
            return "taken"
    event(tg_id, "steam", steam_id)
    return "ok"


def set_step(tg_id: int, step: str, site_user_id: str | None = None, accepted: bool = False) -> None:
    ts = now()
    with _lock:
        if accepted:
            _c().execute(
                """
                UPDATE applicants
                SET step=?, site_user_id=COALESCE(?, site_user_id),
                    accepted_at=COALESCE(accepted_at, ?), updated_at=?, alert_sig=''
                WHERE tg_id=?
                """,
                (step, site_user_id, ts, ts, tg_id),
            )
        else:
            _c().execute(
                """
                UPDATE applicants
                SET step=?, site_user_id=COALESCE(?, site_user_id), updated_at=?
                WHERE tg_id=?
                """,
                (step, site_user_id, ts, tg_id),
            )
        _c().commit()


def mark_removed(tg_id: int) -> None:
    """Снять с учёта так, чтобы /start снова открыл набор с нуля."""
    with _lock:
        _c().execute(
            """
            UPDATE applicants
            SET step=?,
                steam_id=NULL,
                site_user_id=NULL,
                invite_channel=NULL,
                invite_group=NULL,
                squad_hours=NULL,
                prior_clans=NULL,
                applicant_age=NULL,
                alert_sig='',
                accepted_at=NULL,
                updated_at=?
            WHERE tg_id=?
            """,
            (STEP_REMOVED, now(), tg_id),
        )
        _c().commit()


def set_invites(
    tg_id: int,
    *,
    channel: str | None = None,
    group: str | None = None,
) -> None:
    with _lock:
        if channel is not None:
            _c().execute(
                "UPDATE applicants SET invite_channel=?, updated_at=? WHERE tg_id=?",
                (channel or None, now(), tg_id),
            )
        if group is not None:
            _c().execute(
                "UPDATE applicants SET invite_group=?, updated_at=? WHERE tg_id=?",
                (group or None, now(), tg_id),
            )
        _c().commit()


def clear_invites(tg_id: int) -> tuple[str, str]:
    """Возвращает старые ссылки (channel, group) и обнуляет."""
    with _lock:
        row = _c().execute(
            "SELECT invite_channel, invite_group FROM applicants WHERE tg_id=?",
            (tg_id,),
        ).fetchone()
        ch = (row["invite_channel"] or "").strip() if row else ""
        gr = (row["invite_group"] or "").strip() if row else ""
        _c().execute(
            """
            UPDATE applicants
            SET invite_channel=NULL, invite_group=NULL, updated_at=?
            WHERE tg_id=?
            """,
            (now(), tg_id),
        )
        _c().commit()
        return ch, gr


def delete_applicant(tg_id: int) -> bool:
    with _lock:
        cur = _c().execute("DELETE FROM applicants WHERE tg_id=?", (tg_id,))
        _c().commit()
        return cur.rowcount > 0


def _split_alert_sig(raw: str | None) -> tuple[str, int]:
    """alert_sig: plain или `sig|unix` для hourly cooldown."""
    text = raw or ""
    if "|" not in text:
        return text, 0
    base, _, ts = text.rpartition("|")
    if ts.isdigit():
        return base, int(ts)
    return text, 0


def set_alert_sig(tg_id: int, sig: str, *, cooldown_sec: int | None = None) -> bool:
    """True, если алерт надо послать.

    Без cooldown — один раз на подпись.
    С cooldown — та же подпись снова не раньше чем через N секунд.
    """
    with _lock:
        row = _c().execute(
            "SELECT alert_sig FROM applicants WHERE tg_id=?", (tg_id,)
        ).fetchone()
        if row is None:
            return False
        raw = row["alert_sig"] or ""
        prev_sig, prev_ts = _split_alert_sig(raw)
        if raw == sig:
            prev_sig = sig
        now_ts = int(datetime.now(timezone.utc).timestamp())
        if cooldown_sec is not None:
            if prev_sig == sig:
                if not prev_ts:
                    # старый plain — зафиксировать время, не спамить сразу
                    _c().execute(
                        "UPDATE applicants SET alert_sig=?, updated_at=? WHERE tg_id=?",
                        (f"{sig}|{now_ts}", now(), tg_id),
                    )
                    _c().commit()
                    return False
                if (now_ts - prev_ts) < cooldown_sec:
                    return False
            store = f"{sig}|{now_ts}"
        else:
            if prev_sig == sig or raw == sig:
                return False
            store = sig
        _c().execute(
            "UPDATE applicants SET alert_sig=?, updated_at=? WHERE tg_id=?",
            (store, now(), tg_id),
        )
        _c().commit()
        return True


def list_applicants(steps: tuple[str, ...] | None = None) -> list[sqlite3.Row]:
    if steps:
        marks = ",".join("?" for _ in steps)
        return list(
            _c().execute(
                f"SELECT * FROM applicants WHERE step IN ({marks}) ORDER BY updated_at DESC",
                steps,
            ).fetchall()
        )
    return list(
        _c().execute("SELECT * FROM applicants ORDER BY updated_at DESC").fetchall()
    )


def has_normal_tg_username(username: str | None) -> bool:
    """Как на сайте СРИ: 5+ символов, только A-Za-z0-9_."""
    u = (username or "").strip().lstrip("@")
    if len(u) < 5:
        return False
    return bool(re.fullmatch(r"[A-Za-z0-9_]+", u))


def mark_slag(tg_id: int, note: str = "", *, source: str = "auto", by: int | None = None) -> str:
    """Пометить шлак. active = cleared_at IS NULL."""
    with _lock:
        row = _c().execute("SELECT * FROM applicants WHERE tg_id=?", (tg_id,)).fetchone()
        if row is None:
            return "not_found"
        now_s = now()
        cur = _c().execute(
            """
            INSERT INTO slag(tg_id, note, source, created_at, created_by, cleared_at, cleared_by)
            VALUES(?,?,?,?,?,NULL,NULL)
            ON CONFLICT(tg_id) DO UPDATE SET
              note=excluded.note,
              source=excluded.source,
              created_at=excluded.created_at,
              created_by=excluded.created_by,
              cleared_at=NULL,
              cleared_by=NULL
            """,
            (tg_id, (note or "").strip()[:200], source, now_s, by),
        )
        _c().commit()
        event(tg_id, "slag-mark", f"{source}:{(note or '')[:80]}")
        return "ok" if cur.rowcount else "ok"


def clear_slag(tg_id: int, by: int | None = None) -> str:
    with _lock:
        row = _c().execute(
            "SELECT tg_id FROM slag WHERE tg_id=? AND cleared_at IS NULL",
            (tg_id,),
        ).fetchone()
        if row is None:
            return "not_slag"
        _c().execute(
            "UPDATE slag SET cleared_at=?, cleared_by=? WHERE tg_id=?",
            (now(), by, tg_id),
        )
        _c().commit()
        event(tg_id, "slag-clear", str(by or ""))
        return "ok"


def is_slag(tg_id: int) -> bool:
    row = _c().execute(
        "SELECT 1 FROM slag WHERE tg_id=? AND cleared_at IS NULL",
        (tg_id,),
    ).fetchone()
    return row is not None


def list_slag(include_cleared: bool = False) -> list[dict]:
    """
    Шлак для HR:
    1) активные строки slag
    2) step=done без нормального TG (авто, даже если ещё не в таблице)
    """
    out: list[dict] = []
    seen: set[int] = set()

    if include_cleared:
        slag_rows = list(
            _c().execute(
                """
                SELECT s.*, a.game_nick, a.real_name, a.tg_username, a.steam_id, a.step,
                       a.squad_hours, a.prior_clans, a.applicant_age, a.accepted_at, a.tg_first
                FROM slag s
                LEFT JOIN applicants a ON a.tg_id = s.tg_id
                ORDER BY COALESCE(s.cleared_at, s.created_at) DESC
                """
            ).fetchall()
        )
    else:
        slag_rows = list(
            _c().execute(
                """
                SELECT s.*, a.game_nick, a.real_name, a.tg_username, a.steam_id, a.step,
                       a.squad_hours, a.prior_clans, a.applicant_age, a.accepted_at, a.tg_first
                FROM slag s
                LEFT JOIN applicants a ON a.tg_id = s.tg_id
                WHERE s.cleared_at IS NULL
                ORDER BY s.created_at DESC
                """
            ).fetchall()
        )

    for r in slag_rows:
        tid = int(r["tg_id"])
        seen.add(tid)
        out.append(
            {
                "tg_id": tid,
                "game_nick": r["game_nick"],
                "real_name": r["real_name"],
                "tg_username": r["tg_username"],
                "tg_first": r["tg_first"],
                "steam_id": r["steam_id"],
                "step": r["step"] or "?",
                "squad_hours": r["squad_hours"],
                "prior_clans": r["prior_clans"],
                "applicant_age": r["applicant_age"],
                "accepted_at": r["accepted_at"],
                "slag_note": r["note"] or "",
                "slag_source": r["source"] or "auto",
                "slag_at": r["created_at"],
                "cleared_at": r["cleared_at"],
                "why": r["note"] or ("ручная пометка" if r["source"] == "hr" else "шлак"),
            }
        )

    # авто: принятые без нормального @
    for r in list_applicants((STEP_DONE,)):
        tid = int(r["tg_id"])
        if tid in seen:
            continue
        if has_normal_tg_username(r["tg_username"]):
            continue
        # подтянуть в таблицу, чтобы HR видел стабильно
        mark_slag(tid, "нет нормального TG username", source="auto", by=None)
        seen.add(tid)
        out.append(
            {
                "tg_id": tid,
                "game_nick": r["game_nick"],
                "real_name": r["real_name"],
                "tg_username": r["tg_username"],
                "tg_first": r["tg_first"],
                "steam_id": r["steam_id"],
                "step": r["step"],
                "squad_hours": r["squad_hours"],
                "prior_clans": r["prior_clans"],
                "applicant_age": r["applicant_age"],
                "accepted_at": r["accepted_at"],
                "slag_note": "нет нормального TG username",
                "slag_source": "auto",
                "slag_at": now(),
                "cleared_at": None,
                "why": "нет нормального TG username",
            }
        )

    out.sort(key=lambda x: str(x.get("slag_at") or ""), reverse=True)
    return out


def find_applicants(query: str, limit: int = 24) -> list[sqlite3.Row]:
    """Поиск по нику / имени / @username / SteamID64 (подстрока, без регистра)."""
    q = (query or "").strip().lstrip("@")
    if len(q) < 1:
        return []
    like = f"%{q}%"
    prefix = f"{q}%"
    # без пробелов: "DARK KING" ↔ "DARKKING"
    compact = re.sub(r"\s+", "", q)
    like_c = f"%{compact}%" if compact and compact != q else None
    params: list[object] = [like, like, like, like]
    compact_sql = ""
    if like_c:
        compact_sql = """
               OR REPLACE(IFNULL(game_nick, ''), ' ', '') LIKE ? COLLATE NOCASE
               OR REPLACE(IFNULL(real_name, ''), ' ', '') LIKE ? COLLATE NOCASE
        """
        params.extend([like_c, like_c])
    params.extend([prefix, limit])
    return list(
        _c()
        .execute(
            f"""
            SELECT * FROM applicants
            WHERE game_nick LIKE ? COLLATE NOCASE
               OR IFNULL(real_name, '') LIKE ? COLLATE NOCASE
               OR IFNULL(tg_username, '') LIKE ? COLLATE NOCASE
               OR IFNULL(steam_id, '') LIKE ?
               {compact_sql}
            ORDER BY
              CASE WHEN game_nick LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
              game_nick COLLATE NOCASE
            LIMIT ?
            """,
            params,
        )
        .fetchall()
    )


def label(row: sqlite3.Row) -> str:
    nick = row["game_nick"] or "без ника"
    name = row["real_name"] or ""
    if name:
        return f"{nick} ({name})"
    return nick


def export_csv() -> tuple[bytes, bytes]:
    people = list_applicants()
    buf_p = io.StringIO()
    w = csv.writer(buf_p)
    w.writerow(
        [
            "tg_id",
            "tg_username",
            "game_nick",
            "real_name",
            "steam_id",
            "squad_hours",
            "prior_clans",
            "applicant_age",
            "step",
            "site_user_id",
            "created_at",
            "updated_at",
            "accepted_at",
        ]
    )
    for r in people:
        w.writerow(
            [
                r["tg_id"],
                r["tg_username"] or "",
                r["game_nick"] or "",
                r["real_name"] or "",
                r["steam_id"] or "",
                r["squad_hours"] or "",
                r["prior_clans"] or "",
                r["applicant_age"] or "",
                r["step"],
                r["site_user_id"] or "",
                r["created_at"],
                r["updated_at"],
                r["accepted_at"] or "",
            ]
        )
    ev = list(_c().execute("SELECT * FROM events ORDER BY id").fetchall())
    buf_e = io.StringIO()
    w = csv.writer(buf_e)
    w.writerow(["id", "at", "tg_id", "kind", "detail"])
    for r in ev:
        w.writerow([r["id"], r["at"], r["tg_id"] or "", r["kind"], r["detail"] or ""])
    return (
        buf_p.getvalue().encode("utf-8-sig"),
        buf_e.getvalue().encode("utf-8-sig"),
    )
