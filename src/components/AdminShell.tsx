"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminUsersTable, type AdminUserRow } from "@/components/AdminUsersTable";
import { AdminAttendancePanel } from "@/components/AdminAttendancePanel";
import { AdminJournalPanel } from "@/components/AdminJournalPanel";
import { AdminVisitsPanel } from "@/components/AdminVisitsPanel";
import type { AppRole } from "@/lib/roles";

type Props = {
  users: AdminUserRow[];
  roleOptions: AppRole[];
  actorRole: AppRole;
  /** Вкладка логов заходов на сайт — только Keech */
  showSiteVisits: boolean;
};

type Tab = "users" | "attendance" | "journal" | "visits";

const TAB_LEAD: Record<Tab, string> = {
  users: "Пользователи платформы. Кликни по нику — правка анкеты и аватара.",
  attendance:
    "Посещаемость по логам TR1 (тренировка) и PB1/TPUB1 (паблик). Таблица до 30 дней.",
  journal:
    "Накопительный журнал: кто кому что выдал, админ-права и движения по клану. Поиск по словам.",
  visits:
    "Приватно: кто заходит на сайт, где сидит, куда тыкает, динамика по дням/часам. Не путать с посещаемостью TR1.",
};

function readTab(allowVisits: boolean): Tab {
  if (typeof window === "undefined") return "users";
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t === "attendance" || t === "journal" || t === "users") return t;
  if (t === "visits" && allowVisits) return "visits";
  return "users";
}

export function AdminShell({
  users,
  roleOptions,
  actorRole,
  showSiteVisits,
}: Props) {
  const [tab, setTab] = useState<Tab>("users");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTab(readTab(showSiteVisits));
    setHydrated(true);
  }, [showSiteVisits]);

  useEffect(() => {
    if (!hydrated) return;
    if (tab === "visits" && !showSiteVisits) {
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
  }, [tab, hydrated, showSiteVisits]);

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
      {tab === "journal" ? <AdminJournalPanel /> : null}
      {tab === "visits" && showSiteVisits ? <AdminVisitsPanel /> : null}
    </main>
  );
}
