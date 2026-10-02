import { Suspense } from "react";
import SearchPageClient from "@/components/SearchPageClient";
import { LoadingRegion, Skeleton } from "@/components/Skeleton";

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <LoadingRegion className="flex flex-col gap-6">
          <Skeleton className="h-12 w-full max-w-xl rounded-xl" />
        </LoadingRegion>
      }
    >
      <SearchPageClient />
    </Suspense>
  );
}
