import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <div className="not-found-stage" aria-hidden="true">
        <div className="not-found-glow" />
        <div className="not-found-grid" />
      </div>

      <div className="not-found-panel">
        <p className="not-found-brand">BLACKBERRY</p>
        <p className="not-found-code">404</p>
        <h1 className="not-found-title">Такого адреса нет</h1>
        <p className="not-found-lead">
          Ссылка битая или страницу уже убрали. Вернись на главную и зайди через
          меню.
        </p>
        <Link href="/" className="btn primary not-found-home">
          На главную
        </Link>
      </div>
    </main>
  );
}
