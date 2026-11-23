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
  CLAN_ROLE_LABEL,
} from "@/lib/clan";
import { ClanCalendarPanel } from "@/components/ClanCalendarPanel";
import { ClanFactionsPanel } from "@/components/ClanFactionsPanel";
import { clanLogoUrl as ratingClanLogo } from "@/lib/clanLogo";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { withAvatarCacheBust } from "@/lib/avatarUrl";
import {
  canAssignTitleToMember,
  canManageClanTitles,
  canReviewClanJoinRequests,
} from "@/lib/titles";
import { ClanProfileEdit } from "@/components/ClanProfileEdit";
import { ClanPublicStatsPanel } from "@/components/ClanPublicStatsPanel";
import { SitePresenceBadge } from "@/components/SitePresenceBadge";
import { subscribeLive } from "@/lib/liveClient";
import { playerPathFromUser } from "@/lib/playerPath";

type Member = {
  id: string;
  role: ClanRole;
  joinedAt: string;
  title: { id: string; name: string } | null;
  /** Топ-кит по времени за 14 суток (паблик + трёна + КВ на наших серверах). */
  mainKit?: string | null;
  /** Активная VIP (QueuePriority) на паблике */
  hasVip?: boolean;
  user: {
    id: string;
    nick: string | null;
    name: string | null;
    avatarUrl: string | null;
    steamName: string | null;
    steamId?: string | null;
    reserveUntil?: string | null;
    reserveReason?: string | null;
    updatedAt?: string | null;
    lastSeenAt?: string | null;
  };
};
type SquadMember = {
  id: string;
  user: Member["user"];
  tier?: number | null;
  tu?: number | null;
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
    steamId?: string | null;
  };
};

type PendingMember = {
  nick: string;
  steamId: string | null;
  matchId: string | null;
};

type Props = {
  clan: {
    id: string;
    name: string;
    tag: string;
    logoUrl: string | null;
    isExternal?: boolean;
    /** Отображаемый глава (external / КВ-карточка) */
    leaderNick?: string | null;
  };
  members: Member[];
  pendingMembers?: PendingMember[];
  titles: ClanTitle[];
  myUserId: string | null;
  myRole: ClanRole | null;
  myTitleName: string | null;
  /** Владелец платформы с правами главы, но не в составе этого клана */
  platformOwnerAccess?: boolean;
  canManage: boolean;
  canManageTitles: boolean;
  canReviewJoins: boolean;
  canDisband: boolean;
  canEditClanProfile: boolean;
  canApply: boolean;
  inOtherClan: boolean;
  isLoggedIn: boolean;
  profileComplete: boolean;
  myPendingRequestId: string | null;
  joinRequests: JoinRequest[];
  assignableRoles: ClanRole[];
  showFactions?: boolean;
  showVipCol?: boolean;
};

type Tab = "members" | "stats" | "calendar" | "factions";

const ROLE_ORDER: ClanRole[] = [
  "LEADER",
  "DEPUTY",
  "MAIN",
  "SUB",
  "RESERVE",
  "MEMBER",
];

const TAB_IDS = new Set<Tab>(["members", "stats", "calendar", "factions"]);

function readClanTab(): Tab {
  if (typeof window === "undefined") return "members";
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t && TAB_IDS.has(t as Tab)) return t as Tab;
  return "members";
}

export function ClanDetailClient({
  clan,
  members: initialMembers,
  pendingMembers = [],
  titles: initialTitles,
  myUserId,
  myRole: initialMyRole,
  myTitleName: initialMyTitleName,
  platformOwnerAccess = false,
  canManage: initialCanManage,
  canManageTitles: initialCanManageTitles,
  canReviewJoins: initialCanReviewJoins,
  canDisband: initialCanDisband,
  canEditClanProfile = false,
  canApply: initialCanApply,
  inOtherClan,
  isLoggedIn,
  profileComplete,
  myPendingRequestId: initialPendingRequestId,
  joinRequests: initialJoinRequests,
  assignableRoles: initialAssignable,
  showFactions = false,
  showVipCol = false,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(() => readClanTab());

  function goTab(next: Tab) {
    setTab(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }

  useEffect(() => {
    const onPop = () => setTab(readClanTab());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [members, setMembers] = useState(initialMembers);
  const [titles, setTitles] = useState(initialTitles);
  const [myRole, setMyRole] = useState(initialMyRole);
  const [myTitleName, setMyTitleName] = useState(initialMyTitleName);
  const [newTitle, setNewTitle] = useState("");
  const [squads, setSquads] = useState<Squad[]>([]);
  const [inviteNick, setInviteNick] = useState("");
  const [joinRequests, setJoinRequests] = useState(initialJoinRequests);
  const [myPendingRequestId, setMyPendingRequestId] = useState(
    initialPendingRequestId
  );
  const [memberSort, setMemberSort] = useState<
    "player" | "squad" | "role" | "kit" | "title"
  >("role");
  const [memberOrder, setMemberOrder] = useState<"asc" | "desc">("asc");
  const [memberQuery, setMemberQuery] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);
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
  const canReviewJoins =
    myRole != null
      ? canReviewClanJoinRequests(myRole, myTitleName)
      : initialCanReviewJoins;
  const canDisband = myRole ? myRole === "LEADER" : initialCanDisband;
  const canApply = !myRole && !platformOwnerAccess && initialCanApply;
  const assignableRoles = myRole
    ? assignableClanRoles(myRole, myTitleName)
    : initialAssignable;
  const canAssignRoles =
    myRole != null
      ? canAssignClanMemberRoles(myRole, myTitleName)
      : assignableRoles.length > 0;
  const showKickCol = canInvite;
  const colCount = 6 + (showKickCol ? 1 : 0) + (showVipCol ? 1 : 0);

  async function grantVip(member: Member) {
    const nick = member.user.nick || member.user.steamName || "игрок";
    if (
      !window.confirm(
        `Выдать VIP игроку ${nick}?\n\nНа паблике: вход без очереди и смена команды без ограничений по балансу.`
      )
    ) {
      return;
    }
    setLoading(true);
    setError("");
    setOk("");
    try {
      const res = await fetch(`/api/clans/${clan.id}/vip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: member.id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; reply?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || "VIP не выдан");
        return;
      }
      setOk(data.reply || "VIP выдан");
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, hasVip: true } : m))
      );
    } catch {
      setError("нет связи");
    } finally {
      setLoading(false);
    }
  }

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
        hasVip?: boolean;
        mainKit?: string | null;
        title?: { id: string; name: string } | null;
        user: Member["user"] & {
          steamId?: string | null;
          reserveUntil?: string | Date | null;
          updatedAt?: string | Date | null;
        };
      }>;
      setMembers((prev) => {
        const prevById = new Map(prev.map((m) => [m.id, m]));
        return list.map((m) => {
          const was = prevById.get(m.id);
          return {
            id: m.id,
            role: m.role,
            joinedAt:
              typeof m.joinedAt === "string"
                ? m.joinedAt
                : new Date(m.joinedAt).toISOString(),
            title: m.title ? { id: m.title.id, name: m.title.name } : null,
            // live GET may omit kits — keep last known
            mainKit: m.mainKit ?? was?.mainKit ?? null,
            hasVip:
              typeof m.hasVip === "boolean" ? m.hasVip : Boolean(was?.hasVip),
            user: {
              ...m.user,
              steamId: m.user.steamId ?? was?.user.steamId ?? null,
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
              lastSeenAt: m.user.lastSeenAt
                ? typeof m.user.lastSeenAt === "string"
                  ? m.user.lastSeenAt
                  : new Date(m.user.lastSeenAt).toISOString()
                : null,
            },
          };
        });
      });
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

  useEffect(() => {
    void refreshSquads();
  }, [refreshSquads]);

  useEffect(() => {
    const sync = () => {
      void refreshMembers();
      void refreshSquads();
      void refreshTitles();
      void refreshJoinRequests();
    };

    const unsubs: Array<() => void> = [];
    try {
      unsubs.push(
        subscribeLive(`/api/live/clan/${clan.id}`, "clan", () => sync())
      );
      unsubs.push(
        subscribeLive(`/api/live/clan/${clan.id}`, "hello", () =>
          setLiveOk(true)
        )
      );
      setLiveOk(true);
    } catch {
      setLiveOk(false);
    }

    const poll = window.setInterval(sync, 20_000);
    const onFocus = () => sync();
    window.addEventListener("focus", onFocus);

    return () => {
      for (const u of unsubs) u();
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
    };
  }, [clan.id, refreshMembers, refreshSquads, refreshTitles, refreshJoinRequests]);

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

  const squadUserIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of squads) {
      for (const m of s.members) map.set(m.user.id, s.name);
    }
    return map;
  }, [squads]);

  const sorted = useMemo(() => {
    const dir = memberOrder === "asc" ? 1 : -1;
    const q = memberQuery.trim().toLowerCase();
    const filtered = q
      ? members.filter((m) => {
          const nick = (m.user.nick || "").toLowerCase();
          const steam = (m.user.steamName || "").toLowerCase();
          const name = (m.user.name || "").toLowerCase();
          return (
            nick.includes(q) || steam.includes(q) || name.includes(q)
          );
        })
      : members;
    return [...filtered].sort((a, b) => {
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
      if (memberSort === "kit") {
        const ak = a.mainKit || "";
        const bk = b.mainKit || "";
        return (
          ak.localeCompare(bk, "ru", { sensitivity: "base" }) * dir ||
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
  }, [members, memberSort, memberOrder, squadUserIds, memberQuery]);

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

  const displayClanLogo =
    clan.logoUrl ||
    ratingClanLogo(clan.tag.toUpperCase() === "BB" ? "BB-MAIN" : clan.tag) ||
    null;

  return (
    <div className="clan-detail">
      <section className="hero clan-detail-hero">
        {displayClanLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="clan-detail-logo" src={displayClanLogo} alt="" width={72} height={72} />
        ) : (
          <div className="clan-detail-logo clan-row-logo-empty">{clan.tag.slice(0, 2)}</div>
        )}
        <div>
          <p className="eyebrow">клан</p>
          <h1>
            [{clan.tag}] {clan.name}
          </h1>
          {clan.isExternal && clan.leaderNick ? (
            <p className="muted" style={{ marginTop: 4 }}>
              Глава: <strong>{clan.leaderNick}</strong>
            </p>
          ) : null}
          {canEditClanProfile ? (
            <div style={{ marginTop: 12 }}>
              <ClanProfileEdit
                key={`${clan.id}-${clan.tag}-${clan.name}-${clan.logoUrl || ""}`}
                clanId={clan.id}
                name={clan.name}
                tag={clan.tag}
                logoUrl={clan.logoUrl}
              />
            </div>
          ) : null}
          {platformOwnerAccess ? (
            <p className="muted">
              Доступ владельца платформы (права главы)
              {liveOk ? (
                <span className="live-dot" title="Обновления в реальном времени">
                  {" "}
                  · live
                </span>
              ) : null}
            </p>
          ) : myRole ? (
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
            ["stats", "Статистика"],
            ["calendar", "Календарь"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`admin-tab${tab === id ? " active" : ""}`}
            onClick={() => goTab(id)}
          >
            {label}
          </button>
        ))}
        {myRole || inOtherClan ? (
          <Link
            href="/map"
            className="admin-tab clan-map-nav-tab"
            title="Карта игроков кланов"
          >
            Карта игроков
          </Link>
        ) : null}
        {showFactions ? (
          <button
            type="button"
            className={`admin-tab${tab === "factions" ? " active" : ""}`}
            onClick={() => goTab("factions")}
          >
            Фракции
          </button>
        ) : null}
      </div>

      {tab === "factions" && showFactions ? <ClanFactionsPanel clanId={clan.id} /> : null}

      {tab === "members" ? (
        <section className="card">
          {clan.isExternal ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Карточка соперника с КВ. Игроки с табло — ниже; после регистрации на
              площадке попадают в клан. Глава может приглашать, кикать и назначать
              роли.
            </p>
          ) : null}

          {clan.isExternal && pendingMembers.length > 0 ? (
            <div className="clan-join-requests" style={{ marginBottom: 16 }}>
              <h3 className="stats-h3" style={{ marginTop: 0 }}>
                Ростер с КВ (ещё не на сайте)
                {` (${pendingMembers.length})`}
              </h3>
              <ul className="invite-list">
                {pendingMembers.map((p) => {
                  const isLeader =
                    Boolean(clan.leaderNick) &&
                    p.nick
                      .toLowerCase()
                      .includes(String(clan.leaderNick).toLowerCase());
                  return (
                    <li key={p.nick} className="invite-row">
                      <div>
                        <strong>{p.nick}</strong>
                        {isLeader ? (
                          <span
                            className="pill"
                            style={{ marginLeft: 8, fontSize: "0.75rem" }}
                          >
                            глава
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

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
                        <Link href={playerPathFromUser(r.user)}>
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
                Роли/должности клана. Создавать и удалять — глава и заместитель
                (HR тоже может). Выдаются игрокам в таблице ниже.
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
              <div className="clan-member-search">
                <label className="field" style={{ margin: 0, flex: 1 }}>
                  <span>Поиск по нику</span>
                  <input
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="Ник или Steam…"
                    autoComplete="off"
                  />
                </label>
                {memberQuery.trim() ? (
                  <span className="muted clan-member-search-count">
                    {sorted.length} из {members.length}
                  </span>
                ) : null}
              </div>
              <div className="admin-table-wrap" style={{ marginTop: 8 }}>
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
                          onClick={() => toggleMemberSort("kit")}
                          title="Самый частый кит по времени за 14 суток (паблик + трёна + КВ)"
                        >
                          Кит{memberSortMark("kit")}
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
                      {showVipCol ? <th>VIP</th> : null}
                      {showKickCol ? <th></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.length === 0 ? (
                      <tr>
                        <td
                          colSpan={colCount}
                          className="muted"
                          style={{ textAlign: "center", padding: "18px 8px" }}
                        >
                          {memberQuery.trim()
                            ? "Никого не найдено"
                            : "Нет игроков"}
                        </td>
                      </tr>
                    ) : null}
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
                                  href={playerPathFromUser(m.user)}
                                >
                                  {m.user.nick}
                                </Link>
                              ) : (
                                <span>{m.user.steamName || "—"}</span>
                              )}
                              <SitePresenceBadge
                                lastSeenAt={m.user.lastSeenAt}
                                compact
                              />
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
                          <td title="Топ по времени в ките за 14 суток">
                            {m.mainKit || "—"}
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
                          {showVipCol ? (
                            <td>
                              {m.hasVip ? (
                                <span className="clan-vip-on" title="VIP уже активен на паблике">
                                  VIP ✓
                                </span>
                              ) : m.user.steamId ? (
                                <button
                                  type="button"
                                  className="btn ghost"
                                  disabled={loading}
                                  onClick={() => void grantVip(m)}
                                >
                                  Выдать VIP
                                </button>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          ) : null}
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
          </div>
        </section>
      ) : null}

      {/* Keep mounted so public stats prefetch while user is on another tab */}
      <div hidden={tab !== "stats"}>
        <ClanPublicStatsPanel clanId={clan.id} />
      </div>

      {tab === "calendar" ? (
        <ClanCalendarPanel
          clanId={clan.id}
          clanTag={clan.tag}
          clanName={clan.name}
          clanLogoUrl={displayClanLogo}
        />
      ) : null}

      <p style={{ marginTop: 16 }} className="clan-footer-actions">
        {myRole && !platformOwnerAccess ? (
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
