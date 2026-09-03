import Link from "next/link";
import Image from "next/image";
import { backdropUrl, type MediaItem } from "@/lib/media";

export default function Hero({ item }: { item: MediaItem }) {
  const backdrop = backdropUrl(item.backdrop_path);
  const href = item.media_type === "movie" ? `/movie/${item.tmdb_id}` : `/tv/${item.tmdb_id}`;

  return (
    <section className="relative -mx-6 h-[52vh] min-h-[320px] overflow-hidden sm:mx-0 sm:rounded-3xl">
      {backdrop && (
        <Image
          src={backdrop}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B12] via-[#0B0B12]/40 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-6 sm:p-10">
        <p className="mb-2 font-[family-name:var(--font-display)] text-3xl font-semibold italic text-white sm:text-4xl">
          {item.title}
        </p>
        <Link
          href={href}
          className="inline-block rounded-xl bg-[#FF5FA2] px-5 py-2.5 font-medium text-[#0B0B12]"
        >
          More Info
        </Link>
      </div>
    </section>
  );
}
