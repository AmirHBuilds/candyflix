import { Suspense } from "react";
import AskAIPage from "@/components/AskAIPage";
import { LoadingRegion, Skeleton } from "@/components/Skeleton";

export default function AskPage() {
  return (
    <Suspense
      fallback={
        <LoadingRegion className="mx-auto flex max-w-4xl flex-col gap-6">
          <Skeleton className="h-12 w-full rounded-xl" />
        </LoadingRegion>
      }
    >
      <AskAIPage />
    </Suspense>
  );
}
