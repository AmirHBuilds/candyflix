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

export type HomeBannerContent = { enabled: boolean; title: string; text: string };
export type HomeBannersContent = { banners: HomeBannerContent[] };

export const DEFAULT_BANNERS: HomeBannersContent = {
  banners: [
    {
      enabled: true,
      title: "Subtitles that fit",
      text: "Pick a subtitle from OpenSubtitles, then tap Sync and CandyFlix lines it up with the video's audio. It remembers the fixed one for next time.",
    },
    {
      enabled: true,
      title: "Right where you left off",
      text: "Resume any movie or episode from the same spot, skip intros with one tap, and keep your own CandyBox of things to watch.",
    },
    {
      enabled: true,
      title: "Make it yours",
      text: "Pick a colour theme, arrange the player's buttons, peek at every rating, and watch a trailer before you commit to movie night.",
    },
  ],
};

/** Never throws: the banners are never worth breaking the home page over. */
export async function getBannersServer(): Promise<HomeBannersContent> {
  try {
    const res = await fetchWithTimeout(`${getApiBaseUrl()}/site/banners`, { cache: "no-store" });
    if (!res.ok) return DEFAULT_BANNERS;
    const body = await res.json();
    return Array.isArray(body?.banners) && body.banners.length === 3 ? body : DEFAULT_BANNERS;
  } catch {
    return DEFAULT_BANNERS;
  }
}
