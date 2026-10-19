"use client";

type Props = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  className?: string;
  label?: string;
  /** Сколько номеров страниц видно сразу (скользящее окно). По умолчанию 10. */
  maxButtons?: number;
};

/** Видимое окно страниц: не больше `maxButtons`, сдвигается при листании. */
export function pageWindow(
  page: number,
  pageCount: number,
  maxButtons = 10
): number[] {
  if (pageCount <= 0) return [];
  const size = Math.min(Math.max(1, maxButtons), pageCount);
  const safe = Math.min(Math.max(1, page), pageCount);
  let start = Math.max(1, safe - Math.floor((size - 1) / 2));
  let end = start + size - 1;
  if (end > pageCount) {
    end = pageCount;
    start = Math.max(1, end - size + 1);
  }
  const out: number[] = [];
  for (let n = start; n <= end; n++) out.push(n);
  return out;
}

export function ListPager({
  page,
  pageCount,
  total,
  pageSize,
  onChange,
  className,
  label = "Страницы списка",
  maxButtons = 10,
}: Props) {
  if (!total || pageCount <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const nums = pageWindow(page, pageCount, maxButtons);

  return (
    <nav
      className={`public-rating-pager${className ? ` ${className}` : ""}`}
      aria-label={label}
    >
      <span className="muted public-rating-pager-meta">
        {from}–{to} из {total}
      </span>
      <div className="public-rating-pager-btns">
        <button
          type="button"
          className="public-rating-page-btn"
          disabled={page <= 1}
          aria-label="Предыдущая страница"
          onClick={() => onChange(Math.max(1, page - 1))}
        >
          ‹
        </button>
        {nums.map((n) => (
          <button
            key={n}
            type="button"
            className={`public-rating-page-btn${n === page ? " is-active" : ""}`}
            aria-current={n === page ? "page" : undefined}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className="public-rating-page-btn"
          disabled={page >= pageCount}
          aria-label="Следующая страница"
          onClick={() => onChange(Math.min(pageCount, page + 1))}
        >
          ›
        </button>
      </div>
    </nav>
  );
}

export function pageSlice<T>(list: T[], page: number, size: number) {
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, size)) || 1);
  const safe = Math.min(Math.max(1, page), pageCount);
  const start = (safe - 1) * size;
  return {
    page: safe,
    pageCount,
    total,
    rows: list.slice(start, start + size),
  };
}
