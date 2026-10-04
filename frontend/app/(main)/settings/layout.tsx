import SettingsNav from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 md:flex-row md:gap-10">
      <div className="flex flex-col gap-4 md:w-52 md:shrink-0">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold text-white">Settings</h1>
        <SettingsNav />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </div>
  );
}
