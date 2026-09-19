"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClanRole } from "@/lib/clan";
import { CLAN_ROLE_LABEL, canKickClanMember } from "@/lib/clan";

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
  };
};

type Props = {
  clan: {
    id: string;
    name: string;
    tag: string;
    logoUrl: string | null;
  };
  members: Member[];
  myRole: ClanRole | null;
  canManage: boolean;
  assignableRoles: ClanRole[];
};

type Tab = "members" | "matches" | "stats";

const ROLE_ORDER: ClanRole[] = [
  "LEADER",
  "DEPUTY",
  "MAIN",
  "SUB",
  "RESERVE",
  "MEMBER",
];

/** Мок-стата для теста радиальной диаграммы */
const MAP_STATS = [
  { map: "Gorodok", games: 5 },
  { map: "Yehorivka", games: 3 },
  { map: "Narva", games: 2 },
  { map: "Chora", games: 4 },
  { map: "Kohat", games: 1 },
];

export function ClanDetailClient({
  clan,
  members: initialMembers,
  myRole,
  canManage,
  assignableRoles,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState(initialMembers);
  const [inviteNick, setInviteNick] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);
  const [hoverMap, setHoverMap] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...members].sort(
        (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
      ),
    [members]
  );

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
    const res = await fetch(`/api/clans/${clan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Не удалось сменить роль");
      return;
    }
    setMembers((list) =>
      list.map((m) => (m.id === memberId ? { ...m, role } : m))
    );
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
  }

  const maxGames = Math.max(...MAP_STATS.map((m) => m.games), 1);

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
            <p className="muted">Твоя роль: {CLAN_ROLE_LABEL[myRole]}</p>
          ) : null}
        </div>
      </section>

      <div className="admin-tabs clan-tabs">
        <button
          type="button"
          className={`admin-tab${tab === "members" ? " active" : ""}`}
          onClick={() => setTab("members")}
        >
          Список игроков
        </button>
        <button
          type="button"
          className={`admin-tab${tab === "matches" ? " active" : ""}`}
          onClick={() => setTab("matches")}
        >
          История матчей
        </button>
        <button
          type="button"
          className={`admin-tab${tab === "stats" ? " active" : ""}`}
          onClick={() => setTab("stats")}
        >
          Статистика
        </button>
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
                  <th>Роль</th>
                  {canManage ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {sorted.map((m, i) => (
                  <tr key={m.id}>
                    <td>{i + 1}</td>
                    <td>
                      <div className="clan-member-cell">
                        {m.user.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.user.avatarUrl} alt="" width={28} height={28} />
                        ) : (
                          <span className="clan-member-fallback">
                            {(m.user.nick || "?").slice(0, 1)}
                          </span>
                        )}
                        <span>{m.user.nick || m.user.steamName || "—"}</span>
                      </div>
                    </td>
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
                ))}
              </tbody>
            </table>
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
            onClick={() => router.push(`/cw?clan=${encodeURIComponent(clan.tag)}`)}
          >
            Открыть календарь КВ →
          </button>
        </section>
      ) : null}

      {tab === "stats" ? (
        <section className="card clan-stats">
          <div className="clan-stat-cards">
            <div>
              <span className="muted">Игр</span>
              <strong>15</strong>
            </div>
            <div>
              <span className="muted">Победы</span>
              <strong>7</strong>
            </div>
            <div>
              <span className="muted">Winrate</span>
              <strong>47%</strong>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            Карты (тест). Наведи на луч — увидишь название.
          </p>
          <div className="radar-wrap">
            <svg viewBox="0 0 200 200" className="radar-svg" aria-label="Карты">
              {[1, 2, 3, 4].map((ring) => (
                <circle
                  key={ring}
                  cx="100"
                  cy="100"
                  r={ring * 20}
                  fill="none"
                  stroke="rgba(167,139,250,0.2)"
                />
              ))}
              {MAP_STATS.map((m, i) => {
                const angle = (Math.PI * 2 * i) / MAP_STATS.length - Math.PI / 2;
                const r = 20 + (m.games / maxGames) * 70;
                const x = 100 + Math.cos(angle) * r;
                const y = 100 + Math.sin(angle) * r;
                const lx = 100 + Math.cos(angle) * 92;
                const ly = 100 + Math.sin(angle) * 92;
                return (
                  <g key={m.map}>
                    <line
                      x1="100"
                      y1="100"
                      x2={100 + Math.cos(angle) * 80}
                      y2={100 + Math.sin(angle) * 80}
                      stroke="rgba(167,139,250,0.25)"
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r={hoverMap === m.map ? 7 : 5}
                      fill="#a78bfa"
                      style={{ cursor: "pointer" }}
                      onMouseEnter={() => setHoverMap(m.map)}
                      onMouseLeave={() => setHoverMap(null)}
                    />
                    <text
                      x={lx}
                      y={ly}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#9b93b0"
                      fontSize="8"
                    >
                      {m.map.slice(0, 6)}
                    </text>
                  </g>
                );
              })}
            </svg>
            <p className="radar-hint">
              {hoverMap
                ? `${hoverMap}: ${MAP_STATS.find((m) => m.map === hoverMap)?.games} игр`
                : "Наведи на точку"}
            </p>
          </div>
          <p className="muted" style={{ fontSize: "0.8rem" }}>
            Цифры пока тестовые — подключим к КВ позже.
          </p>
        </section>
      ) : null}

      <p style={{ marginTop: 16 }}>
        <Link className="kv-link" href="/clans">
          ← Все кланы
        </Link>
      </p>
    </div>
  );
}
