import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type GeocodeHit = {
  lat: number;
  lon: number;
  label: string;
  country: string;
  region: string | null;
  city: string;
};

type NominatimItem = {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    country?: string;
    state?: string;
    region?: string;
    county?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
  };
};

/** Прокси геокодера OSM Nominatim — country → region → city */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен полный профиль" }, { status: 401 });
  }

  const url = new URL(req.url);
  const country = String(url.searchParams.get("country") ?? "").trim();
  const region = String(url.searchParams.get("region") ?? "").trim();
  const city = String(url.searchParams.get("city") ?? "").trim();

  if (country.length < 2) {
    return NextResponse.json({ error: "Укажи страну" }, { status: 400 });
  }
  if (city.length < 1) {
    return NextResponse.json({ error: "Укажи город" }, { status: 400 });
  }

  const qParts = [city, region || null, country].filter(Boolean);
  const q = qParts.join(", ");

  const nominatim = new URL("https://nominatim.openstreetmap.org/search");
  nominatim.searchParams.set("q", q);
  nominatim.searchParams.set("format", "json");
  nominatim.searchParams.set("addressdetails", "1");
  nominatim.searchParams.set("limit", "6");
  nominatim.searchParams.set("accept-language", "ru");

  let data: NominatimItem[] = [];
  try {
    const res = await fetch(nominatim.toString(), {
      headers: {
        "User-Agent": "bb-squad-platform/1.0 (https://bb-squad.ru; clan map)",
        Accept: "application/json",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Геокодер временно недоступен" }, { status: 502 });
    }
    data = (await res.json()) as NominatimItem[];
  } catch {
    return NextResponse.json({ error: "Не удалось связаться с геокодером" }, { status: 502 });
  }

  const hits: GeocodeHit[] = data
    .map((item) => {
      const a = item.address || {};
      const hitCity =
        a.city || a.town || a.village || a.municipality || city;
      const hitRegion = a.state || a.region || a.county || region || null;
      const hitCountry = a.country || country;
      return {
        lat: Number(item.lat),
        lon: Number(item.lon),
        label: item.display_name,
        country: hitCountry,
        region: hitRegion,
        city: hitCity,
      };
    })
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon));

  if (hits.length === 0) {
    return NextResponse.json(
      { error: "Ничего не найдено. Проверь написание или укажи область." },
      { status: 404 }
    );
  }

  return NextResponse.json({ hits });
}
