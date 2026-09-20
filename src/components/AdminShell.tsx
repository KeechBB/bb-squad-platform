"use client";

import Link from "next/link";
import { useState } from "react";
import { AdminUsersTable, type AdminUserRow } from "@/components/AdminUsersTable";
import { AdminAttendancePanel } from "@/components/AdminAttendancePanel";
import { AdminJournalPanel } from "@/components/AdminJournalPanel";
import type { AppRole } from "@/lib/roles";

type Props = {
  users: AdminUserRow[];
  roleOptions: AppRole[];
  actorRole: AppRole;
};

type Tab = "users" | "attendance" | "journal";

const TAB_LEAD: Record<Tab, string> = {
  users: "Пользователи платформы. Кликни по нику — правка анкеты и аватара.",
  attendance:
    "Посещаемость по логам TR1 (тренировка) и PB1/TPUB1 (паблик). Таблица до 30 дней.",
  journal:
    "Накопительный журнал: кто кому что выдал, админ-права и движения по клану. Поиск по словам.",
};

export function AdminShell({ users, roleOptions, actorRole }: Props) {
  const [tab, setTab] = useState<Tab>("users");

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
    </main>
  );
}
