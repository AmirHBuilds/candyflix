"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { backdropUrl, detailHref, type MediaItem } from "@/lib/media";
import DetailActions from "@/components/DetailActions";

const ROTATE_MS = 7000;
const MAX_SLIDES = 5;
const SWIPE_THRESHOLD_PX = 40;

export default function HeroCarousel({ items }: { items: MediaItem[] }) {
  const slides = items.slice(0, MAX_SLIDES);
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);

  function resetTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (slides.length > 1) {
      timerRef.current = setInterval(() => {
        setIndex((i) => (i + 1) % slides.length);
      }, ROTATE_MS);
    }
  }

  useEffect(() => {
    resetTimer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  function goTo(i: number) {
    setIndex(((i % slides.length) + slides.length) % slides.length);
    resetTimer();
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (delta > SWIPE_THRESHOLD_PX) goTo(index - 1);
    else if (delta < -SWIPE_THRESHOLD_PX) goTo(index + 1);
    touchStartX.current = null;
  }

  if (slides.length === 0) return null;

  return (
    <section
      className="relative -mx-6 h-[75vh] min-h-[460px] overflow-hidden sm:mx-0 sm:rounded-3xl sm:min-h-[560px]"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {slides.map((item, i) => {
        const backdrop = backdropUrl(item.backdrop_path, "original");
        const isActive = i === index;
        const typeLabel = item.media_type === "movie" ? "Movie" : "TV";
        return (
          <div
            key={`${item.media_type}-${item.tmdb_id}`}
            aria-hidden={!isActive}
            className={`absolute inset-0 transition-opacity duration-700 ease-out ${
              isActive ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            {backdrop && (
              <Image
                src={backdrop}
                alt=""
                fill
                priority={i === 0}
                sizes="100vw"
                className="object-cover object-top"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B12] via-[#0B0B12]/55 to-[#0B0B12]/10" />
            <div className="absolute inset-x-0 bottom-0 p-6 sm:p-12">
              <p className="mb-2 text-sm font-medium uppercase tracking-wide text-[#8FE3C7]">
                Trending Now · {typeLabel} · {item.year ?? ""}
              </p>
              <Link href={detailHref(item)} className="group inline-block">
                <p className="mb-5 max-w-2xl font-[family-name:var(--font-display)] text-4xl font-semibold italic text-white group-hover:underline sm:text-6xl">
                  {item.title}
                </p>
              </Link>
              <DetailActions />
            </div>
          </div>
        );
      })}

      {slides.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous title"
            onClick={() => goTo(index - 1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/30 p-2 text-white/80 backdrop-blur hover:bg-black/50"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next title"
            onClick={() => goTo(index + 1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/30 p-2 text-white/80 backdrop-blur hover:bg-black/50"
          >
            ›
          </button>

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
            {slides.map((_, i) => (
              <button
                type="button"
                key={i}
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => goTo(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-6 bg-[#FF5FA2]" : "w-1.5 bg-white/30"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
