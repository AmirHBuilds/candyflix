"use client";

import "./globals.css";

// Replaces the root layout when *it* fails, so it must supply its own
// <html>/<body>. Deliberately self-contained: no fonts, no router, no
// shared components — anything that could itself be what broke.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-canvas px-6 text-center text-white antialiased">
        <div role="alert" className="flex flex-col items-center gap-4">
          <h1 className="text-2xl font-semibold">CandyFlix hit a snag</h1>
          <p className="max-w-sm text-sm text-white/50">Something went wrong loading the app. Please try again.</p>
          <button
            type="button"
            onClick={reset}
            className="h-11 rounded-xl bg-accent px-6 text-sm font-semibold text-on-accent hover:bg-accent/90"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
