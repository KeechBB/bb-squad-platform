/** Меняй при обновлении KV, чтобы iframe не брал старый кэш */
const KV_CACHE = "20260921-tm-section";

export default async function TrainingMatchesPage() {
  const params = new URLSearchParams({ embed: "1", v: KV_CACHE });
  const q = `?${params.toString()}#/tm`;

  return (
    <div className="cw-embed">
      <iframe
        className="cw-frame"
        src={`/kv-static/index.html${q}`}
        title="Тренировочные матчи BlackBerry"
        allow="fullscreen"
      />
    </div>
  );
}
