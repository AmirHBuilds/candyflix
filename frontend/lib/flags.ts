// Which country flag stands for a subtitle language. A language isn't a country,
// so this is a best-effort pick (English -> UK, Persian -> Iran, ...). A region in
// the code wins when there is one ("pt-BR" -> Brazil, "zh-TW" -> Taiwan).
// The flag images are in /public/flags (flag-icons, MIT; see LICENSE there).
// Anything not listed gets a neutral globe tile instead of a wrong flag.

const BY_LANGUAGE: Record<string, string> = {
  af: "za", am: "et", ar: "sa", az: "az", be: "by", bg: "bg", bn: "bd", bs: "ba", ca: "es-ct", cs: "cz",
  cy: "gb-wls", da: "dk", de: "de", el: "gr", en: "gb", es: "es", et: "ee", eu: "es-pv", fa: "ir", fi: "fi",
  fil: "ph", fr: "fr", ga: "ie", gl: "es-ga", gu: "in", he: "il", hi: "in", hr: "hr", hu: "hu", hy: "am",
  id: "id", is: "is", it: "it", ja: "jp", ka: "ge", kk: "kz", km: "kh", kn: "in", ko: "kr", ku: "iq",
  lo: "la", lt: "lt", lv: "lv", mk: "mk", ml: "in", mn: "mn", mr: "in", ms: "my", mt: "mt", my: "mm",
  nb: "no", ne: "np", nl: "nl", nn: "no", no: "no", pa: "in", pl: "pl", ps: "af", pt: "pt", ro: "ro",
  ru: "ru", si: "lk", sk: "sk", sl: "si", sq: "al", sr: "rs", sv: "se", sw: "ke", ta: "in", te: "in",
  tg: "tj", th: "th", tl: "ph", tr: "tr", uk: "ua", ur: "pk", uz: "uz", vi: "vn", zh: "cn",
};

// Region codes we actually have a flag for when they show up after a dash.
const REGIONS = new Set([
  "br", "pt", "cn", "tw", "hk", "us", "gb", "ca", "mx", "ar", "co", "cl", "pe", "ve", "au", "nz", "ie",
  "za", "in", "ch", "at", "be", "es", "fr", "de", "it", "nl", "eg", "sa", "ae", "ma", "dz", "tn",
]);

/** ISO country code of the flag for a language code like "en", "pt-BR", "zh-TW"; null when unknown. */
export function flagCodeFor(language: string): string | null {
  const lower = language.trim().toLowerCase().replace("_", "-");
  if (!lower || lower === "und") return null;
  const [base, region] = lower.split("-");
  if (region && REGIONS.has(region) && !(base === "en" && region === "gb")) return region;
  return BY_LANGUAGE[base] ?? null;
}

export const FLAG_CODES: string[] = [...new Set([...Object.values(BY_LANGUAGE), ...REGIONS])].sort();
