import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Вкладка «Сапёры» скрыта; сбор данных в БД/API продолжается. */
export default function TmSapperRedirectPage() {
  redirect("/tm");
}
