"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminUsersTable, type AdminUserRow } from "@/components/AdminUsersTable";
import { AdminAttendancePanel } from "@/components/AdminAttendancePanel";
import { AdminJournalPanel } from "@/components/AdminJournalPanel";
import { AdminVisitsPanel } from "@/components/AdminVisitsPanel";
import { AdminReservePanel } from "@/components/AdminReservePanel";
import type { AppRole } from "@/lib/roles";

type Props = {
  users: AdminUserRow[];
  roleOptions: AppRole[];
  actorRole: AppRole;
  /** Заходы на сайт — Keech / Зам / HR */
  showSiteVisits: boolean;
  /** Вкладка резерва — Keech / Зам / HR */
  showReserve: boolean;
};

type Tab = "users" | "attendance" | "journal" | "visits" | "reserve";

const TAB_LEAD: Record<Tab, string> = {
  users: "Пользователи платформы. Кликни по нику — правка анкеты и аватара.",
  attendance:
    "Посещаемость по логам TR1 (тренировка) и PB1/TPUB1 (паблик). Таблица до 30 дней.",
  journal:
    "Накопительный журнал: роли, клан, профиль и тикеты поддержки (открытие, сообщения, ответы, закрытие).",
  visits:
    "Кто заходит на сайт, где сидит, куда тыкает. Keech / Зам / HR. Не путать с посещаемостью TR1.",
  reserve:
    "Резерв BlackBerry: весь состав, причины, даты ухода/возврата, ручное управление, история.",
};

function readTab(allowVisits: boolean, allowReserve: boolean): Tab {
  if (typeof window === "undefined") return "users";
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t === "attendance" || t === "journal" || t === "users") return t;
  if (t === "visits" && allowVisits) return "visits";
  if (t === "reserve" && allowReserve) return "reserve";
  return "users";
}

export function AdminShell({
  users,
  roleOptions,
  actorRole,
  showSiteVisits,
  showReserve,
}: Props) {
  const [tab, setTab] = useState<Tab>("users");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTab(readTab(showSiteVisits, showReserve));
    setHydrated(true);
  }, [showSiteVisits, showReserve]);

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
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(
      null,
      "",
      `${url.pathname}?${url.searchParams.toString()}`
    );
  }, [tab, hydrated, showSiteVisits, showReserve]);

  return (
    <main
      className={
        tab === "attendance" ? "admin-page admin-attendance-page" : "admin-page"
      }
    >
      <section className="hero">
        <p className="eyebrow">админ</p>
        <h1>Панель</h1>
        <p className="lead">{TAB_LEAD[tab]}</p>
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
          {showSiteVisits ? (
            <button
              type="button"
              className={`admin-tab ${tab === "visits" ? "active" : ""}`}
              onClick={() => setTab("visits")}
            >
              Заходы на сайт
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
      {tab === "visits" && showSiteVisits ? <AdminVisitsPanel /> : null}
    </main>
  );
}
