/** Короткое имя слоя для таблиц: мод + карта, без режима и версии. */

const MODS = ["SEC 26", "HotDrop", "CSL", "FCL", "SEC", "HD"];

const MODE =
  /\b(RAAS|PAAS|AAS|Invasion|Insurgency|Skirmish|Seed|Destruction|Territory Control|TC|Tanks)\b/gi;

const MAPS: Array<[RegExp, string]> = [
  [/tallil(?:\s+outskirts)?/i, "Tallil"],
  [/sumari(?:\s+bala)?/i, "Sumari"],
  [/fool'?s\s+road/i, "Fool's Road"],
  [/black\s*coast/i, "Black Coast"],
  [/al\s*basrah/i, "Al Basrah"],
  [/goose\s+bay/i, "Goose Bay"],
  [/pacific(?:\s+proving\s+grounds)?/i, "Pacific"],
  [/manicouagan/i, "Manicouagan"],
  [/yehorivka/i, "Yehorivka"],
  [/fallujah/i, "Fallujah"],
  [/sanxian/i, "Sanxian"],
  [/mutaha/i, "Mutaha"],
  [/narva/i, "Narva"],
  [/harju/i, "Harju"],
  [/kamdesh/i, "Kamdesh"],
  [/gorodok/i, "Gorodok"],
  [/kokan/i, "Kokan"],
  [/chora/i, "Chora"],
  [/skorpo/i, "Skorpo"],
  [/lashkar/i, "Lashkar"],
  [/logar/i, "Logar"],
  [/kohat/i, "Kohat"],
  [/belaya/i, "Belaya"],
  [/anvil/i, "Anvil"],
  [/mestia/i, "Mestia"],
];

export function shortMapName(raw: string | null | undefined): string {
  let s = String(raw || "").trim().replace(/\s+/g, " ");
  if (!s || s === "—") return s || "—";
  s = s.replace(/\s+v\d+\b/gi, " ").replace(MODE, " ").replace(/\s+/g, " ").trim();
  let mod = "";
  for (const name of MODS) {
    const re = new RegExp(`^${name.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(s)) {
      mod = name;
      s = s.replace(re, "").trim();
      break;
    }
  }
  for (const [re, label] of MAPS) {
    if (re.test(s)) {
      s = label;
      break;
    }
  }
  return (mod ? `${mod} ${s}` : s).replace(/\s+/g, " ").trim();
}
