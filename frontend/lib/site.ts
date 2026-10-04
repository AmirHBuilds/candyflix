/** Footer content (public read; admins edit it in the admin panel). */
import { fetchWithTimeout, getApiBaseUrl } from "@/lib/api-client";

export type FooterLink = { label: string; url: string };
export type FooterContent = {
  enabled: boolean;
  tagline: string;
  email: string;
  links: FooterLink[];
  copyright: string;
};

export const DEFAULT_FOOTER: FooterContent = {
  enabled: true,
  tagline: "Your own private movie night.",
  email: "",
  links: [],
  copyright: "CandyFlix",
};

/** Never throws: a footer is never worth breaking a page over. */
export async function getFooterServer(): Promise<FooterContent> {
  try {
    const res = await fetchWithTimeout(`${getApiBaseUrl()}/site/footer`, { cache: "no-store" });
    if (!res.ok) return DEFAULT_FOOTER;
    return { ...DEFAULT_FOOTER, ...(await res.json()) };
  } catch {
    return DEFAULT_FOOTER;
  }
}
