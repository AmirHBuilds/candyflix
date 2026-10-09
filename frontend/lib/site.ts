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

/** Written into the app on purpose: not an admin setting, always shown (footer and login screen). */
export const LOVE_NOTE = "Made with all my love, for Candy 💗";

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

export type BadgePosition = "top" | "top-left" | "top-right";
export type BadgeContent = { position: BadgePosition; image_url: string | null };
export const DEFAULT_BADGE: BadgeContent = { position: "top-left", image_url: null };

/** The crown settings, for the signed-out login screen. Never throws: a missing badge falls back to the default crown. */
export async function getBadge(): Promise<BadgeContent> {
  try {
    const res = await fetchWithTimeout(`${getApiBaseUrl()}/site/badge`, { cache: "no-store" });
    if (!res.ok) return DEFAULT_BADGE;
    return { ...DEFAULT_BADGE, ...(await res.json()) };
  } catch {
    return DEFAULT_BADGE;
  }
}
