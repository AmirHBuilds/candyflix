import type { RatingSourceId } from "@/lib/rating-sources";

/** A rating site's logo, in its own colour (files in /public/ratings). */
export default function RatingIcon({ source, size = 20 }: { source: RatingSourceId; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/ratings/${source}.svg`} alt="" width={size} height={size} draggable={false} className="shrink-0" style={{ height: size, width: size }} />
  );
}
