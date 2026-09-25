import Image from "next/image";
import Link from "next/link";
import { detailHref, posterUrl, type MediaItem } from "@/lib/media";

export default function MediaCard({
  item,
  onNavigate,
  href,
  badge,
  cta,
}: {
  item: MediaItem;
  onNavigate?: () => void;
  /** Overrides the default detail-page link — used by Continue Watching
   * (Phase 7) to send the click straight to the resume point instead of
   * the detail page, same as every other row's default behavior. */
  href?: string;
  /** Small corner label over the poster, e.g. "S2:E8" — Continue
   * Watching's series section only; omitted everywhere else. */
  badge?: string;
  /** Replaces the year/type/rating meta row with a short call-to-action
   * line, e.g. "Watch Now — S2:E8". Omitted everywhere else. */
  cta?: string;
}) {
  const poster = posterUrl(item.poster_path, "w500");
  const typeLabel = item.media_type === "movie" ? "Movie" : "TV";

  return (
    <Link href={href ?? detailHref(item)} onClick={onNavigate} className="group block w-full min-w-0">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition-all duration-200 group-hover:ring-[#FF5FA2]/50 group-hover:shadow-[0_0_24px_-4px_rgba(255,95,162,0.35)]">
        {poster ? (
          <Image
            src={poster}
            alt={item.title}
            fill
            sizes="(min-width: 1024px) 16vw, (min-width: 640px) 25vw, 50vw"
            className="object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-sm text-white/40">
            {item.title}
          </div>
        )}
        {badge && (
          <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-sm">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-sm text-white/80">{item.title}</p>
      {cta ? (
        <p className="truncate text-xs font-medium text-[#FF5FA2]">{cta}</p>
      ) : (
        <div className="flex items-center justify-between text-xs text-white/40">
          <span className="truncate">
            {item.year ?? "—"} · {typeLabel}
          </span>
          {item.rating != null && (
            <span className="ml-2 shrink-0 text-[#8FE3C7]">★ {item.rating.toFixed(1)}</span>
          )}
        </div>
      )}
    </Link>
  );
}
