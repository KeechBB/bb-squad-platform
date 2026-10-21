"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  TEAM_SUB_TABS,
  TEAMS_SECTION_BLURB,
  TOURNAMENT_TEAM_ROLE_LABEL,
  TOURNAMENT_TEAM_ROSTER_MAX,
  TOURNAMENT_TEAMS_DRAFT,
  type TeamSubTabId,
  type TournamentTeamDraft,
  type TournamentTeamRole,
} from "@/lib/tournaments";

function Placeholder({ children }: { children: ReactNode }) {
  return <p className="tn-placeholder">{children}</p>;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function TeamsOverview({
  teams,
  viewerNick,
  onCreated,
}: {
  teams: TournamentTeamDraft[];
  viewerNick: string;
  onCreated: (team: TournamentTeamDraft) => void;
}) {
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onLogoPick(file: File | null) {
    if (!file) {
      setLogoPreview(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Логотип должен быть картинкой");
      return;
    }
    if (file.size > 2_500_000) {
      setError("Логотип до 2.5 МБ");
      return;
    }
    setError(null);
    const url = URL.createObjectURL(file);
    setLogoPreview(url);
  }

  function validate(): string | null {
    const n = name.trim();
    const t = tag.trim().toUpperCase();
    if (n.length < 2) return "Название — минимум 2 символа";
    if (n.length > 32) return "Название — максимум 32 символа";
    if (!/^[A-Za-zА-Яа-яЁё0-9 _.\-]{2,32}$/.test(n)) {
      return "В названии недопустимые символы";
    }
    if (!/^[A-Za-zА-Яа-яЁё0-9]{2,6}$/.test(t)) {
      return "Тег: 2–6 букв/цифр";
    }
    if (teams.some((x) => x.tag.toUpperCase() === t)) {
      return "Такой тег уже занят";
    }
    return null;
  }

  function requestCreate(e: FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      setConfirmOpen(false);
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  function confirmCreate() {
    const err = validate();
    if (err) {
      setError(err);
      setConfirmOpen(false);
      return;
    }
    const now = new Date().toISOString();
    const team: TournamentTeamDraft = {
      id: `local-${Date.now()}`,
      name: name.trim(),
      tag: tag.trim().toUpperCase(),
      logoSrc: logoPreview,
      createdAt: now,
      membersCount: 1,
      rosterMax: TOURNAMENT_TEAM_ROSTER_MAX,
      members: [
        {
          id: "self",
          nick: viewerNick || "Keech",
          joinedAt: now,
          role: "captain",
          clanName: "BlackBerry",
        },
      ],
      pendingInvites: [],
      eventInvites: [],
    };
    onCreated(team);
    setConfirmOpen(false);
    setName("");
    setTag("");
    setLogoPreview(null);
  }

  return (
    <div className="tn-teams">
      <div className="tn-teams-left">
        <section className="tn-panel tn-teams-blurb" aria-label="Пояснения">
          <h2 className="tn-panel-title">О разделе и командах</h2>
          <div className="tn-teams-blurb-body">{TEAMS_SECTION_BLURB}</div>
        </section>

        <section
          className="tn-panel tn-teams-create"
          aria-label="Создание команды"
        >
          <h2 className="tn-panel-title">Окно создания команды</h2>
          <form className="tn-teams-form" onSubmit={requestCreate}>
            <label className="tn-field">
              <span>Название</span>
              <input
                type="text"
                value={name}
                maxLength={32}
                placeholder="Например: Berry Core"
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="tn-field">
              <span>Тег</span>
              <input
                type="text"
                value={tag}
                maxLength={6}
                placeholder="BB"
                onChange={(e) => setTag(e.target.value.toUpperCase())}
                autoComplete="off"
              />
            </label>
            <label className="tn-field">
              <span>Логотип</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => onLogoPick(e.target.files?.[0] || null)}
              />
            </label>
            {logoPreview ? (
              <div className="tn-teams-logo-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoPreview} alt="" width={64} height={64} />
              </div>
            ) : null}
            {error ? <p className="tn-teams-error">{error}</p> : null}
            {!confirmOpen ? (
              <button type="submit" className="tn-teams-create-btn">
                Создать
              </button>
            ) : (
              <div className="tn-teams-confirm">
                <p>
                  Создать команду <strong>{name.trim()}</strong> [{tag.trim().toUpperCase()}]?
                  Пока черновик только у тебя в сессии — на сервер ещё не пишем.
                </p>
                <div className="tn-teams-confirm-actions">
                  <button
                    type="button"
                    className="tn-teams-create-btn"
                    onClick={confirmCreate}
                  >
                    Подтвердить
                  </button>
                  <button
                    type="button"
                    className="tn-teams-cancel-btn"
                    onClick={() => setConfirmOpen(false)}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </form>
        </section>
      </div>

      <section className="tn-panel tn-teams-table-wrap" aria-label="Таблица команд">
        <h2 className="tn-panel-title">Таблица команд</h2>
        {teams.length === 0 ? (
          <Placeholder>
            Команд пока нет. Создай первую — она появится в таблице и откроет
            вкладку «Моя команда».
          </Placeholder>
        ) : (
          <div className="tn-teams-table-scroll">
            <table className="tn-teams-table">
              <thead>
                <tr>
                  <th>Лого</th>
                  <th>Название</th>
                  <th>Тег</th>
                  <th>Дата создания</th>
                  <th>Состав</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((tm) => (
                  <tr key={tm.id}>
                    <td>
                      {tm.logoSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="tn-teams-table-logo"
                          src={tm.logoSrc}
                          alt=""
                          width={36}
                          height={36}
                        />
                      ) : (
                        <span className="tn-teams-table-logo is-empty" aria-hidden />
                      )}
                    </td>
                    <td>{tm.name}</td>
                    <td className="tn-teams-tag">[{tm.tag}]</td>
                    <td>{formatDate(tm.createdAt)}</td>
                    <td>
                      {tm.membersCount}/{tm.rosterMax}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const ROLE_ORDER: TournamentTeamRole[] = [
  "captain",
  "deputy",
  "starter",
  "sub",
  "reserve",
];

function MyTeamPanel({ team }: { team: TournamentTeamDraft | null }) {
  const [inviteNick, setInviteNick] = useState("");

  if (!team) {
    return (
      <section className="tn-soon" aria-label="Моя команда">
        <h2>Моя команда</h2>
        <Placeholder>
          Сначала создай команду на вкладке «Общая». После создания эта вкладка
          откроется с управлением составом и приглашениями.
        </Placeholder>
      </section>
    );
  }

  return (
    <div className="tn-my-team" aria-label="Моя команда">
      <div className="tn-my-team-left">
        <section className="tn-panel tn-my-info" aria-label="Информация о команде">
          <h2 className="tn-panel-title">Информация о команде</h2>
          <div className="tn-my-info-row">
            {team.logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.logoSrc} alt="" width={88} height={88} />
            ) : (
              <span className="tn-teams-table-logo is-empty is-lg" aria-hidden />
            )}
            <div>
              <h3 className="tn-my-info-name">{team.name}</h3>
              <p className="tn-teams-tag">[{team.tag}]</p>
              <p className="tn-my-info-meta">
                Состав {team.membersCount}/{team.rosterMax} · с{" "}
                {formatDate(team.createdAt)}
              </p>
            </div>
          </div>
        </section>

        <section
          className="tn-panel tn-my-control"
          aria-label="Панель управления командой"
        >
          <h2 className="tn-panel-title">Панель управления командой</h2>

          <div className="tn-my-control-block">
            <h3>Выдача ролей</h3>
            <ul className="tn-my-roles">
              {ROLE_ORDER.map((role) => (
                <li key={role}>
                  <strong>{TOURNAMENT_TEAM_ROLE_LABEL[role]}</strong>
                  {role === "captain" ? (
                    <span> — по умолчанию создатель, можно передать</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <Placeholder>
              Выбор роли у игрока в таблице — следующим шагом (нужен бэк).
            </Placeholder>
          </div>

          <div className="tn-my-control-block">
            <h3>Приглашения в команду</h3>
            <p className="tn-my-note">
              Подать заявку в команду нельзя — только получить приглашение от
              капитана / зама.
            </p>
            <div className="tn-my-invite-row">
              <input
                type="text"
                value={inviteNick}
                placeholder="Ник игрока"
                maxLength={32}
                onChange={(e) => setInviteNick(e.target.value)}
                aria-label="Ник для приглашения"
              />
              <button
                type="button"
                className="tn-teams-create-btn"
                disabled={!inviteNick.trim()}
                title="Пока UI-черновик, на сервер не уходит"
              >
                Пригласить
              </button>
            </div>
            {team.pendingInvites.length === 0 ? (
              <Placeholder>Исходящих приглашений пока нет.</Placeholder>
            ) : (
              <ul className="tn-my-invite-list">
                {team.pendingInvites.map((inv) => (
                  <li key={`${inv.nick}-${inv.sentAt}`}>
                    {inv.nick} · {formatDate(inv.sentAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section
          className="tn-panel tn-my-events"
          aria-label="Приглашения на ивенты"
        >
          <h2 className="tn-panel-title">Ивенты от площадки</h2>
          {team.eventInvites.length === 0 ? (
            <Placeholder>
              Здесь появятся приглашения на участие в турнирах и других ивентах
              от площадки.
            </Placeholder>
          ) : (
            <ul className="tn-my-event-list">
              {team.eventInvites.map((ev) => (
                <li key={ev.title}>
                  <strong>{ev.title}</strong>
                  <span>{ev.note}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section
        className="tn-panel tn-my-players"
        aria-label="Таблица игроков команды"
      >
        <h2 className="tn-panel-title">Таблица игроков команды</h2>
        <div className="tn-teams-table-scroll">
          <table className="tn-teams-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Ник</th>
                <th>Дата вступления</th>
                <th>Основная роль</th>
                <th>Клан на сайте</th>
              </tr>
            </thead>
            <tbody>
              {team.members.map((m, i) => (
                <tr key={m.id}>
                  <td>{i + 1}</td>
                  <td>{m.nick}</td>
                  <td>{formatDate(m.joinedAt)}</td>
                  <td>{TOURNAMENT_TEAM_ROLE_LABEL[m.role]}</td>
                  <td>{m.clanName || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function TournamentTeamsTab({ viewerNick }: { viewerNick: string }) {
  const [sub, setSub] = useState<TeamSubTabId>("overview");
  const [teams, setTeams] = useState<TournamentTeamDraft[]>(
    () => [...TOURNAMENT_TEAMS_DRAFT]
  );
  const [myTeamId, setMyTeamId] = useState<string | null>(null);

  const myTeam = useMemo(
    () => teams.find((t) => t.id === myTeamId) || null,
    [teams, myTeamId]
  );

  function onCreated(team: TournamentTeamDraft) {
    setTeams((prev) => [team, ...prev]);
    setMyTeamId(team.id);
    setSub("my-team");
  }

  return (
    <div className="tn-teams-root">
      <nav className="tn-subtabs" aria-label="Разделы команд">
        {TEAM_SUB_TABS.map((t) => {
          const on = sub === t.id;
          const locked = t.id === "my-team" && !myTeam;
          return (
            <button
              key={t.id}
              type="button"
              className={`tn-subtab${on ? " is-on" : ""}${locked ? " is-locked" : ""}`}
              aria-pressed={on}
              title={
                locked
                  ? "Сначала создай команду на вкладке «Общая»"
                  : undefined
              }
              onClick={() => setSub(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {sub === "overview" ? (
        <TeamsOverview
          teams={teams}
          viewerNick={viewerNick}
          onCreated={onCreated}
        />
      ) : (
        <MyTeamPanel team={myTeam} />
      )}
    </div>
  );
}
