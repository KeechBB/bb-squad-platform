/** Общие уведомления всем, кто зарегистрирован на сайте. */

export type SiteNotice = {
  id: string;
  title: string;
  body: string;
  href: string;
  linkLabel: string;
};

export const SITE_NOTICES: SiteNotice[] = [
  {
    id: "fssc-1",
    title: "FSSC #1",
    body: "Приглашаем принять участие в турнире Fruit Strike Squad Cup #1. Регистрация команд открыта до 30 октября.",
    href: "/tournaments",
    linkLabel: "Перейти к турниру",
  },
];

export function findSiteNotice(id: string): SiteNotice | null {
  return SITE_NOTICES.find((n) => n.id === id) ?? null;
}
