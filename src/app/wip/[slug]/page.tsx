import Link from "next/link";
import { notFound } from "next/navigation";
import { HOME_HUB_WIP_TITLES } from "@/lib/homeHub";

type Props = { params: Promise<{ slug: string }> };

export default async function WipStubPage({ params }: Props) {
  const { slug } = await params;
  const title = HOME_HUB_WIP_TITLES[slug];
  if (!title) notFound();

  return (
    <main className="wip-stub-page">
      <div className="wip-stub-card" role="status">
        <p className="wip-stub-kicker">{title}</p>
        <h1>В РАЗРАБОТКЕ</h1>
        <p className="wip-stub-note">Раздел скоро появится на платформе.</p>
        <Link href="/" className="wip-stub-back">
          ← На главную
        </Link>
      </div>
    </main>
  );
}
