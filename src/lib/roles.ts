export type AppRole = "USER" | "ADMIN" | "SUPER_ADMIN";

export function roleLabel(role: AppRole): string {
  if (role === "SUPER_ADMIN") return "Главный админ";
  if (role === "ADMIN") return "Админ";
  return "Игрок";
}

export function parseRole(value: string): AppRole | null {
  const v = value.toUpperCase();
  if (v === "USER" || v === "ADMIN" || v === "SUPER_ADMIN") return v;
  return null;
}
