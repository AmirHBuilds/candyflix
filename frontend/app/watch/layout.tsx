import { redirect } from "next/navigation";
import { getServerCurrentUser } from "@/lib/session";
import Nav from "@/components/Nav";
import { SettingsProvider } from "@/components/SettingsProvider";
import { getServerSettings } from "@/lib/settings-server";

// Used to deliberately omit <Nav/> here for a distraction-free player.
// Reversed by request — the header/search should be reachable from the
// watch page too. Auth check is still duplicated from (main)/layout.tsx
// since this route group sits outside it.
export default async function WatchLayout({ children }: { children: React.ReactNode }) {
  const [user, settings] = await Promise.all([getServerCurrentUser(), getServerSettings()]);
  if (!user) {
    redirect("/login");
  }

  return (
    <SettingsProvider initial={settings}>
      <div className="min-h-dvh bg-black">
        <Nav />
        {children}
      </div>
    </SettingsProvider>
  );
}
