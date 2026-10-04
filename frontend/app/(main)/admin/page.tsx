import Link from "next/link";
import { redirect } from "next/navigation";
import AdminPanel from "@/components/admin/AdminPanel";
import { getServerCurrentUser } from "@/lib/session";

export const metadata = { title: "Admin panel · CandyFlix" };

export default async function AdminPage() {
  const user = await getServerCurrentUser();
  if (!user) redirect("/login");

  // The server enforces this too (every /api/admin route is admin-only);
  // this just gives everyone else a clear page instead of an empty panel.
  if (!user.is_admin) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-white">Admins only</h1>
        <p className="text-sm text-white/50">You don&apos;t have access to the admin panel.</p>
        <Link href="/" className="mt-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white/80 hover:bg-white/15">
          Back home
        </Link>
      </div>
    );
  }
  return <AdminPanel currentUserId={user.id} />;
}
