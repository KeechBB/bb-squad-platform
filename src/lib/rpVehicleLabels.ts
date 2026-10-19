/**
 * Human labels for vehicle RP events (client-safe — no node: imports).
 * Tickets: Squad ticketValue table (src/lib/squadVehicleTickets.ts) =
 * scripts/data/squad_vehicle_tickets.json. Keep fallback heuristics aligned
 * with platform/scripts/rp_log_parse.py.
 */

import { SQUAD_VEHICLE_TICKETS } from "@/lib/squadVehicleTickets";

export type RpVehicleLabelEvent = {
  kind?: string;
  label?: string;
  vehicle?: string;
  victim?: string;
  killer?: string;
  tickets?: number;
  reason?: string;
};

/** Short name from Asset: BP_T72S_GFI_C → T72S */
export function vehicleShortName(asset: string): string {
  let a = String(asset || "").replace(/^BP_/i, "");
  a = a.replace(/_C$/i, "");
  a = a.replace(
    /_(Desert|Woodland|WoodLand|Black|Green|Urban|Snow|Forest)$/i,
    ""
  );
  a = a.replace(
    /_(GFI|RUS|USA|USMC|PLA|CAF|BAF|ADF|MEA|INS|IMF|WPMC|TLF|VDV|GB|IRAN)$/i,
    ""
  );
  a = a.replace(/_/g, " ").trim();
  return a || "техника";
}

function isArmedLight(asset: string): boolean {
  return /(TOW|KORNET|M134|ZU23|QJZ|NSV|KORD|DSHK|SPG9|SPG_9|CAS|CROWS|RWS|ARMED|OPEN.?TOP|MINIGUN|ROCKET|M2HB|PKT|KPVT|OBLITERATE|DSHKM|HMG|GMG)/i.test(
    asset
  );
}

function isUnarmedTransport(asset: string): boolean {
  const a = String(asset || "");
  if (!a || /LOGI/i.test(a) || isArmedLight(a)) return false;
  if (/TRANSPORT/i.test(a)) return true;
  return /(UTIL|URAL|KAMAZ|M939|CTM131|GAZ66|GAZ_66|TECHNICAL4SEATER_TRANSPORT|SAFEZONE)/i.test(
    a
  );
}

function assetBpKey(asset: string): string {
  return String(asset || "")
    .trim()
    .replace(/_C_\d+$/i, "")
    .replace(/_C$/i, "");
}

function lookupVehicleTickets(asset: string): number | null {
  const base = assetBpKey(asset);
  if (!base) return null;
  const stripped = base.replace(/_(Turret|Periscope|Gunner|Passenger)(?=_|$)/gi, "");
  for (const key of [base, stripped]) {
    if (key && SQUAD_VEHICLE_TICKETS[key] != null) return SQUAD_VEHICLE_TICKETS[key];
  }
  return null;
}

function inferVehicleTickets(asset: string): number {
  const hit = lookupVehicleTickets(asset);
  if (hit != null) return hit;
  const a = String(asset || "");
  if (/M113A3_MSV|WPMC.*(HUB|MCT|HQ|RADIO.?BIKE|MOBILE|COMMAND|MSV)/i.test(a))
    return 20;
  if (
    /(T72|T62|T80|T90|M1A|LEOPARD|2A6|2A7|M60|CHALLENGER|MERKAVA|T14|ZTZ|TYPE99|TYPE96|FV4034|T64)/i.test(
      a
    )
  )
    return 15;
  if (
    /(BTR82|BTR-?82|BTR4|BMP|BFV|FV510|FV520|AAVP|WARRIOR|ZBD|ZBL|BMD|PIRANHA|STRYKER|LAV25|LAV6|LAV_6|LAV2_COYOTE|BOXER|ZTD|ACV-?15|ASLAV|PARS3|M7A3|WZ551|ZSD89|M1126|M1128|SPRUT)/i.test(
      a
    )
  )
    return 10;
  if (/LOGI/i.test(a)) {
    if (/(MINSK|QUAD|RHIB|M-?GATOR|LYNX|TECHNICAL|LUVW)/i.test(a)) return 1;
    return 5;
  }
  if (isUnarmedTransport(a)) return 3;
  if (/(MINSK|QUAD|BIKE|RHIB|ZODIAC|M-?GATOR|LYNXATV)/i.test(a)) return 1;
  return 5;
}

export function vehicleClassRu(
  asset: string,
  tickets?: number | null
): string {
  const a = String(asset || "");
  const t =
    tickets != null && Number.isFinite(Number(tickets))
      ? Number(tickets)
      : inferVehicleTickets(asset);
  if (t >= 20) return "хаб WPMC";
  if (t >= 15) {
    if (/LOACH|CAS|HELI|UH|MI8|CH14/i.test(a)) return "вертолёт";
    return "танк";
  }
  if (t >= 10) return "БТР/БМП";
  if (t === 0) return "RSV";
  if (t === 1) return "лёгкий";
  if (t === 3 || isUnarmedTransport(a)) return "транспорт";
  if (/LOGI/i.test(a)) return "logi";
  return "техника";
}

export function vehicleLabelRu(
  asset: string,
  tickets?: number | null
): string {
  const short = vehicleShortName(asset);
  const cls = vehicleClassRu(asset, tickets);
  if (cls === "хаб WPMC") {
    return short && short.toLowerCase() !== "техника" ? `${cls} ${short}` : cls;
  }
  return `${cls} ${short}`.trim();
}

/** Text for детальный разбор — never show raw BP_… as the only clue. */
export function formatRpEventLabel(
  e: RpVehicleLabelEvent,
  side: "kill" | "death"
): string {
  if (e.label) return e.label;
  const asset = String(
    e.vehicle || (side === "kill" ? e.victim : e.killer) || ""
  );
  const tickets = e.tickets;
  const vlab = asset ? vehicleLabelRu(asset, tickets) : "техника";
  const tik =
    tickets != null && Number.isFinite(Number(tickets))
      ? `, ${tickets} тик.`
      : "";
  switch (e.kind) {
    case "vehicle_loss":
      return `потеря ${vlab} (F2${tik})`;
    case "vehicle_loss_driver":
      return `потеря ${vlab} (мехвод 70%${tik})`;
    case "vehicle_kill":
      return `уничтожил ${vlab}${tik ? ` (${String(tickets)} тик.)` : ""}`;
    case "driver_share": {
      const why =
        e.reason === "nok"
          ? "нок"
          : e.reason === "die"
            ? "килл"
            : e.reason === "vehicle_kill"
              ? "технику"
              : "килл";
      return `мехвод 70% · ${why} F2 (${e.victim || "—"}) · ${vlab}`;
    }
    default:
      return side === "kill" ? e.victim || "—" : e.killer || "—";
  }
}

export function isVehicleRpEvent(e: RpVehicleLabelEvent): boolean {
  const k = e.kind || "";
  return (
    k === "vehicle_kill" ||
    k === "vehicle_loss" ||
    k === "vehicle_loss_driver" ||
    k === "driver_share"
  );
}
