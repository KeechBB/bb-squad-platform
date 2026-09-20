"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClanRole } from "@/lib/clan";
import {
  assignableClanRoles,
  canAssignClanMemberRoles,
  canInviteClanMembers,
  canKickClanMember,
  canManageClanMembers,
  canDeleteClanSquad,
  CLAN_ROLE_LABEL,
} from "@/lib/clan";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { withAvatarCacheBust } from "@/lib/avatarUrl";
import {
  canAssignTitleToMember,
  canAssignClanSquadMembers,
  canManageClanTitles,
  canReviewClanJoinRequests,
} from "@/lib/titles";
import {
  classifyRosterMember,
  ROSTER_BUCKET_COLOR,
  ROSTER_BUCKET_LABEL,
  tallyRosterBuckets,
} from "@/lib/tiers";
import { ClanRosterChart } from "@/components/ClanRosterChart";

type Member = {
  id: string;
  role: ClanRole;
  joinedAt: string;
  title: { id: string; name: string } | null;
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

type ClanTitle = {
  id: string;
  name: string;
  sortOrder?: number;
};

type JoinRequest = {
  id: string;
  createdAt: string;
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
  titles: ClanTitle[];
  myUserId: string | null;
  myRole: ClanRole | null;
  myTitleName: string | null;
  canManage: boolean;
  canManageTitles: boolean;
  canReviewJoins: boolean;
  canDisband: boolean;
  canApply: boolean;
  inOtherClan: boolean;
  isLoggedIn: boolean;
  profileComplete: boolean;
  myPendingRequestId: string | null;
  joinRequests: JoinRequest[];
  assignableRoles: ClanRole[];
  tierEntries: Array<[string, 1 | 2 | 3]>;
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
  titles: initialTitles,
  myUserId,
  myRole: initialMyRole,
  myTitleName: initialMyTitleName,
  canManage: initialCanManage,
  canManageTitles: initialCanManageTitles,
  canReviewJoins: initialCanReviewJoins,
  canDisband: initialCanDisband,
  canApply: initialCanApply,
  inOtherClan,
  isLoggedIn,
  profileComplete,
  myPendingRequestId: initialPendingRequestId,
  joinRequests: initialJoinRequests,
  assignableRoles: initialAssignable,
  tierEntries,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState(initialMembers);
  const [titles, setTitles] = useState(initialTitles);
  const [myRole, setMyRole] = useState(initialMyRole);
  const [myTitleName, setMyTitleName] = useState(initialMyTitleName);
  const [newTitle, setNewTitle] = useState("");
  const [squads, setSquads] = useState<Squad[]>([]);
  const [newSquad, setNewSquad] = useState("");
  const [inviteNick, setInviteNick] = useState("");
  const [joinRequests, setJoinRequests] = useState(initialJoinRequests);
  const [myPendingRequestId, setMyPendingRequestId] = useState(
    initialPendingRequestId
  );
  const [memberSort, setMemberSort] = useState<
    "player" | "squad" | "role" | "title"
  >("role");
  const [memberOrder, setMemberOrder] = useState<"asc" | "desc">("asc");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);
  const [hoverMap, setHoverMap] = useState<string | null>(null);
  const [stats, setStats] = useState<ClanStatsData | null>(null);
  const [statsError, setStatsError] = useState("");
  const [liveOk, setLiveOk] = useState(false);

  const canManage = myRole ? canManageClanMembers(myRole) : initialCanManage;
  const canInvite =
    myRole != null
      ? canInviteClanMembers(myRole, myTitleName)
      : initialCanManage;
  const canTitles =
    myRole != null
      ? canManageClanTitles(myRole, myTitleName)
      : initialCanManageTitles;
  const canAssignSquads =
    myRole != null
      ? canAssignClanSquadMembers(myRole, myTitleName)
      : canManage;
  const canReviewJoins =
    myRole != null
      ? canReviewClanJoinRequests(myRole, myTitleName)
      : initialCanReviewJoins;
  const canDisband = myRole ? myRole === "LEADER" : initialCanDisband;
  const canApply = !myRole && initialCanApply;
  const assignableRoles = myRole
    ? assignableClanRoles(myRole, myTitleName)
    : initialAssignable;
  const canAssignRoles =
    myRole != null
      ? canAssignClanMemberRoles(myRole, myTitleName)
      : assignableRoles.length > 0;
  const showKickCol = canInvite;

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
        title?: { id: string; name: string } | null;
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
          title: m.title ? { id: m.title.id, name: m.title.name } : null,
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
        const mine = list.find((m) => m.user.id === myUserId || m.userId === myUserId);
        if (mine) {
          setMyRole(mine.role);
          setMyTitleName(mine.title?.name || null);
        }
      }
    } catch {
      /* ignore */
    }
  }, [clan.id, myUserId]);

  const refreshTitles = useCallback(async () => {
    try {
      const res = await fetch(`/api/clans/${clan.id}/titles`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setTitles(data.titles || []);
    } catch {
      /* ignore */
    }
  }, [clan.id]);

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

  const refreshJoinRequests = useCallback(async () => {
    try {
      const res = await fetch(`/api/clans/${clan.id}/join-requests`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setJoinRequests(data.requests || []);
      setMyPendingRequestId(data.myRequest?.id ?? null);
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
      void refreshTitles();
      void refreshJoinRequests();
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

    const poll = window.setInterval(sync, 5000);
    const onFocus = () => sync();
    window.addEventListener("focus", onFocus);

    return () => {
      es?.close();
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [clan.id, refreshMembers, refreshSquads, refreshTitles, refreshJoinRequests, refreshStats, tab]);

  useEffect(() => {
    void refreshTitles();
  }, [refreshTitles]);

  async function createTitle() {
    setError("");
    setOk("");
    setLoading(true);
    try {
      const res = await fetch(`/api/clans/${clan.id}/titles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTitle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось создать должность");
        return;
      }
      setNewTitle("");
      setOk("Должность создана");
      void refreshTitles();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function deleteTitle(titleId: string, name: string) {
    if (!window.confirm(`Удалить должность «${name}»?`)) return;
    setError("");
    const res = await fetch(
      `/api/clans/${clan.id}/titles?titleId=${encodeURIComponent(titleId)}`,
      { method: "DELETE" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Не удалось удалить");
      return;
    }
    void refreshTitles();
    void refreshMembers();
  }

  async function setMemberTitle(memberId: string, titleId: string) {
    setError("");
    const nextId = titleId || null;
    setMembers((list) =>
      list.map((m) => {
        if (m.id !== memberId) return m;
        const title = nextId
          ? titles.find((t) => t.id === nextId) || null
          : null;
        return {
          ...m,
          title: title ? { id: title.id, name: title.name } : null,
        };
      })
    );
    const res = await fetch(`/api/clans/${clan.id}/titles`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, titleId: nextId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Не удалось сменить должность");
      void refreshMembers();
      return;
    }
    if (myUserId) {
      const mine = members.find((m) => m.id === memberId && m.user.id === myUserId);
      if (mine || members.some((m) => m.id === memberId && m.user.id === myUserId)) {
        void refreshMembers();
      }
    }
  }

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

  async function disbandClan() {
    if (
      !window.confirm(
        `Удалить клан [${clan.tag}] ${clan.name}? Это действие необратимо.`
      )
    ) {
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/clans/${clan.id}/disband`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось удалить клан");
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

  async function applyToClan() {
    setError("");
    setOk("");
    setLoading(true);
    try {
      const res = await fetch(`/api/clans/${clan.id}/join-requests`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось подать заявку");
        return;
      }
      setMyPendingRequestId(data.request?.id ?? "pending");
      setOk("Заявка отправлена");
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function cancelJoinRequest() {
    if (!myPendingRequestId) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/clans/${clan.id}/join-requests`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: myPendingRequestId,
          action: "cancel",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось отменить заявку");
        return;
      }
      setMyPendingRequestId(null);
      setOk("Заявка отменена");
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function reviewJoinRequest(
    requestId: string,
    action: "accept" | "decline"
  ) {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/clans/${clan.id}/join-requests`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось обработать заявку");
        void refreshJoinRequests();
        return;
      }
      setJoinRequests((list) => list.filter((r) => r.id !== requestId));
      if (action === "accept") {
        setOk("Заявка принята");
        void refreshMembers();
        void refreshSquads();
      }
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

  const sorted = useMemo(() => {
    const dir = memberOrder === "asc" ? 1 : -1;
    return [...members].sort((a, b) => {
      if (memberSort === "role") {
        return (ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)) * dir;
      }
      if (memberSort === "squad") {
        const as = squadUserIds.get(a.user.id) || "";
        const bs = squadUserIds.get(b.user.id) || "";
        return (
          as.localeCompare(bs, "ru", { sensitivity: "base" }) * dir ||
          (ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
        );
      }
      if (memberSort === "title") {
        const at = a.title?.name || "";
        const bt = b.title?.name || "";
        return (
          at.localeCompare(bt, "ru", { sensitivity: "base" }) * dir ||
          (ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
        );
      }
      const an = a.user.nick || a.user.steamName || "";
      const bn = b.user.nick || b.user.steamName || "";
      return an.localeCompare(bn, "ru", { sensitivity: "base" }) * dir;
    });
  }, [members, memberSort, memberOrder, squadUserIds]);

  function toggleMemberSort(key: typeof memberSort) {
    if (memberSort === key) {
      setMemberOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setMemberSort(key);
      setMemberOrder("asc");
    }
  }

  function memberSortMark(key: typeof memberSort) {
    if (memberSort !== key) return "";
    return memberOrder === "asc" ? " ↑" : " ↓";
  }

  const tierMap = useMemo(() => new Map(tierEntries), [tierEntries]);

  const rosterBuckets = useMemo(
    () =>
      tallyRosterBuckets(
        members.map((m) => ({
          nick: m.user.nick,
          role: m.role,
          reserveUntil: m.user.reserveUntil,
          squadName: squadUserIds.get(m.user.id) || null,
        })),
        tierMap
      ),
    [members, squadUserIds, tierMap]
  );

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
              {myTitleName ? ` · должность: ${myTitleName}` : ""}
              {liveOk ? (
                <span className="live-dot" title="Обновления в реальном времени">
                  {" "}
                  · live
                </span>
              ) : null}
            </p>
          ) : (
            <div className="clan-guest-actions">
              {!isLoggedIn ? (
                <p className="muted">Войди, чтобы подать заявку в клан.</p>
              ) : !profileComplete ? (
                <p className="muted">
                  Заверши профиль, чтобы подать заявку.{" "}
                  <Link href="/register">Перейти →</Link>
                </p>
              ) : inOtherClan ? (
                <p className="muted">
                  Ты уже в другом клане. Сначала выйди из него, чтобы подать
                  заявку сюда.
                </p>
              ) : myPendingRequestId ? (
                <div className="clan-invite-row">
                  <p className="muted" style={{ margin: 0 }}>
                    Заявка на вступление отправлена.
                  </p>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={loading}
                    onClick={() => void cancelJoinRequest()}
                  >
                    Отменить
                  </button>
                </div>
              ) : canApply ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={loading}
                  onClick={() => void applyToClan()}
                >
                  Подать заявку
                </button>
              ) : null}
            </div>
          )}
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
          {canReviewJoins ? (
            <div className="clan-join-requests">
              <h3 className="stats-h3" style={{ marginTop: 0 }}>
                Заявки на вступление
                {joinRequests.length > 0 ? ` (${joinRequests.length})` : ""}
              </h3>
              {joinRequests.length === 0 ? (
                <p className="muted" style={{ marginTop: 0 }}>
                  Пока нет заявок.
                </p>
              ) : (
                <ul className="invite-list">
                  {joinRequests.map((r) => (
                    <li key={r.id} className="invite-row">
                      <div>
                        <Link href={`/players/${encodeURIComponent(r.user.nick || r.user.id)}`}>
                          {r.user.nick || r.user.steamName || "Игрок"}
                        </Link>
                        <span className="muted" style={{ marginLeft: 8 }}>
                          {formatRuDate(new Date(r.createdAt))}
                        </span>
                      </div>
                      <div className="clan-invite-row" style={{ margin: 0, gap: 8 }}>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={loading}
                          onClick={() => void reviewJoinRequest(r.id, "accept")}
                        >
                          Принять
                        </button>
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={loading}
                          onClick={() => void reviewJoinRequest(r.id, "decline")}
                        >
                          Отклонить
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {canInvite ? (
            <div className="clan-invite-row">
              <label className="field" style={{ flex: 1, margin: 0 }}>
                <span>Пригласить по нику или Steam ID</span>
                <input
                  value={inviteNick}
                  onChange={(e) => setInviteNick(e.target.value)}
                  placeholder="Nick или 7656119…"
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

          {canTitles ? (
            <div className="clan-titles-panel">
              <p className="muted" style={{ margin: "0 0 8px" }}>
                Должности клана (не влияют на права сайта). Создавать и удалять —
                глава, заместитель и HR.
              </p>
              <div className="clan-invite-row">
                <label className="field" style={{ flex: 1, margin: 0 }}>
                  <span>Новая должность</span>
                  <input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Например Officer"
                    maxLength={32}
                  />
                </label>
                <button
                  type="button"
                  className="btn primary"
                  disabled={loading || !newTitle.trim()}
                  onClick={() => void createTitle()}
                >
                  Создать
                </button>
              </div>
              {titles.length > 0 ? (
                <ul className="clan-title-list">
                  {titles.map((t) => (
                    <li key={t.id}>
                      <span>{t.name}</span>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => void deleteTitle(t.id, t.name)}
                      >
                        Удалить
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="clan-members-layout">
            <div className="clan-members-main">
              <div className="admin-table-wrap" style={{ marginTop: 12 }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>
                        <button
                          type="button"
                          className="sort-btn"
                          onClick={() => toggleMemberSort("player")}
                        >
                          Игрок{memberSortMark("player")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="sort-btn"
                          onClick={() => toggleMemberSort("squad")}
                        >
                          Состав{memberSortMark("squad")}
                        </button>
                      </th>
                      <th>Ранг</th>
                      <th>
                        <button
                          type="button"
                          className="sort-btn"
                          onClick={() => toggleMemberSort("role")}
                        >
                          Роль{memberSortMark("role")}
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="sort-btn"
                          onClick={() => toggleMemberSort("title")}
                        >
                          Должность{memberSortMark("title")}
                        </button>
                      </th>
                      {showKickCol ? <th></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((m, i) => {
                      const avatarSrc = withAvatarCacheBust(
                        m.user.avatarUrl,
                        m.user.updatedAt || m.user.avatarUrl
                      );
                      const rankBucket = classifyRosterMember({
                        nick: m.user.nick,
                        role: m.role,
                        reserveUntil: m.user.reserveUntil,
                        squadName: squadUserIds.get(m.user.id) || null,
                        tierMap,
                      });
                      return (
                        <tr key={m.id}>
                          <td>{i + 1}</td>
                          <td>
                            <div className="clan-member-cell">
                              {avatarSrc ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={avatarSrc}
                                  alt=""
                                  width={28}
                                  height={28}
                                />
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
                            <span
                              className="roster-rank-badge"
                              style={{
                                color: ROSTER_BUCKET_COLOR[rankBucket],
                                borderColor: `${ROSTER_BUCKET_COLOR[rankBucket]}55`,
                                background: `${ROSTER_BUCKET_COLOR[rankBucket]}18`,
                              }}
                            >
                              {ROSTER_BUCKET_LABEL[rankBucket]}
                            </span>
                          </td>
                          <td>
                            {canAssignRoles &&
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
                          <td>
                            {canTitles &&
                            myRole &&
                            canAssignTitleToMember(myRole, m.role) ? (
                              <select
                                className="role-select"
                                value={m.title?.id || ""}
                                onChange={(e) =>
                                  void setMemberTitle(m.id, e.target.value)
                                }
                              >
                                <option value="">—</option>
                                {titles.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              m.title?.name || "—"
                            )}
                          </td>
                          {showKickCol ? (
                            <td>
                              {myRole &&
                              canKickClanMember(myRole, m.role, myTitleName) ? (
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
            </div>
            <ClanRosterChart buckets={rosterBuckets} />
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
                    {canManage && myRole && canDeleteClanSquad(myRole) && !locked ? (
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
                          {canAssignSquads ? (
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
                  {canAssignSquads ? (
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
                  <span className="muted">Всего матчей</span>
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
                    <svg viewBox="0 0 300 300" className="radar-svg" aria-label="Карты">
                      {[1, 2, 3, 4].map((ring) => (
                        <circle
                          key={ring}
                          cx="150"
                          cy="150"
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
                              return [150 + Math.cos(angle) * r, 150 + Math.sin(angle) * r];
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
                        const cos = Math.cos(angle);
                        const sin = Math.sin(angle);
                        const r = 24 + (m.games / maxGames) * 64;
                        const x = 150 + cos * r;
                        const y = 150 + sin * r;
                        const lx = 150 + cos * 112;
                        const ly = 150 + sin * 112;
                        const anchor =
                          cos > 0.35 ? "start" : cos < -0.35 ? "end" : "middle";
                        const dy = sin > 0.55 ? 4 : sin < -0.55 ? -2 : 0;
                        const label =
                          m.map.length > 12 ? `${m.map.slice(0, 11)}…` : m.map;
                        return (
                          <g key={m.map}>
                            <line
                              x1="150"
                              y1="150"
                              x2={150 + cos * 88}
                              y2={150 + sin * 88}
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
                              y={ly + dy}
                              textAnchor={anchor}
                              dominantBaseline="middle"
                              fill="#d4c8f0"
                              fontSize="10"
                              fontWeight="600"
                            >
                              {label}
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
        {canDisband ? (
          <button
            type="button"
            className="btn ghost leave-clan-btn"
            disabled={loading}
            onClick={() => void disbandClan()}
          >
            Удалить клан
          </button>
        ) : null}
        <Link className="kv-link" href="/clans">
          ← Все кланы
        </Link>
      </p>
    </div>
  );
}
