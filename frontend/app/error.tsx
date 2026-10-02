"use client";

import { useEffect } from "react";
import ErrorState from "@/components/ErrorState";

// Last line of defence for routes outside (main) — the watch pages and
// the login page — and for failures in the (main) layout itself.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="px-6">
      <ErrorState
        message="We hit an unexpected problem. Give it another try."
        onRetry={reset}
        secondary={{ label: "Back to home", href: "/" }}
        detail={error.digest ? `Reference: ${error.digest}` : undefined}
      />
    </div>
  );
}
