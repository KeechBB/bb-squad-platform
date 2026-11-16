/** Фиолетовый $ с двумя косыми полосками — знак Черничного Доллара. */
export function BdMark({ className = "" }: { className?: string }) {
  return (
    <span className={`bd-mark ${className}`.trim()} title="Черничный Доллар" aria-label="Черничный Доллар">
      $
    </span>
  );
}

export function BdAmount({
  n,
  className = "",
  signed = false,
}: {
  n: number;
  className?: string;
  /** Показать + перед положительным */
  signed?: boolean;
}) {
  const v = Math.round(Number(n) || 0);
  const prefix = signed && v > 0 ? "+" : "";
  return (
    <span className={`bd-amount ${className}`.trim()}>
      {prefix}
      {v.toLocaleString("ru-RU")}
      {"\u00A0"}
      <BdMark />
    </span>
  );
}
