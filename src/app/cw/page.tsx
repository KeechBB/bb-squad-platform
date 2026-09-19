type Props = {
  searchParams?: Promise<{ clan?: string }>;
};

export default async function CwPage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const clan = sp.clan ? String(sp.clan) : "";
  const q = clan
    ? `?embed=1&clan=${encodeURIComponent(clan)}#/cw`
    : "?embed=1#/cw";

  return (
    <div className="cw-embed">
      {clan ? (
        <p className="cw-clan-filter muted">
          Фильтр клана в календаре: <strong>[{clan}]</strong> — введи в поиск клана на таблице.
        </p>
      ) : null}
      <iframe
        className="cw-frame"
        src={`/kv-static/index.html${q}`}
        title="Клановые войны BlackBerry"
        allow="fullscreen"
      />
    </div>
  );
}
