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
  teamIdentityError,
  TOURNAMENT_TEAM_ROLE_LABEL,
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
  userId: string;
  nick: string;
  steamId: string;
  joinedAt: string;
  role: string;
  matchesPlayed?: number;
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
  likes: number;
  dislikes: number;
  myVote: 1 | -1 | null;
  members: ApiMember[];
  pendingInvites: { id: string; nick: string; sentAt: string }[];
};

const DB_ROLES = [
  "CAPTAIN",
  "DEPUTY",
  "STARTER",
  "SUB",
  "RESERVE",
] as const;

type DbRole = (typeof DB_ROLES)[number];

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

const ROLE_ORDER: TournamentTeamRole[] = [
  "captain",
  "deputy",
  "starter",
  "sub",
  "reserve",
];

function roleOptionsForActor(
  actorRole: string | null,
  target: ApiMember,
  actorUserId: string | null
): DbRole[] | null {
  if (actorRole === "CAPTAIN") {
    // Себя как капитана не демотим через select — только передача другому
    if (
      actorUserId &&
      target.userId === actorUserId &&
      target.role === "CAPTAIN"
    ) {
      return null;
    }
    return [...DB_ROLES];
  }
  if (actorRole === "DEPUTY") {
    if (target.role === "CAPTAIN") return null;
    if (target.role === "DEPUTY") return null;
    if (actorUserId && target.userId === actorUserId) return null;
    return ["STARTER", "SUB", "RESERVE"];
  }
  return null;
}

function canKickTarget(
  actorRole: string | null,
  target: ApiMember,
  actorUserId: string | null
): boolean {
  if (!actorUserId || target.userId === actorUserId) return false;
  if (actorRole === "CAPTAIN") return true;
  if (actorRole === "DEPUTY") {
    return target.role !== "CAPTAIN" && target.role !== "DEPUTY";
  }
  return false;
}

function TeamPublicInspect({
  team,
  onBack,
}: {
  team: ApiTeam;
  onBack: () => void;
}) {
  const roster = useMemo(
    () =>
      [...team.members].sort((a, b) => {
        const ra = ROLE_ORDER.indexOf(mapDbTeamRole(a.role));
        const rb = ROLE_ORDER.indexOf(mapDbTeamRole(b.role));
        if (ra !== rb) return ra - rb;
        return a.joinedAt.localeCompare(b.joinedAt);
      }),
    [team.members]
  );

  return (
    <section
      className="tn-panel tn-team-inspect"
      aria-label={`Команда ${team.name}`}
    >
      <div className="tn-team-inspect-head">
        <button
          type="button"
          className="tn-teams-cancel-btn tn-team-inspect-back"
          onClick={onBack}
        >
          ← К таблице
        </button>
        <h2 className="tn-panel-title">Просмотр команды</h2>
      </div>

      <div className="tn-team-inspect-info">
        {team.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="tn-teams-table-logo is-lg"
            src={team.logoUrl}
            alt=""
            width={72}
            height={72}
          />
        ) : (
          <span className="tn-teams-table-logo is-empty is-lg" aria-hidden />
        )}
        <div className="tn-team-inspect-meta">
          <p className="tn-team-inspect-name">{team.name}</p>
          <p className="tn-team-inspect-tag">[{team.tag}]</p>
          <p className="tn-team-inspect-sub">
            Создана {formatDate(team.createdAt)} · состав{" "}
            {team.membersCount}
          </p>
        </div>
      </div>

      <div className="tn-teams-table-scroll">
        <table className="tn-teams-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Ник</th>
              <th>Роль</th>
              <th>В команде с</th>
              <th>Матчи</th>
              <th>Клан</th>
            </tr>
          </thead>
          <tbody>
            {roster.length === 0 ? (
              <tr>
                <td colSpan={6}>В команде пока никого нет.</td>
              </tr>
            ) : (
              roster.map((m, i) => (
                <tr key={m.id}>
                  <td>{i + 1}</td>
                  <td>{m.nick}</td>
                  <td>
                    {TOURNAMENT_TEAM_ROLE_LABEL[mapDbTeamRole(m.role)]}
                  </td>
                  <td>{formatDate(m.joinedAt)}</td>
                  <td>{m.matchesPlayed ?? 0}</td>
                  <td>
                    {m.clanTag ? `[${m.clanTag}]` : m.clanName || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TeamVoteCell({
  team,
  authed,
  onVoted,
}: {
  team: ApiTeam;
  authed: boolean;
  onVoted: (
    teamId: string,
    next: { likes: number; dislikes: number; myVote: 1 | -1 | null }
  ) => void;
}) {
  const [busy, setBusy] = useState<1 | -1 | null>(null);
  const [pop, setPop] = useState<1 | -1 | null>(null);

  async function vote(value: 1 | -1) {
    if (!authed || busy) return;
    setBusy(value);
    setPop(value);
    window.setTimeout(() => setPop(null), 420);
    try {
      const res = await fetch(`/api/tournaments/teams/${team.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        likes?: number;
        dislikes?: number;
        myVote?: 1 | -1 | null;
      };
      if (!res.ok) {
        if (res.status === 401) {
          window.alert("Войди через Steam, чтобы голосовать");
        }
        return;
      }
      onVoted(team.id, {
        likes: Number(data.likes) || 0,
        dislikes: Number(data.dislikes) || 0,
        myVote:
          data.myVote === 1 || data.myVote === -1 ? data.myVote : null,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="tn-team-votes"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`tn-team-vote-btn is-up${team.myVote === 1 ? " is-on" : ""}${pop === 1 ? " is-pop" : ""}`}
        disabled={!authed || busy !== null}
        title={authed ? "Нравится" : "Войди, чтобы голосовать"}
        aria-pressed={team.myVote === 1}
        aria-label={`Лайк, ${team.likes}`}
        onClick={() => void vote(1)}
      >
        <svg className="tn-team-vote-ico" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M14 3v8h6.2c.7 0 1.3.5 1.4 1.2l-.8 5.5c-.1.9-.9 1.6-1.8 1.6H9V9.8L12.4 2.6c.3-.7 1.2-.9 1.8-.5.4.3.6.7.6 1.2zM2 10h5v10H2z"
          />
        </svg>
        <span className="tn-team-vote-n">{team.likes}</span>
      </button>
      <button
        type="button"
        className={`tn-team-vote-btn is-down${team.myVote === -1 ? " is-on" : ""}${pop === -1 ? " is-pop" : ""}`}
        disabled={!authed || busy !== null}
        title={authed ? "Не нравится" : "Войди, чтобы голосовать"}
        aria-pressed={team.myVote === -1}
        aria-label={`Дизлайк, ${team.dislikes}`}
        onClick={() => void vote(-1)}
      >
        <svg className="tn-team-vote-ico" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M10 21v-8H3.8c-.7 0-1.3-.5-1.4-1.2l.8-5.5C3.3 5.4 4.1 4.7 5 4.7H15V14.2L11.6 21.4c-.3.7-1.2.9-1.8.5-.4-.3-.6-.7-.6-1.2zM22 14h-5V4h5z"
          />
        </svg>
        <span className="tn-team-vote-n">{team.dislikes}</span>
      </button>
    </div>
  );
}

function TeamsOverview({
  teams,
  canCreate,
  authed,
  onCreated,
  onTeamVotes,
}: {
  teams: ApiTeam[];
  canCreate: boolean;
  /** Зарегистрированный пользователь (профиль заполнен) */
  authed: boolean;
  onCreated: (team: ApiTeam) => void;
  onTeamVotes: (
    teamId: string,
    next: { likes: number; dislikes: number; myVote: 1 | -1 | null }
  ) => void;
}) {
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspectId, setInspectId] = useState<string | null>(null);

  const inspectTeam = useMemo(
    () => (inspectId ? teams.find((t) => t.id === inspectId) || null : null),
    [inspectId, teams]
  );

  function onLogoPick(file: File | null) {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  }

  function validate(): string | null {
    const n = name.trim();
    const t = tag.trim().toUpperCase();
    const identity = teamIdentityError(n, t);
    if (identity) return identity;
    if (logoFile) {
      if (logoFile.size > 20 * 1024 * 1024) return "Лого до 20 МБ";
      const ok =
        logoFile.type === "image/png" ||
        logoFile.type === "image/webp" ||
        logoFile.type === "image/jpeg" ||
        logoFile.type === "image/jpg" ||
        /\.(png|webp|jpe?g)$/i.test(logoFile.name);
      if (!ok) return "Лого: png, webp или jpeg";
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
      const form = new FormData();
      form.set("name", name.trim());
      form.set("tag", tag.trim());
      if (logoFile) form.set("logo", logoFile);
      const res = await fetch("/api/tournaments/teams", {
        method: "POST",
        body: form,
      });
      const raw = await res.text();
      let data: { error?: string; team?: ApiTeam } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        /* nginx 413 и т.п. отдают HTML */
      }
      if (!res.ok || !data.team) {
        if (res.status === 413) {
          setError("Файл слишком большой для сервера (лимит 20 МБ)");
        } else {
          setError(data.error || `Не удалось создать (HTTP ${res.status})`);
        }
        return;
      }
      onCreated(data.team);
      setConfirmOpen(false);
      setName("");
      setTag("");
      onLogoPick(null);
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
          {!authed ? (
            <Placeholder>
              Создать команду могут только зарегистрированные игроки —
              войди через Steam и заверши регистрацию на сайте.
            </Placeholder>
          ) : !canCreate ? (
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
                <span>Тег (1–6)</span>
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
                <span>Логотип (png/webp/jpeg, до 20 МБ)</span>
                <input
                  type="file"
                  accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg"
                  onChange={(e) =>
                    onLogoPick(e.target.files?.[0] || null)
                  }
                />
              </label>
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="tn-logo-preview"
                  src={logoPreview}
                  alt=""
                  width={64}
                  height={64}
                />
              ) : null}
              {error ? <p className="tn-teams-error">{error}</p> : null}
              {!confirmOpen ? (
                <button
                  type="submit"
                  className="tn-teams-create-btn"
                  disabled={busy}
                >
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

      {inspectTeam ? (
        <TeamPublicInspect
          team={inspectTeam}
          onBack={() => setInspectId(null)}
        />
      ) : (
        <section
          className="tn-panel tn-teams-table-wrap"
          aria-label="Таблица команд"
        >
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
                    <th>Состав</th>
                    <th>Дата создания</th>
                    <th>Оценка</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((tm) => (
                    <tr
                      key={tm.id}
                      className="tn-teams-row-click"
                      tabIndex={0}
                      role="link"
                      aria-label={`Открыть команду ${tm.name}`}
                      onClick={() => setInspectId(tm.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setInspectId(tm.id);
                        }
                      }}
                    >
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
                          <span
                            className="tn-teams-table-logo is-empty"
                            aria-hidden
                          />
                        )}
                      </td>
                      <td>{tm.name}</td>
                      <td className="tn-teams-tag">[{tm.tag}]</td>
                      <td>{tm.membersCount}</td>
                      <td>{formatDate(tm.createdAt)}</td>
                      <td>
                        <TeamVoteCell
                          team={tm}
                          authed={authed}
                          onVoted={onTeamVotes}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function MyTeamPanel({
  team,
  myRole,
  myUserId,
  onChanged,
  onDeleted,
}: {
  team: ApiTeam | null;
  myRole: string | null;
  myUserId: string | null;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [inviteQ, setInviteQ] = useState("");
  const [picked, setPicked] = useState<PlayerSuggestHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);
  const [kickBusyId, setKickBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(team?.name ?? "");
  const [editTag, setEditTag] = useState(team?.tag ?? "");

  useEffect(() => {
    setEditName(team?.name ?? "");
    setEditTag(team?.tag ?? "");
    setEditing(false);
  }, [team?.id, team?.name, team?.tag]);

  const canInvite = myRole === "CAPTAIN" || myRole === "DEPUTY";
  const canLogo = canInvite;
  const canDelete = myRole === "CAPTAIN";
  const canRename = canDelete;
  const canRoles = canInvite;
  const canKick = canInvite;

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
      onChanged();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function saveIdentity(e: FormEvent) {
    e.preventDefault();
    if (!team || !canRename) return;
    const err = teamIdentityError(editName, editTag);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/tournaments/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          tag: editTag.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Не удалось сохранить");
        return;
      }
      setOkMsg("Название и тег сохранены");
      setEditing(false);
      onChanged();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File | null, remove = false) {
    if (!team || !canLogo) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const form = new FormData();
      if (remove) form.set("removeLogo", "1");
      else if (file) form.set("logo", file);
      else {
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/tournaments/teams/${team.id}`, {
        method: "PATCH",
        body: form,
      });
      const raw = await res.text();
      let data: { error?: string } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        /* nginx 413 */
      }
      if (!res.ok) {
        if (res.status === 413) {
          setError("Файл слишком большой для сервера (лимит 20 МБ)");
        } else {
          setError(data.error || `Не удалось обновить лого (HTTP ${res.status})`);
        }
        return;
      }
      setOkMsg(remove ? "Лого удалено" : "Лого обновлено");
      onChanged();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function setRole(target: ApiMember, role: DbRole) {
    if (!team || !canRoles || target.role === role) return;
    if (
      role === "CAPTAIN" &&
      !confirm(
        `Передать капитанство игроку ${target.nick}? Ты станешь основным составом.`
      )
    ) {
      return;
    }
    setRoleBusyId(target.userId);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/tournaments/teams/${team.id}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: target.userId, role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Не удалось сменить роль");
        return;
      }
      setOkMsg(`Роль ${target.nick}: ${TOURNAMENT_TEAM_ROLE_LABEL[mapDbTeamRole(role)]}`);
      onChanged();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setRoleBusyId(null);
    }
  }

  async function deleteTeam() {
    if (!team || !canDelete) return;
    if (
      !confirm(
        `Удалить команду [${team.tag}] ${team.name}? Состав и заявки на турнир будут сняты.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/teams/${team.id}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Не удалось удалить");
        return;
      }
      onDeleted();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  async function kickMember(target: ApiMember) {
    if (!team || !canKick || !canKickTarget(myRole, target, myUserId)) return;
    if (
      !confirm(
        `Кикнуть ${target.nick} из команды [${team.tag}]? Игрок также будет снят с заявки на турнир.`
      )
    ) {
      return;
    }
    setKickBusyId(target.userId);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/tournaments/teams/${team.id}/kick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: target.userId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Не удалось кикнуть");
        return;
      }
      setOkMsg(`${target.nick} исключён из команды`);
      onChanged();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setKickBusyId(null);
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
                Состав {team.membersCount} · с {formatDate(team.createdAt)}
              </p>
            </div>
          </div>
          {canRename && editing ? (
            <form className="tn-my-rename" onSubmit={(e) => void saveIdentity(e)}>
              <label className="tn-field">
                <span>Название</span>
                <input
                  type="text"
                  value={editName}
                  maxLength={32}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label className="tn-field tn-field-tag">
                <span>Тег (1–6)</span>
                <input
                  type="text"
                  value={editTag}
                  maxLength={6}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(e) => setEditTag(e.target.value.toUpperCase())}
                />
              </label>
              <div className="tn-my-logo-actions">
                <button
                  type="submit"
                  className="tn-teams-create-btn"
                  disabled={busy}
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  className="tn-teams-cancel-btn"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setEditName(team.name);
                    setEditTag(team.tag);
                    setError(null);
                  }}
                >
                  Отмена
                </button>
              </div>
              {error ? <p className="tn-teams-error">{error}</p> : null}
            </form>
          ) : null}
          {canRename && !editing ? (
            <div className="tn-my-logo-actions">
              <button
                type="button"
                className="tn-teams-create-btn"
                disabled={busy}
                onClick={() => {
                  setEditName(team.name);
                  setEditTag(team.tag);
                  setError(null);
                  setOkMsg(null);
                  setEditing(true);
                }}
              >
                Изменить название и тег
              </button>
            </div>
          ) : null}
          {canLogo ? (
            <div className="tn-my-logo-actions">
              <label className="tn-teams-create-btn tn-logo-file-btn">
                Сменить лого
                <input
                  type="file"
                  accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg"
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    e.target.value = "";
                    if (f) {
                      if (f.size > 20 * 1024 * 1024) {
                        setError("Лого до 20 МБ");
                        return;
                      }
                      void uploadLogo(f);
                    }
                  }}
                />
              </label>
              {team.logoUrl ? (
                <button
                  type="button"
                  className="tn-teams-cancel-btn"
                  disabled={busy}
                  onClick={() => void uploadLogo(null, true)}
                >
                  Убрать лого
                </button>
              ) : null}
            </div>
          ) : null}
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
                    <span> — создатель; можно передать</span>
                  ) : null}
                  {role === "deputy" ? (
                    <span>
                      {" "}
                      — приглашения, кик, роли (кроме кап./зама), турнир
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="tn-my-note">
              Меняй роль в таблице справа. Зам не трогает капитана и не выдаёт
              роли капитана/зама.
            </p>
          </div>

          <div className="tn-my-control-block">
            <h3>Приглашения в команду</h3>
            <p className="tn-my-note">
              Только приглашение от капитана / зама. Приглашать можно лишь
              игроков, зарегистрированных на сайте.
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

          {canDelete ? (
            <div className="tn-my-control-block">
              <h3>Удаление команды</h3>
              <p className="tn-my-note">Только капитан. Действие необратимо.</p>
              <button
                type="button"
                className="tn-register-btn is-danger"
                disabled={busy}
                onClick={() => void deleteTeam()}
              >
                Удалить команду
              </button>
            </div>
          ) : null}
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
                {canKick ? <th>Кик</th> : null}
              </tr>
            </thead>
            <tbody>
              {team.members.map((m, i) => {
                const opts = roleOptionsForActor(myRole, m, myUserId);
                const showKick = canKickTarget(myRole, m, myUserId);
                return (
                  <tr key={m.id}>
                    <td>{i + 1}</td>
                    <td>{m.nick}</td>
                    <td>{formatDate(m.joinedAt)}</td>
                    <td>
                      {opts ? (
                        <select
                          className="tn-role-select"
                          value={m.role}
                          disabled={roleBusyId === m.userId || busy}
                          onChange={(e) =>
                            void setRole(m, e.target.value as DbRole)
                          }
                        >
                          {opts.map((r) => (
                            <option key={r} value={r}>
                              {
                                TOURNAMENT_TEAM_ROLE_LABEL[
                                  mapDbTeamRole(r)
                                ]
                              }
                            </option>
                          ))}
                          {!opts.includes(m.role as DbRole) ? (
                            <option value={m.role}>
                              {
                                TOURNAMENT_TEAM_ROLE_LABEL[
                                  mapDbTeamRole(m.role)
                                ]
                              }
                            </option>
                          ) : null}
                        </select>
                      ) : (
                        TOURNAMENT_TEAM_ROLE_LABEL[mapDbTeamRole(m.role)]
                      )}
                    </td>
                    <td>
                      {m.clanTag ? `[${m.clanTag}]` : m.clanName || "—"}
                    </td>
                    {canKick ? (
                      <td>
                        {showKick ? (
                          <button
                            type="button"
                            className="tn-kick-btn"
                            disabled={
                              busy ||
                              kickBusyId === m.userId ||
                              roleBusyId === m.userId
                            }
                            onClick={() => void kickMember(m)}
                          >
                            Кик
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
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
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/tournaments/teams", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        teams?: ApiTeam[];
        myTeamId?: string | null;
        myRole?: string | null;
        myUserId?: string | null;
        canCreate?: boolean;
        authed?: boolean;
      };
      if (!res.ok) {
        setBootError(data.error || "Не удалось загрузить команды");
        return;
      }
      setTeams(
        Array.isArray(data.teams)
          ? data.teams.map((t) => ({
              ...t,
              likes: Number(t.likes) || 0,
              dislikes: Number(t.dislikes) || 0,
              myVote:
                t.myVote === 1 || t.myVote === -1 ? t.myVote : null,
            }))
          : []
      );
      setMyTeamId(data.myTeamId || null);
      setMyRole(data.myRole || null);
      setMyUserId(data.myUserId || null);
      setAuthed(Boolean(data.authed));
      setCanCreate(Boolean(data.canCreate));
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
    setTeams((prev) => [
      {
        ...team,
        likes: Number(team.likes) || 0,
        dislikes: Number(team.dislikes) || 0,
        myVote:
          team.myVote === 1 || team.myVote === -1 ? team.myVote : null,
      },
      ...prev.filter((t) => t.id !== team.id),
    ]);
    setMyTeamId(team.id);
    setMyRole("CAPTAIN");
    setCanCreate(false);
    setAuthed(true);
    setSub("my-team");
  }

  function onTeamVotes(
    teamId: string,
    next: { likes: number; dislikes: number; myVote: 1 | -1 | null }
  ) {
    setTeams((prev) =>
      prev.map((t) => (t.id === teamId ? { ...t, ...next } : t))
    );
  }

  function onDeleted() {
    setTeams((prev) => prev.filter((t) => t.id !== myTeamId));
    setMyTeamId(null);
    setMyRole(null);
    setCanCreate(authed);
    setSub("overview");
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
          canCreate={canCreate}
          authed={authed}
          onCreated={onCreated}
          onTeamVotes={onTeamVotes}
        />
      ) : (
        <MyTeamPanel
          team={myTeam}
          myRole={myRole}
          myUserId={myUserId}
          onChanged={() => void reload()}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}
