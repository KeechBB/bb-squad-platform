export type AppRole = "USER" | "ADMIN" | "DEPUTY" | "SUPER_ADMIN";

export function roleLabel(role: AppRole): string {
  if (role === "SUPER_ADMIN") return "Главный админ";
  if (role === "DEPUTY") return "Заместитель";
  if (role === "ADMIN") return "Админ";
  return "Игрок";
}

export function parseRole(value: string): AppRole | null {
  const v = value.toUpperCase();
  if (v === "USER" || v === "ADMIN" || v === "DEPUTY" || v === "SUPER_ADMIN") {
    return v;
  }
  return null;
}

/** Какие роли можно выдать (не считая ограничений по цели) */
export function assignableRoles(actorRole: AppRole): AppRole[] {
  if (actorRole === "SUPER_ADMIN" || actorRole === "DEPUTY") {
    return ["USER", "ADMIN", "DEPUTY"];
  }
  if (actorRole === "ADMIN") {
    return ["USER", "ADMIN"];
  }
  return [];
}
