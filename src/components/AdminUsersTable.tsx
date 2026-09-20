"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { AppRole } from "@/lib/roles";
import { roleLabel } from "@/lib/roles";
import { isSiteOnline } from "@/lib/presence";
import { SitePresenceBadge } from "@/components/SitePresenceBadge";

export type AdminUserRow = {
  id: string;
  steamId: string;
  steamName: string | null;
  name: string | null;
  nick: string | null;
  age: number | null;
  role: AppRole;
  profileComplete: boolean;
  regNo: number | null;
  createdAt: string;
  lastSeenAt?: string | null;
  canEditRole: boolean;
  canDelete: boolean;
};

type SortKey =
  | "regNo"
  | "createdAt"
  | "nick"
  | "name"
  | "age"
  | "steamId"
  | "role"
  | "online";

type Props = {
  initialUsers: AdminUserRow[];
  roleOptions: AppRole[];
  actorRole: AppRole;
};

function fmtDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function canEditTarget(actorRole: AppRole, targetRole: AppRole, isSelf: boolean) {
  if (isSelf) return false;
  if (targetRole === "SUPER_ADMIN") return false;
  if (actorRole === "SUPER_ADMIN" || actorRole === "DEPUTY") return true;
  if (actorRole === "HR") return targetRole !== "DEPUTY";
  if (actorRole === "ADMIN") return targetRole === "USER";
  return false;
}

export function AdminUsersTable({ initialUsers, roleOptions, actorRole }: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  /** Подтягиваем lastSeenAt раз в 30 сек, чтобы статусы не устаревали */
  useEffect(() => {
    let cancelled = false;
    async function refreshPresence() {
      try {
        const res = await fetch("/api/admin/users?sort=createdAt&order=desc", {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const list = (data.users || []) as Array<{
          id: string;
          lastSeenAt?: string | Date | null;
        }>;
        if (!list.length || cancelled) return;
        const map = new Map(
          list.map((u) => [
            u.id,
            u.lastSeenAt
              ? typeof u.lastSeenAt === "string"
                ? u.lastSeenAt
                : new Date(u.lastSeenAt).toISOString()
              : null,
          ])
        );
        setUsers((prev) =>
          prev.map((u) =>
            map.has(u.id) ? { ...u, lastSeenAt: map.get(u.id) ?? null } : u
          )
        );
      } catch {
        /* ignore */
      }
    }
    const id = window.setInterval(() => void refreshPresence(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const onlineCount = useMemo(
    () => users.filter((u) => isSiteOnline(u.lastSeenAt)).length,
    [users]
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = users;
    if (needle) {
      list = list.filter((u) => {
        const blob = [u.nick, u.name, u.steamId, u.steamName, roleLabel(u.role)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return blob.includes(needle);
      });
    }
    const dir = order === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort === "online") {
        const ao = isSiteOnline(a.lastSeenAt) ? 1 : 0;
        const bo = isSiteOnline(b.lastSeenAt) ? 1 : 0;
        return (ao - bo) * dir;
      }
      const av = a[sort as keyof AdminUserRow];
      const bv = b[sort as keyof AdminUserRow];
      if (sort === "createdAt") {
        return (
          (new Date(String(av)).getTime() - new Date(String(bv)).getTime()) * dir
        );
      }
      if (sort === "regNo" || sort === "age") {
        const an = (av as number | null) ?? -1;
        const bn = (bv as number | null) ?? -1;
        return (an - bn) * dir;
      }
      return (
        String(av ?? "").localeCompare(String(bv ?? ""), "ru", {
          sensitivity: "base",
        }) * dir
      );
    });
  }, [users, q, sort, order]);

  function toggleSort(key: SortKey) {
    if (sort === key) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setOrder(key === "createdAt" || key === "online" ? "desc" : "asc");
    }
  }

  function sortMark(key: SortKey) {
    if (sort !== key) return "";
    return order === "asc" ? " ↑" : " ↓";
  }

  async function setRole(userId: string, role: AppRole) {
    const target = users.find((u) => u.id === userId);
    if (!target || target.role === role) return;

    setError("");
    setOk("");
    setBusyId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, roleOnly: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось сменить роль");
        return;
      }
      const saved = (data.user?.role as AppRole) || role;
      setUsers((list) =>
        list.map((u) =>
          u.id === userId
            ? {
                ...u,
                role: saved,
                canEditRole: canEditTarget(actorRole, saved, false),
              }
            : u
        )
      );
      setOk(
        `${target.nick || target.steamId}: роль «${roleLabel(saved)}» сохранена`
      );
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteUser(userId: string) {
    const target = users.find((u) => u.id === userId);
    if (!target || !target.canDelete) return;

    const label = target.nick || target.steamId;
    const hint = target.profileComplete
      ? `Удалить пользователя ${label}? Анкета и данные будут стёрты.`
      : `Удалить незавершённую регистрацию ${label}?`;
    if (!window.confirm(hint)) return;

    setError("");
    setOk("");
    setBusyId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось удалить");
        return;
      }
      setUsers((list) => list.filter((u) => u.id !== userId));
      setOk(`Удалён: ${label}`);
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setBusyId(null);
    }
  }

  const showDeleteCol = users.some((u) => u.canDelete);

  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <label className="field admin-search">
          <span>Поиск</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ник, имя, Steam ID…"
          />
        </label>
        <p className="muted admin-count">
          Найдено: {rows.length} / {users.length}
          {" · "}
          Онлайн на сайте: {onlineCount}
        </p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {ok ? <p className="ok-msg">{ok}</p> : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className="sort-btn"
                  onClick={() => toggleSort("regNo")}
                >
                  №{sortMark("regNo")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-btn"
                  onClick={() => toggleSort("nick")}
                >
                  Ник{sortMark("nick")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-btn"
                  onClick={() => toggleSort("online")}
                >
                  Сайт{sortMark("online")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-btn"
                  onClick={() => toggleSort("name")}
                >
                  Имя{sortMark("name")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-btn"
                  onClick={() => toggleSort("age")}
                >
                  Возраст{sortMark("age")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-btn"
                  onClick={() => toggleSort("steamId")}
                >
                  Steam ID{sortMark("steamId")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-btn"
                  onClick={() => toggleSort("createdAt")}
                >
                  Регистрация{sortMark("createdAt")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="sort-btn"
                  onClick={() => toggleSort("role")}
                >
                  Роль{sortMark("role")}
                </button>
              </th>
              {showDeleteCol ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const editable = u.canEditRole && roleOptions.length > 0;
              const options = editable
                ? Array.from(new Set<AppRole>([u.role, ...roleOptions])).filter(
                    (r) => r === u.role || roleOptions.includes(r)
                  )
                : [];
              return (
                <tr key={u.id}>
                  <td>{u.regNo ?? "—"}</td>
                  <td>
                    <Link
                      className="admin-user-link"
                      href={`/admin/users/${u.id}`}
                    >
                      {u.nick || "—"}
                    </Link>
                    {!u.profileComplete ? (
                      <span className="admin-badge">не завершил</span>
                    ) : null}
                  </td>
                  <td>
                    <SitePresenceBadge
                      lastSeenAt={u.lastSeenAt}
                      compact
                      showOffline
                    />
                  </td>
                  <td>{u.name || "—"}</td>
                  <td>{u.age ?? "—"}</td>
                  <td className="mono">{u.steamId}</td>
                  <td>{fmtDate(u.createdAt)}</td>
                  <td>
                    {editable ? (
                      <select
                        className="role-select"
                        value={u.role}
                        disabled={busyId === u.id}
                        onChange={(e) =>
                          void setRole(u.id, e.target.value as AppRole)
                        }
                      >
                        {options.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="role-static">{roleLabel(u.role)}</span>
                    )}
                  </td>
                  {showDeleteCol ? (
                    <td>
                      {u.canDelete ? (
                        <button
                          type="button"
                          className="btn ghost leave-clan-btn"
                          disabled={busyId === u.id}
                          onClick={() => void deleteUser(u.id)}
                        >
                          Удалить
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={showDeleteCol ? 9 : 8} className="muted">
                  Никого не найдено
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
