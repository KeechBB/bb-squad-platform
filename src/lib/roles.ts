export type AppRole =
  | "USER"
  | "ADMIN"
  | "HR"
  | "DEPUTY"
  | "SUPER_ADMIN"
  | "PUBLIC_ADMIN"
  | "PUBLIC_MOD";

export const ROLE_LABELS: Record<AppRole, string> = {
  USER: "Игрок",
  ADMIN: "Админ",
  HR: "HR",
  DEPUTY: "Зам. главного админа",
  SUPER_ADMIN: "Главный админ",
  PUBLIC_ADMIN: "Администратор паблика",
  PUBLIC_MOD: "Модератор паблика",
};

export function roleLabel(role: AppRole): string {
  return ROLE_LABELS[role] || role;
}

export function parseRole(v: string): AppRole | null {
  const u = v.trim().toUpperCase();
  if (u === "USER") return "USER";
  if (u === "ADMIN") return "ADMIN";
  if (u === "HR") return "HR";
  if (u === "DEPUTY") return "DEPUTY";
  if (u === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (u === "PUBLIC_ADMIN") return "PUBLIC_ADMIN";
  if (u === "PUBLIC_MOD") return "PUBLIC_MOD";
  return null;
}

/** Роли, которые актор может выставить цели */
export function assignableRoles(actor: AppRole): AppRole[] {
  if (actor === "SUPER_ADMIN" || actor === "DEPUTY") {
    return ["USER", "ADMIN", "HR", "DEPUTY", "PUBLIC_ADMIN", "PUBLIC_MOD"];
  }
  if (actor === "HR") {
    return ["USER", "ADMIN", "PUBLIC_ADMIN", "PUBLIC_MOD"];
  }
  if (actor === "ADMIN") {
    return ["USER"];
  }
  return [];
}

/** Доступ к панели серверов (/admin/panelka) */
export function canAccessPanelka(role: AppRole | null | undefined): boolean {
  return (
    role === "SUPER_ADMIN" ||
    role === "DEPUTY" ||
    role === "HR" ||
    role === "PUBLIC_ADMIN" ||
    role === "PUBLIC_MOD"
  );
}

/** Только паблик-роли (без полного админского UI) */
export function isPublicPanelRole(role: AppRole | null | undefined): boolean {
  return role === "PUBLIC_ADMIN" || role === "PUBLIC_MOD";
}
