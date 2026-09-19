"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClanRole } from "@/lib/clan";
import {
  assignableClanRoles,
  canKickClanMember,
  canManageClanMembers,
  CLAN_ROLE_LABEL,
} from "@/lib/clan";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { withAvatarCacheBust } from "@/lib/avatar";

type Member = {
  id: string;
  role: ClanRole;
  joinedAt: string;
  user: {
    id: string;
    nick: string | null;
    name: string | null;
    avatarUrl: string | null;
    steamName: string | null;
    reserveUntil?: string | null;
    reserveReason?: string | null;
    updatedAt?: string | null;
  };
};
type SquadMember = {
  id: string;
  user: Member["user"];
};

type Squad = {
  id: string;
  name: string;
  sortOrder: number;
  members: SquadMember[];
};

type Props = {
  clan: {
    id: string;
    name: string;
    tag: string;
    logoUrl: string | null;
  };
  members: Member[];
  myUserId: string | null;
  myRole: ClanRole | null;
  canManage: boolean;
  assignableRoles: ClanRole[];
};

type Tab = "members" | "squads" | "matches" | "stats";

type ClanStatsData = {
  total: number;
  played: number;
  upcoming: number;
  wins: number;
  draws: number;
  losses: number;
  winrate: number;
  byStack: {
    name: string;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    winrate: number;
  }[];
  maps: {
    map: string;
    full: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
  }[];
  recent: {
    day: number;
    opp: string;
    map: string;
    stack: string;
    status: string;
    meeting: string;
  }[];
};

const ROLE_ORDER: ClanRole[] = [
  "LEADER",
  "DEPUTY",
  "MAIN",
  "SUB",
  "RESERVE",
  "MEMBER",
];

const STATUS_RU: Record<string, string> = {
  win: "победа",
  lose: "поражение",
  draw: "ничья",
};

export function ClanDetailClient({
  clan,
  members: initialMembers,
  myUserId,
  myRole: initialMyRole,
  canManage: initialCanManage,
  assignableRoles: initialAssignable,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState(initialMembers);
  const [myRole, setMyRole] = useState(initialMyRole);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [newSquad, setNewSquad] = useState("");
  const [inviteNick, setInviteNick] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);
  const [hoverMap, setHoverMap] = useState<string | null>(null);
  const [stats, setStats] = useState<ClanStatsData | null>(null);
  const [statsError, setStatsError] = useState("");
  const [liveOk, setLiveOk] = useState(false);

  const canManage = myRole ? canManageClanMembers(myRole) : initialCanManage;
  const assignableRoles = myRole
    ? assignableClanRoles(myRole)
    : initialAssignable;

  const sorted = useMemo(
    () =>
      [...members].sort(
        (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
      ),
    [members]
  );

  const refreshMembers = useCallback(async () => {
    try {
      const res = await fetch(`/api/clans/${clan.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list = (data.clan?.members || []) as Array<{
        id: string;
        role: ClanRole;
        joinedAt: string;
        userId?: string;
        user: Member["user"] & {
          reserveUntil?: string | Date | null;
          updatedAt?: string | Date | null;
        };
      }>;
      setMembers(
        list.map((m) => ({
          id: m.id,
          role: m.role,
          joinedAt:
            typeof m.joinedAt === "string"
              ? m.joinedAt
              : new Date(m.joinedAt).toISOString(),
          user: {
            ...m.user,
            reserveUntil: m.user.reserveUntil
              ? typeof m.user.reserveUntil === "string"
                ? m.user.reserveUntil
                : new Date(m.user.reserveUntil).toISOString()
              : null,
            reserveReason: m.user.reserveReason ?? null,
            updatedAt: m.user.updatedAt
              ? typeof m.user.updatedAt === "string"
                ? m.user.updatedAt
                : new Date(m.user.updatedAt).toISOString()
              : null,
          },
        }))
      );
      if (myUserId) {
        const mine = list.find((m) => m.user?.id === myUserId);
        if (mine) setMyRole(mine.role);
      }
    } catch {
      /* ignore */
    }
  }, [clan.id, myUserId]);

  const refreshSquads = useCallback(async () => {
    try {
      const res = await fetch(`/api/clans/${clan.id}/squads`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setSquads(data.squads || []);
    } catch {
      /* ignore */
    }
  }, [clan.id]);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/clans/${clan.id}/stats`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatsError(data.error || "Стата недоступна");
        return;
      }
      setStatsError("");
      setStats(data.stats as ClanStatsData);
    } catch {
      setStatsError("Не удалось загрузить стату КВ");
    }
  }, [clan.id]);

  useEffect(() => {
    void refreshSquads();
  }, [refreshSquads]);

  useEffect(() => {
    if (tab === "stats") void refreshStats();
  }, [tab, refreshStats]);

  useEffect(() => {
    const sync = () => {
      void refreshMembers();
      void refreshSquads();
      if (tab === "stats") void refreshStats();
    };

    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/live/clan/${clan.id}`);
      es.addEventListener("hello", () => setLiveOk(true));
      es.addEventListener("clan", () => sync());
      es.onerror = () => setLiveOk(false);
    } catch {
      setLiveOk(false);
    }

    const poll = window.setInterval(sync, 8000);
    const onFocus = () => sync();
    window.addEventListener("focus", onFocus);

    return () => {
      es?.close();
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [clan.id, refreshMembers, refreshSquads, refreshStats, tab]);

  async function invite() {
    setError("");
    setOk("");
    setLoading(true);
    try {
      const res = await fetch(`/api/clans/${clan.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: inviteNick }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось пригласить");
        return;
      }
      setOk("Приглашение отправлено");
      setInviteNick("");
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function setRole(memberId: string, role: ClanRole) {
    setError("");
    setMembers((list) =>
      list.map((m) => (m.id === memberId ? { ...m, role } : m))
    );
    const res = await fetch(`/api/clans/${clan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Не удалось сменить роль");
      void refreshMembers();
      return;
    }
  }

  async function kick(memberId: string) {
    setError("");
    const res = await fetch(`/api/clans/${clan.id}?memberId=${memberId}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Не удалось кикнуть");
      return;
    }
    setMembers((list) => list.filter((m) => m.id !== memberId));
    void refreshSquads();
  }

  async function leaveClan() {
    if (
      !window.confirm(
        myRole === "LEADER"
          ? "Ты глава. Если в клане никого больше нет — клан удалится. Выйти?"
          : "Точно выйти из клана?"
      )
    ) {
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/clans/${clan.id}/leave`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось выйти");
        return;
      }
      router.push("/clans");
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function createSquad() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/clans/${clan.id}/squads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSquad }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось создать состав");
        return;
      }
      setNewSquad("");
      await refreshSquads();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function setSquadMember(
    squadId: string,
    userId: string,
    action: "add" | "remove"
  ) {
    setError("");
    const res = await fetch(`/api/clans/${clan.id}/squads`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ squadId, userId, action }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Не удалось обновить состав");
      return;
    }
    await refreshSquads();
  }

  async function deleteSquad(squadId: string) {
    setError("");
    const res = await fetch(
      `/api/clans/${clan.id}/squads?squadId=${encodeURIComponent(squadId)}`,
      { method: "DELETE" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Не удалось удалить");
      return;
    }
    await refreshSquads();
  }

  const maxGames = Math.max(...(stats?.maps.map((m) => m.games) || [1]), 1);
  const mapPoints = stats?.maps.slice(0, 8) || [];
  const squadUserIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of squads) {
      for (const m of s.members) map.set(m.user.id, s.name);
    }
    return map;
  }, [squads]);

  return (
    <div className="clan-detail">
      <section className="hero clan-detail-hero">
        {clan.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="clan-detail-logo" src={clan.logoUrl} alt="" width={72} height={72} />
        ) : (
          <div className="clan-detail-logo clan-row-logo-empty">{clan.tag.slice(0, 2)}</div>
        )}
        <div>
          <p className="eyebrow">клан</p>
          <h1>
            [{clan.tag}] {clan.name}
          </h1>
          {myRole ? (
            <p className="muted">
              Твоя роль: {CLAN_ROLE_LABEL[myRole]}
              {liveOk ? (
                <span className="live-dot" title="Обновления в реальном времени">
                  {" "}
                  · live
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </section>

      <div className="admin-tabs clan-tabs">
        {(
          [
            ["members", "Список игроков"],
            ["squads", "Составы"],
            ["matches", "История матчей"],
            ["stats", "Статистика"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`admin-tab${tab === id ? " active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "members" ? (
        <section className="card">
          {canManage ? (
            <div className="clan-invite-row">
              <label className="field" style={{ flex: 1, margin: 0 }}>
                <span>Пригласить по нику</span>
                <input
                  value={inviteNick}
                  onChange={(e) => setInviteNick(e.target.value)}
                  placeholder="Nick"
                />
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={loading || !inviteNick.trim()}
                onClick={() => void invite()}
              >
                Пригласить
              </button>
            </div>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          {ok ? <p className="ok">{ok}</p> : null}

          <div className="admin-table-wrap" style={{ marginTop: 12 }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Игрок</th>
                  <th>Состав</th>
                  <th>Роль</th>
                  {canManage ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {sorted.map((m, i) => {
                  const avatarSrc = withAvatarCacheBust(
                    m.user.avatarUrl,
                    m.user.updatedAt || m.user.avatarUrl
                  );
                  return (
                  <tr key={m.id}>
                    <td>{i + 1}</td>
                    <td>
                      <div className="clan-member-cell">
                        {avatarSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatarSrc} alt="" width={28} height={28} />
                        ) : (
                          <span className="clan-member-fallback">
                            {(m.user.nick || "?").slice(0, 1)}
                          </span>
                        )}
                        {m.user.nick ? (
                          <Link
                            className="player-nick-link"
                            href={`/players/${encodeURIComponent(m.user.nick)}`}
                          >
                            {m.user.nick}
                          </Link>
                        ) : (
                          <span>{m.user.steamName || "—"}</span>
                        )}
                        {isActiveReserve(
                          m.user.reserveUntil
                            ? new Date(m.user.reserveUntil)
                            : null
                        ) ? (
                          <span
                            className="reserve-badge"
                            title={
                              m.user.reserveReason
                                ? `До ${formatRuDate(new Date(m.user.reserveUntil!))}: ${m.user.reserveReason}`
                                : `До ${formatRuDate(new Date(m.user.reserveUntil!))}`
                            }
                          >
                            резерв
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>{squadUserIds.get(m.user.id) || "—"}</td>
                    <td>
                      {canManage &&
                      myRole &&
                      assignableRoles.includes(m.role) &&
                      m.role !== "LEADER" ? (
                        <select
                          className="role-select"
                          value={m.role}
                          onChange={(e) =>
                            void setRole(m.id, e.target.value as ClanRole)
                          }
                        >
                          {assignableRoles.map((r) => (
                            <option key={r} value={r}>
                              {CLAN_ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        CLAN_ROLE_LABEL[m.role]
                      )}
                    </td>
                    {canManage ? (
                      <td>
                        {myRole && canKickClanMember(myRole, m.role) ? (
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => void kick(m.id)}
                          >
                            Кик
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "squads" ? (
        <section className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            Main и Junior — базовые составы. Можно создать ещё и раскидать игроков
            клана. В рейтинге КВ появятся колонки «Клан» и «Состав».
          </p>
          {canManage ? (
            <div className="clan-invite-row" style={{ marginTop: 12 }}>
              <label className="field" style={{ flex: 1, margin: 0 }}>
                <span>Новый состав</span>
                <input
                  value={newSquad}
                  onChange={(e) => setNewSquad(e.target.value)}
                  placeholder="Academy"
                  maxLength={24}
                />
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={loading || newSquad.trim().length < 2}
                onClick={() => void createSquad()}
              >
                Создать
              </button>
            </div>
          ) : null}
          {error ? <p className="error">{error}</p> : null}

          <div className="squad-grid">
            {squads.map((s) => {
              const inSquad = new Set(s.members.map((m) => m.user.id));
              const available = members.filter((m) => !inSquad.has(m.user.id));
              const locked = ["main", "junior"].includes(s.name.toLowerCase());
              return (
                <div key={s.id} className="squad-card">
                  <div className="squad-card-head">
                    <strong>{s.name}</strong>
                    <span className="muted">{s.members.length} чел.</span>
                    {canManage && myRole === "LEADER" && !locked ? (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => void deleteSquad(s.id)}
                      >
                        Удалить
                      </button>
                    ) : null}
                  </div>
                  <ul className="squad-list">
                    {s.members.length === 0 ? (
                      <li className="muted">Пока пусто — добавь игроков ниже</li>
                    ) : (
                      s.members.map((m) => (
                        <li key={m.id} className="squad-list-row">
                          <span>{m.user.nick || m.user.steamName || "—"}</span>
                          {canManage ? (
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={() =>
                                void setSquadMember(s.id, m.user.id, "remove")
                              }
                            >
                              Убрать
                            </button>
                          ) : null}
                        </li>
                      ))
                    )}
                  </ul>
                  {canManage ? (
                    <label className="field" style={{ marginTop: 8 }}>
                      <span>Добавить в {s.name}</span>
                      <select
                        className="role-select"
                        defaultValue=""
                        onChange={(e) => {
                          const uid = e.target.value;
                          e.target.value = "";
                          if (uid) void setSquadMember(s.id, uid, "add");
                        }}
                      >
                        <option value="" disabled>
                          Выбери игрока…
                        </option>
                        {available.map((m) => (
                          <option key={m.user.id} value={m.user.id}>
                            {m.user.nick || m.user.steamName || m.user.id}
                            {squadUserIds.has(m.user.id)
                              ? ` (сейчас ${squadUserIds.get(m.user.id)})`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {tab === "matches" ? (
        <section className="card">
          <p className="muted">
            Календарь матчей с фильтром по тегу клана <strong>[{clan.tag}]</strong>.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              router.push(`/cw?clan=${encodeURIComponent(clan.tag)}`)
            }
          >
            Открыть календарь КВ →
          </button>
        </section>
      ) : null}

      {tab === "stats" ? (
        <section className="card clan-stats">
          {statsError ? <p className="error">{statsError}</p> : null}
          {!stats && !statsError ? <p className="muted">Считаем стату из КВ…</p> : null}
          {stats ? (
            <>
              <div className="clan-stat-cards clan-stat-cards-rich">
                <div>
                  <span className="muted">Всего слотов</span>
                  <strong>{stats.total}</strong>
                  <em className="stat-sub">
                    сыграно {stats.played} · впереди {stats.upcoming}
                  </em>
                </div>
                <div>
                  <span className="muted">W–D–L</span>
                  <strong>
                    {stats.wins}–{stats.draws}–{stats.losses}
                  </strong>
                  <em className="stat-sub">встречи с результатом</em>
                </div>
                <div className="stat-winrate">
                  <span className="muted">Winrate</span>
                  <strong>{stats.winrate}%</strong>
                  <em className="stat-sub">победы / сыгранные</em>
                </div>
              </div>

              {stats.byStack.length > 0 ? (
                <div className="stack-stats">
                  <h3 className="stats-h3">По составам</h3>
                  <div className="stack-stats-row">
                    {stats.byStack.map((s) => (
                      <div key={s.name} className="stack-stat-pill">
                        <strong>{s.name}</strong>
                        <span>
                          {s.played} игр · {s.wins}W {s.draws}D {s.losses}L ·{" "}
                          <b>{s.winrate}%</b>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="maps-stats-grid">
                <div>
                  <h3 className="stats-h3">Карты</h3>
                  <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
                    Сколько раз играли и чем закончилось
                  </p>
                  <ul className="map-bars">
                    {mapPoints.length === 0 ? (
                      <li className="muted">Пока нет сыгранных карт</li>
                    ) : (
                      mapPoints.map((m) => (
                        <li key={m.map}>
                          <div className="map-bar-head">
                            <span title={m.full}>{m.map}</span>
                            <span className="map-bar-nums">
                              {m.games} · {m.wins}W/{m.draws}D/{m.losses}L
                            </span>
                          </div>
                          <div className="map-bar-track">
                            <div
                              className="map-bar-fill"
                              style={{ width: `${(m.games / maxGames) * 100}%` }}
                            />
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
                <div>
                  <h3 className="stats-h3">Радар карт</h3>
                  <div className="radar-wrap">
                    <svg viewBox="0 0 220 220" className="radar-svg" aria-label="Карты">
                      {[1, 2, 3, 4].map((ring) => (
                        <circle
                          key={ring}
                          cx="110"
                          cy="110"
                          r={ring * 22}
                          fill="none"
                          stroke="rgba(167,139,250,0.18)"
                        />
                      ))}
                      {mapPoints.length >= 3
                        ? (() => {
                            const pts = mapPoints.map((m, i) => {
                              const angle =
                                (Math.PI * 2 * i) / mapPoints.length - Math.PI / 2;
                              const r = 24 + (m.games / maxGames) * 64;
                              return [110 + Math.cos(angle) * r, 110 + Math.sin(angle) * r];
                            });
                            return (
                              <polygon
                                points={pts.map((p) => p.join(",")).join(" ")}
                                fill="rgba(167,139,250,0.18)"
                                stroke="#a78bfa"
                                strokeWidth="1.5"
                              />
                            );
                          })()
                        : null}
                      {mapPoints.map((m, i) => {
                        const angle =
                          (Math.PI * 2 * i) / Math.max(mapPoints.length, 1) -
                          Math.PI / 2;
                        const r = 24 + (m.games / maxGames) * 64;
                        const x = 110 + Math.cos(angle) * r;
                        const y = 110 + Math.sin(angle) * r;
                        const lx = 110 + Math.cos(angle) * 100;
                        const ly = 110 + Math.sin(angle) * 100;
                        return (
                          <g key={m.map}>
                            <line
                              x1="110"
                              y1="110"
                              x2={110 + Math.cos(angle) * 88}
                              y2={110 + Math.sin(angle) * 88}
                              stroke="rgba(167,139,250,0.22)"
                            />
                            <circle
                              cx={x}
                              cy={y}
                              r={hoverMap === m.map ? 7 : 5}
                              fill="#c4b5fd"
                              style={{ cursor: "pointer" }}
                              onMouseEnter={() => setHoverMap(m.map)}
                              onMouseLeave={() => setHoverMap(null)}
                            />
                            <text
                              x={lx}
                              y={ly}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fill="#d4c8f0"
                              fontSize="9"
                              fontWeight="600"
                            >
                              {m.map.slice(0, 8)}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                    <p className="radar-hint">
                      {hoverMap
                        ? (() => {
                            const m = mapPoints.find((x) => x.map === hoverMap);
                            return m
                              ? `${m.map}: ${m.games} игр (${m.wins}W ${m.draws}D ${m.losses}L)`
                              : "";
                          })()
                        : "Наведи на точку — цифры по карте"}
                    </p>
                  </div>
                </div>
              </div>

              {stats.recent.length > 0 ? (
                <div style={{ marginTop: 18 }}>
                  <h3 className="stats-h3">Последние матчи</h3>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>День</th>
                          <th>Соперник</th>
                          <th>Карта</th>
                          <th>Состав</th>
                          <th>Счёт</th>
                          <th>Итог</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.recent.map((m, i) => (
                          <tr key={`${m.day}-${m.opp}-${i}`}>
                            <td>{String(m.day).padStart(2, "0")}</td>
                            <td>{m.opp}</td>
                            <td>{m.map}</td>
                            <td>{m.stack}</td>
                            <td>{m.meeting}</td>
                            <td>
                              <span className={`status-chip ${m.status}`}>
                                {STATUS_RU[m.status] || m.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      <p style={{ marginTop: 16 }} className="clan-footer-actions">
        {myRole ? (
          <button
            type="button"
            className="btn ghost leave-clan-btn"
            disabled={loading}
            onClick={() => void leaveClan()}
          >
            Выйти из клана
          </button>
        ) : null}
        <Link className="kv-link" href="/clans">
          ← Все кланы
        </Link>
      </p>
    </div>
  );
}
