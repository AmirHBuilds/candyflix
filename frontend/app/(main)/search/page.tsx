import { Suspense } from "react";
import SearchPageClient from "@/components/SearchPageClient";

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="text-white/40">Loading…</p>}>
      <SearchPageClient />
    </Suspense>
  );
}
