import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  getUserRole,
  isAdmin,
  isBuiltinSuperAdmin,
  isPublicPanelRole,
  syncBuiltinAdmins,
} from "@/lib/admin";
import { canAccessPanelka, type AppRole } from "@/lib/roles";

export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return {
      session: null,
      error: NextResponse.json({ error: "Нет доступа" }, { status: 403 }),
    };
  }
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) {
    return {
      session: null,
      error: NextResponse.json({ error: "Нет доступа" }, { status: 403 }),
    };
  }
  // Паблик-роли — только /admin/panelka, не полный админ-API
  const role = await getUserRole(session.user.steamId);
  if (isPublicPanelRole(role)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Нет доступа" }, { status: 403 }),
    };
  }
  return { session, error: null };
}

/** Панель серверов: Keech / Зам / HR / Админ паблика / Модератор паблика */
export async function requirePanelkaAccess() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return {
      session: null,
      error: NextResponse.json({ error: "Нет доступа" }, { status: 403 }),
    };
  }
  await syncBuiltinAdmins();
  const role = await getUserRole(session.user.steamId);
  if (!canAccessPanelka(role)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Нет доступа" }, { status: 403 }),
    };
  }
  return { session, error: null };
}

/** Только Keech (builtin SUPER_ADMIN steamId) */
export async function requireKeechOnly() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return {
      session: null,
      error: NextResponse.json({ error: "Нет доступа" }, { status: 403 }),
    };
  }
  await syncBuiltinAdmins();
  if (!isBuiltinSuperAdmin(session.user.steamId)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Нет доступа" }, { status: 403 }),
    };
  }
  return { session, error: null };
}

/** Заходы на сайт: Keech + Зам + HR */
export function canViewSiteVisits(role: AppRole | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "DEPUTY" || role === "HR";
}

export async function requireSiteVisitsAccess() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return {
      session: null,
      error: NextResponse.json({ error: "Нет доступа" }, { status: 403 }),
    };
  }
  await syncBuiltinAdmins();
  const role = await getUserRole(session.user.steamId);
  if (!canViewSiteVisits(role)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Нет доступа" }, { status: 403 }),
    };
  }
  return { session, error: null };
}
