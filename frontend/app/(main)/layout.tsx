import { redirect } from "next/navigation";
import { getServerCurrentUser } from "@/lib/session";
import Nav from "@/components/Nav";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getServerCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <>
      <Nav />
      <main className="px-6 py-8 sm:px-10">{children}</main>
    </>
  );
}
