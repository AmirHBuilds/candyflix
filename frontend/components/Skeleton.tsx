import { MEDIA_GRID_CLASSES } from "@/components/MediaGrid";

// Loading placeholders. They mirror the real layouts' dimensions (same
// grid classes, same poster ratio, same backdrop heights) so the page
// doesn't jump when the content arrives. Server-safe: no hooks.

/** A single pulsing block. Size and shape come from `className`. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/[0.07] ${className}`} />;
}

/**
 * Wraps a whole skeleton so screen readers hear one "Loading…" instead
 * of a page of meaningless empty boxes (the blocks are aria-hidden).
 */
export function LoadingRegion({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  );
}

export function MediaCardSkeleton() {
  return (
    <div className="w-full min-w-0">
      <Skeleton className="aspect-[2/3] rounded-xl" />
      <Skeleton className="mt-2 h-3.5 w-3/4" />
      <Skeleton className="mt-1.5 h-3 w-1/2" />
    </div>
  );
}

/** Same columns as <MediaGrid>. */
export function MediaGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={MEDIA_GRID_CLASSES}>
      {Array.from({ length: count }, (_, i) => (
        <MediaCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Movies / Series / Candy Box / Continue Watching: a title and a grid. */
export function GridPageSkeleton({ count = 12 }: { count?: number }) {
  return (
    <LoadingRegion className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48" />
      <MediaGridSkeleton count={count} />
    </LoadingRegion>
  );
}

/** Home: hero banner, then a couple of rows. */
export function HomeSkeleton() {
  return (
    <LoadingRegion className="flex flex-col gap-10">
      <Skeleton className="-mx-6 h-[50vh] min-h-[300px] rounded-none sm:mx-0 sm:rounded-3xl" />
      {[0, 1].map((row) => (
        <section key={row} className="flex flex-col gap-3">
          <Skeleton className="h-6 w-40" />
          <MediaGridSkeleton count={6} />
        </section>
      ))}
    </LoadingRegion>
  );
}

/** Movie / TV detail: backdrop, poster, text lines and the two buttons. */
export function DetailSkeleton() {
  return (
    <LoadingRegion className="flex flex-col gap-8">
      <Skeleton className="-mx-6 h-[40vh] min-h-[260px] rounded-none sm:mx-0 sm:rounded-3xl" />
      <div className="flex flex-col gap-6 sm:flex-row">
        <Skeleton className="hidden aspect-[2/3] w-[clamp(150px,20vw,220px)] shrink-0 self-start rounded-xl sm:block" />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
          <div className="mt-2 flex gap-3">
            <Skeleton className="h-12 w-40 rounded-xl" />
            <Skeleton className="h-12 w-40 rounded-xl" />
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}

/** A season's episode list. */
export function EpisodeListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <LoadingRegion className="flex flex-col divide-y divide-white/10">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-4 py-4">
          <Skeleton className="h-20 w-36 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

/** Watch pages: a black 16:9 stage, since the player itself is black. */
export function PlayerSkeleton() {
  return (
    <LoadingRegion>
      <div className="flex aspect-video max-h-[calc(100vh-8rem)] w-full items-center justify-center bg-black">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-[#FF5FA2]" />
      </div>
    </LoadingRegion>
  );
}
