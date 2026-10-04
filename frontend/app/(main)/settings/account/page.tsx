import { redirect } from "next/navigation";
import AccountSettingsForm from "@/components/settings/AccountSettingsForm";
import { getServerCurrentUser } from "@/lib/session";

export default async function AccountSettings() {
  const user = await getServerCurrentUser();
  if (!user) redirect("/login");
  return <AccountSettingsForm user={user} />;
}
