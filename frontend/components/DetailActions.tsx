export default function DetailActions() {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        disabled
        title="Playback arrives in a later phase"
        className="cursor-not-allowed rounded-xl bg-[#FF5FA2]/30 px-6 py-2.5 font-medium text-white/50"
      >
        Watch
      </button>
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
