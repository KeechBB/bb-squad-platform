"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminUsersTable, type AdminUserRow } from "@/components/AdminUsersTable";
import { AdminAttendancePanel } from "@/components/AdminAttendancePanel";
import { AdminJournalPanel } from "@/components/AdminJournalPanel";
import { AdminVisitsPanel } from "@/components/AdminVisitsPanel";
import { AdminReservePanel } from "@/components/AdminReservePanel";
import { AdminUpdatesPanel } from "@/components/AdminUpdatesPanel";
import { AdminFactionLogPanel } from "@/components/AdminFactionLogPanel";
import { AdminKeechHuntPanel } from "@/components/AdminKeechHuntPanel";
import { AdminLoadPanel } from "@/components/AdminLoadPanel";
import { AdminMailPanel } from "@/components/AdminMailPanel";
import { AdminMarketLogPanel } from "@/components/AdminMarketLogPanel";
import { AdminCasesLogPanel } from "@/components/AdminCasesLogPanel";
import { AdminTransfersPanel } from "@/components/AdminTransfersPanel";
import { AdminModLogPanel } from "@/components/AdminModLogPanel";
import { AdminPublicVipsPanel } from "@/components/AdminPublicVipsPanel";
import { AdminServerBansPanel } from "@/components/AdminServerBansPanel";
import type { AppRole } from "@/lib/roles";

type Props = {
  users: AdminUserRow[];
  roleOptions: AppRole[];
  actorRole: AppRole;
  /** Заходы на сайт — Keech / Зам / HR / паблик */
  showSiteVisits: boolean;
  /** Вкладка резерва — Keech / Зам / HR */
  showReserve: boolean;
  /** Письмо — Keech / Зам / HR */
  showMail: boolean;
  /** Серверы (panelka) */
  showServers: boolean;
  /** Личный hunt-лог — только Keech (builtin super) */
  showKeechHunt: boolean;
  /** Админ/мод паблика: только users / journal / servers / visits / load / modlog */
  publicLimited?: boolean;
};

type Tab =
  | "users"
  | "attendance"
  | "journal"
  | "tournaments"
  | "visits"
  | "reserve"
  | "updates"
  | "factions"
  | "hunt"
  | "load"
  | "mail"
  | "market"
  | "cases"
  | "transfers"
  | "modlog"
  | "vips"
  | "serverbans";

const TAB_LEAD: Record<Tab, string> = {
  users: "Пользователи платформы. Кликни по нику — правка анкеты и аватара.",
  attendance:
    "Посещаемость: таблица явки (BB / PB1) и статистика — динамика вечера TR1+TR2 + стрики пропусков/явки.",
  journal:
    "Накопительный журнал: роли, клан, профиль, тикеты поддержки и турниры.",
  tournaments:
    "Все движения по вкладке Турниры: команды, приглашения, роли, лого, заявки на кубок.",
  visits:
    "Кто заходит на сайт, где сидит, куда тыкает. Keech / Зам / HR. Не путать с посещаемостью TR1.",
  reserve:
    "Выходной (1–3 дня) и резерв (от 4 дней): состав BB, выдача/снятие задним числом, календарь, история.",
  updates:
    "Логи обновлений сайта: дата, Beta-версия и что добавили для игроков.",
  factions:
    "Лог фракций: кто кого добавил или исключил. При исключении — обязательная причина.",
  hunt:
    "Личный live-лог PB1+TR1: ноки / киллы / смерти / ресы и пробный ±RP. Только для тебя.",
  load: "Нагрузка plaza: CPU, RAM, NVMe. Фильтры Минуты / Часы / Дни.",
  mail: "Письмо в почту профиля: от разработчика, администрации, отдела кадров или со своей подписью.",
  market:
    "Лог торговой площадки: покупки и продажи нашивок, фонов и шрифтов — время, ник, цена BBC.",
  cases:
    "Лог кейсов Сада: открытия, списания BBC/$, дроп и оценка продажи с площадки.",
  transfers:
    "Трансферное окно фракций: открыть/закрыть, даты паузы, прогон гринда Черничных Долларов с тренировок.",
  modlog:
    "Лог всех админов и модераторов паблика: кто кого кикнул/забанил/варнул и когда. Кликни ник — карточка игрока.",
  vips:
    "Випки паблика (QueuePriority): действующие приоритеты очереди, поиск, выдача со сроком и кто выдал.",
  serverbans:
    "Баны серверов из Bans.cfg: список, поиск, выдача со сроком и снятие бана.",
};

const PUBLIC_TABS: Tab[] = [
  "users",
  "journal",
  "visits",
  "load",
  "modlog",
  "vips",
  "serverbans",
];

function readTab(
  allowVisits: boolean,
  allowReserve: boolean,
  allowHunt: boolean,
  allowMail: boolean,
  publicLimited: boolean
): Tab {
  if (typeof window === "undefined") return "users";
  const t = new URLSearchParams(window.location.search).get("tab");
  if (publicLimited) {
    if (
      t === "journal" ||
      t === "users" ||
      t === "load" ||
      t === "modlog" ||
      t === "vips" ||
      t === "serverbans"
    )
      return t;
    if (t === "visits" && allowVisits) return "visits";
    return "users";
  }
  if (
    t === "attendance" ||
    t === "journal" ||
    t === "tournaments" ||
    t === "users" ||
    t === "updates" ||
    t === "factions" ||
    t === "load" ||
    t === "market" ||
    t === "cases" ||
    t === "transfers" ||
    t === "modlog" ||
    t === "vips" ||
    t === "serverbans"
  )
    return t;
  if (t === "tiers") return "factions";
  if (t === "mail" && allowMail) return "mail";
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
  showMail,
  showServers,
  showKeechHunt,
  publicLimited = false,
}: Props) {
  const [tab, setTab] = useState<Tab>("users");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTab(
      readTab(showSiteVisits, showReserve, showKeechHunt, showMail, publicLimited)
    );
    setHydrated(true);
  }, [showSiteVisits, showReserve, showKeechHunt, showMail, publicLimited]);

  useEffect(() => {
    if (!hydrated) return;
    if (publicLimited && !PUBLIC_TABS.includes(tab)) {
      setTab("users");
      return;
    }
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
    if (tab === "transfers" && !showKeechHunt) {
      setTab("users");
      return;
    }
    if (tab === "mail" && !showMail) {
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
  }, [
    tab,
    hydrated,
    showSiteVisits,
    showReserve,
    showKeechHunt,
    showMail,
    publicLimited,
  ]);

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
        {!publicLimited ? (
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
        ) : null}
        <div className="admin-tabs" role="tablist">
          <button
            type="button"
            className={`admin-tab ${tab === "users" ? "active" : ""}`}
            onClick={() => setTab("users")}
          >
            Пользователи
          </button>
          {!publicLimited ? (
            <button
              type="button"
              className={`admin-tab ${tab === "attendance" ? "active" : ""}`}
              onClick={() => setTab("attendance")}
            >
              Посещаемость тренировок
            </button>
          ) : null}
          {!publicLimited && showReserve ? (
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
          {!publicLimited ? (
            <button
              type="button"
              className={`admin-tab ${tab === "tournaments" ? "active" : ""}`}
              onClick={() => setTab("tournaments")}
            >
              Турниры
            </button>
          ) : null}
          {!publicLimited ? (
            <button
              type="button"
              className={`admin-tab ${tab === "factions" ? "active" : ""}`}
              onClick={() => setTab("factions")}
            >
              Лог фракций
            </button>
          ) : null}
          {!publicLimited ? (
            <button
              type="button"
              className={`admin-tab ${tab === "market" ? "active" : ""}`}
              onClick={() => setTab("market")}
            >
              Лог магазина
            </button>
          ) : null}
          {!publicLimited ? (
            <button
              type="button"
              className={`admin-tab ${tab === "cases" ? "active" : ""}`}
              onClick={() => setTab("cases")}
            >
              Лог кейсов
            </button>
          ) : null}
          {!publicLimited ? (
            <button
              type="button"
              className={`admin-tab ${tab === "updates" ? "active" : ""}`}
              onClick={() => setTab("updates")}
            >
              Логи обновлений
            </button>
          ) : null}
          {!publicLimited && showMail ? (
            <button
              type="button"
              className={`admin-tab ${tab === "mail" ? "active" : ""}`}
              onClick={() => setTab("mail")}
            >
              Письмо
            </button>
          ) : null}
          {showServers ? (
            <Link
              href="/admin/panelka"
              className="admin-tab"
              style={{ textDecoration: "none", display: "inline-block" }}
            >
              Серверы
            </Link>
          ) : null}
          {showServers ? (
            <button
              type="button"
              className={`admin-tab ${tab === "modlog" ? "active" : ""}`}
              onClick={() => setTab("modlog")}
            >
              Лог модерации
            </button>
          ) : null}
          {showServers ? (
            <button
              type="button"
              className={`admin-tab ${tab === "vips" ? "active" : ""}`}
              onClick={() => setTab("vips")}
            >
              Випки с паблика
            </button>
          ) : null}
          {showServers ? (
            <button
              type="button"
              className={`admin-tab ${tab === "serverbans" ? "active" : ""}`}
              onClick={() => setTab("serverbans")}
            >
              Баны серверов
            </button>
          ) : null}
          {showSiteVisits ? (
            <button
              type="button"
              className={`admin-tab ${tab === "visits" ? "active" : ""}`}
              onClick={() => setTab("visits")}
            >
              Заходы на сайт
            </button>
          ) : null}
          {!publicLimited && showKeechHunt ? (
            <button
              type="button"
              className={`admin-tab ${tab === "transfers" ? "active" : ""}`}
              onClick={() => setTab("transfers")}
            >
              Трансферы
            </button>
          ) : null}
          {!publicLimited && showKeechHunt ? (
            <button
              type="button"
              className={`admin-tab ${tab === "hunt" ? "active" : ""}`}
              onClick={() => setTab("hunt")}
            >
              Hunt
            </button>
          ) : null}
          <button
            type="button"
            className={`admin-tab ${tab === "load" ? "active" : ""}`}
            onClick={() => setTab("load")}
          >
            Нагрузка
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
      {!publicLimited && tab === "attendance" ? <AdminAttendancePanel /> : null}
      {!publicLimited && tab === "reserve" && showReserve ? (
        <AdminReservePanel />
      ) : null}
      {tab === "journal" ? <AdminJournalPanel /> : null}
      {!publicLimited && tab === "tournaments" ? (
        <AdminJournalPanel
          fixedCategory="tournament"
          title="Журнал турниров"
          emptyHint="Пока нет записей. Сюда попадают создание/роспуск команд, приглашения, роли, лого и заявки на кубок."
          searchPlaceholder="Ник, тег команды, заявка…"
        />
      ) : null}
      {!publicLimited && tab === "factions" ? <AdminFactionLogPanel /> : null}
      {!publicLimited && tab === "market" ? <AdminMarketLogPanel /> : null}
      {!publicLimited && tab === "cases" ? <AdminCasesLogPanel /> : null}
      {!publicLimited && tab === "updates" ? <AdminUpdatesPanel /> : null}
      {!publicLimited && tab === "mail" && showMail ? <AdminMailPanel /> : null}
      {tab === "visits" && showSiteVisits ? <AdminVisitsPanel /> : null}
      {tab === "modlog" && showServers ? <AdminModLogPanel /> : null}
      {tab === "vips" && showServers ? <AdminPublicVipsPanel /> : null}
      {tab === "serverbans" && showServers ? <AdminServerBansPanel /> : null}
      {!publicLimited && tab === "transfers" && showKeechHunt ? (
        <AdminTransfersPanel />
      ) : null}
      {!publicLimited && tab === "hunt" && showKeechHunt ? (
        <AdminKeechHuntPanel />
      ) : null}
      {tab === "load" ? <AdminLoadPanel /> : null}
    </main>
  );
}
