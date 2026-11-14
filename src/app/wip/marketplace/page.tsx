import { redirect } from "next/navigation";

/** Старый stub хаба → живая площадка. */
export default function MarketplaceWipRedirect() {
  redirect("/marketplace");
}
