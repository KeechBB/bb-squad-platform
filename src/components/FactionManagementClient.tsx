"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { FactionView } from "@/lib/factions";
import { factionMgmtBgUrl } from "@/lib/factionMgmtBg";
import { CanvasScaleStage } from "@/components/CanvasScaleStage";
import {
  FactionNightBetsBoard,
  FactionRaceBoard,
} from "@/components/FactionBoards";
import { FactionTransfers } from "@/components/FactionTransfers";
import { FactionHrPanel } from "@/components/FactionHrPanel";
import { FactionPlayerValuesPanel } from "@/components/FactionPlayerValuesPanel";
import { FactionAuctionPanel } from "@/components/FactionAuctionPanel";
import { FactionSeasonsPanel } from "@/components/FactionSeasonsPanel";
import { FactionFaqPanel } from "@/components/FactionFaqPanel";
import { BdAmount } from "@/components/BdMark";

function formatJoinedAt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

type MgmtPanel =
  | "race"
  | "nightbets"
  | "transfers"
  | "economy"
  | "hr"
  | "values"
  | "auction"
  | "seasons"
  | "faq"
  | null;

type NavBtn = {
  id: number;
  label: string;
  panel: MgmtPanel;
  ready: boolean;
};

const NAV_BUTTONS: NavBtn[] = [
  { id: 1, label: "Гонка фракций", panel: "race", ready: true },
  { id: 2, label: "Ставки фракций", panel: "nightbets", ready: true },
  { id: 3, label: "Трансферы", panel: "transfers", ready: true },
  { id: 4, label: "Экономика фракции", panel: "economy", ready: true },
  { id: 5, label: "Контракты и зарплаты", panel: "hr", ready: true },
  { id: 6, label: "Стоимость игроков", panel: "values", ready: true },
  { id: 7, label: "Аукцион", panel: "auction", ready: true },
  { id: 8, label: "Сезоны", panel: "seasons", ready: true },
  { id: 9, label: "Кнопка 9", panel: null, ready: false },
  { id: 10, label: "FAQ", panel: "faq", ready: true },
];

export function FactionManagementClient({
  initial,
  isMember,
  mgmtUnlocked = false,
}: {
  initial: FactionView;
  isMember: boolean;
  /** Пока true только у Keech — полный UI; иначе заглушка. */
  mgmtUnlocked?: boolean;
}) {
  const [view] = useState(initial);
  const [panel, setPanel] = useState<MgmtPanel>("race");
  const [raceKey, setRaceKey] = useState(1);
  const [nightBetsKey, setNightBetsKey] = useState(0);
  const [deniedOpen, setDeniedOpen] = useState(!isMember && mgmtUnlocked);
  const backHref = `/factions/${encodeURIComponent(view.slug)}`;
  const bgUrl = useMemo(() => factionMgmtBgUrl(view.slug), [view.slug]);

  useEffect(() => {
    if (!bgUrl) return;
    const body = document.body;
    body.style.setProperty("--profile-bg-image", `url(${bgUrl})`);
    body.classList.add("has-profile-bg");
    return () => {
      body.style.removeProperty("--profile-bg-image");
      body.classList.remove("has-profile-bg");
    };
  }, [bgUrl]);

  function openPanel(next: MgmtPanel) {
    if (!next) return;
    setPanel(next);
    if (next === "race") setRaceKey((n) => n + 1);
    if (next === "nightbets") setNightBetsKey((n) => n + 1);
  }

  if (!mgmtUnlocked) {
    return (
      <main className="faction-mgmt-denied-page">
        <div className="faction-mgmt-denied-fallback faction-mgmt-stub">
          <h1>Менеджмент</h1>
          <p className="muted">В разработке. Скоро откроем для фракций.</p>
          <Link href={backHref} className="btn primary">
            Назад к фракции
          </Link>
        </div>
      </main>
    );
  }

  if (!isMember) {
    return (
      <main className="faction-mgmt-denied-page">
        {deniedOpen ? (
          <div
            className="profile-match-modal"
            role="presentation"
            onClick={() => setDeniedOpen(false)}
          >
            <div className="profile-match-modal-backdrop" />
            <div
              className="profile-match-modal-panel faction-mgmt-denied-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="faction-mgmt-denied-title"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="profile-match-modal-head">
                <div>
                  <h3 id="faction-mgmt-denied-title">Менеджмент недоступен</h3>
                  <p className="profile-match-modal-sub muted">
                    Вы не участник фракции «{view.name}». Этот раздел только для
                    состава.
                  </p>
                </div>
                <button
                  type="button"
                  className="profile-match-modal-close"
                  onClick={() => setDeniedOpen(false)}
                >
                  ×
                </button>
              </header>
              <div className="profile-match-modal-body">
                <div className="clan-invite-row" style={{ marginTop: 4 }}>
                  <Link href={backHref} className="btn primary">
                    Назад к фракции
                  </Link>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setDeniedOpen(false)}
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="faction-mgmt-denied-fallback">
          <p className="muted">Раздел менеджмента только для участников фракции.</p>
          <Link href={backHref} className="btn primary">
            Назад к фракции
          </Link>
          <button
            type="button"
            className="btn"
            onClick={() => setDeniedOpen(true)}
          >
            Показать сообщение
          </button>
        </div>
      </main>
    );
  }

  const activeLabel =
    NAV_BUTTONS.find((b) => b.panel === panel)?.label || "Менеджмент";

  return (
    <main className="faction-mgmt-page">
      <CanvasScaleStage
        hasBg={Boolean(bgUrl)}
        contentWidth="full"
        className="is-profile is-side-inset is-faction-mgmt"
      >
        <div className="faction-mgmt-shell">
          <header className="faction-mgmt-top">
            <Link href={backHref} className="btn faction-mgmt-back">
              ← Назад к фракции
            </Link>
            <div className="faction-mgmt-top-title">
              <strong>Менеджмент</strong>
              <span className="muted">{view.name}</span>
            </div>
            <div className="faction-mgmt-top-meta muted">
              Казна: <BdAmount n={view.blueberryBalance} />
            </div>
          </header>

          <div className="faction-mgmt-grid">
            <aside className="faction-mgmt-pane faction-mgmt-pane-side" aria-label="Окно 1">
              <div className="faction-mgmt-side-brand">
                {view.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={view.logoUrl}
                    alt=""
                    width={56}
                    height={56}
                    className="faction-logo"
                  />
                ) : (
                  <div className="faction-logo faction-logo-empty">лого</div>
                )}
                <div className="faction-mgmt-side-brand-text">
                  <h1>{view.name}</h1>
                  <p className="muted">
                    Глава: <strong>{view.leaderNick || "не назначен"}</strong>
                    {" · "}
                    Зам:{" "}
                    <strong>
                      {view.deputyNicks.length
                        ? view.deputyNicks.join(", ")
                        : "не назначен"}
                    </strong>
                  </p>
                  <p className="muted">
                    Состав: <strong>{view.members.length}</strong>
                    {" · "}
                    Казна:{" "}
                    <strong>
                      <BdAmount n={view.blueberryBalance} />
                    </strong>
                  </p>
                </div>
              </div>

              <div className="faction-mgmt-roster-head">
                <h2>Состав</h2>
                <span className="muted">{view.members.length}</span>
              </div>
              <div className="faction-mgmt-roster-wrap">
                <table className="faction-mgmt-roster-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Игрок</th>
                      <th>Роль</th>
                      <th>Вступил</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.members.map((m, i) => (
                      <tr key={m.id}>
                        <td className="faction-mgmt-roster-num">{m.order || i + 1}</td>
                        <td className="faction-mgmt-roster-nick">{m.nick}</td>
                        <td className="faction-mgmt-roster-role">
                          {m.mainKit && m.mainKit !== "—" ? m.mainKit : "—"}
                        </td>
                        <td className="faction-mgmt-roster-date">
                          {formatJoinedAt(m.joinedAt)}
                        </td>
                      </tr>
                    ))}
                    {!view.members.length ? (
                      <tr>
                        <td colSpan={4} className="muted">
                          Пока никого нет.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </aside>

            <nav className="faction-mgmt-nav" aria-label="Разделы менеджмента">
              <div className="faction-mgmt-nav-grid">
                {NAV_BUTTONS.map((b) => {
                  const active = b.ready && b.panel === panel;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className={`faction-mgmt-nav-btn${active ? " is-active" : ""}${
                        !b.ready ? " is-soon" : ""
                      }`}
                      disabled={!b.ready}
                      onClick={() => openPanel(b.panel)}
                    >
                      <span className="faction-mgmt-nav-num">{b.id}</span>
                      <span className="faction-mgmt-nav-label">
                        {b.ready ? b.label : "Скоро"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </nav>

            <section
              className="faction-mgmt-pane faction-mgmt-pane-main"
              aria-label="Окно 2"
            >
              <div className="faction-mgmt-main-head">
                <h2>{activeLabel}</h2>
              </div>
              <div className="faction-mgmt-main-body">
                {panel === "race" ? (
                  <FactionRaceBoard slug={view.slug} loadKey={raceKey} />
                ) : null}
                {panel === "nightbets" ? (
                  <FactionNightBetsBoard slug={view.slug} loadKey={nightBetsKey} />
                ) : null}
                {panel === "transfers" ? (
                  <FactionTransfers
                    slug={view.slug}
                    canManage={view.canManage || view.keech}
                    scope="deals"
                  />
                ) : null}
                {panel === "economy" ? (
                  <FactionTransfers
                    slug={view.slug}
                    canManage={view.canManage || view.keech}
                    scope="economy"
                  />
                ) : null}
                {panel === "hr" ? (
                  <FactionHrPanel
                    slug={view.slug}
                    canManage={view.canManage || view.keech}
                  />
                ) : null}
                {panel === "values" ? (
                  <FactionPlayerValuesPanel slug={view.slug} />
                ) : null}
                {panel === "auction" ? (
                  <FactionAuctionPanel
                    slug={view.slug}
                    canManage={view.canManage || view.keech}
                  />
                ) : null}
                {panel === "seasons" ? <FactionSeasonsPanel /> : null}
                {panel === "faq" ? <FactionFaqPanel /> : null}
                {!panel ? (
                  <p className="muted">Выберите раздел слева.</p>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </CanvasScaleStage>
    </main>
  );
}
