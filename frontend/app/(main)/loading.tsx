import { HomeSkeleton } from "@/components/Skeleton";

// Covers the home page, and every (main) page that doesn't define its own
// loading.tsx — so a new route shows *something* instead of freezing.
export default function Loading() {
  return <HomeSkeleton />;
}
