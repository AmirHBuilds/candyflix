import Image from "next/image";
import Link from "next/link";
import { posterUrl, type MediaItem } from "@/lib/media";

export default function MediaCard({ item }: { item: MediaItem }) {
  const href = item.media_type === "movie" ? `/movie/${item.tmdb_id}` : `/tv/${item.tmdb_id}`;
  const poster = posterUrl(item.poster_path);

  return (
    <Link
      href={href}
      className="group block w-[150px] shrink-0 sm:w-[170px]"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition-all duration-200 group-hover:ring-[#FF5FA2]/50 group-hover:shadow-[0_0_24px_-4px_rgba(255,95,162,0.35)]">
        {poster ? (
          <Image
            src={poster}
            alt={item.title}
            fill
            sizes="170px"
            className="object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-sm text-white/40">
            {item.title}
          </div>
        )}
      </div>
      <p className="mt-2 truncate text-sm text-white/80">{item.title}</p>
      {item.year && <p className="text-xs text-white/40">{item.year}</p>}
    </Link>
  );
}
