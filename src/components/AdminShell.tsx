"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminUsersTable, type AdminUserRow } from "@/components/AdminUsersTable";
import { AdminAttendancePanel } from "@/components/AdminAttendancePanel";
import { AdminJournalPanel } from "@/components/AdminJournalPanel";
import { AdminVisitsPanel } from "@/components/AdminVisitsPanel";
import { AdminReservePanel } from "@/components/AdminReservePanel";
import { AdminUpdatesPanel } from "@/components/AdminUpdatesPanel";
import { AdminTierLogPanel } from "@/components/AdminTierLogPanel";
import { AdminKeechHuntPanel } from "@/components/AdminKeechHuntPanel";
import type { AppRole } from "@/lib/roles";

type Props = {
  users: AdminUserRow[];
  roleOptions: AppRole[];
  actorRole: AppRole;
  /** Заходы на сайт — Keech / Зам / HR */
  showSiteVisits: boolean;
  /** Вкладка резерва — Keech / Зам / HR */
  showReserve: boolean;
  /** Личный hunt-лог — только Keech (builtin super) */
  showKeechHunt: boolean;
};

type Tab =
  | "users"
  | "attendance"
  | "journal"
  | "visits"
  | "reserve"
  | "updates"
  | "tiers"
  | "hunt";

const TAB_LEAD: Record<Tab, string> = {
  users: "Пользователи платформы. Кликни по нику — правка анкеты и аватара.",
  attendance:
    "Посещаемость тренировок — только клан BlackBerry (логи TR1). Паблик PB1 — отдельно. Таблица до 30 дней.",
  journal:
    "Накопительный журнал: роли, клан, профиль и тикеты поддержки (открытие, сообщения, ответы, закрытие).",
  visits:
    "Кто заходит на сайт, где сидит, куда тыкает. Keech / Зам / HR. Не путать с посещаемостью TR1.",
  reserve:
    "Резерв BlackBerry: весь состав, причины, даты ухода/возврата, ручное управление, история.",
  updates:
    "Логи обновлений сайта: дата, Beta-версия и что добавили для игроков.",
  tiers:
    "История переводов по тирам: кто, когда, из какого в какой. Можно дописать вручную.",
  hunt:
    "Личный live-лог PB1+TR1: ноки / киллы / смерти / ресы и пробный ±RP. Только для тебя.",
};

function readTab(
  allowVisits: boolean,
  allowReserve: boolean,
  allowHunt: boolean
): Tab {
  if (typeof window === "undefined") return "users";
  const t = new URLSearchParams(window.location.search).get("tab");
  if (
    t === "attendance" ||
    t === "journal" ||
    t === "users" ||
    t === "updates" ||
    t === "tiers"
  )
    return t;
  if (t === "visits" && allowVisits) return "visits";
  if (t === "reserve" && allowReserve) return "reserve";
  if (t === "hunt" && allowHunt) return "hunt";
  return "users";
}

export function AdminShell({
  users,
  roleOptions,
  actorRole,
  showSiteVisits,
  showReserve,
  showKeechHunt,
}: Props) {
  const [tab, setTab] = useState<Tab>("users");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTab(readTab(showSiteVisits, showReserve, showKeechHunt));
    setHydrated(true);
  }, [showSiteVisits, showReserve, showKeechHunt]);

  useEffect(() => {
    if (!hydrated) return;
    if (tab === "visits" && !showSiteVisits) {
      setTab("users");
      return;
    }
    if (tab === "reserve" && !showReserve) {
      setTab("users");
      return;
    }
    if (tab === "hunt" && !showKeechHunt) {
      setTab("users");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(
      null,
      "",
      `${url.pathname}?${url.searchParams.toString()}`
    );
  }, [tab, hydrated, showSiteVisits, showReserve, showKeechHunt]);

  return (
    <main
      className={
        tab === "attendance"
          ? "admin-page admin-attendance-page"
          : tab === "hunt"
            ? "admin-page admin-keech-hunt-page"
            : "admin-page"
      }
    >
      <section className="hero">
        <p className="eyebrow">админ</p>
        <h1>Панель</h1>
        <p className="lead">{TAB_LEAD[tab]}</p>
        <div className="admin-export-row">
          <a
            className="btn primary admin-export-btn"
            href="/api/admin/users/export"
            download
          >
            Выгрузить пользователей в Excel
          </a>
          <span className="muted admin-export-hint">
            № · Ник · Имя · Steam ID · Резерв / не резерв
          </span>
        </div>
        <div className="admin-tabs" role="tablist">
          <button
            type="button"
            className={`admin-tab ${tab === "users" ? "active" : ""}`}
            onClick={() => setTab("users")}
          >
            Пользователи
          </button>
          <button
            type="button"
            className={`admin-tab ${tab === "attendance" ? "active" : ""}`}
            onClick={() => setTab("attendance")}
          >
            Посещаемость тренировок
          </button>
          {showReserve ? (
            <button
              type="button"
              className={`admin-tab ${tab === "reserve" ? "active" : ""}`}
              onClick={() => setTab("reserve")}
            >
              Резерв
            </button>
          ) : null}
          <button
            type="button"
            className={`admin-tab ${tab === "journal" ? "active" : ""}`}
            onClick={() => setTab("journal")}
          >
            Журнал действий
          </button>
          <button
            type="button"
            className={`admin-tab ${tab === "tiers" ? "active" : ""}`}
            onClick={() => setTab("tiers")}
          >
            Лог тиров
          </button>
          <button
            type="button"
            className={`admin-tab ${tab === "updates" ? "active" : ""}`}
            onClick={() => setTab("updates")}
          >
            Логи обновлений
          </button>
          {showSiteVisits ? (
            <button
              type="button"
              className={`admin-tab ${tab === "visits" ? "active" : ""}`}
              onClick={() => setTab("visits")}
            >
              Заходы на сайт
            </button>
          ) : null}
          {showKeechHunt ? (
            <button
              type="button"
              className={`admin-tab ${tab === "hunt" ? "active" : ""}`}
              onClick={() => setTab("hunt")}
            >
              Hunt
            </button>
          ) : null}
        </div>
        <p style={{ marginTop: 12 }}>
          <Link className="kv-link" href="/profile">
            ← В профиль
          </Link>
        </p>
      </section>

      {tab === "users" ? (
        <AdminUsersTable
          initialUsers={users}
          roleOptions={roleOptions}
          actorRole={actorRole}
        />
      ) : null}
      {tab === "attendance" ? <AdminAttendancePanel /> : null}
      {tab === "reserve" && showReserve ? <AdminReservePanel /> : null}
      {tab === "journal" ? <AdminJournalPanel /> : null}
      {tab === "tiers" ? <AdminTierLogPanel /> : null}
      {tab === "updates" ? <AdminUpdatesPanel /> : null}
      {tab === "visits" && showSiteVisits ? <AdminVisitsPanel /> : null}
      {tab === "hunt" && showKeechHunt ? <AdminKeechHuntPanel /> : null}
    </main>
  );
}
