import { redirect } from "next/navigation";
import { getServerCurrentUser } from "@/lib/session";
import Nav from "@/components/Nav";
import { BoxNameProvider } from "@/components/BoxNameProvider";
import Footer from "@/components/Footer";
import ScrollToTop from "@/components/ScrollToTop";
import { SettingsProvider } from "@/components/SettingsProvider";
import { getServerSettings } from "@/lib/settings-server";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Loaded together: the settings lookup doesn't depend on the user one.
  const [user, settings] = await Promise.all([getServerCurrentUser(), getServerSettings()]);
  if (!user) {
    redirect("/login");
  }

  return (
    <SettingsProvider initial={settings}>
      <BoxNameProvider displayName={user.display_name}>
      <ScrollToTop />
      <div className="flex min-h-dvh flex-col">
        <Nav />
        <main className="flex-1 px-6 py-8 sm:px-10">{children}</main>
        <Footer />
      </div>
      </BoxNameProvider>
    </SettingsProvider>
  );
}
