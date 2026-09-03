import { getTrending } from "@/lib/media";
import Hero from "@/components/Hero";
import MediaRow from "@/components/MediaRow";

export default async function Home() {
  let trending: Awaited<ReturnType<typeof getTrending>> = [];
  let error: string | null = null;

  try {
    trending = await getTrending();
  } catch {
    error = "Couldn't load trending right now. Try refreshing in a moment.";
  }

  const [featured, ...rest] = trending;

  return (
    <div className="flex flex-col gap-8">
      {error && <p className="text-[#FF5FA2]">{error}</p>}

      {featured && <Hero item={featured} />}

      <MediaRow title="Trending Today" items={rest} />
    </div>
  );
}
