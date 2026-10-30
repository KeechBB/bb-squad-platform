import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { isAnyClanMember } from "@/lib/clanAccess";
import { liveKvBust } from "@/lib/kvBust";

export const dynamic = "force-dynamic";

const ROLE_PAGES: Record<string, string> = {
  rifleman: "Стрелок",
  "squad-lead": "Командир отряда",
  medic: "Медик",
  lmg: "Легкий Пулемет",
  hmg: "Тяжелый Пулемет",
  engineer: "Сапер/Инженер",
  "crew-lead": "Наводчик",
  crewman: "Мехвод",
  grenadier: "Гранатомет подствольный",
  lat: "Легкая Труба",
  hat: "Тандем",
  sniper: "Снайпер",
  marksman: "Марксман",
  scout: "Разведчик",
  raider: "Рейдер",
  pilot: "Пилот",
};

type Props = { params: Promise<{ kit: string }> };

export default async function TmRolePage({ params }: Props) {
  const { kit } = await params;
  const title = ROLE_PAGES[kit];
  if (!title) notFound();

  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");
  if (!(await isAnyClanMember(session.user.steamId))) {
    redirect("/clans");
  }

  const bust = await liveKvBust();
  const q = new URLSearchParams({
    embed: "1",
    hideTiers: "1",
    rolePage: "1",
    role: kit,
    v: bust,
  });
  const src = `/kv-static/index.html?${q.toString()}#/tm/${kit}`;

  return (
    <div className="tm-role-page">
      <style>{`
        html:has(.tm-role-page),
        body:has(.tm-role-page) {
          height: 100%;
          overflow: hidden;
          background: #07060c;
        }
        body:has(.tm-role-page) {
          display: flex;
          flex-direction: column;
          height: 100dvh;
        }
        body:has(.tm-role-page) .site-footer { display: none; }
        .shell:has(.tm-role-page) {
          max-width: none;
          width: 100%;
          margin: 0;
          padding: 0;
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .tm-role-page {
          flex: 1 1 auto;
          min-height: 0;
          width: 100%;
          display: flex;
        }
        .tm-role-frame {
          flex: 1 1 auto;
          width: 100%;
          height: 100%;
          border: 0;
          display: block;
          background: #120e1c;
        }
      `}</style>
      <iframe className="tm-role-frame" src={src} title={title} />
    </div>
  );
}
