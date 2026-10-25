import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** FIT/ORR сняты с сайта — старые ссылки ведут на тренировки. */
export default function TiersFitRedirectPage() {
  redirect("/tm");
}
