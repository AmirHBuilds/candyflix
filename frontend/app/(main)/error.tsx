"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ErrorState";

// Catches anything a (main) page throws that it didn't handle itself.
// Rendered inside the layout, so the header stays and "Try again" just
// re-renders the segment.
export default function MainError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      message="We hit an unexpected problem loading this page. Give it another try."
      onRetry={reset}
      secondary={{ label: "Back to home", href: "/" }}
      detail={error.digest ? `Reference: ${error.digest}` : undefined}
    />
  );
}
