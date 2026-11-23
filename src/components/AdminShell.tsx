"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { AdminPublicCamerasPanel } from "@/components/AdminPublicCamerasPanel";
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
  | "cameras"
  | "serverbans";

type MenuItem =
  | { kind: "tab"; tab: Tab; label: string }
  | { kind: "link"; href: string; label: string };

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
  cameras:
    "Камеры (Cameraman): кто получил freecam, кто выдал, поиск и снятие из Admins.cfg.",
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
  "cameras",
  "serverbans",
];

const SERVER_TABS: Tab[] = ["vips", "cameras", "modlog", "serverbans"];
const LOG_TABS: Tab[] = [
  "factions",
  "cases",
  "updates",
  "tournaments",
  "market",
];
const MANAGE_TABS: Tab[] = ["hunt", "load", "visits", "mail", "attendance", "reserve"];

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
      t === "cameras" ||
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
    t === "cameras" ||
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

function AdminTabMenu({
  label,
  tone,
  active,
  items,
  currentTab,
  onSelectTab,
}: {
  label: string;
  tone: "servers" | "logs" | "manage";
  active: boolean;
  items: MenuItem[];
  currentTab: Tab;
  onSelectTab: (tab: Tab) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div className={`admin-tab-menu ${open ? "is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`admin-tab admin-tab-group admin-tab-group--${tone}${
          active ? " active" : ""
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className="admin-tab-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="admin-tab-dropdown" id={menuId} role="menu">
          {items.map((item) => {
            if (item.kind === "link") {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  className="admin-tab-dropdown-item"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              );
            }
            const isOn = currentTab === item.tab;
            return (
              <button
                key={item.tab}
                type="button"
                role="menuitem"
                className={`admin-tab-dropdown-item${isOn ? " is-on" : ""}`}
                onClick={() => {
                  onSelectTab(item.tab);
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SubTabs({
  items,
  currentTab,
  onSelectTab,
}: {
  items: MenuItem[];
  currentTab: Tab;
  onSelectTab: (tab: Tab) => void;
}) {
  const tabItems = items.filter((i): i is Extract<MenuItem, { kind: "tab" }> => i.kind === "tab");
  const linkItems = items.filter((i): i is Extract<MenuItem, { kind: "link" }> => i.kind === "link");
  if (!tabItems.length && !linkItems.length) return null;
  return (
    <div className="admin-subtabs" role="tablist" aria-label="Подразделы">
      {linkItems.map((item) => (
        <Link key={item.href} href={item.href} className="admin-tab admin-subtab">
          {item.label}
        </Link>
      ))}
      {tabItems.map((item) => (
        <button
          key={item.tab}
          type="button"
          className={`admin-tab admin-subtab${currentTab === item.tab ? " active" : ""}`}
          onClick={() => onSelectTab(item.tab)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
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

  const serversItems: MenuItem[] = showServers
    ? [
        { kind: "tab", tab: "vips", label: "Випки с паблика" },
        { kind: "tab", tab: "cameras", label: "Камеры (лог)" },
        { kind: "tab", tab: "modlog", label: "Лог модерации" },
        { kind: "link", href: "/admin/panelka", label: "Серверы" },
        { kind: "tab", tab: "serverbans", label: "Баны серверов" },
      ]
    : [];

  const logsItems: MenuItem[] = !publicLimited
    ? [
        { kind: "tab", tab: "factions", label: "Лог фракций" },
        { kind: "tab", tab: "cases", label: "Лог кейсов" },
        { kind: "tab", tab: "updates", label: "Лог обновлений" },
        { kind: "tab", tab: "tournaments", label: "Лог турниров" },
        { kind: "tab", tab: "market", label: "Лог магазина" },
      ]
    : [];

  const manageItems: MenuItem[] = [
    ...(!publicLimited && showKeechHunt
      ? ([{ kind: "tab", tab: "hunt", label: "Hunt" }] as MenuItem[])
      : []),
    { kind: "tab", tab: "load", label: "Нагрузка" },
    ...(showSiteVisits
      ? ([{ kind: "tab", tab: "visits", label: "Заходы на сайт" }] as MenuItem[])
      : []),
    ...(!publicLimited && showMail
      ? ([{ kind: "tab", tab: "mail", label: "Письмо" }] as MenuItem[])
      : []),
    ...(!publicLimited
      ? ([
          { kind: "tab", tab: "attendance", label: "Посещаемость тренировок" },
        ] as MenuItem[])
      : []),
    ...(showReserve
      ? ([{ kind: "tab", tab: "reserve", label: "Резерв" }] as MenuItem[])
      : []),
  ];

  const activeGroup: "servers" | "logs" | "manage" | null = SERVER_TABS.includes(tab)
    ? "servers"
    : LOG_TABS.includes(tab)
      ? "logs"
      : MANAGE_TABS.includes(tab)
        ? "manage"
        : null;

  const activeGroupItems =
    activeGroup === "servers"
      ? serversItems
      : activeGroup === "logs"
        ? logsItems
        : activeGroup === "manage"
          ? manageItems
          : [];

  let content: ReactNode = null;
  if (tab === "users") {
    content = (
      <AdminUsersTable
        initialUsers={users}
        roleOptions={roleOptions}
        actorRole={actorRole}
      />
    );
  } else if (!publicLimited && tab === "attendance") {
    content = <AdminAttendancePanel />;
  } else if (!publicLimited && tab === "reserve" && showReserve) {
    content = <AdminReservePanel />;
  } else if (tab === "journal") {
    content = <AdminJournalPanel />;
  } else if (!publicLimited && tab === "tournaments") {
    content = (
      <AdminJournalPanel
        fixedCategory="tournament"
        title="Журнал турниров"
        emptyHint="Пока нет записей. Сюда попадают создание/роспуск команд, приглашения, роли, лого и заявки на кубок."
        searchPlaceholder="Ник, тег команды, заявка…"
      />
    );
  } else if (!publicLimited && tab === "factions") {
    content = <AdminFactionLogPanel />;
  } else if (!publicLimited && tab === "market") {
    content = <AdminMarketLogPanel />;
  } else if (!publicLimited && tab === "cases") {
    content = <AdminCasesLogPanel />;
  } else if (!publicLimited && tab === "updates") {
    content = <AdminUpdatesPanel />;
  } else if (!publicLimited && tab === "mail" && showMail) {
    content = <AdminMailPanel />;
  } else if (tab === "visits" && showSiteVisits) {
    content = <AdminVisitsPanel />;
  } else if (tab === "modlog" && showServers) {
    content = <AdminModLogPanel />;
  } else if (tab === "vips" && showServers) {
    content = <AdminPublicVipsPanel />;
  } else if (tab === "cameras" && showServers) {
    content = <AdminPublicCamerasPanel />;
  } else if (tab === "serverbans" && showServers) {
    content = <AdminServerBansPanel />;
  } else if (!publicLimited && tab === "transfers" && showKeechHunt) {
    content = <AdminTransfersPanel />;
  } else if (!publicLimited && tab === "hunt" && showKeechHunt) {
    content = <AdminKeechHuntPanel />;
  } else if (tab === "load") {
    content = <AdminLoadPanel />;
  }

  const pageClass =
    tab === "users"
      ? "admin-page admin-users-wide-page"
      : tab === "attendance"
        ? "admin-page admin-attendance-page"
        : tab === "hunt"
          ? "admin-page admin-keech-hunt-page"
          : SERVER_TABS.includes(tab)
            ? "admin-page admin-panelka-wide-page"
            : "admin-page";

  return (
    <main className={pageClass}>
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
          <button
            type="button"
            className={`admin-tab ${tab === "journal" ? "active" : ""}`}
            onClick={() => setTab("journal")}
          >
            Журнал действий
          </button>
          {!publicLimited && showKeechHunt ? (
            <button
              type="button"
              className={`admin-tab ${tab === "transfers" ? "active" : ""}`}
              onClick={() => setTab("transfers")}
            >
              Трансферы
            </button>
          ) : null}

          <AdminTabMenu
            label="Панель Управления Серверами"
            tone="servers"
            active={activeGroup === "servers"}
            items={serversItems}
            currentTab={tab}
            onSelectTab={setTab}
          />
          <AdminTabMenu
            label="Логи BlackBerry"
            tone="logs"
            active={activeGroup === "logs"}
            items={logsItems}
            currentTab={tab}
            onSelectTab={setTab}
          />
          <AdminTabMenu
            label="Упр. BlackBerry"
            tone="manage"
            active={activeGroup === "manage"}
            items={manageItems}
            currentTab={tab}
            onSelectTab={setTab}
          />
        </div>
        {activeGroup && activeGroupItems.length ? (
          <SubTabs items={activeGroupItems} currentTab={tab} onSelectTab={setTab} />
        ) : null}
        <p style={{ marginTop: 12 }}>
          <Link className="kv-link" href="/profile">
            ← В профиль
          </Link>
        </p>
      </section>

      {content}
    </main>
  );
}
