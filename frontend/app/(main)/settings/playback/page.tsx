import { redirect } from "next/navigation";

// Settings is one long page now; old links land on the right section.
export default function Legacy() {
  redirect("/settings#playback");
}
