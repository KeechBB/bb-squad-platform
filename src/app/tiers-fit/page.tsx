import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Старый URL → вкладка внутри Тренировочных матчей */
export default function TiersFitRedirectPage() {
  redirect("/tm?tab=fit");
}
