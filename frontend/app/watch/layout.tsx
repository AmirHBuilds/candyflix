import { redirect } from "next/navigation";
import { getServerCurrentUser } from "@/lib/session";

// Deliberately no <Nav/> here, unlike the (main) layout — a
// distraction-free player shouldn't have site chrome around it. Auth
// check is duplicated from (main)/layout.tsx since this route group
// sits outside it for that reason.
export default async function WatchLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <div className="min-h-screen bg-black">{children}</div>;
}
