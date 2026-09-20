type Props = {
  searchParams?: Promise<{ clan?: string }>;
};

/** Меняй при обновлении KV, чтобы iframe не брал старый кэш */
const KV_CACHE = "20260921-training";

export default async function CwPage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const clan = sp.clan ? String(sp.clan) : "";
  const params = new URLSearchParams({ embed: "1", v: KV_CACHE });
  if (clan) params.set("clan", clan);
  const q = `?${params.toString()}#/cw`;

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
