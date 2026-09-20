"use client";

import Link from "next/link";
import { useState } from "react";
import { AdminUsersTable, type AdminUserRow } from "@/components/AdminUsersTable";
import { AdminAttendancePanel } from "@/components/AdminAttendancePanel";
import type { AppRole } from "@/lib/roles";

type Props = {
  users: AdminUserRow[];
  roleOptions: AppRole[];
  actorRole: AppRole;
};

export function AdminShell({ users, roleOptions, actorRole }: Props) {
  const [tab, setTab] = useState<"users" | "attendance">("users");

  return (
    <main
      className={
        tab === "attendance" ? "admin-page admin-attendance-page" : "admin-page"
      }
    >
      <section className="hero">
        <p className="eyebrow">админ</p>
        <h1>Панель</h1>
        <p className="lead">
          {tab === "users"
            ? "Пользователи платформы. Кликни по нику — правка анкеты и аватара."
            : "Посещаемость тренировок по логам TPUB1. Таблица до 30 дней, фильтры периода."}
        </p>
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
      ) : (
        <AdminAttendancePanel />
      )}
    </main>
  );
}
