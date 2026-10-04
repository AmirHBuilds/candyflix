/** One section of the long settings page — its own block, clearly apart from its neighbours. */
export default function SettingsSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-40 border-t border-white/10 pt-10 first:border-t-0 first:pt-0"
    >
      <h2 id={`${id}-heading`} className="mb-5 font-[family-name:var(--font-display)] text-2xl font-semibold text-white">
        {title}
      </h2>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}
