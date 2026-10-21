"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  TEAM_SUB_TABS,
  TEAMS_SECTION_BLURB,
  TOURNAMENT_TEAM_ROLE_LABEL,
  TOURNAMENT_TEAM_ROSTER_MAX,
  mapDbTeamRole,
  type TeamSubTabId,
  type TournamentTeamRole,
} from "@/lib/tournaments";
import {
  PlayerSuggestInput,
  type PlayerSuggestHit,
} from "@/components/PlayerSuggestInput";

type ApiMember = {
  id: string;
  nick: string;
  steamId: string;
  joinedAt: string;
  role: string;
  clanTag: string | null;
  clanName: string | null;
};

type ApiTeam = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  createdAt: string;
  membersCount: number;
  rosterMax: number;
  members: ApiMember[];
  pendingInvites: { id: string; nick: string; sentAt: string }[];
};

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
  canCreate,
  onCreated,
}: {
  teams: ApiTeam[];
  canCreate: boolean;
  onCreated: (team: ApiTeam) => void;
}) {
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    return null;
  }

  function requestCreate(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) {
      setError("Ты уже в команде");
      return;
    }
    const err = validate();
    if (err) {
      setError(err);
      setConfirmOpen(false);
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  async function confirmCreate() {
    const err = validate();
    if (err) {
      setError(err);
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tournaments/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), tag: tag.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        team?: ApiTeam;
      };
      if (!res.ok || !data.team) {
        setError(data.error || "Не удалось создать");
        return;
      }
      onCreated(data.team);
      setConfirmOpen(false);
      setName("");
      setTag("");
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
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
          {!canCreate ? (
            <Placeholder>
              Ты уже состоишь в команде — создание недоступно.
            </Placeholder>
          ) : (
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
              <p className="tn-my-note">
                Логотип добавим позже (загрузка на сервер).
              </p>
              {error ? <p className="tn-teams-error">{error}</p> : null}
              {!confirmOpen ? (
                <button type="submit" className="tn-teams-create-btn" disabled={busy}>
                  Создать
                </button>
              ) : (
                <div className="tn-teams-confirm">
                  <p>
                    Создать команду <strong>{name.trim()}</strong> [
                    {tag.trim().toUpperCase()}]?
                  </p>
                  <div className="tn-teams-confirm-actions">
                    <button
                      type="button"
                      className="tn-teams-create-btn"
                      disabled={busy}
                      onClick={() => void confirmCreate()}
                    >
                      Подтвердить
                    </button>
                    <button
                      type="button"
                      className="tn-teams-cancel-btn"
                      disabled={busy}
                      onClick={() => setConfirmOpen(false)}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </form>
          )}
        </section>
      </div>

      <section className="tn-panel tn-teams-table-wrap" aria-label="Таблица команд">
        <h2 className="tn-panel-title">Таблица команд</h2>
        {teams.length === 0 ? (
          <Placeholder>
            Команд пока нет. Создай первую — она появится в таблице.
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
                      {tm.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="tn-teams-table-logo"
                          src={tm.logoUrl}
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
                      {tm.membersCount}/{tm.rosterMax || TOURNAMENT_TEAM_ROSTER_MAX}
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

function MyTeamPanel({
  team,
  myRole,
  onInvited,
}: {
  team: ApiTeam | null;
  myRole: string | null;
  onInvited: () => void;
}) {
  const [inviteQ, setInviteQ] = useState("");
  const [picked, setPicked] = useState<PlayerSuggestHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const canInvite = myRole === "CAPTAIN" || myRole === "DEPUTY";

  async function sendInvite() {
    if (!team || !canInvite) return;
    const q = (picked?.nick || inviteQ).trim();
    if (q.length < 2) {
      setError("Укажи ник или Steam ID");
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/tournaments/teams/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: team.id,
          q: picked?.steamId || q,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        invite?: { nick: string };
      };
      if (!res.ok) {
        setError(data.error || "Не удалось отправить");
        return;
      }
      setOkMsg(`Приглашение отправлено: ${data.invite?.nick || q}`);
      setInviteQ("");
      setPicked(null);
      onInvited();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  if (!team) {
    return (
      <section className="tn-soon" aria-label="Моя команда">
        <h2>Моя команда</h2>
        <Placeholder>
          Сначала создай команду на вкладке «Общая» или прими приглашение в
          колокольчике сверху.
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
            {team.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.logoUrl} alt="" width={88} height={88} />
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
              Смена роли у игрока в таблице — следующим шагом.
            </Placeholder>
          </div>

          <div className="tn-my-control-block">
            <h3>Приглашения в команду</h3>
            <p className="tn-my-note">
              Подать заявку нельзя — только приглашение от капитана / зама.
              Поиск по нику и Steam ID с подсказками.
            </p>
            {canInvite ? (
              <div className="tn-my-invite-row">
                <PlayerSuggestInput
                  value={inviteQ}
                  onChange={(v) => {
                    setInviteQ(v);
                    setPicked(null);
                  }}
                  onPick={(hit) => {
                    setPicked(hit);
                    setInviteQ(hit.nick);
                  }}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="tn-teams-create-btn"
                  disabled={busy || inviteQ.trim().length < 2}
                  onClick={() => void sendInvite()}
                >
                  Пригласить
                </button>
              </div>
            ) : (
              <Placeholder>Приглашать могут капитан и зам.</Placeholder>
            )}
            {error ? <p className="tn-teams-error">{error}</p> : null}
            {okMsg ? <p className="tn-teams-ok">{okMsg}</p> : null}
            {team.pendingInvites.length === 0 ? (
              <Placeholder>Исходящих приглашений пока нет.</Placeholder>
            ) : (
              <ul className="tn-my-invite-list">
                {team.pendingInvites.map((inv) => (
                  <li key={inv.id}>
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
          <Placeholder>
            Здесь появятся приглашения на турниры и другие ивенты от площадки.
          </Placeholder>
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
                  <td>
                    {
                      TOURNAMENT_TEAM_ROLE_LABEL[
                        mapDbTeamRole(m.role)
                      ]
                    }
                  </td>
                  <td>
                    {m.clanTag ? `[${m.clanTag}]` : m.clanName || "—"}
                  </td>
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
  void viewerNick;
  const [sub, setSub] = useState<TeamSubTabId>("overview");
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/tournaments/teams", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        teams?: ApiTeam[];
        myTeamId?: string | null;
        myRole?: string | null;
      };
      if (!res.ok) {
        setBootError(data.error || "Не удалось загрузить команды");
        return;
      }
      setTeams(Array.isArray(data.teams) ? data.teams : []);
      setMyTeamId(data.myTeamId || null);
      setMyRole(data.myRole || null);
      setBootError(null);
    } catch {
      setBootError("Сеть недоступна");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const myTeam = useMemo(
    () => teams.find((t) => t.id === myTeamId) || null,
    [teams, myTeamId]
  );

  function onCreated(team: ApiTeam) {
    setTeams((prev) => [team, ...prev.filter((t) => t.id !== team.id)]);
    setMyTeamId(team.id);
    setMyRole("CAPTAIN");
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
                  ? "Сначала создай команду или прими приглашение"
                  : undefined
              }
              onClick={() => setSub(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {bootError ? <p className="tn-teams-error">{bootError}</p> : null}

      {sub === "overview" ? (
        <TeamsOverview
          teams={teams}
          canCreate={!myTeamId}
          onCreated={onCreated}
        />
      ) : (
        <MyTeamPanel team={myTeam} myRole={myRole} onInvited={() => void reload()} />
      )}
    </div>
  );
}
