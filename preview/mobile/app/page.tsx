import { HomeFit } from "@/components/HomeFit";
import { cookies } from "next/headers";
import { HomeHub } from "@/components/HomeHub";
import { HOME_HUB_TILES } from "@/lib/homeHub";
import { cwCards, hubLayout } from "../fixtures";

export default async function Page() {
  const empty = (await cookies()).get("bb-preview-state")?.value === "empty";
  return <main className="home-page is-hub"><HomeFit hub><HomeHub showCw cwCards={empty ? [] : cwCards} canEditTiles={false} tileLayout={hubLayout} tiles={HOME_HUB_TILES} /></HomeFit></main>;
}
