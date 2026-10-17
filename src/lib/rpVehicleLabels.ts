/**
 * Human labels for vehicle RP events (client-safe — no node: imports).
 * Keep in sync with platform/scripts/rp_log_parse.py vehicle_label_ru.
 */

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
  if (
    /(UTIL|URAL|KAMAZ|M939|CTM131|GAZ66|GAZ_66|MINSK|BIKE|MOTORCYCLE|QUAD|BICYCLE|BOAT|RHIB|ZODIAC|CH146|RAVEN|UH60|UH_60|MI8|MI_8|LOACH|SAFEZONE)/i.test(
      a
    )
  ) {
    if (/LOACH/i.test(a) && /CAS/i.test(a)) return false;
    return true;
  }
  return false;
}

function inferVehicleTickets(asset: string): number {
  const a = String(asset || "");
  if (/WPMC.*(HUB|MCT|HQ|RADIO.?BIKE|MOBILE|COMMAND)/i.test(a)) return 20;
  if (
    /(T72|T62|T80|T90|M1A|LEOPARD|M60|CHALLENGER|MERKAVA|T14|ZTZ|TYPE99|TYPE96)/i.test(
      a
    )
  )
    return 15;
  if (
    /(BTR|BMP|BFV|FV510|AAVP|WARRIOR|ZBD|ZBL|BMD|MTL|PIRANHA|STRYKER|LAV25|BOXER|ZTD|BRDM)/i.test(
      a
    )
  )
    return 10;
  if (/LOGI/i.test(a)) return 5;
  if (isUnarmedTransport(a)) return 2;
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
  if (t >= 15) return "танк";
  if (t >= 10) return "БТР/БМП";
  if (t <= 2) return "транспорт";
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
