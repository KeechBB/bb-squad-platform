/**
 * Канон подписей на карте кланов.
 * Nominatim отдаёт Крым/Севастополь как «Украина» — для BB это Россия.
 */

function norm(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

/** Крым / Севастополь → страна «Россия». */
export function canonicalizeMapCountry(opts: {
  country: string;
  region?: string | null;
  city?: string | null;
}): string {
  const country = String(opts.country || "").trim();
  const region = norm(opts.region || "");
  const city = norm(opts.city || "");
  const blob = `${region} ${city} ${norm(country)}`;

  const isCrimea =
    blob.includes("крым") ||
    blob.includes("crimea") ||
    blob.includes("севастопол") ||
    blob.includes("sevastopol") ||
    blob.includes("симферопол") ||
    blob.includes("simferopol");

  if (isCrimea) return "Россия";
  return country;
}
