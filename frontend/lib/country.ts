/** "DE" -> "Germany", "LAN" -> "Local network". Null when the country isn't known (the server has no country file). */
export function placeName(code: string | null | undefined, locale?: string): string | null {
  if (!code) return null;
  if (code === "LAN") return "Local network";
  try {
    return new Intl.DisplayNames(locale ? [locale] : undefined, { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
