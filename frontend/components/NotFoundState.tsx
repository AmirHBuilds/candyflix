import Link from "next/link";
import { stateActionClass } from "@/components/EmptyState";

/** The branded 404, shared by the root and (main) not-found files. */
export default function NotFoundState() {
  return (
    <div className="animate-fade-up flex min-h-[50vh] flex-col items-center justify-center gap-5 px-6 py-20 text-center">
      <p className="font-[family-name:var(--font-display)] text-7xl font-semibold text-[#FF5FA2]/80">404</p>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-white">
          We couldn&apos;t find that
        </h1>
        <p className="mx-auto max-w-sm text-sm text-white/50">
          The page may have moved, or the title isn&apos;t available. Let&apos;s get you back to something to watch.
        </p>
      </div>
      <Link href="/" className={stateActionClass}>
        Back to home
      </Link>
    </div>
  );
}
