export default function DetailActions({ watchHref }: { watchHref?: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      {watchHref ? (
        <a
          href={watchHref}
          className="rounded-xl bg-[#FF5FA2] px-6 py-2.5 font-medium text-[#0b0b12] hover:bg-[#FF5FA2]/90"
        >
          Watch Now
        </a>
      ) : (
        <button
          disabled
          title="Pick an episode below to watch"
          className="cursor-not-allowed rounded-xl bg-[#FF5FA2]/30 px-6 py-2.5 font-medium text-white/50"
        >
          Watch Now
        </button>
      )}
      <button
        disabled
        title="Candy Box arrives in a later phase"
        className="cursor-not-allowed rounded-xl border border-white/15 px-6 py-2.5 font-medium text-white/40"
      >
        Add to Candy Box
      </button>
    </div>
  );
}
